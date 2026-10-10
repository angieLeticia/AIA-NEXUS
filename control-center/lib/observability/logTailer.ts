// Offset-based incremental log tailing. SECURITY/PERFORMANCE INVARIANT: this
// module never calls readFileSync/readFile on a whole log file — some of the
// real daily logs (agent/logs/agent-2026-09-25.log) are 20+ MB and grow
// forever (they are never rotated by the core system). Every read after the
// first uses fs.read() with an explicit position, reading only the bytes
// appended since the last known offset. Offsets live in process memory only
// (never written into the monitored logs/ or agent/logs/ directories).
import { openSync, closeSync, readSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { CORE_ROOT } from "./roles";
import type { AgentRole, LogLine } from "@/types/observability";

export interface LogSourceDef {
  role: AgentRole | "system";
  label: string;
  absolutePath: string;
}

function p(...parts: string[]) {
  return path.join(CORE_ROOT, ...parts);
}

const todayStamp = () => new Date().toISOString().slice(0, 10);

// Static, hardcoded list — matches PHASE_CONTROL_CENTER_AUDIT section 13.
// Daily-named files are resolved for "today" at call time (see logSourcesForToday).
export function logSourcesForToday(): LogSourceDef[] {
  const today = todayStamp();
  return [
    { role: "agent1", label: "Agent 1 wrapper", absolutePath: p("logs", "analyze-task-wrapper.log") },
    { role: "agent1", label: "Agent 1 stdout", absolutePath: p("logs", "analyze-agent-stdout.log") },
    { role: "agent1", label: "Agent 1 stderr", absolutePath: p("logs", "analyze-agent-stderr.log") },
    { role: "agent2", label: "Agent 2 wrapper", absolutePath: p("logs", "pipeline-task-wrapper.log") },
    { role: "agent2", label: "Agent 2 stdout", absolutePath: p("logs", "pipeline-agent-stdout.log") },
    { role: "agent2", label: "Agent 2 stderr", absolutePath: p("logs", "pipeline-agent-stderr.log") },
    { role: "agent2", label: "Agent 2 daily", absolutePath: p("logs", `pipeline-${today}.log`) },
    { role: "watcher", label: "Watcher wrapper", absolutePath: p("agent", "logs", "task-wrapper.log") },
    { role: "watcher", label: "Watcher daily (shared)", absolutePath: p("agent", "logs", `agent-${today}.log`) },
    { role: "scheduler", label: "Scheduler wrapper", absolutePath: p("logs", "schedule-task-wrapper.log") },
    { role: "scheduler", label: "Scheduler stdout", absolutePath: p("logs", "schedule-agent-stdout.log") },
    { role: "scheduler", label: "Scheduler stderr", absolutePath: p("logs", "schedule-agent-stderr.log") },
    { role: "publisher", label: "Publisher wrapper", absolutePath: p("logs", "publish-task-wrapper.log") },
    { role: "publisher", label: "Publisher stdout", absolutePath: p("logs", "publish-agent-stdout.log") },
    { role: "publisher", label: "Publisher stderr", absolutePath: p("logs", "publish-agent-stderr.log") },
  ];
}

// In-memory offsets, keyed by absolute path. Module-level singleton: survives
// across requests within one `next dev`/`next start` process, resets on
// restart (acceptable — restarting the dashboard never restarts the agents).
const offsets = new Map<string, number>();

const LEVEL_PATTERN = /\[(DEBUG|INFO|WARN|WARNING|ERROR|CRITICAL)\]/i;
const TAG_PATTERN = /\[(AGENT|WATCHER|QUEUE|WORKER|RECOVERY|ERROR|WHISPER|OLLAMA|ANALYSIS|SCHEDULE|PUBLISH)\]/;
const TS_PATTERN = /^\[([0-9T:.Z-]+)\]/;

function normalizeLevel(raw: string | undefined): LogLine["level"] {
  if (!raw) return "INFO";
  const u = raw.toUpperCase();
  if (u === "WARN") return "WARNING";
  if (u === "DEBUG" || u === "INFO" || u === "WARNING" || u === "ERROR" || u === "CRITICAL") return u;
  return "INFO";
}

function parseLine(raw: string, sourceFile: string): LogLine | null {
  const line = raw.trim();
  if (!line) return null;
  const tsMatch = line.match(TS_PATTERN);
  const levelMatch = line.match(LEVEL_PATTERN);
  const tagMatch = line.match(TAG_PATTERN);
  return {
    timestamp: tsMatch ? tsMatch[1] : new Date().toISOString(),
    component: tagMatch ? tagMatch[1] : path.basename(sourceFile),
    level: normalizeLevel(levelMatch?.[1]),
    message: line,
    raw: line,
    sourceFile,
  };
}

// Reads only newly-appended bytes since the last call for this path. On the
// very first call for a given path, seeks to (size - tailBytes) instead of
// reading from byte 0, so a 20 MB log doesn't get fully read just to show the
// last screenful of lines.
export function readNewLines(absolutePath: string, initialTailBytes = 16_000): LogLine[] {
  if (!existsSync(absolutePath)) return [];
  const stat = statSync(absolutePath);
  const knownOffset = offsets.get(absolutePath);
  const startOffset = knownOffset !== undefined ? Math.min(knownOffset, stat.size) : Math.max(0, stat.size - initialTailBytes);

  if (stat.size <= startOffset) {
    offsets.set(absolutePath, stat.size);
    return [];
  }

  const length = stat.size - startOffset;
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, startOffset);
    offsets.set(absolutePath, stat.size);
    const text = buffer.toString("utf-8");
    return text
      .split("\n")
      .map((l) => parseLine(l, absolutePath))
      .filter((l): l is LogLine => l !== null);
  } finally {
    closeSync(fd);
  }
}

export function resetOffsets(): void {
  offsets.clear();
}
