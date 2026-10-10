// Single source of truth for the Windows Task -> real role mapping.
// Verified live against Get-ScheduledTask ... Actions.Arguments during
// PHASE_CONTROL_CENTER_AUDIT. AIA NEXUS rebrand (2026-10-10): tasks moved
// from \Visteapy\ to \AIANexus\ and renamed to match the official component
// names below — "AIANexusPulse" runs agent/run.mts (the Watcher/PULSE), not
// anything publish-related, despite what the old "VisteapyAgentPublicacion"
// name used to suggest. Never infer role from task name text alone; always
// use this table, keyed by the real entrypoint script.
import type { AgentRole } from "@/types/observability";

export interface RoleDefinition {
  role: AgentRole;
  label: string;
  entrypoint: string; // relative to CORE_ROOT, matched against process CommandLine
  taskName: string;
  wrapperScript: string;
  // P2.12J — nombre del archivo marcador específico de mantenimiento de este
  // rol (verificado leyendo cada wrapper .ps1: "Guardia de mantenimiento...
  // jerarquia OR entre la guardia global [PAUSE_AGENTS] y la especifica").
  // Relativo a agent/runtime/, igual que PAUSE_AGENTS.
  pauseFile: string;
}

export const CORE_ROOT = "C:\\Users\\angie\\Documents\\Proyectos\\automatizacion-completa-de-contenido";

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    role: "agent1",
    label: "AIA NEXUS SCOUT",
    entrypoint: "agent/analyze/run.mts",
    taskName: "AIANexusScout",
    wrapperScript: "agent/analyze/windows/start-agent.ps1",
    pauseFile: "PAUSE_ANALYZE",
  },
  {
    role: "agent2",
    label: "AIA NEXUS FORGE",
    entrypoint: "scripts/pipeline/agent.mts",
    taskName: "AIANexusForge",
    wrapperScript: "scripts/pipeline/windows/start-agent.ps1",
    pauseFile: "PAUSE_PRODUCTION",
  },
  {
    role: "watcher",
    label: "AIA NEXUS PULSE",
    entrypoint: "agent/run.mts",
    taskName: "AIANexusPulse",
    wrapperScript: "agent/windows/start-agent.ps1",
    pauseFile: "PAUSE_WATCH",
  },
  {
    role: "publisher",
    label: "AIA NEXUS PUBLISHER",
    entrypoint: "agent/publish/run.mts",
    taskName: "AIANexusPublisher",
    wrapperScript: "agent/publish/windows/start-agent.ps1",
    pauseFile: "PAUSE_PUBLISH",
  },
  {
    role: "scheduler",
    label: "AIA NEXUS SCHEDULER",
    entrypoint: "agent/schedule/run.mts",
    taskName: "AIANexusScheduler",
    wrapperScript: "agent/schedule/windows/start-agent.ps1",
    pauseFile: "PAUSE_SCHEDULE",
  },
];

export function roleByEntrypoint(entrypoint: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => entrypoint.includes(r.entrypoint.replace(/\//g, "\\")) || entrypoint.includes(r.entrypoint));
}

export function roleByTaskName(taskName: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => r.taskName === taskName);
}
