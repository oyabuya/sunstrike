import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

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

test("live startup requires an initialized state bound to the dedicated wallet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-startup-risk-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const wallet = Keypair.generate();
  const liveEnv = {
    DRY_RUN: "false",
    SUNSTRIKE_LIVE_ENABLED: "true",
    SUNSTRIKE_LIVE_WALLET: wallet.publicKey.toBase58(),
    SUNSTRIKE_PORTFOLIO_STATE_PATH: statePath,
    WALLET_PRIVATE_KEY: bs58.encode(wallet.secretKey),
    RPC_URL: "https://rpc.invalid",
    HELIUS_API_KEY: "configured",
    JUPITER_API_KEY: "configured",
    GMGN_API_KEY: "configured",
    OPENROUTER_API_KEY: "configured",
    LLM_BASE_URL: "https://openrouter.ai/api/v1",
  };
  const missing = run('await import("./config.js")', liveEnv);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Live startup blocked by readiness gates:/);
  assert.match(missing.stderr, /initialized portfolio risk state/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the agent cannot raise capital limits", () => {
  const source = 'const { executeTool } = await import("./tools/executor.js"); const r = await executeTool("update_config", { changes: { maxDeployAmount: 1000 }, reason: "test" }); const fs = await import("node:fs"); fs.writeSync(1, JSON.stringify(r)); process.exit(0)';
  const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"success":false/);
});
