import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertScreeningInputs } from '../screening-readiness.js';
const positions = { positions: [], total_positions: 0 };
const balance = { wallet: 'test-wallet', sol: 0, total_usd: 0 };
test('verified empty wallet is valid for dry-run screening', () => {
  assert.doesNotThrow(() => assertScreeningInputs(positions, balance));
});
test('RPC failure cannot masquerade as zero positions', () => {
  for (const bad of [{ ...positions, error: 'RPC failed' }, { positions: [] }, { ...positions, total_positions: 1 }, null]) {
    assert.throws(() => assertScreeningInputs(bad, balance), /positions could not be verified/);
  }
});
test('wallet failures and invalid values block screening', () => {
  for (const bad of [{ ...balance, error: 'timeout' }, { ...balance, wallet: null }, { ...balance, sol: NaN }, { ...balance, total_usd: -1 }]) {
    assert.throws(() => assertScreeningInputs(positions, bad), /balance could not be verified/);
  }
});
