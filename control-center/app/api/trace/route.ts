import { NextResponse } from "next/server";
import { runTrace } from "@/lib/observability/traceMonitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  if (!q || !q.trim()) {
    return NextResponse.json({ error: "Missing ?q= search query." }, { status: 400 });
  }
  const result = await runTrace(q.trim());
  return NextResponse.json(result);
}
