import { assertLiveConfiguration, config } from './config.js';
import { checkPortfolioRisk } from './portfolio-risk.js';
import { getWalletBalances } from './tools/wallet.js';
import { getMyPositions } from './tools/dlmm.js';

// Called only by the authenticated Telegram handler while all execution is idle.
export async function switchRuntimeMode(mode, dependencies = {}) {
  if (mode === 'DRY_RUN') {
    process.env.DRY_RUN = 'true';
    return 'DRY_RUN aktif. Tidak ada transaksi baru. Posisi on-chain tidak ditutup otomatis. Restart kembali mengikuti .env.';
  }
  if (mode !== 'LIVE') throw new Error('Mode tidak dikenal');
  (dependencies.assertConfiguration || assertLiveConfiguration)();
  const [balance, positions] = await Promise.all([
    (dependencies.getBalance || getWalletBalances)(),
    (dependencies.getPositions || getMyPositions)({ force: true, silent: true }),
  ]);
  const risk = (dependencies.checkRisk || checkPortfolioRisk)({
    balance, positions, expectedWallet: process.env.SUNSTRIKE_LIVE_WALLET, risk: config.risk,
  });
  if (!risk.allowed) throw new Error(risk.reason);
  if (!Number.isFinite(balance.sol) || balance.sol < config.management.minSolToOpen ||
      !Number.isFinite(balance.sol_price) || balance.sol_price <= 0 ||
      balance.total_usd < config.risk.minimumLiquidReserveUsd) {
    throw new Error('Saldo SOL/reserve belum cukup untuk LIVE');
  }
  process.env.DRY_RUN = 'false';
  return 'LIVE aktif. Maksimum dua posisi, masing-masing 0,2 SOL. Tidak ada batas rugi portofolio otomatis. Screening mengikuti jadwal. /dry_run untuk simulasi; /mode untuk status.';
}
