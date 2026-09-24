import test from "node:test";
import assert from "node:assert/strict";
import { config, computeDeployAmount } from "../config.js";

test("fixed-size mode deploys the requested SOL amount or waits for budget", () => {
  const old = {
    autoCompoundEnabled: config.management.autoCompoundEnabled,
    deployAmountSol: config.management.deployAmountSol,
    maxPositionUsd: config.risk.maxPositionUsd,
  };
  try {
    config.management.autoCompoundEnabled = false;
    config.management.deployAmountSol = 0.2;
    config.risk.maxPositionUsd = 50;
    assert.equal(computeDeployAmount(1, 115), 0.2);
    assert.equal(computeDeployAmount(0.3, 115), 0);
    assert.equal(computeDeployAmount(1, 260), 0);
  } finally {
    config.management.autoCompoundEnabled = old.autoCompoundEnabled;
    config.management.deployAmountSol = old.deployAmountSol;
    config.risk.maxPositionUsd = old.maxPositionUsd;
  }
});
