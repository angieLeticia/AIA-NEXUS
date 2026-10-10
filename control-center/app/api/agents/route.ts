import { NextResponse } from "next/server";
import { getAgentStatuses } from "@/lib/observability/agentStatusMonitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = await getAgentStatuses();
  return NextResponse.json({ agents });
}
