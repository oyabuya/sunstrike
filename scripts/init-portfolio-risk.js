import "../load-env.js";
import { resolveLiveWalletAddress } from "../wallet-identity.js";

if (process.env.DRY_RUN !== "true") {
  throw new Error("Run this read-only initializer with DRY_RUN=true; it never signs transactions.");
}
resolveLiveWalletAddress({ required: true });

const [{ config }, { getWalletBalances }, { getMyPositions }, { initializePortfolioRiskState }] = await Promise.all([
  import("../config.js"),
  import("../tools/wallet.js"),
  import("../tools/dlmm.js"),
  import("../portfolio-risk.js"),
]);

const [balance, positions] = await Promise.all([
  getWalletBalances(),
  getMyPositions({ force: true, silent: true }),
]);
if (balance?.error || positions?.error) {
  throw new Error("Read-only wallet/LP snapshot failed; no portfolio risk state was created.");
}

const state = initializePortfolioRiskState({
  balance,
  positions,
  expectedWallet: process.env.SUNSTRIKE_LIVE_WALLET,
  risk: config.risk,
});
console.log(`Portfolio risk state initialized for this wallet. Initial equity: $${state.initial_snapshot.equity_usd.toFixed(2)}.`);
