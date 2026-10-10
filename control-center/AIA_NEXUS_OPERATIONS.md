# AIA NEXUS Operations Manual

This is the manual operator's companion to the Control Center dashboard. Every command below is real PowerShell, verified live on this host during the build and monitoring of this tool — not generic boilerplate.

---

## 1. How to start the dashboard

```powershell
cd C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\control-center
npm run dev
```

Opens on **http://localhost:4040**. First visit to each page takes a few seconds in dev mode (Next.js compiles routes on demand) — this is normal, not a failure.

## 2. How to stop the dashboard

Close the terminal running `npm run dev`, or:

```powershell
$conn = Get-NetTCPConnection -LocalPort 4040 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
```

**Stopping the dashboard never touches the 5 real agents.** They are separate Windows Scheduled Tasks, started independently at Windows logon.

## 3. How to verify it's working

```powershell
Invoke-RestMethod http://localhost:4040/api/system
```
- **GREEN**: returns JSON with real `ramTotalMb`/`ramUsedMb` values.
- **WARNING**: request succeeds but `cpuPercent` is `null` (host limitation, not a dashboard bug — see §16).
- **CRITICAL**: connection refused — the dashboard itself isn't running (restart with §1).

---

## 4. How to check Agent 1 (Analyze)

**Purpose**: confirm Agent 1 is alive and see what it's currently transcribing/classifying.

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'agent[\\/]analyze[\\/]run\.mts' } | Select-Object ProcessId, CommandLine
```
- **GREEN**: 2 processes returned (the `tsx` wrapper + its `node` loader child).
- **WARNING**: 0 processes but the task is `Ready` (not `Running`) — it finished a pass and is between relaunches; check again in ~10s.
- **CRITICAL**: 0 processes and the Windows Task reports `Running` (see §10) — process/task mismatch, possible crash.

```powershell
Get-Content "C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\logs\analyze-agent-stdout.log" -Tail 20
```
Look for `[WHISPER] iniciando` / `[WHISPER] terminado` / `[OLLAMA]` lines — these show real transcription/classification progress. **Never** a percentage (Whisper doesn't report one).

## 5. How to check Agent 2 (Production)

**Purpose**: confirm Agent 2 is alive, and understand why it's idle if nothing is rendering.

```powershell
Get-Content "C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\scripts\pipeline\state\agent.lock" | ConvertFrom-Json
```
- **GREEN**: returns `{pid, startedAt}` and `Get-Process -Id <pid>` succeeds.
- **CRITICAL — `STALE_AGENT2_LOCK`**: the lock file exists but `Get-Process -Id <pid>` fails (`Cannot find a process...`). Agent 2 crashed without cleaning up. **Do not delete the lock file manually** unless you've confirmed with the Control Center's Incidents page and understand the consequence — report it, don't "fix" it ad hoc.

```powershell
Get-Content "C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\logs\pipeline-2026-10-02.log" -Tail 20
```
Lines like `[AGENT] SIN EXPLICACIÓN/012: sin encolar — COMPLETED — requiere nueva autorización` are **normal** — Agent 2 is actively evaluating its queue and correctly declining to re-render already-completed or unauthorized projects. This is GREEN, not an error.

## 6. How to check the Watcher

**Purpose**: confirm new material is actually being detected.

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'agent[\\/]run\.mts' } | Select-Object ProcessId, CommandLine
```
Remember: this is the task named **`AIANexusPulse`** — the name was historically misleading before the AIA NEXUS rebrand (it used to be `VisteapyAgentPublicacion`), the script is the Watcher.

```powershell
Get-Content "C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\agent\logs\task-wrapper.log" -Tail 10
```
- **GREEN**: recent `[INFO]` lines, no repeated "reiniciando" (restart) messages in a tight loop.
- **CRITICAL — crash loop**: the same restart message repeating every few seconds for more than a few minutes.

## 7. How to check the Scheduler

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'agent[\\/]schedule[\\/]run\.mts' }
```
The Scheduler's wrapper does one pass then exits and relaunches — **0 processes with the Windows Task still `Running`** is expected and normal (WARNING at worst, not CRITICAL), unlike the other 4 agents which stay resident.

## 8. How to check the Publisher

**Purpose**: the single most safety-critical check — confirm nothing published without authorization.

```powershell
Get-Content "C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\logs\publish-agent-stdout.log" -Tail 20
```
Look for `Publicado con exito` lines and cross-check the `postId` against Supabase (§9) — it must have a real `publication_authorized_at`/`publication_authorized_by`.

- **CRITICAL**: any `social_posts` row with `status=published` and no `publication_authorized_at`/`_by` — the Control Center's Incidents page flags this automatically as `UNAUTHORIZED_PUBLICATION`. If you ever see this, **do not try to "fix" it by deleting or editing the row** — stop and investigate what bypassed the gate.

## 9. How to check Windows Tasks

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -match '^AIANexus' } | ForEach-Object {
  $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath
  [PSCustomObject]@{ TaskName = $_.TaskName; State = $_.State; LastRunTime = $info.LastRunTime; LastTaskResult = $info.LastTaskResult }
} | Format-Table
```
- **GREEN**: `State=Running` for all 5 (while logged in), or `State=Ready` for all 5 with no new logon yet.
- **WARNING**: `State=Ready` for a task whose `LastTaskResult` is non-zero and non-`267009` (`267009` = "task is currently running", a normal transient code).
- **CRITICAL**: a task shows `Disabled`.

Remember: all 5 tasks use `LogonTrigger` — they only (re)start at a genuine Windows logon, **not** at `Win+L` lock/unlock. Verified live: `explorer.exe`'s `CreationDate` and `Win32_OperatingSystem.LastBootUpTime` are the reliable proxies for "did a real logon/reboot happen":

```powershell
(Get-CimInstance Win32_Process -Filter "name='explorer.exe'").CreationDate
(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
```

## 10. How to check Supabase

```powershell
cd C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido
# Use the project's own read-only review queue script rather than querying Supabase ad hoc:
npx tsx agent/publish/list-review-queue.mts
```
Or via the dashboard: `http://localhost:4040/database?table=social_posts`.

**Never run `select("*")` against `social_accounts`** — it contains `credentials`. The Control Center's own client never does this (enforced by `test/supabaseProjection.test.ts`); if you're querying manually, always list explicit columns.

## 11. How to review processes

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe' or name='ffmpeg.exe'" | Select-Object ProcessId, ParentProcessId, CommandLine
```
**Always read `CommandLine`, never trust the process name alone.** Verified live this session: a real `node.exe` belonging to Adobe Creative Cloud Experience was running alongside the pipeline's own processes — matching on name alone would have misattributed it.

## 12. How to review memory

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object @{N="UsedPercent";E={[math]::Round((($_.TotalVisibleMemorySize-$_.FreePhysicalMemory)/$_.TotalVisibleMemorySize)*100,0)}}
```
- **GREEN**: < 85% used.
- **WARNING**: 85–95% used, especially while Whisper is running (it's memory-hungry).
- **CRITICAL**: > 95% used, or the system becomes unresponsive.

## 13. How to review logs

Daily logs **never rotate or delete themselves** — some real files on this host exceed 20 MB. Always use `-Tail`, never open the whole file in a text editor casually.

```powershell
Get-Content "C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido\agent\logs\agent-2026-10-02.log" -Tail 50 -Wait
```
(`-Wait` tails live, like `tail -f`.) Or just use the dashboard's `/logs` page, which does this incrementally without ever reading the whole file.

## 14. How to investigate an episode

Use the dashboard's **`/trace`** page: search by filename (`LUNA VERDE\Clips\001 - Clip 1.mp4`), `content_file_id`, `content_metadata_id`, `social_post_id`, or `external_post_id`. Every event in the resulting timeline is tagged with its evidence source (`SUPABASE`/`LOG`/`MANIFEST`/...) — trust `SUPABASE`-tagged facts over anything `LOG`-tagged (which is parsed/inferred).

## 15. How to investigate a publication

1. `/trace` with the `social_post_id` or `external_post_id`.
2. Confirm `publication_authorized_at`/`_by` are both present — if either is missing on a `published` row, this is `CRITICAL`, stop and report, do not edit the row.
3. Verify independently against the real platform (YouTube `videos.list`, Meta Graph API, TikTok) — the dashboard shows what Supabase says; it does **not** call any platform API itself (by design — it must never need platform credentials).

## 16. How to investigate an error

`/incidents` page, or:

```powershell
Invoke-RestMethod http://localhost:4040/api/incidents | Select-Object -ExpandProperty incidents | Format-Table severity, type, title
```

## 17. GREEN / WARNING / CRITICAL — overall system

**GREEN**: no CRITICAL incidents; `PAUSE_AGENTS` absent (if 24/7 operation is intended) or present (if intentionally paused — both are valid states, not errors); all 5 tasks `Running` or legitimately `Ready` awaiting next logon; Agent 2's lock (if present) points to a live PID.

**WARNING**: any of — a legacy conflict file with pending unauthorized posts; files missing `episode_id` with pending unauthorized posts; the Scheduler transiently showing 0 processes between passes; CPU reporting `UNAVAILABLE`.

**CRITICAL**: any of — a `published` post missing authorization; a duplicate `(content_file_id, account_id)` pair; an active `content_account` outside the 4 production accounts; a stale Agent 2 lock; credentials ever appearing in an API response.

## 18. What NOT to touch

- `agent/runtime/PAUSE_AGENTS` — never create/delete it from the dashboard or while "just checking something."
- `scripts/pipeline/state/agent.lock`, `queue.json`, or any `projects/*.json` manifest — read-only, always.
- The 5 Windows Scheduled Tasks — never `Start-ScheduledTask`/`Stop-ScheduledTask`/`Disable-ScheduledTask` them as part of routine observation.
- Any `social_posts` row — authorization happens only through `agent/publish/authorize-publication.mts`, run deliberately, never through this dashboard (which has no write path at all).
- `D:\MATERIAL VIDEOS` — never scan it directly; `content_files` in Supabase already mirrors everything the real Watcher has registered.

## 19. Incident protocol

1. Note the incident's `type`, `severity`, and full `evidence` from `/incidents`.
2. Cross-check with `/trace` for the specific file/post involved.
3. **Do not attempt an automated fix** — this dashboard has no write path, by design, specifically so that observation can never become intervention by accident.
4. Escalate to a human decision: does this need `agent/publish/authorize-publication.mts`, `pipeline:authorize`, a manual Supabase correction, or just documentation as a known legacy artifact (e.g. the ROANOKE conflict file)?

## 20. Recovery protocol

Recovery actions (clearing a stale lock, resolving a conflict, re-authorizing a project) all go through the **core project's own existing mechanisms** (`npm run pipeline:authorize`, `npm run social:authorize-publication`, etc. — see the root `package.json`), never through the Control Center. If the dashboard itself misbehaves (stuck SSE connection, stale data), the only "recovery" is restarting `npm run dev` (§1/§2) — this never affects the real agents.
