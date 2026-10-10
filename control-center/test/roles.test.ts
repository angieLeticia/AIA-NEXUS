import { test } from "node:test";
import assert from "node:assert/strict";
import { roleByTaskName, roleByEntrypoint, ROLE_DEFINITIONS } from "../lib/observability/roles";

test("AIANexusPulse maps to the Watcher, not the Publisher (critical — the component is PULSE, not Publisher)", () => {
  const def = roleByTaskName("AIANexusPulse");
  assert.ok(def, "expected a role definition for AIANexusPulse");
  assert.equal(def!.role, "watcher");
  assert.equal(def!.entrypoint, "agent/run.mts");
  assert.notEqual(def!.role, "publisher");
});

test("AIANexusPublisher maps to the real Publisher", () => {
  const def = roleByTaskName("AIANexusPublisher");
  assert.equal(def!.role, "publisher");
  assert.equal(def!.entrypoint, "agent/publish/run.mts");
});

test("every role has a unique entrypoint and task name", () => {
  const entrypoints = ROLE_DEFINITIONS.map((r) => r.entrypoint);
  const taskNames = ROLE_DEFINITIONS.map((r) => r.taskName);
  assert.equal(new Set(entrypoints).size, entrypoints.length);
  assert.equal(new Set(taskNames).size, taskNames.length);
  assert.equal(ROLE_DEFINITIONS.length, 5);
});

test("roleByEntrypoint matches a real process CommandLine fragment", () => {
  const cmd = `"node"   "C:\\Users\\angie\\...\\tsx\\dist\\cli.mjs" agent/analyze/run.mts`;
  const def = ROLE_DEFINITIONS.find((r) => cmd.includes(r.entrypoint));
  assert.equal(def?.role, "agent1");
});

test("roleByEntrypoint does not match an unrelated script", () => {
  const def = roleByEntrypoint("some/other/script.mts");
  assert.equal(def, undefined);
});
