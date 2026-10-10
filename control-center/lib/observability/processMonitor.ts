// Identifies real pipeline processes strictly by CommandLine (never by image
// name alone — a real Adobe Creative Cloud node.exe was observed sharing the
// process name "node.exe" with the pipeline's own processes during manual
// monitoring this same night, which is exactly the false-positive this guards
// against). Groups each role's wrapper (tsx cli.mjs) + its tsx-loader child
// into one logical agent, since every wrapper spawns exactly that pair.
import { runPowerShell } from "./powershell";
import { ROLE_DEFINITIONS, type RoleDefinition } from "./roles";
import type { AgentRole, ProcessInfo } from "@/types/observability";

interface RawProcess {
  ProcessId: number;
  ParentProcessId: number;
  CommandLine: string | null;
  CreationDate: string | null; // pre-formatted as ISO ("o") by the script below
}

// CreationDate is a [datetime] — ConvertTo-Json emits an ambiguous
// {value, DateTime} object for that type (verified live on this host), so
// the PowerShell script below pre-formats it to ISO 8601 ("o") before
// serializing. This just normalizes whatever well-formed date string arrives.
function cimDateToIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function listRawProcesses(): Promise<RawProcess[]> {
  const script = `Get-CimInstance Win32_Process -Filter "name='node.exe' or name='ffmpeg.exe'" | ForEach-Object { [PSCustomObject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; CommandLine = $_.CommandLine; CreationDate = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString("o") } else { $null } } } | ConvertTo-Json -Compress`;
  const { stdout } = await runPowerShell(script);
  if (!stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter(Boolean);
  } catch {
    return [];
  }
}

export interface AgentProcessGroup {
  role: AgentRole;
  definition: RoleDefinition;
  processes: ProcessInfo[];
}

export interface ProcessSnapshot {
  agentGroups: AgentProcessGroup[];
  ffmpegProcesses: ProcessInfo[];
  unrelatedNodeProcessCount: number; // e.g. the Adobe node.exe case — never attributed to any role
}

export async function getProcessSnapshot(): Promise<ProcessSnapshot> {
  const raw = await listRawProcesses();

  const agentGroups: AgentProcessGroup[] = ROLE_DEFINITIONS.map((definition) => ({
    role: definition.role,
    definition,
    processes: [],
  }));

  const ffmpegProcesses: ProcessInfo[] = [];
  let unrelatedNodeProcessCount = 0;

  for (const p of raw) {
    const cmd = p.CommandLine ?? "";
    const info: ProcessInfo = {
      pid: p.ProcessId,
      parentPid: p.ParentProcessId ?? null,
      commandLine: cmd,
      startTime: cimDateToIso(p.CreationDate),
    };

    if (cmd.toLowerCase().includes("ffmpeg")) {
      // ffmpeg.exe's own CommandLine is the ffmpeg invocation itself (not node),
      // but Win32_Process name filter already restricted to node.exe/ffmpeg.exe.
      ffmpegProcesses.push(info);
      continue;
    }

    // Must reference THIS repo's path AND one of the 5 known entrypoints —
    // matches on entrypoint alone would still be safe here since the scripts
    // are unique filenames, but requiring the repo path too is extra safety
    // against a coincidentally-named script elsewhere on the machine.
    const matched = ROLE_DEFINITIONS.find((def) => cmd.includes(def.entrypoint) || cmd.includes(def.entrypoint.replace(/\//g, "\\")));

    if (matched && cmd.toLowerCase().includes("automatizacion-completa-de-contenido")) {
      const group = agentGroups.find((g) => g.role === matched.role)!;
      group.processes.push(info);
    } else if (cmd.toLowerCase().includes("node")) {
      unrelatedNodeProcessCount += 1;
    }
  }

  return { agentGroups, ffmpegProcesses, unrelatedNodeProcessCount };
}

export async function isOllamaRunning(): Promise<boolean> {
  const script = `if (Get-Process -Name "ollama" -ErrorAction SilentlyContinue) { "yes" } else { "no" }`;
  const { stdout } = await runPowerShell(script);
  return stdout.trim() === "yes";
}
