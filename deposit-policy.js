import { config } from './config.js';

export const USDC_PER_POSITION = 20;
// New bin arrays are blocked before signing. Keep SOL for network fees and
// position-account rent without charging the unused bin-array rent buffer.
export const USDC_POSITION_RENT_SOL = 0.02;

export function isApprovedDepositRequest(args, deposit) {
  const amountY = args?.amount_y ?? (deposit?.symbol === 'SOL' ? args?.amount_sol : null);
  return Number.isFinite(amountY) && Number.isFinite(deposit?.amount) &&
    Math.abs(amountY - deposit.amount) <= 0.000001;
}

export function chooseDeposit(balance, management = config.management, tokens = config.tokens, risk = config.risk) {
  const reserveSol = management.gasReserve + (management.binArrayRentBuffer ?? 0.15);
  const usdcReserveSol = management.gasReserve + USDC_POSITION_RENT_SOL;
  const solRequired = Math.max(management.minSolToOpen, management.deployAmountSol + reserveSol);
  if (Number.isFinite(balance?.sol) && Number.isFinite(balance?.sol_price) && balance.sol_price > 0 &&
      balance.sol >= solRequired && management.deployAmountSol * balance.sol_price <= risk.maxPositionUsd) {
    return { mint: tokens.SOL, symbol: 'SOL', amount: management.deployAmountSol,
      amountUsd: management.deployAmountSol * balance.sol_price, requiredSol: solRequired };
  }
  if (Number.isFinite(balance?.usdc) && balance.usdc >= USDC_PER_POSITION &&
      Number.isFinite(balance?.sol) && balance.sol >= usdcReserveSol) {
    return { mint: tokens.USDC, symbol: 'USDC', amount: USDC_PER_POSITION,
      amountUsd: USDC_PER_POSITION, requiredSol: usdcReserveSol };
  }
  return null;
}
