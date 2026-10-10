// P2.12J — pruebas del falso positivo real corregido: un lock de Agent 2 con
// PID muerto NO implica un crash. classifyAgent2Lock() es una función PURA
// (sin fs, sin PowerShell, sin red) — estas pruebas solo le pasan fixtures en
// memoria, nunca tocan scripts/pipeline/state/agent.lock real, queue.json,
// episodes.ts, manifiestos, Supabase ni logs de producción. No hay ninguna
// sustitución de función que restaurar (nada que mockear: todas las
// dependencias ya son parámetros explícitos de la función).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { classifyAgent2Lock, type Agent2Lock } from "../lib/observability/agentLock";
import { runtimeStatusFor, isPauseActiveFor } from "../lib/observability/agentStatusMonitor";
import { CORE_ROOT } from "../lib/observability/roles";

const aliveLock: Agent2Lock = { path: "fake.lock", pid: 111, startedAt: "2026-01-01T00:00:00.000Z", processAlive: true };
const deadLock: Agent2Lock = { path: "fake.lock", pid: 10584, startedAt: "2026-10-02T15:31:43.137Z", processAlive: false };

test("RUNNING: proceso activo + lock válido (PID vivo)", () => {
  const result = classifyAgent2Lock({ lock: aliveLock, hasProcess: true, pauseActive: false, wrapperLastTaskResult: 0 });
  assert.equal(result, "RUNNING");
});

test("RUNNING: pauseActive=true pero el proceso SÍ está realmente vivo -> RUNNING gana (evidencia real > bandera de pausa)", () => {
  const result = classifyAgent2Lock({ lock: aliveLock, hasProcess: true, pauseActive: true, wrapperLastTaskResult: null });
  assert.equal(result, "RUNNING");
});

test("PAUSED: agente detenido por mantenimiento CON lock obsoleto (el caso real de producción: PID 10584)", () => {
  const result = classifyAgent2Lock({ lock: deadLock, hasProcess: false, pauseActive: true, wrapperLastTaskResult: 0 });
  assert.equal(result, "PAUSED");
});

test("PAUSED: sin lock en absoluto, pero con pausa activa", () => {
  const result = classifyAgent2Lock({ lock: null, hasProcess: false, pauseActive: true, wrapperLastTaskResult: null });
  assert.equal(result, "PAUSED");
});

test("ERROR: agente que termina con un error real confirmado (LastTaskResult de Windows != 0), SIN pausa activa", () => {
  const result = classifyAgent2Lock({ lock: deadLock, hasProcess: false, pauseActive: false, wrapperLastTaskResult: 1 });
  assert.equal(result, "ERROR");
});

test("ERROR gana SIEMPRE sobre PAUSED: evidencia real de fallo no se oculta solo porque PAUSE_AGENTS esté presente", () => {
  const result = classifyAgent2Lock({ lock: deadLock, hasProcess: false, pauseActive: true, wrapperLastTaskResult: 1 });
  assert.equal(result, "ERROR");
});

test("STALE_LOCK: lock obsoleto, SIN pausa activa, SIN evidencia de fallo real -> ambiguo, nunca se asume crash", () => {
  const result = classifyAgent2Lock({ lock: deadLock, hasProcess: false, pauseActive: false, wrapperLastTaskResult: 0 });
  assert.equal(result, "STALE_LOCK");
});

test("STALE_LOCK: lock obsoleto, SIN pausa activa, LastTaskResult desconocido (null) -> sigue sin asumir fallo", () => {
  const result = classifyAgent2Lock({ lock: deadLock, hasProcess: false, pauseActive: false, wrapperLastTaskResult: null });
  assert.equal(result, "STALE_LOCK");
});

test("IDLE: ausencia total de lock, sin pausa activa (nunca hubo instancia, o se liberó limpio)", () => {
  const result = classifyAgent2Lock({ lock: null, hasProcess: false, pauseActive: false, wrapperLastTaskResult: null });
  assert.equal(result, "IDLE");
});

test("IDLE: lock vivo pero el snapshot de procesos no lo ve (inconsistencia rara, sin pausa) -> no se inventa un estado nuevo", () => {
  const result = classifyAgent2Lock({ lock: aliveLock, hasProcess: false, pauseActive: false, wrapperLastTaskResult: null });
  assert.equal(result, "IDLE");
});

test("regresión del hallazgo real exacto: PID 10584, muerto desde 2026-10-07, PAUSE_AGENTS presente, sin hasProcess -> PAUSED, nunca ERROR", () => {
  const result = classifyAgent2Lock({ lock: deadLock, hasProcess: false, pauseActive: true, wrapperLastTaskResult: 0 });
  assert.equal(result, "PAUSED");
  assert.notEqual(result, "ERROR");
});

// --- runtimeStatusFor(): mapeo puro hacia AgentRuntimeStatus, usado por los 5 roles ---

test("runtimeStatusFor: agent2Classification RUNNING se mapea a ACTIVE (vocabulario existente del dashboard)", () => {
  assert.equal(runtimeStatusFor(true, "Running", false, "RUNNING"), "ACTIVE");
});

test("runtimeStatusFor: agent2Classification no-RUNNING se pasa literal (PAUSED/STALE_LOCK/ERROR/IDLE)", () => {
  assert.equal(runtimeStatusFor(false, "Ready", true, "PAUSED"), "PAUSED");
  assert.equal(runtimeStatusFor(false, "Ready", false, "STALE_LOCK"), "STALE_LOCK");
  assert.equal(runtimeStatusFor(false, "Ready", false, "ERROR"), "ERROR");
  assert.equal(runtimeStatusFor(false, "Ready", false, "IDLE"), "IDLE");
});

test("runtimeStatusFor: roles SIN lock (agent2Classification=null) ahora también reportan PAUSED cuando corresponde", () => {
  assert.equal(runtimeStatusFor(false, "Ready", true, null), "PAUSED");
});

test("runtimeStatusFor: roles sin lock, sin pausa, comportamiento histórico sin cambios (ACTIVE/IDLE/UNKNOWN)", () => {
  assert.equal(runtimeStatusFor(true, "Running", false, null), "ACTIVE");
  assert.equal(runtimeStatusFor(false, "Ready", false, null), "IDLE");
  assert.equal(runtimeStatusFor(false, "Unknown", false, null), "UNKNOWN");
});

// --- isPauseActiveFor(): verificación read-only contra el filesystem REAL,
// pero sin hardcodear "true"/"false" (ese valor cambia legítimamente el día
// que se active el sistema) — en vez de eso, recalcula la MISMA condición de
// forma independiente (existsSync directo) y compara, probando que la
// función se mantiene consistente con la realidad SIN importar cuál sea esa
// realidad en el momento de correr la prueba. No crea ni borra ningún archivo.
test("isPauseActiveFor: coincide con la realidad real del filesystem, cualquiera que sea en este momento", () => {
  const globalReal = existsSync(path.join(CORE_ROOT, "agent", "runtime", "PAUSE_AGENTS"));
  const specificReal = existsSync(path.join(CORE_ROOT, "agent", "runtime", "PAUSE_UN_ROL_QUE_NO_EXISTE"));
  assert.equal(isPauseActiveFor("PAUSE_UN_ROL_QUE_NO_EXISTE"), globalReal || specificReal);
});

test("isPauseActiveFor: un rol con su propio marcador específico real (PAUSE_PRODUCTION) también se refleja correctamente", () => {
  const globalReal = existsSync(path.join(CORE_ROOT, "agent", "runtime", "PAUSE_AGENTS"));
  const specificReal = existsSync(path.join(CORE_ROOT, "agent", "runtime", "PAUSE_PRODUCTION"));
  assert.equal(isPauseActiveFor("PAUSE_PRODUCTION"), globalReal || specificReal);
});
