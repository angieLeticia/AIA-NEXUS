// System-level resources. CPU is known unreliable via Win32_Processor on this
// host (verified empty during manual monitoring) — falls back to aggregating
// Get-Process CPU time deltas is not meaningful as a single sample, so if the
// primary source is empty this reports UNAVAILABLE rather than fabricating a
// number. RAM via Win32_OperatingSystem is the validated reliable source.
import { existsSync } from "node:fs";
import path from "node:path";
import { runPowerShell } from "./powershell";
import { CORE_ROOT } from "./roles";
import type { SystemResources } from "@/types/observability";

// DateTime fields are formatted to ISO 8601 ("o") INSIDE PowerShell before
// ConvertTo-Json — see taskMonitor.ts for why this is required (ConvertTo-Json
// otherwise emits an ambiguous {value, DateTime} object for [datetime]
// values, verified live on this host).
const SCRIPT = `
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).LoadPercentage
$explorerProc = Get-CimInstance Win32_Process -Filter "name='explorer.exe'" | Select-Object -First 1
$bootIso = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToUniversalTime().ToString("o") } else { $null }
$explorerIso = if ($explorerProc -and $explorerProc.CreationDate) { $explorerProc.CreationDate.ToUniversalTime().ToString("o") } else { $null }
[PSCustomObject]@{
  TotalKb = $os.TotalVisibleMemorySize
  FreeKb = $os.FreePhysicalMemory
  LastBootUpTime = $bootIso
  CpuLoadPercent = $cpu
  ExplorerCreationDate = $explorerIso
} | ConvertTo-Json -Compress
`;

function cimDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getSystemResources(): Promise<SystemResources> {
  const { stdout } = await runPowerShell(SCRIPT);
  const pauseAgentsPresent = existsSync(path.join(CORE_ROOT, "agent", "runtime", "PAUSE_AGENTS"));

  let parsed: { TotalKb?: number; FreeKb?: number; LastBootUpTime?: string; CpuLoadPercent?: number | null; ExplorerCreationDate?: string } = {};
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // leave defaults — report UNAVAILABLE below
  }

  const totalMb = parsed.TotalKb ? Math.round(parsed.TotalKb / 1024) : null;
  const freeMb = parsed.FreeKb ? Math.round(parsed.FreeKb / 1024) : null;
  const usedMb = totalMb !== null && freeMb !== null ? totalMb - freeMb : null;
  const usedPercent = totalMb && usedMb !== null ? Math.round((usedMb / totalMb) * 100) : null;

  const cpuPercent = typeof parsed.CpuLoadPercent === "number" ? parsed.CpuLoadPercent : null;

  return {
    ramTotalMb: totalMb,
    ramUsedMb: usedMb,
    ramFreeMb: freeMb,
    ramUsedPercent: usedPercent,
    cpuPercent,
    cpuSource: cpuPercent !== null ? "win32_processor" : "unavailable",
    nodeProcessCount: 0, // filled in by the caller from processMonitor, kept here only as a type placeholder
    ffmpegProcessCount: 0,
    ollamaRunning: false,
    lastBootUpTime: cimDateToIso(parsed.LastBootUpTime),
    approximateLastLogonTime: cimDateToIso(parsed.ExplorerCreationDate),
    pauseAgentsPresent,
  };
}
