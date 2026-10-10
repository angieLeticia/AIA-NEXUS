import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const API_DIR = path.join(__dirname, "..", "app", "api");

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const routeFiles = findRouteFiles(API_DIR);

test("at least one API route file exists", () => {
  assert.ok(routeFiles.length > 0);
});

for (const file of routeFiles) {
  const rel = path.relative(API_DIR, file);
  test(`${rel}: exports no POST/PUT/PATCH/DELETE handler`, () => {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/);
  });
}

test("no API route file shells out to a command built from request input (grep for runPowerShell with a template literal containing searchParams/params)", () => {
  for (const file of routeFiles) {
    const source = readFileSync(file, "utf-8");
    // Flags the dangerous pattern directly: runPowerShell(`...${request/params/searchParams...}`)
    const danger = /runPowerShell\(\s*`[^`]*\$\{[^}]*(searchParams|params|request)[^}]*\}/i;
    assert.doesNotMatch(source, danger, `${file} appears to build a PowerShell command from request input`);
  }
});
