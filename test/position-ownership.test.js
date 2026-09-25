import test from "node:test";
import assert from "node:assert/strict";
import { isBotManagedPosition, isAllowedAutonomousManagementTool } from "../position-ownership.js";

test("manual LP outside range never qualifies for autonomous management", () => {
  const position = { position: "manual", pool: "pool", active_bin: 11, upper_bin: 10 };
  assert.equal(isBotManagedPosition(position, null), false);
  assert.equal(isBotManagedPosition(position, { position: "manual", pool: "pool", closed: false }), false);
});

test("autonomous manager rejects writes to manual LPs and unrelated trades", () => {
  const approved = ["bot"];
  assert.equal(isAllowedAutonomousManagementTool("close_position", { position_address: "bot" }, approved), true);
  assert.equal(isAllowedAutonomousManagementTool("claim_fees", { position_address: "manual" }, approved), false);
  assert.equal(isAllowedAutonomousManagementTool("close_position", { position_address: "manual" }, approved), false);
  assert.equal(isAllowedAutonomousManagementTool("swap_token", {}, approved), false);
  assert.equal(isAllowedAutonomousManagementTool("deploy_position", {}, approved), false);
  assert.equal(isAllowedAutonomousManagementTool("close_position", { position_address: "bot" }, []), false);
  assert.equal(isAllowedAutonomousManagementTool("get_my_positions", {}, []), true);
  assert.equal(isAllowedAutonomousManagementTool("close_position", { position_address: "manual" }, null), true);
});

test("only the matching open bot deployment qualifies", () => {
  const position = { position: "bot", pool: "pool" };
  const tracked = { position: "bot", pool: "pool", deployed_at: "2026-09-25T00:00:00.000Z", closed: false };
  assert.equal(isBotManagedPosition(position, tracked), true);
  assert.equal(isBotManagedPosition(position, { ...tracked, closed: true }), false);
  assert.equal(isBotManagedPosition(position, { ...tracked, position: "other" }), false);
  assert.equal(isBotManagedPosition(position, { ...tracked, pool: "other" }), false);
});
