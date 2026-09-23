import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
process.env.DRY_RUN = 'true';
process.env.WALLET_PRIVATE_KEY = bs58.encode(Keypair.generate().secretKey);
process.env.SUNSTRIKE_LIVE_WALLET = '';
process.env.HELIUS_API_KEY = 'test';
const { getWalletBalances } = await import('../tools/wallet.js');
test('Helius native SOL sentinel resolves amount and price without trusting symbols', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ totalUsdValue: 100,
      balances: [{ mint: 'So11111111111111111111111111111111111111111', balance: 1, pricePerToken: 100, usdValue: 100 },
        { mint: 'fake', symbol: 'USDC', balance: 9000, usdValue: 0 }] }) });
    const b = await getWalletBalances();
    assert.equal(b.sol, 1);
    assert.equal(b.sol_price, 100);
    assert.equal(b.usdc, 0);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ totalUsdValue: 0 }) });
    assert.match((await getWalletBalances()).error, /missing or invalid/);
  } finally { globalThis.fetch = original; }
});
