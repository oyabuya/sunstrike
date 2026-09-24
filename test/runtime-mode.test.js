import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DRY_RUN = 'true';
const { switchRuntimeMode } = await import('../runtime-mode.js');

test('LIVE validates configuration and fresh risk before changing mode', async () => {
  const old = process.env.DRY_RUN;
  const deps = {
    assertConfiguration() {},
    async getBalance() { return { sol: 1, sol_price: 100, total_usd: 100 }; },
    async getPositions() { return {}; },
    checkRisk() { return { allowed: false, reason: 'wallet snapshot stale' }; },
  };
  try {
    await assert.rejects(switchRuntimeMode('LIVE', deps), /wallet snapshot stale/);
    assert.equal(process.env.DRY_RUN, 'true');
    await assert.rejects(switchRuntimeMode('LIVE', { ...deps, assertConfiguration() { throw new Error('missing key'); } }), /missing key/);
    assert.equal(process.env.DRY_RUN, 'true');
    deps.checkRisk = () => ({ allowed: true });
    await switchRuntimeMode('LIVE', deps);
    assert.equal(process.env.DRY_RUN, 'false');
    await switchRuntimeMode('DRY_RUN');
    assert.equal(process.env.DRY_RUN, 'true');
  } finally { process.env.DRY_RUN = old; }
});
