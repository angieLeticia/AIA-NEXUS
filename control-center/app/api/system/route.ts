import { NextResponse } from "next/server";
import { getSystemResources } from "@/lib/observability/systemMonitor";
import { getProcessSnapshot, isOllamaRunning } from "@/lib/observability/processMonitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const [resources, snapshot, ollama] = await Promise.all([getSystemResources(), getProcessSnapshot(), isOllamaRunning()]);

  const nodeProcessCount = snapshot.agentGroups.reduce((sum, g) => sum + g.processes.length, 0);

  return NextResponse.json({
    ...resources,
    nodeProcessCount,
    ffmpegProcessCount: snapshot.ffmpegProcesses.length,
    ollamaRunning: ollama,
    unrelatedNodeProcessCount: snapshot.unrelatedNodeProcessCount,
  });
}
