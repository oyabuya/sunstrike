import { assertLiveConfiguration, config } from './config.js';
import { checkPortfolioRisk, validateNewPosition } from './portfolio-risk.js';
import { getWalletBalances } from './tools/wallet.js';
import { getMyPositions } from './tools/dlmm.js';
import { chooseDeposit } from './deposit-policy.js';

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
  const deposit = chooseDeposit(balance);
  if (!deposit || !Number.isFinite(balance.total_usd) ||
      balance.total_usd < config.risk.minimumLiquidReserveUsd) {
    throw new Error('Saldo SOL atau USDC dan reserve SOL belum cukup untuk LIVE');
  }
  if (!Number.isFinite(risk.snapshot?.open_exposure_usd)) throw new Error('Eksposur LP tidak dapat diverifikasi');
  const sizing = validateNewPosition({ amountUsd: deposit.amountUsd, walletUsd: balance.total_usd,
    currentExposureUsd: risk.snapshot?.open_exposure_usd, risk: config.risk });
  if (!sizing.pass) throw new Error(sizing.reason);
  process.env.DRY_RUN = 'false';
  return 'LIVE aktif. Maksimum dua posisi: 0,2 SOL bila SOL cukup; jika tidak, 20 USDC dengan reserve SOL. Tidak ada batas rugi portofolio otomatis. Screening mengikuti jadwal. /dry_run untuk simulasi; /mode untuk status.';
}
