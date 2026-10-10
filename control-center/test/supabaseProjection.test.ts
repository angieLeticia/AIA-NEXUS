import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(path.join(__dirname, "..", "lib", "observability", "supabaseReadOnly.ts"), "utf-8");

// Code only, with // comment lines stripped — the file's own header comment
// intentionally contains the literal text `select("*")` as a description of
// what to grep for, which would otherwise make this check match itself.
const CODE_ONLY = SOURCE.split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

test("supabaseReadOnly.ts never uses select(\"*\") or select('*') in actual code", () => {
  assert.doesNotMatch(CODE_ONLY, /select\(\s*["']\*["']\s*\)/);
});

test("supabaseReadOnly.ts never selects the credentials column from social_accounts", () => {
  // Find the getSocialAccounts function body specifically and assert its
  // .select(...) column list does not mention "credentials".
  const match = SOURCE.match(/export async function getSocialAccounts[\s\S]*?\.select\("([^"]+)"\)/);
  assert.ok(match, "getSocialAccounts function or its .select(...) call not found");
  assert.doesNotMatch(match![1], /credentials/);
});

test("supabaseReadOnly.ts defines no insert/update/upsert/delete calls anywhere", () => {
  assert.doesNotMatch(CODE_ONLY, /\.(insert|update|upsert|delete)\(/);
});

test("supabaseReadOnly.ts is marked server-only", () => {
  assert.match(SOURCE, /import\s+["']server-only["']/);
});
