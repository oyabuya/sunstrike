import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(source, overrides = {}) {
  const env = { ...process.env, DRY_RUN: "true", SUNSTRIKE_LIVE_ENABLED: "false", ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 10_000,
    env,
  });
}

test("an explicit live mode without the second local gate fails before startup", () => {
  const result = run('await import("./config.js")', { DRY_RUN: "false" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live mode blocked/);
});

test("an invalid mode is coerced to dry run", () => {
  const result = run('await import("./config.js"); const fs = await import("node:fs"); fs.writeSync(1, process.env.DRY_RUN)', { DRY_RUN: "typo" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "true");
});

test("the agent cannot raise capital limits", () => {
  const source = 'const { executeTool } = await import("./tools/executor.js"); const r = await executeTool("update_config", { changes: { maxDeployAmount: 1000 }, reason: "test" }); const fs = await import("node:fs"); fs.writeSync(1, JSON.stringify(r)); process.exit(0)';
  const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"success":false/);
});
