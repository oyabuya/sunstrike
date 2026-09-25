import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { APPROVED_POSITION_SIZE_SOL, assertLiveConfiguration, config } from "../config.js";
import { checkBinArraysInitialized, inclusiveBinCount, isPositionClosedOnChain, LIVE_DEPOSIT_SLIPPAGE_PERCENT } from "../tools/dlmm.js";
import { getPostCloseSwapCandidate, isConfirmedSwapResult } from "../tools/post-close-swap.js";
import { isJupiterUltraExecutionSuccess } from "../tools/wallet.js";

test("range width counts both endpoints, including the active bin", () => {
  assert.equal(inclusiveBinCount(-35, 34), 70);
  assert.equal(inclusiveBinCount(10, 9), null);
  assert.equal(LIVE_DEPOSIT_SLIPPAGE_PERCENT, 10);
});

test("binArray verification checks every signed index and fails closed", async () => {
  const poolAddress = Keypair.generate().publicKey.toBase58();
  let accountCount = 0;
  const existing = await checkBinArraysInitialized({
    poolAddress,
    minBinId: -1,
    maxBinId: 70,
    connection: { async getMultipleAccountsInfo(accounts) { accountCount = accounts.length; return accounts.map(() => ({})); } },
  });
  assert.equal(accountCount, 3); // arrays -1, 0, and 1
  assert.equal(existing.pass, true);

  const missing = await checkBinArraysInitialized({
    poolAddress,
    minBinId: -1,
    maxBinId: 70,
    connection: { async getMultipleAccountsInfo(accounts) { return accounts.map((_, index) => index === 1 ? null : {}); } },
  });
  assert.deepEqual(missing.missingIndexes, [0]);
  assert.equal(missing.pass, false);

  const rpcFailure = await checkBinArraysInitialized({
    poolAddress,
    minBinId: 0,
    maxBinId: 1,
    connection: { async getMultipleAccountsInfo() { throw new Error("rpc unavailable"); } },
  });
  assert.equal(rpcFailure.pass, false);
  assert.match(rpcFailure.error, /could not be verified/);
});

test("position close requires an explicit on-chain account result", async () => {
  const position = Keypair.generate().publicKey.toBase58();
  assert.equal(await isPositionClosedOnChain(position, { async getAccountInfo() { return null; } }), true);
  assert.equal(await isPositionClosedOnChain(position, { async getAccountInfo() { return { data: Buffer.alloc(0) }; } }), false);
  await assert.rejects(isPositionClosedOnChain(position, { async getAccountInfo() { return undefined; } }), /no position account result/);
});

test("post-close swap does not require USD valuation and only accepts confirmed results", () => {
  assert.equal(getPostCloseSwapCandidate([{ mint: "BASE", balance: 2, usd: null }], "BASE").status, "ready");
  assert.equal(getPostCloseSwapCandidate([{ mint: "BASE", balance: 2, usd: 0.05 }], "BASE").status, "dust");
  assert.equal(getPostCloseSwapCandidate(null, "BASE").status, "unknown");
  assert.equal(isConfirmedSwapResult({ success: true, tx: "sig" }), true);
  assert.equal(isConfirmedSwapResult({ success: true, tx: "sig", dry_run: true }), false);
  assert.equal(isConfirmedSwapResult({ success: false, tx: "sig", error: "pending" }), false);
  assert.equal(isConfirmedSwapResult({ success: true }), false);
});

test("Jupiter Ultra only accepts Success with a signature", () => {
  assert.equal(isJupiterUltraExecutionSuccess({ status: "Success", signature: "sig" }), true);
  assert.equal(isJupiterUltraExecutionSuccess({ status: "Pending", signature: "sig" }), false);
  assert.equal(isJupiterUltraExecutionSuccess({ status: "Failed", signature: "sig" }), false);
  assert.equal(isJupiterUltraExecutionSuccess({ status: "Success" }), false);
});

test("LIVE readiness rejects a deploy size that differs from the approved 0.2 SOL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-live-size-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const wallet = Keypair.generate();
  const publicKey = wallet.publicKey.toBase58();
  const envKeys = [
    "SUNSTRIKE_LIVE_ENABLED", "SUNSTRIKE_LIVE_WALLET", "WALLET_PRIVATE_KEY", "RPC_URL",
    "HELIUS_API_KEY", "JUPITER_API_KEY", "OPENROUTER_API_KEY", "SUNSTRIKE_PORTFOLIO_STATE_PATH",
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const prior = {
    maxPositions: config.risk.maxPositions,
    strategy: config.strategy.strategy,
    autoCompoundEnabled: config.management.autoCompoundEnabled,
    deployAmountSol: config.management.deployAmountSol,
    antiRugStrict: config.screening.antiRugStrict,
  };
  try {
    process.env.SUNSTRIKE_LIVE_ENABLED = "true";
    process.env.SUNSTRIKE_LIVE_WALLET = publicKey;
    process.env.WALLET_PRIVATE_KEY = bs58.encode(wallet.secretKey);
    process.env.RPC_URL = "https://rpc.example.invalid";
    process.env.HELIUS_API_KEY = "test";
    process.env.JUPITER_API_KEY = "test";
    process.env.OPENROUTER_API_KEY = "test";
    process.env.SUNSTRIKE_PORTFOLIO_STATE_PATH = statePath;
    fs.writeFileSync(statePath, JSON.stringify({
      version: 1,
      wallet: publicKey,
      baseline_usd: config.risk.capitalBudgetUsd,
      tripped: false,
      created_at: new Date().toISOString(),
      initial_snapshot: { wallet: publicKey, equity_usd: 100, positions: 0 },
    }));
    config.risk.maxPositions = 2;
    config.strategy.strategy = "spot";
    config.management.autoCompoundEnabled = false;
    config.screening.antiRugStrict = true;
    config.management.deployAmountSol = 0.21;
    assert.throws(assertLiveConfiguration, /deployAmountSol=0\.2/);
    config.management.deployAmountSol = APPROVED_POSITION_SIZE_SOL;
    assert.doesNotThrow(assertLiveConfiguration);
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    config.risk.maxPositions = prior.maxPositions;
    config.strategy.strategy = prior.strategy;
    config.management.autoCompoundEnabled = prior.autoCompoundEnabled;
    config.management.deployAmountSol = prior.deployAmountSol;
    config.screening.antiRugStrict = prior.antiRugStrict;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
