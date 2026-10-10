// Point-in-time log fetch (used for the initial page load / manual refresh).
// For live tailing the frontend uses /api/events (SSE) instead — this route
// exists so /logs can also work with a plain polling fallback and so tests
// can exercise log parsing without an open SSE connection.
import { NextResponse } from "next/server";
import { logSourcesForToday, readNewLines } from "@/lib/observability/logTailer";
import type { AgentRole, LogLine } from "@/types/observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roleFilter = searchParams.get("role") as AgentRole | "system" | null;

  const sources = logSourcesForToday().filter((s) => !roleFilter || s.role === roleFilter);
  const lines: LogLine[] = [];
  for (const source of sources) {
    lines.push(...readNewLines(source.absolutePath, 8_000));
  }
  lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return NextResponse.json({ lines });
}
