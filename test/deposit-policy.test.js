import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDeposit, isApprovedDepositRequest, USDC_PER_POSITION, USDC_POSITION_RENT_SOL } from '../deposit-policy.js';
import { config } from '../config.js';
import { validateNewPosition } from '../portfolio-risk.js';

test('USDC deploy accepts exact amount_y despite a redundant legacy SOL alias', () => {
  const deposit = { symbol: 'USDC', amount: USDC_PER_POSITION };
  assert.equal(isApprovedDepositRequest({ amount_y: 20, amount_sol: 0.2 }, deposit), true);
  assert.equal(isApprovedDepositRequest({ amount_y: 20.01, amount_sol: 0.2 }, deposit), false);
  assert.equal(isApprovedDepositRequest({ amount_sol: 20 }, deposit), false);
  assert.equal(isApprovedDepositRequest({ amount_y: '20' }, deposit), false);
  assert.equal(isApprovedDepositRequest({ amount_y: 0.2, amount_sol: 20 }, { symbol: 'SOL', amount: 0.2 }), true);
});

test('SOL has priority when both deposits can be funded', () => {
  const deposit = chooseDeposit({ sol: 0.8, sol_price: 120, usdc: 100 });
  assert.equal(deposit.mint, config.tokens.SOL);
  assert.equal(deposit.amount, 0.2);
  assert.equal(deposit.amountUsd, 24);
});

test('USDC fallback needs $20 and SOL transaction reserve', () => {
  const deposit = chooseDeposit({ sol: 0.4, sol_price: 120, usdc: 40 });
  assert.equal(deposit.mint, config.tokens.USDC);
  assert.equal(deposit.amount, USDC_PER_POSITION);
  const reserve = config.management.gasReserve + USDC_POSITION_RENT_SOL;
  assert.equal(deposit.requiredSol, reserve);
  assert.equal(chooseDeposit({ sol: reserve - 0.01, sol_price: 120, usdc: 40 }), null);
  assert.equal(chooseDeposit({ sol: 0.4, sol_price: 120, usdc: 19.99 }), null);
  assert.equal(chooseDeposit({ sol: 0.8, sol_price: 300, usdc: 40 }).mint, config.tokens.USDC);
});

test('two USDC deposits are bounded by two $20 entries and USD exposure checks', () => {
  const risk = config.risk;
  const first = validateNewPosition({ amountUsd: 20, walletUsd: 90, currentExposureUsd: 0, risk });
  const second = validateNewPosition({ amountUsd: 20, walletUsd: 70, currentExposureUsd: 20, risk });
  assert.equal(first.pass, true);
  assert.equal(second.pass, true);
  assert.equal(first.amountUsd + second.amountUsd, 40);
  assert.equal(validateNewPosition({ amountUsd: 20, walletUsd: 30, currentExposureUsd: 40, risk }).pass, false);
});
