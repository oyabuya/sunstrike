// Read-only operational audit: never switches mode or invokes transaction tools.
import { config, assertLiveConfiguration } from '../config.js';
import { getWalletBalances } from '../tools/wallet.js';
import { getMyPositions } from '../tools/dlmm.js';
import { checkPortfolioRisk, validateNewPosition } from '../portfolio-risk.js';
import { chooseDeposit } from '../deposit-policy.js';

const blockers = [];
try { assertLiveConfiguration(); } catch (error) { blockers.push(error.message); }
const [balance, positions] = await Promise.all([
  getWalletBalances(), getMyPositions({ force: true, silent: true }),
]);
// Updates the local risk ledger snapshot; does not alter the operator's mode.
const risk = checkPortfolioRisk({ balance, positions,
  expectedWallet: process.env.SUNSTRIKE_LIVE_WALLET, risk: config.risk });
if (!risk.allowed) blockers.push(risk.reason);
const deposit = chooseDeposit(balance);
if (!deposit) blockers.push('Neither 0.2 SOL nor 20 USDC with SOL transaction reserve is available');
const sizing = validateNewPosition({ amountUsd: deposit?.amountUsd,
  walletUsd: balance.total_usd,
  currentExposureUsd: risk.snapshot?.open_exposure_usd, risk: config.risk });
if (deposit && !sizing.pass) blockers.push(sizing.reason);
if (!Number.isFinite(balance.total_usd) || balance.total_usd < config.risk.minimumLiquidReserveUsd) blockers.push('Liquid USD reserve is insufficient or unknown');
if (positions.total_positions >= config.risk.maxPositions) blockers.push('All approved LP slots are occupied');
console.log(JSON.stringify({ at: new Date().toISOString(), ready_for_entry: blockers.length === 0,
  configured_mode: process.env.DRY_RUN === 'true' ? 'DRY_RUN' : 'LIVE',
  deposit: deposit && { side: deposit.symbol, strategy: config.strategy.strategy, amount: deposit.amount },
  liquid_sol: balance.sol ?? null, liquid_usdc: balance.usdc ?? null, required_sol: deposit?.requiredSol ?? null,
  equity_usd: risk.snapshot?.equity_usd ?? null, open_positions: positions.total_positions ?? null,
  positions: positions.positions?.map(p => ({ pair: p.pair, in_range: p.in_range,
    direction: ![p.active_bin, p.upper_bin, p.lower_bin].every(Number.isFinite) ? 'unknown'
      : p.active_bin > p.upper_bin ? 'above' : p.active_bin < p.lower_bin ? 'below' : 'in_range',
    minutes_out_of_range: p.minutes_out_of_range ?? null, value_usd: p.total_value_true_usd })),
  blockers,
  note: 'Entry still requires fresh candidate preflight; readiness does not prove profitability.',
}, null, 2));
process.exit(blockers.length ? 1 : 0);
