# AIA NEXUS CONTROL CENTER V1

A **read-only** observability dashboard for the AIA NEXUS AUTOMATION 24/7 content pipeline (SIN EXPLICACIÓN, ENCIENDE EL CAOS, LUNA VERDE, OBJETOS MALDITOS). It observes AIA NEXUS SCOUT, AIA NEXUS FORGE, AIA NEXUS PULSE, AIA NEXUS SCHEDULER, and AIA NEXUS PUBLISHER — it never starts, stops, restarts, or otherwise influences them.

## What this is

An independent Next.js application living in `control-center/`, with its own `package.json` and `node_modules`, never merged into the root project. It reads:

- **Supabase** (via its own read-only client, explicit columns only, never `credentials`)
- **The filesystem** (log files, `scripts/pipeline/state/agent.lock`, `agent/runtime/PAUSE_AGENTS`)
- **Windows** (`Get-ScheduledTask`, `Get-CimInstance Win32_Process`, `Win32_OperatingSystem`)

…and renders it. It has no write path into any of those systems.

## Why the role mapping matters

The 5 real Windows Scheduled Tasks do **not** map to their roles the way their names suggest. Verified live against `Get-ScheduledTask ... Actions.Arguments`:

| Task name | Real script | Real role |
|---|---|---|
| `AIANexusScout` | `agent/analyze/run.mts` | AIA NEXUS SCOUT |
| `AIANexusForge` | `scripts/pipeline/agent.mts` | AIA NEXUS FORGE |
| **`AIANexusPulse`** | `agent/run.mts` | **AIA NEXUS PULSE** (the Watcher — not the Publisher!) |
| `AIANexusPublisher` | `agent/publish/run.mts` | AIA NEXUS PUBLISHER (the real one) |
| `AIANexusScheduler` | `agent/schedule/run.mts` | AIA NEXUS SCHEDULER |

Every part of this app resolves role from the real script path (`lib/observability/roles.ts`), never from the task name string. `test/roles.test.ts` enforces this with a dedicated test.

## Architecture

```
AIA NEXUS AUTOMATION CORE (never touched)
        │  read-only: filesystem + Supabase + Windows
        ▼
lib/observability/*            ← the Observability API, as plain library functions
        │  consumed by
        ▼
app/api/**/route.ts             ← GET-only Next.js route handlers
        │
        ▼
app/**/page.tsx                 ← React Server/Client pages (polling + SSE)
```

### `lib/observability/`

| File | Responsibility |
|---|---|
| `roles.ts` | Single source of truth for task↔script↔role mapping |
| `powershell.ts` | Hardened PowerShell runner — every call site passes a hardcoded script, enforced by `test/powershellSafety.test.ts` |
| `processMonitor.ts` | Finds real agent processes by `CommandLine`, never by `node.exe` alone |
| `taskMonitor.ts` | Reads the 5 Windows Tasks (`Get-ScheduledTask`/`Get-ScheduledTaskInfo`, read-only) |
| `systemMonitor.ts` | RAM (reliable), CPU (`UNAVAILABLE` if the host doesn't report it — never fabricated), boot time, logon-time proxy |
| `agentLock.ts` | Reads `scripts/pipeline/state/agent.lock` (Agent 2's real PID+startedAt) |
| `supabaseReadOnly.ts` | The only Supabase client in this app — explicit columns only, `credentials` never selected |
| `pipelineMonitor.ts` | Derives pipeline-stage counts and per-account summaries from Supabase |
| `agentStatusMonitor.ts` | Composes processes+tasks+lock+log-tail into one `AgentStatus` per role — anything from a log line is marked `inferred: true` |
| `logTailer.ts` | Offset-based incremental log tail — never a full re-read of a log file |
| `traceMonitor.ts` | Reconstructs a file/episode/post timeline from real evidence, each event tagged with its source |
| `incidentDetector.ts` | Read-only incident classifier (GREEN/WARNING/CRITICAL) |
| `codeExplorer.ts` | Whitelisted, read-only file access for `/code` — rejects path traversal and disallowed extensions |

### Pages

Overview (`/`), Agents (`/agents`), Pipeline (`/pipeline`), Trace (`/trace`), Logs (`/logs`), Code (`/code`, Monaco read-only), Database (`/database`), Accounts (`/accounts`), Incidents (`/incidents`).

## Real-time model

- **Live Activity / Logs**: Server-Sent Events (`/api/events`), one direction only — `Browser ← SSE ← read-only events`. The stream never reads a request body and accepts no parameters; there is no way for a client to send a command through it.
- **Processes / Tasks**: polled every 3–5s.
- **Database counters**: polled every 10s.
- **System RAM/boot**: polled every 30s.
- **Code**: on-demand only.

## Security invariants (enforced by tests, not just convention)

1. `supabaseReadOnly.ts` never calls `select("*")`, and `social_accounts.credentials` is never in any select list — `test/supabaseProjection.test.ts`.
2. No `app/api/**/route.ts` exports `POST`/`PUT`/`PATCH`/`DELETE` — `test/apiReadOnly.test.ts`.
3. Every `runPowerShell(...)` call site passes a hardcoded script; the only permitted interpolation is a `Number()`-cast local value (e.g. a PID read from a local lock file) — never request input — `test/powershellSafety.test.ts`.
4. `/api/code/file` rejects absolute paths, `..` segments, and anything outside the whitelist or allowed extensions — `test/codeExplorer.test.ts`.
5. `AIANexusPulse` must resolve to the Watcher, never the Publisher — `test/roles.test.ts`.

## Known limitations

- **Whisper progress**: Whisper reports no percentage. The UI shows `UNKNOWN` and never simulates one.
- **CPU**: on this host, `Win32_Processor.LoadPercentage` is sometimes empty; when that happens the UI shows `UNAVAILABLE` rather than a fabricated number.
- **Exact logon time**: the Windows Security log requires admin rights and isn't read here. `approximateLastLogonTime` is a proxy (`explorer.exe` process start time), clearly labeled as such.
- **"Producing"/"Produced" pipeline stages**: not yet derived from a single Supabase field — see the Accounts/Pipeline pages' note, and read `scripts/pipeline/state/projects/*.json` manifests directly via `/code` for authoritative per-episode production state.
- Next.js is pinned to `14.2.35` (not the `16.x` major). `npm audit` still reports advisories whose full GHSA range includes this version — assessed as low real-world risk here because the app is loopback-only and never exposed beyond `localhost`. See `AIA_NEXUS_OPERATIONS.md` for the full V2 recommendation.

## V2 recommendations (not implemented)

- Upgrade to Next.js 15/16 once the App Router API changes can be tested properly.
- A dedicated `queue.json`/manifest watcher for real-time "Producing" status instead of inferring it from `social_posts`.
- Persist incident history (currently recomputed fresh on every poll) so a resolved incident's timeline isn't lost.
- Expose CPU-per-process (not just aggregate) if `Get-Process` CPU sampling proves reliable on this host over time.
