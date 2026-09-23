import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DRY_RUN = 'true';
const { buildDiscoveryFilters } = await import('../tools/screening.js');
const { config } = await import('../config.js');
test('diagnostic filters match configured age, volume window and safety gates', () => {
  const filters = buildDiscoveryFilters({ ...config.screening, minTokenAgeHours: 12, maxTokenAgeHours: 72, minVolume: 1234 }, 300000000);
  assert.ok(filters.includes('base_token_created_at<=256800000'));
  assert.ok(filters.includes('base_token_created_at>=40800000'));
  assert.ok(filters.includes('volume>=1234'));
  assert.ok(filters.includes('base_token_has_critical_warnings=false'));
  assert.ok(filters.includes('base_token_has_high_single_ownership=false'));
});
