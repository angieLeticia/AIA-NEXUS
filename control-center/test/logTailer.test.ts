import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readNewLines } from "../lib/observability/logTailer";

function withTempLog(run: (filePath: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-logtailer-"));
  const filePath = path.join(dir, "test.log");
  try {
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readNewLines returns nothing for a non-existent file", () => {
  const lines = readNewLines(path.join(os.tmpdir(), "does-not-exist-" + Date.now() + ".log"));
  assert.deepEqual(lines, []);
});

test("readNewLines parses timestamp, tag, and level from a real log line format", () => {
  withTempLog((filePath) => {
    writeFileSync(filePath, `[2026-10-02T15:46:52.746Z] [INFO] [WHISPER] terminado {"filePath":"x.mp4"}\n`);
    const lines = readNewLines(filePath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].timestamp, "2026-10-02T15:46:52.746Z");
    assert.equal(lines[0].level, "INFO");
    assert.equal(lines[0].component, "WHISPER");
  });
});

test("readNewLines only returns bytes appended since the previous call (incremental, never full re-read)", () => {
  withTempLog((filePath) => {
    writeFileSync(filePath, `[2026-10-02T00:00:00.000Z] [INFO] [AGENT] line one\n`);
    const first = readNewLines(filePath, 10_000);
    assert.equal(first.length, 1);

    // A second call with no new bytes must return nothing.
    const second = readNewLines(filePath);
    assert.deepEqual(second, []);

    appendFileSync(filePath, `[2026-10-02T00:00:01.000Z] [WARN] [AGENT] line two\n`);
    const third = readNewLines(filePath);
    assert.equal(third.length, 1);
    assert.equal(third[0].level, "WARNING");
    assert.match(third[0].message, /line two/);
  });
});

test("WARN is normalized to WARNING", () => {
  withTempLog((filePath) => {
    writeFileSync(filePath, `[2026-10-02T00:00:00.000Z] [WARN] [AGENT] something\n`);
    const lines = readNewLines(filePath);
    assert.equal(lines[0].level, "WARNING");
  });
});

test("blank lines are skipped", () => {
  withTempLog((filePath) => {
    writeFileSync(filePath, `\n\n[2026-10-02T00:00:00.000Z] [INFO] [AGENT] real line\n\n`);
    const lines = readNewLines(filePath);
    assert.equal(lines.length, 1);
  });
});
