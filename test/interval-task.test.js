import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleInterval } from '../interval-task.js';

test('45-minute interval does not fire again after only 15 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const task = scheduleInterval(45, () => { calls++; });
  t.mock.timers.tick(45 * 60000);
  await Promise.resolve();
  assert.equal(calls, 1);
  t.mock.timers.tick(15 * 60000);
  await Promise.resolve();
  assert.equal(calls, 1);
  t.mock.timers.tick(30 * 60000);
  await Promise.resolve();
  assert.equal(calls, 2);
  task.stop();
  t.mock.timers.tick(45 * 60000);
  assert.equal(calls, 2);
});
test('slow tasks cannot overlap; errors allow later retries', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release, calls = 0, errors = 0;
  const task = scheduleInterval(1, async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    else throw new Error('provider unavailable');
  }, () => { errors++; });
  t.mock.timers.tick(60000);
  t.mock.timers.tick(120000);
  assert.equal(calls, 1);
  release();
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(60000);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(errors, 1);
  task.stop();
});
test('invalid intervals cannot silently become rapid loops', () => {
  for (const value of [0, -1, NaN, Infinity, 40000]) {
    assert.throws(() => scheduleInterval(value, () => {}), /Interval/);
  }
});
