// Reads (never writes, never deletes) scripts/pipeline/state/agent.lock —
// Agent 2's real PID+startedAt lock file. A lock that exists but whose PID is
// not actually running is a genuine incident (crashed without cleanup),
// surfaced by incidentDetector.ts — this module only reports facts.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { runPowerShell } from "./powershell";
import { CORE_ROOT } from "./roles";

const LOCK_PATH = path.join(CORE_ROOT, "scripts", "pipeline", "state", "agent.lock");

export interface Agent2Lock {
  path: string;
  pid: number;
  startedAt: string;
  processAlive: boolean;
}

async function isPidAlive(pid: number): Promise<boolean> {
  const { stdout } = await runPowerShell(`if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { "yes" } else { "no" }`);
  return stdout.trim() === "yes";
}

export async function getAgent2Lock(): Promise<Agent2Lock | null> {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(LOCK_PATH, "utf-8")) as { pid: number; startedAt: string };
    const alive = Number.isInteger(raw.pid) ? await isPidAlive(raw.pid) : false;
    return { path: LOCK_PATH, pid: raw.pid, startedAt: raw.startedAt, processAlive: alive };
  } catch {
    return null;
  }
}

// P2.12J — hallazgo real (ver docs/operational-memory.md / diagnóstico
// AGENT2_DIAGNOSIS): un lock con PID muerto NO implica un crash. El lock real
// (PID 10584, scripts/pipeline/state/agent.lock) quedó huérfano porque el
// proceso fue detenido deliberadamente (Stop-Process) mientras
// agent/runtime/PAUSE_AGENTS ya estaba activo — el wrapper .ps1 nunca lo
// relanzó por diseño (ver scripts/pipeline/windows/start-agent.ps1, guardia de
// mantenimiento), y agentLock.mts::acquireLock() reclama un lock así de forma
// automática y segura en el próximo arranque real — nunca requiere borrado
// manual. Antes de esta corrección, agentStatusMonitor.ts e incidentDetector.ts
// trataban CUALQUIER lock con PID muerto como "ERROR"/"puede haber crasheado"
// incondicionalmente — un falso positivo real, ya observado en producción.
//
// Función PURA (sin fs, sin PowerShell) para que sea 100% testeable: dado el
// lock ya leído + las 2 señales estructurales relevantes (nunca inferidas de
// texto de log), decide una de las 5 clasificaciones pedidas. El orden de las
// comprobaciones importa: la evidencia estructural de fallo real (bullet 2)
// se chequea ANTES que la pausa — una pausa activa nunca debe ocultar un
// fallo real ya confirmado por Windows.
export type Agent2LockClassification = "RUNNING" | "PAUSED" | "STALE_LOCK" | "ERROR" | "IDLE";

export interface ClassifyAgent2LockInput {
  lock: Agent2Lock | null;
  hasProcess: boolean; // evidencia real de proceso vivo (processMonitor), independiente del lock
  pauseActive: boolean; // PAUSE_AGENTS (global) O PAUSE_PRODUCTION (específico) presente AHORA
  // Evidencia ESTRUCTURAL (nunca texto de log inferido) de que el wrapper
  // mismo terminó con un código de fallo real la última vez que corrió —
  // Get-ScheduledTaskInfo -> LastTaskResult, reportado por Windows, no por
  // nosotros. null = desconocido/no disponible (nunca se asume fallo).
  wrapperLastTaskResult: number | null;
}

export function classifyAgent2Lock(input: ClassifyAgent2LockInput): Agent2LockClassification {
  const { lock, hasProcess, pauseActive, wrapperLastTaskResult } = input;

  if (hasProcess && lock?.processAlive) return "RUNNING";

  if (!lock || lock.processAlive) {
    // Sin lock: nunca hubo instancia, o se liberó limpio (releaseLock real).
    // Lock vivo pero sin proceso visible en el snapshot: inconsistencia rara
    // del snapshot, no del lock — se trata igual que "sin lock" para no
    // inventar un estado nuevo para un caso sin evidencia propia.
    return pauseActive ? "PAUSED" : "IDLE";
  }

  // A partir de aquí: lock existe Y su PID está muerto (processAlive=false).
  const realFailureEvidence = wrapperLastTaskResult !== null && wrapperLastTaskResult !== 0;
  if (realFailureEvidence) return "ERROR"; // evidencia real gana SIEMPRE, incluso si además está pausado
  if (pauseActive) return "PAUSED"; // explicación estructural real: se detuvo por mantenimiento, no por un fallo
  return "STALE_LOCK"; // ni pausa ni evidencia de fallo real — ambiguo por diseño, nunca se asume crash
}
