import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshTelegramUpdate } from '../telegram.js';
test('Telegram rejects queued commands from before polling started and expired messages', () => {
  assert.equal(isFreshTelegramUpdate({ date: 999 }, 1000, 1001), false);
  assert.equal(isFreshTelegramUpdate({ date: 1000 }, 1000, 1001), false);
  assert.equal(isFreshTelegramUpdate({ date: 1001 }, 1000, 1002), true);
  assert.equal(isFreshTelegramUpdate({ date: 1001 }, 1000, 1122), false);
  assert.equal(isFreshTelegramUpdate({}, 1000, 1001), false);
});
