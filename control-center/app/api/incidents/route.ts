import { NextResponse } from "next/server";
import { detectIncidents } from "@/lib/observability/incidentDetector";

export const dynamic = "force-dynamic";

export async function GET() {
  const incidents = await detectIncidents();
  return NextResponse.json({ incidents });
}
