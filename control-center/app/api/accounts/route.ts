import { NextResponse } from "next/server";
import { getPipelineSnapshot } from "@/lib/observability/pipelineMonitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const { accounts } = await getPipelineSnapshot();
  return NextResponse.json({ accounts });
}
