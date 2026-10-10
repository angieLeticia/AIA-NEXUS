import { NextResponse } from "next/server";
import { getTaskStatuses } from "@/lib/observability/taskMonitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const tasks = await getTaskStatuses();
  return NextResponse.json({ tasks });
}
