import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DRY_RUN = 'true';
const { computeEvilPandaDeployPlan, getEvilPandaThresholds } = await import('../evilpanda-policy.js');
const { buildSystemPrompt } = await import('../prompt.js');

test('bin range reports compounded price distance and inclusive count', () => {
  for (const binStep of [25, 80, 125]) {
    const p = computeEvilPandaDeployPlan({ volatility: 4, binStep });
    const expected = 100 * (1 - (1 + binStep / 10000) ** -p.bins_below);
    assert.ok(Math.abs(p.downside_buffer_pct - expected) <= 0.05);
    assert.ok(p.downside_buffer_pct > 0 && p.downside_buffer_pct < 100);
    assert.equal(p.total_bins, p.bins_below + p.bins_above + 1);
  }
});
test('owner concentration limits cannot be silently loosened', () => {
  const t = getEvilPandaThresholds({ maxDevHoldPct: 1, maxTop10Pct: 15, maxRatTraderPct: 10, maxBundlePct: 20 });
  assert.equal(t.maxDevHoldPct, 1);
  assert.equal(t.maxTop10Pct, 15);
  assert.equal(t.maxRatTraderPct, 10);
  assert.equal(t.maxBundlerHardPct, 20);
  assert.equal(getEvilPandaThresholds({}).maxTop10Pct, 30);
});
test('manager follows mechanical exits without loss recovery instruction', () => {
  const prompt = buildSystemPrompt('MANAGER', {}, {});
  assert.match(prompt, /Execute precomputed CLOSE actions immediately/);
  assert.doesNotMatch(prompt, /NEVER close a position at a loss|We WANT dumps|only valid exit/);
});
