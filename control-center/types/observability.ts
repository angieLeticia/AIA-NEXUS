// Shared types for the observability layer. Deliberately decoupled from the
// core pipeline's own types (agent/*.mts, scripts/pipeline/types.mts) — the
// Control Center never imports core modules, only observes their output
// (filesystem, Supabase, OS processes, Windows Tasks), so it defines its own
// minimal shapes here instead of depending on code it must never execute.

export type Severity = "GREEN" | "WARNING" | "CRITICAL";

export type SystemStatus = "ONLINE" | "DEGRADED" | "WARNING" | "CRITICAL" | "OFFLINE";

// The 5 real roles, keyed by the actual script each one runs — never by
// Windows Task name, since AIANexusPulse actually runs agent/run.mts
// (the Watcher), not the Publisher. See ROLE_DEFINITIONS in lib/observability/roles.ts.
export type AgentRole = "agent1" | "agent2" | "watcher" | "scheduler" | "publisher";

// P2.12J — PAUSED/STALE_LOCK añadidos para que un lock con PID muerto deje de
// clasificarse incondicionalmente como ERROR (falso positivo real, ver
// agentStatusMonitor.ts::runtimeStatusFor y agentLock.ts::classifyAgent2Lock):
// PAUSED = detenido por mantenimiento (PAUSE_AGENTS/PAUSE_PRODUCTION presente,
// hecho estructural, no inferido); STALE_LOCK = lock obsoleto sin evidencia
// suficiente para afirmar que hubo un fallo real; ERROR sigue reservado para
// cuando SÍ hay evidencia estructural de un fallo real (ej. LastTaskResult de
// Windows ≠ 0), nunca solo por el PID muerto.
export type AgentRuntimeStatus = "ACTIVE" | "IDLE" | "WAITING" | "ERROR" | "STOPPED" | "UNKNOWN" | "PAUSED" | "STALE_LOCK";

export interface ProcessInfo {
  pid: number;
  parentPid: number | null;
  commandLine: string;
  startTime: string | null; // ISO, null if unavailable
}

export interface AgentStatus {
  role: AgentRole;
  label: string;
  entrypoint: string; // real script path, e.g. "agent/analyze/run.mts"
  taskName: string; // the (possibly misleading) Windows Task name
  status: AgentRuntimeStatus;
  processes: ProcessInfo[]; // 0, 1, or 2 (wrapper + tsx loader child)
  lastLogActivityAt: string | null; // ISO
  currentStage: string | null; // e.g. "TRANSCRIBING" — inferred from log tail
  currentFile: string | null; // inferred from log tail
  currentAccount: string | null; // inferred from log tail
  currentEpisode: string | null; // inferred from log tail
  inferred: boolean; // true whenever stage/file/account/episode come from log parsing, not a structured source
  idleReason: string | null; // e.g. "No AUTHORIZED projects available" for Agent 2
  lock?: {
    path: string;
    pid: number;
    startedAt: string;
    processAlive: boolean;
  };
}

export interface TaskStatus {
  taskName: string;
  realRole: AgentRole;
  realRoleLabel: string;
  entrypoint: string;
  state: "Running" | "Ready" | "Disabled" | "Unknown";
  lastRunTime: string | null;
  nextRunTime: string | null;
  lastTaskResult: number | null;
  trigger: string | null;
}

export interface SystemResources {
  ramTotalMb: number | null;
  ramUsedMb: number | null;
  ramFreeMb: number | null;
  ramUsedPercent: number | null;
  cpuPercent: number | null; // null => UNAVAILABLE, never fabricated
  cpuSource: "win32_processor" | "get-process-aggregate" | "unavailable";
  nodeProcessCount: number;
  ffmpegProcessCount: number;
  ollamaRunning: boolean;
  lastBootUpTime: string | null;
  approximateLastLogonTime: string | null; // proxy via explorer.exe CreationDate
  pauseAgentsPresent: boolean;
}

export interface PipelineStageCounts {
  files: number;
  analyzing: number;
  ready: number;
  authorized: number;
  producing: number;
  produced: number;
  pendingPublication: number;
  published: number;
  errors: number;
}

export interface AccountSummary {
  account: string;
  ready: number;
  pending: number;
  processing: number;
  error: number;
  authorized: number;
  producing: number;
  published: number;
}

export type EvidenceSource = "SUPABASE" | "LOG" | "MANIFEST" | "PROCESS" | "TASK" | "FILESYSTEM";

export interface TraceEvent {
  stage: string;
  status: "DONE" | "IN_PROGRESS" | "PENDING" | "ERROR" | "UNKNOWN";
  timestamp: string | null;
  source: EvidenceSource;
  detail: string | null;
}

export interface TraceResult {
  query: string;
  matched: {
    contentFileId?: string;
    contentMetadataId?: string;
    socialPostIds?: string[];
    account?: string;
    episode?: string;
    filePath?: string;
  };
  timeline: TraceEvent[];
}

export interface LogLine {
  timestamp: string;
  component: string;
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  message: string;
  raw: string;
  sourceFile: string;
}

export interface Incident {
  id: string;
  severity: Severity;
  type: string;
  title: string;
  detail: string;
  detectedAt: string;
  evidence: Record<string, unknown>;
}

export interface LiveEvent {
  timestamp: string;
  source: EvidenceSource;
  component: string;
  severity: Severity;
  message: string;
}
