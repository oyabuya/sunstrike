import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLessonsForCampaign, filterPerformanceForCampaign } from "../lessons.js";

test("a dedicated wallet starts a clean performance campaign without deleting April history", () => {
  const history = [
    { pool: "APRIL", pnl_usd: -5.33 },
    { pool: "NEW", pnl_usd: 1, wallet_scope: "DEDICATED" },
    { pool: "OTHER", pnl_usd: 2, wallet_scope: "OTHER" },
  ];

  assert.deepEqual(filterPerformanceForCampaign(history, "DEDICATED"), [history[1]]);
  assert.equal(history.length, 3);
  assert.deepEqual(filterPerformanceForCampaign(history, ""), []);
  assert.deepEqual(filterPerformanceForCampaign(history, null), history);
});

test("prompt learning keeps global manual guidance and only current-wallet outcomes", () => {
  const lessons = [
    { rule: "April result", outcome: "bad" },
    { rule: "April auto evolution", outcome: "manual", tags: ["evolution", "config_change"] },
    { rule: "Global operator rule", outcome: "manual", tags: ["risk"] },
    { rule: "New wallet result", outcome: "good", wallet_scope: "DEDICATED" },
    { rule: "Other wallet result", outcome: "bad", wallet_scope: "OTHER" },
  ];

  assert.deepEqual(
    filterLessonsForCampaign(lessons, "DEDICATED").map((lesson) => lesson.rule),
    ["Global operator rule", "New wallet result"],
  );
  assert.deepEqual(
    filterLessonsForCampaign(lessons, "").map((lesson) => lesson.rule),
    ["Global operator rule"],
  );
});
