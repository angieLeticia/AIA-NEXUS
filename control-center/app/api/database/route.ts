// Read-only database view. GET only. Table name comes from a fixed whitelist
// (query param is validated against it, never interpolated into a query) —
// social_accounts never returns `credentials` (see supabaseReadOnly.ts).
import { NextResponse } from "next/server";
import {
  getContentAccounts,
  getContentFiles,
  getContentMetadata,
  getSocialAccounts,
  getSocialPosts,
  getContentFileConflicts,
} from "@/lib/observability/supabaseReadOnly";

export const dynamic = "force-dynamic";

const TABLES = ["content_accounts", "content_files", "content_metadata", "social_accounts", "social_posts", "content_file_conflicts"] as const;
type Table = (typeof TABLES)[number];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") as Table | null;

  if (!table || !TABLES.includes(table)) {
    return NextResponse.json({ error: "Unknown or missing table. Valid: " + TABLES.join(", ") }, { status: 400 });
  }

  switch (table) {
    case "content_accounts":
      return NextResponse.json({ table, rows: await getContentAccounts() });
    case "content_files":
      return NextResponse.json({ table, rows: await getContentFiles(1000) });
    case "content_metadata":
      return NextResponse.json({ table, rows: await getContentMetadata(1000) });
    case "social_accounts":
      return NextResponse.json({ table, rows: await getSocialAccounts() });
    case "social_posts":
      return NextResponse.json({ table, rows: await getSocialPosts(1000) });
    case "content_file_conflicts":
      return NextResponse.json({ table, rows: await getContentFileConflicts() });
  }
}
