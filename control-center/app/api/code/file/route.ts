// Read-only, whitelisted file content. See codeExplorer.ts for the full
// security rationale (resolve()+prefix check, extension whitelist, no "..").
import { NextResponse } from "next/server";
import { readWhitelistedFile } from "@/lib/observability/codeExplorer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const relativePath = searchParams.get("path");
  if (!relativePath) {
    return NextResponse.json({ error: "Missing ?path=" }, { status: 400 });
  }
  const result = readWhitelistedFile(relativePath);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  return NextResponse.json(result);
}
