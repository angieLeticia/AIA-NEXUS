import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const OBS_DIR = path.join(__dirname, "..", "lib", "observability");

function findTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("every runPowerShell(...) call site passes a hardcoded script — no interpolation of unsanitized external input", () => {
  for (const file of findTsFiles(OBS_DIR)) {
    const source = readFileSync(file, "utf-8");
    const calls = source.match(/runPowerShell\(([\s\S]*?)\n\)/g) ?? [];
    for (const call of calls) {
      // The only allowed interpolation pattern in this codebase is a Number()-cast
      // local value (see agentLock.ts, which interpolates a PID read from a local
      // JSON lock file — never request/searchParams/params input).
      const interpolations = call.match(/\$\{[^}]+\}/g) ?? [];
      for (const interp of interpolations) {
        const safe = /\$\{\s*Number\(/.test(interp);
        assert.ok(safe, `${path.basename(file)} interpolates "${interp}" into a PowerShell command — must be a Number()-cast local value only`);
      }
    }
  }
});

test("powershell.ts execFile call does not use shell:true (avoids shell string re-interpretation)", () => {
  const source = readFileSync(path.join(OBS_DIR, "powershell.ts"), "utf-8");
  assert.doesNotMatch(source, /shell:\s*true/);
});
