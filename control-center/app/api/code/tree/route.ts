import { NextResponse } from "next/server";
import { listTree } from "@/lib/observability/codeExplorer";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tree: listTree() });
}
