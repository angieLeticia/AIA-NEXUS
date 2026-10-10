import { test } from "node:test";
import assert from "node:assert/strict";
import { readWhitelistedFile, listTree } from "../lib/observability/codeExplorer";

test("reads a real whitelisted file", () => {
  const result = readWhitelistedFile("agent/logger.mts");
  assert.ok(!("error" in result), `expected success, got: ${"error" in result ? result.error : ""}`);
  if (!("error" in result)) {
    assert.ok(result.content.includes("Log estructurado"));
  }
});

test("rejects '..' traversal even when it resolves back inside the repo", () => {
  const result = readWhitelistedFile("agent/../../../../Windows/System32/drivers/etc/hosts");
  assert.ok("error" in result);
});

test("rejects an absolute path", () => {
  const result = readWhitelistedFile("C:\\Windows\\System32\\drivers\\etc\\hosts");
  assert.ok("error" in result);
});

test("rejects a path outside the whitelisted directories", () => {
  const result = readWhitelistedFile(".env.local");
  assert.ok("error" in result);
});

test("rejects a disallowed extension inside a whitelisted directory", () => {
  // .lock exists for real under scripts/pipeline/state/, but isn't in ALLOWED_EXTENSIONS.
  const result = readWhitelistedFile("scripts/pipeline/state/agent.lock");
  assert.ok("error" in result);
});

test("rejects a non-existent whitelisted-looking path without throwing", () => {
  const result = readWhitelistedFile("agent/this-file-does-not-exist.mts");
  assert.ok("error" in result);
});

test("listTree only ever returns nodes under the whitelisted dirs", () => {
  const tree = listTree();
  const allowedRoots = ["agent", "scripts/pipeline", "lib/social", "control-center"];
  for (const node of tree) {
    assert.ok(allowedRoots.includes(node.name), `unexpected root node: ${node.name}`);
  }
});
