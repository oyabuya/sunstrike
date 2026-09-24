import test from "node:test";
import assert from "node:assert/strict";
import { formatWalletTokenMessages } from "../telegram-wallet-view.js";

test("wallet view includes every positive token and distinguishes zero from unknown USD value", () => {
  const pages = formatWalletTokenMessages({ wallet: "WALLET", total_usd: 10, tokens: [
    { symbol: "SOL", mint: "So11111111111111111111111111111111111111111", balance: 0.1, usd: 10 },
    { symbol: "DUST", mint: "DUST_MINT", balance: 0.00000001, usd: null },
    { symbol: "ZERO", mint: "ZERO_MINT", balance: 4, usd: 0 },
    { symbol: "EMPTY", mint: "EMPTY_MINT", balance: 0, usd: 0 },
  ] });
  const text = pages.join("\n");
  assert.match(text, /3 token dengan saldo positif/);
  for (const symbol of ["SOL", "DUST", "ZERO"]) assert.match(text, new RegExp(symbol));
  assert.doesNotMatch(text, /EMPTY/);
  assert.match(text, /nilai USD belum tersedia/);
  assert.match(text, /ZERO \(ZERO_MINT\): 4 · \$0/);
  assert.match(text, /1\.000e-8/);
});

test("wallet view sends all assets across pages without Telegram truncation", () => {
  const tokens = Array.from({ length: 120 }, (_, i) => ({ symbol: `TOKEN${i}`, mint: `MINT_${i}`, balance: i + 1, usd: i }));
  const pages = formatWalletTokenMessages({ wallet: "WALLET", total_usd: 100, tokens });
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= 3500));
  for (let i = 0; i < 120; i++) assert.match(pages.join("\n"), new RegExp(`TOKEN${i} \\(`));
});
