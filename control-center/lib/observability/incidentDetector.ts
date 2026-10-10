// Read-only incident classifier. Never writes, never "fixes" anything it
// finds — every function here only returns Incident[] describing what was
// observed. Severity is only ever CRITICAL when there is direct evidence
// (an actual published-without-authorization row, an actual duplicate
// (content_file_id, account_id) pair, etc.) — never speculative.
import { getAgent2Lock, classifyAgent2Lock } from "./agentLock";
import { getTaskStatuses } from "./taskMonitor";
import { getProcessSnapshot } from "./processMonitor";
import { getContentAccounts, getContentFiles, getSocialAccounts, getSocialPosts } from "./supabaseReadOnly";
import { isPauseActiveFor } from "./agentStatusMonitor";
import type { Incident } from "@/types/observability";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function detectIncidents(): Promise<Incident[]> {
  const incidents: Incident[] = [];
  const now = new Date().toISOString();

  const [lock, tasks, processes, accounts, files, socialAccounts, posts] = await Promise.all([
    getAgent2Lock(),
    getTaskStatuses(),
    getProcessSnapshot(),
    getContentAccounts(),
    getContentFiles(3000),
    getSocialAccounts(),
    getSocialPosts(5000),
  ]);

  // 1. Stale Agent 2 lock: file exists, PID not alive. P2.12J — corregido:
  // esto NO implica por sí solo un crash (falso positivo real confirmado en
  // producción: el lock quedó huérfano por una detención deliberada durante
  // mantenimiento, no por un fallo). Se reutiliza la MISMA clasificación que
  // ya usa agentStatusMonitor.ts (classifyAgent2Lock) — nunca una regla
  // paralela — para decidir si esto es: PAUSED (esperado, no se reporta
  // ningún incidente), STALE_LOCK (ambiguo, WARNING informativo) o ERROR
  // (evidencia estructural real de fallo — LastTaskResult de Windows ≠ 0 —
  // único caso que mantiene CRITICAL, consistente con el principio ya
  // documentado arriba: "Severity is only ever CRITICAL when there is direct
  // evidence... never speculative").
  if (lock && !lock.processAlive) {
    const agent2Task = tasks.find((t) => t.realRole === "agent2");
    const agent2Group = processes.agentGroups.find((g) => g.role === "agent2");
    const classification = classifyAgent2Lock({
      lock,
      hasProcess: (agent2Group?.processes.length ?? 0) > 0,
      pauseActive: isPauseActiveFor("PAUSE_PRODUCTION"),
      wrapperLastTaskResult: agent2Task?.lastTaskResult ?? null,
    });

    if (classification === "ERROR") {
      incidents.push({
        id: nextId("agent2-error"),
        severity: "CRITICAL",
        type: "AGENT2_REAL_ERROR",
        title: "Agent 2 real failure confirmed",
        detail: `scripts/pipeline/state/agent.lock references PID ${lock.pid} (started ${lock.startedAt}), not running — AND Windows Task Scheduler reports a real failure exit code for the wrapper (LastTaskResult=${agent2Task?.lastTaskResult}). This is structural evidence of a real failure, not an inference from log text.`,
        detectedAt: now,
        evidence: { lockPath: lock.path, pid: lock.pid, startedAt: lock.startedAt, lastTaskResult: agent2Task?.lastTaskResult ?? null },
      });
    } else if (classification === "STALE_LOCK") {
      incidents.push({
        id: nextId("stale-lock"),
        severity: "WARNING",
        type: "STALE_AGENT2_LOCK",
        title: "Stale Agent 2 lock (cause undetermined)",
        detail: `scripts/pipeline/state/agent.lock references PID ${lock.pid} (started ${lock.startedAt}), not currently running. No maintenance pause is active and no confirmed failure evidence was found — cause undetermined. Self-heals automatically on Agent 2's next real start (agentLock.mts::acquireLock() reclaims a dead-PID lock); no manual deletion needed.`,
        detectedAt: now,
        evidence: { lockPath: lock.path, pid: lock.pid, startedAt: lock.startedAt },
      });
    }
    // classification === "PAUSED": completamente explicado por mantenimiento activo — no se reporta como incidente.
  }

  // 2. Task not running vs process evidence mismatch: a task reports Running
  // but no matching process was found for its role (or vice versa, informational only).
  for (const task of tasks) {
    const group = processes.agentGroups.find((g) => g.role === task.realRole);
    if (task.state === "Running" && (!group || group.processes.length === 0)) {
      incidents.push({
        id: nextId("task-process-mismatch"),
        severity: "WARNING",
        type: "TASK_RUNNING_NO_PROCESS",
        title: `${task.taskName} reports Running but no matching process found`,
        detail: `Real role: ${task.realRoleLabel} (${task.entrypoint}). Task Scheduler says Running but no node.exe process with this entrypoint in its CommandLine was found.`,
        detectedAt: now,
        evidence: { taskName: task.taskName, entrypoint: task.entrypoint },
      });
    }
  }

  // 3. Unrelated node.exe processes sharing the image name (informational, not an incident per se,
  // but worth surfacing since it was a real false-positive encountered during manual monitoring).
  if (processes.unrelatedNodeProcessCount > 0) {
    incidents.push({
      id: nextId("unrelated-node"),
      severity: "GREEN",
      type: "UNRELATED_NODE_PROCESS",
      title: `${processes.unrelatedNodeProcessCount} node.exe process(es) unrelated to the pipeline`,
      detail: "Detected via CommandLine filtering — these do not belong to any of the 5 agent roles and are not counted as agent activity.",
      detectedAt: now,
      evidence: { count: processes.unrelatedNodeProcessCount },
    });
  }

  // 4. Unauthorized publication: status=published but authorization fields missing. Should be
  // structurally impossible given the Publisher's own gate, but this is the one check that must
  // never be skipped — it is the single CRITICAL condition the whole system exists to prevent.
  for (const post of posts) {
    if (post.status === "published" && (!post.publication_authorized_at || !post.publication_authorized_by)) {
      incidents.push({
        id: nextId("unauthorized-pub"),
        severity: "CRITICAL",
        type: "UNAUTHORIZED_PUBLICATION",
        title: "Published post missing human authorization",
        detail: `social_posts.id=${post.id} is published but publication_authorized_at/_by is missing.`,
        detectedAt: now,
        evidence: { socialPostId: post.id, externalPostId: post.external_post_id },
      });
    }
  }

  // 5. Duplicate (content_file_id, account_id) pairs — should be structurally prevented by the
  // real UNIQUE index, surfaced here only as a sanity check.
  const seen = new Map<string, string>();
  for (const post of posts) {
    if (!post.content_file_id) continue;
    const key = `${post.content_file_id}::${post.account_id}`;
    if (seen.has(key)) {
      incidents.push({
        id: nextId("dup-post"),
        severity: "CRITICAL",
        type: "DUPLICATE_SOCIAL_POST",
        title: "Duplicate (content_file_id, account_id) social_post pair",
        detail: `Posts ${seen.get(key)} and ${post.id} both target the same content_file_id+account_id.`,
        detectedAt: now,
        evidence: { postIds: [seen.get(key), post.id] },
      });
    } else {
      seen.set(key, post.id);
    }
  }

  // 6. Scope violation: any content_account outside the 4 closed production names.
  const PRODUCTION_NAMES = new Set(["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"]);
  for (const acc of accounts) {
    if (acc.is_active && !PRODUCTION_NAMES.has(acc.folder_name) && !acc.folder_name.startsWith("FASE4_TEST")) {
      incidents.push({
        id: nextId("scope-violation"),
        severity: "CRITICAL",
        type: "SCOPE_VIOLATION",
        title: `Active account outside RUN_SCOPE: ${acc.folder_name}`,
        detail: "An active content_account exists outside the 4 authorized production accounts.",
        detectedAt: now,
        evidence: { account: acc.folder_name, id: acc.id },
      });
    }
  }

  // 7. Known legacy conflicts — ROANOKE under LUNA VERDE, prueva video.mp4 under ENCIENDE EL CAOS.
  // Detected generically (not hardcoded by name): any content_file with status=account_conflict,
  // plus any social_post referencing a conflicted or no-episode legacy file that has a new
  // *unauthorized pending* post (the real risk pattern observed this session).
  const fileById = new Map(files.map((f) => [f.id, f]));
  const accountNameById = Object.fromEntries(accounts.map((a) => [a.id, a.folder_name]));
  for (const file of files) {
    if (file.status === "account_conflict") {
      const relatedPending = posts.filter((p) => p.content_file_id === file.id && p.status === "pending" && !p.publication_authorized_at);
      incidents.push({
        id: nextId("legacy-conflict"),
        severity: relatedPending.length > 0 ? "WARNING" : "GREEN",
        type: "LEGACY_CONFLICT_FILE",
        title: `Conflict file under ${accountNameById[file.content_account_id] ?? file.content_account_id}`,
        detail: `${file.file_path} — ${file.error_message ?? "account_conflict"}.${
          relatedPending.length > 0 ? ` ${relatedPending.length} pending (unauthorized) social_post(s) exist for it — do not authorize.` : ""
        }`,
        detectedAt: now,
        evidence: { contentFileId: file.id, pendingPostIds: relatedPending.map((p) => p.id) },
      });
    }
  }

  // Files with no episode_id and >=1 pending unauthorized post. This is NOT
  // necessarily a "legacy/test" file — verified live that most matches here
  // are real production clips (e.g. "SIN EXPLICACIÓN/Clips/012 - Parte 1.mp4")
  // that are simply missing episode_id in content_files, a real data-quality
  // gap in the core pipeline, distinct from an actual test filename. Reported
  // as ONE aggregated incident per account (not one row per file) to avoid
  // alarm-fatigue noise — the per-file list is still in `evidence` for drill-down.
  // Filenames that look like actual test content (prueba/prueva/test, with no
  // real episode-number prefix at all) are called out separately in the detail text.
  const noEpisodePendingByAccount = new Map<string, { file: (typeof files)[number]; pendingPostIds: string[] }[]>();
  for (const file of files) {
    if (file.episode_id || file.folder_type !== "clip" || file.status === "account_conflict") continue;
    const relatedPending = posts.filter((p) => p.content_file_id === file.id && p.status === "pending" && !p.publication_authorized_at);
    if (relatedPending.length === 0) continue;
    const accountName = accountNameById[file.content_account_id] ?? file.content_account_id;
    const list = noEpisodePendingByAccount.get(accountName) ?? [];
    list.push({ file, pendingPostIds: relatedPending.map((p) => p.id) });
    noEpisodePendingByAccount.set(accountName, list);
  }
  for (const [accountName, entries] of noEpisodePendingByAccount) {
    const looksLikeTestFile = (name: string) => /prueb|prueva|\btest\b/i.test(name);
    const testFiles = entries.filter((e) => looksLikeTestFile(e.file.file_path));
    const realFilesMissingEpisode = entries.filter((e) => !looksLikeTestFile(e.file.file_path));
    incidents.push({
      id: nextId("no-episode-pending"),
      severity: "WARNING",
      type: "NO_EPISODE_ID_PENDING_AUTH",
      title: `${accountName}: ${entries.length} clip(s) with no episode_id have pending unauthorized post(s)`,
      detail:
        `${realFilesMissingEpisode.length} appear to be real production files missing episode_id in content_files (a data-quality gap, not test content)` +
        (testFiles.length > 0 ? `, and ${testFiles.length} filename(s) look like actual test content (${testFiles.map((e) => e.file.file_path.split("\\").pop()).join(", ")})` : "") +
        ". Review each before authorizing — episode identity cannot be confirmed from the filename alone.",
      detectedAt: now,
      evidence: { files: entries.map((e) => ({ contentFileId: e.file.id, filePath: e.file.file_path, pendingPostIds: e.pendingPostIds })) },
    });
  }

  // 8. Credentials sanity: never possible to trip this from this app (supabaseReadOnly.ts never
  // selects `credentials`), kept here as a structural self-check that always passes — serves as
  // a canary if someone edits that file to select "*" in the future.
  const sampleHasCredentials = (socialAccounts as unknown as Record<string, unknown>[]).some((a) => "credentials" in a);
  if (sampleHasCredentials) {
    incidents.push({
      id: nextId("credentials-exposed"),
      severity: "CRITICAL",
      type: "CREDENTIALS_EXPOSED",
      title: "social_accounts query returned a credentials field",
      detail: "supabaseReadOnly.ts must never select the credentials column. This indicates a regression in that file.",
      detectedAt: now,
      evidence: {},
    });
  }

  return incidents.sort((a, b) => {
    const order = { CRITICAL: 0, WARNING: 1, GREEN: 2 };
    return order[a.severity] - order[b.severity];
  });
}
