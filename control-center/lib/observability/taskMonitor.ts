// Reads the 5 real Windows Scheduled Tasks. Read-only: Get-ScheduledTask /
// Get-ScheduledTaskInfo only — never Start-ScheduledTask, Stop-ScheduledTask,
// Set-ScheduledTask, Disable-ScheduledTask, or Unregister-ScheduledTask.
import { runPowerShell } from "./powershell";
import { ROLE_DEFINITIONS } from "./roles";
import type { TaskStatus } from "@/types/observability";

interface RawTask {
  TaskName: string;
  State: number | string;
  LastRunTime: string | null; // pre-formatted as ISO ("o") by the script below, or null
  NextRunTime: string | null;
  LastTaskResult: number | null;
  Trigger: string | null;
}

// Get-ScheduledTask's .State is an enum; ConvertTo-Json renders it as its
// string name when piped through Select-Object with a calculated label, so
// we request it pre-stringified to avoid relying on the numeric mapping.
// DateTime fields are formatted to ISO 8601 ("o") INSIDE PowerShell before
// ConvertTo-Json — left as [datetime], ConvertTo-Json instead emits an
// ambiguous {value, DateTime} object (verified live on this host), which is
// why these must be pre-stringified here rather than parsed on the TS side.
const SCRIPT = `
Get-ScheduledTask | Where-Object { $_.TaskName -match '^AIANexus' } | ForEach-Object {
  $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath
  $lastRun = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 1950) { $info.LastRunTime.ToUniversalTime().ToString("o") } else { $null }
  $nextRun = if ($info.NextRunTime -and $info.NextRunTime.Year -gt 1950) { $info.NextRunTime.ToUniversalTime().ToString("o") } else { $null }
  [PSCustomObject]@{
    TaskName = $_.TaskName
    State = $_.State.ToString()
    LastRunTime = $lastRun
    NextRunTime = $nextRun
    LastTaskResult = $info.LastTaskResult
    Trigger = (($_.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ',')
  }
} | ConvertTo-Json -Compress
`;

function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function getTaskStatuses(): Promise<TaskStatus[]> {
  const { stdout } = await runPowerShell(SCRIPT);
  if (!stdout.trim()) {
    // Scheduled task service unreachable / no tasks found — reflect as UNKNOWN
    // for all 5 expected tasks rather than silently returning an empty list.
    return ROLE_DEFINITIONS.map((def) => ({
      taskName: def.taskName,
      realRole: def.role,
      realRoleLabel: def.label,
      entrypoint: def.entrypoint,
      state: "Unknown",
      lastRunTime: null,
      nextRunTime: null,
      lastTaskResult: null,
      trigger: null,
    }));
  }

  let raw: RawTask[];
  try {
    const parsed = JSON.parse(stdout);
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    raw = [];
  }

  return ROLE_DEFINITIONS.map((def) => {
    const found = raw.find((t) => t.TaskName === def.taskName);
    if (!found) {
      return {
        taskName: def.taskName,
        realRole: def.role,
        realRoleLabel: def.label,
        entrypoint: def.entrypoint,
        state: "Unknown" as const,
        lastRunTime: null,
        nextRunTime: null,
        lastTaskResult: null,
        trigger: null,
      };
    }
    const state = String(found.State);
    return {
      taskName: def.taskName,
      realRole: def.role,
      realRoleLabel: def.label,
      entrypoint: def.entrypoint,
      state: (state === "Running" || state === "Ready" || state === "Disabled" ? state : "Unknown") as TaskStatus["state"],
      lastRunTime: toIso(found.LastRunTime),
      nextRunTime: toIso(found.NextRunTime),
      lastTaskResult: found.LastTaskResult,
      trigger: found.Trigger || null,
    };
  });
}
