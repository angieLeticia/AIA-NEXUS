// Composes process + task + lock + log-tail evidence into one AgentStatus per
// role. Anything derived from parsing a log line is marked `inferred: true` —
// never presented as a structured fact (see PHASE_CONTROL_CENTER_AUDIT §5).
import { existsSync } from "node:fs";
import path from "node:path";
import { getProcessSnapshot } from "./processMonitor";
import { getTaskStatuses } from "./taskMonitor";
import { getAgent2Lock, classifyAgent2Lock, type Agent2LockClassification } from "./agentLock";
import { logSourcesForToday, readNewLines } from "./logTailer";
import { ROLE_DEFINITIONS, CORE_ROOT } from "./roles";
import type { AgentStatus, AgentRole, AgentRuntimeStatus } from "@/types/observability";

const RUNTIME_DIR = path.join(CORE_ROOT, "agent", "runtime");
const PAUSE_AGENTS_GLOBAL = path.join(RUNTIME_DIR, "PAUSE_AGENTS");

// P2.12J — misma jerarquía OR que cada wrapper .ps1 ya implementa
// (PAUSE_AGENTS global O el marcador específico del rol) — nunca se duplica
// la lógica, solo se LEE el mismo par de archivos que el wrapper real verifica.
export function isPauseActiveFor(pauseFile: string): boolean {
  return existsSync(PAUSE_AGENTS_GLOBAL) || existsSync(path.join(RUNTIME_DIR, pauseFile));
}

// Rolling in-memory buffer of the last parsed line per role, used to infer
// current stage/file without re-reading the whole log on every request.
const lastKnownLine = new Map<AgentRole, { timestamp: string; message: string }>();

function extractFilePath(message: string): string | null {
  const m = message.match(/"filePath":"([^"]+)"/) ?? message.match(/filePath=([^\s,}]+)/);
  return m ? m[1].replace(/\\\\/g, "\\") : null;
}

function extractAccount(filePath: string | null): string | null {
  if (!filePath) return null;
  const m = filePath.match(/MATERIAL VIDEOS\\([^\\]+)\\/);
  return m ? m[1] : null;
}

function extractEpisode(filePath: string | null): string | null {
  if (!filePath) return null;
  const base = filePath.split("\\").pop() ?? "";
  const m = base.match(/^(\d+)\s*-/);
  return m ? m[1] : null;
}

function extractStage(message: string): string | null {
  if (/\[WHISPER\].*iniciando/i.test(message)) return "TRANSCRIBING";
  if (/\[WHISPER\].*terminado/i.test(message)) return "TRANSCRIPT_READY";
  if (/\[OLLAMA\].*iniciando/i.test(message)) return "CLASSIFYING";
  if (/\[OLLAMA\].*recibida|guardado/i.test(message)) return "METADATA_SAVED";
  if (/\[SCHEDULE\]/i.test(message)) return "SCHEDULING";
  if (/\[PUBLISH\]|Publicado con exito|Claim ganado/i.test(message)) return "PUBLISHING";
  if (/watcher|chokidar/i.test(message)) return "WATCHING";
  if (/\bAGENT\b.*sin encolar|AGENT\].*COMPLETED|AGENT\].*READY/i.test(message)) return "EVALUATING_QUEUE";
  return null;
}

// P2.12O — hallazgo real: un rol (agent2 sobre todo) tiene VARIAS fuentes de
// log (wrapper/stdout/stderr/diario), leídas en orden fijo cada poll. Antes
// de esta corrección, cada línea nueva SOBRESCRIBÍA lastKnownLine sin
// comparar marcas de tiempo — si una fuente (ej. pipeline-agent-stdout.log,
// alimentada por la redirección de stdout de PowerShell, que puede llegar
// con buffering/retraso) entregaba líneas nuevas DESPUÉS que la fuente
// diaria (pipeline-<fecha>.log, escrita en tiempo real por logger.mts) en el
// mismo ciclo de poll, un lote de líneas viejas ("sin encolar...") podía
// pisar el estado real y más reciente ya visto — confirmado en vivo: el
// dashboard mostraba "No AUTHORIZED projects available" mientras Agent 2
// procesaba 10 episodios reales. Corrección: solo se sobrescribe si la
// línea nueva es, de verdad, más reciente que la ya guardada — nunca se
// asume que el orden de lectura de las fuentes es el orden cronológico real.
async function pumpLogsForRole(role: AgentRole): Promise<void> {
  const sources = logSourcesForToday().filter((s) => s.role === role);
  for (const source of sources) {
    const lines = readNewLines(source.absolutePath);
    for (const line of lines) {
      const current = lastKnownLine.get(role);
      if (!current || line.timestamp >= current.timestamp) {
        lastKnownLine.set(role, { timestamp: line.timestamp, message: line.message });
      }
    }
  }
}

// P2.12J — corregido: un lock de Agent 2 con PID muerto YA NO se clasifica
// incondicionalmente como ERROR (falso positivo real confirmado en
// producción — ver agentLock.ts::classifyAgent2Lock). Para agent2, la
// clasificación del lock (que ya pesa pausa + evidencia estructural real de
// fallo) es la fuente de verdad completa; para los otros 4 roles (sin lock),
// se agrega PAUSED cuando corresponde y se mantiene el resto sin cambios.
export function runtimeStatusFor(
  hasProcess: boolean,
  taskState: string,
  pauseActive: boolean,
  agent2Classification: Agent2LockClassification | null
): AgentRuntimeStatus {
  if (agent2Classification) {
    return agent2Classification === "RUNNING" ? "ACTIVE" : agent2Classification;
  }
  if (hasProcess && taskState === "Running") return "ACTIVE";
  if (!hasProcess && pauseActive) return "PAUSED";
  if (!hasProcess && taskState === "Ready") return "IDLE";
  if (hasProcess && taskState !== "Running") return "ACTIVE"; // process exists even if TaskScheduler state lags
  if (taskState === "Unknown") return "UNKNOWN";
  return "IDLE";
}

export async function getAgentStatuses(): Promise<AgentStatus[]> {
  const [snapshot, tasks, lock] = await Promise.all([getProcessSnapshot(), getTaskStatuses(), getAgent2Lock()]);

  // Pump the per-role log tail for every role so lastKnownLine stays fresh.
  await Promise.all(ROLE_DEFINITIONS.map((def) => pumpLogsForRole(def.role)));

  return ROLE_DEFINITIONS.map((def): AgentStatus => {
    const group = snapshot.agentGroups.find((g) => g.role === def.role)!;
    const task = tasks.find((t) => t.realRole === def.role);
    const known = lastKnownLine.get(def.role);
    const filePath = known ? extractFilePath(known.message) : null;
    const hasProcess = group.processes.length > 0;
    const pauseActive = isPauseActiveFor(def.pauseFile);

    const agent2Classification =
      def.role === "agent2"
        ? classifyAgent2Lock({
            lock,
            hasProcess,
            pauseActive,
            wrapperLastTaskResult: task?.lastTaskResult ?? null,
          })
        : null;

    let idleReason: string | null = null;
    if (def.role === "agent2" && hasProcess && !known) {
      idleReason = "No AUTHORIZED projects available across any of the 4 accounts.";
    }
    if (known && /sin encolar/i.test(known.message) && def.role === "agent2") {
      idleReason = known.message;
    }

    return {
      role: def.role,
      label: def.label,
      entrypoint: def.entrypoint,
      taskName: def.taskName,
      status: runtimeStatusFor(hasProcess, task?.state ?? "Unknown", pauseActive, agent2Classification),
      processes: group.processes,
      lastLogActivityAt: known?.timestamp ?? null,
      currentStage: known ? extractStage(known.message) : null,
      currentFile: filePath,
      currentAccount: extractAccount(filePath),
      currentEpisode: extractEpisode(filePath),
      inferred: true,
      idleReason,
      lock:
        def.role === "agent2" && lock
          ? { path: lock.path, pid: lock.pid, startedAt: lock.startedAt, processAlive: lock.processAlive }
          : undefined,
    };
  });
}
