import { config } from './config.js';

export const USDC_PER_POSITION = 20;

export function chooseDeposit(balance, management = config.management, tokens = config.tokens, risk = config.risk) {
  const reserveSol = management.gasReserve + (management.binArrayRentBuffer ?? 0.15);
  const solRequired = Math.max(management.minSolToOpen, management.deployAmountSol + reserveSol);
  if (Number.isFinite(balance?.sol) && Number.isFinite(balance?.sol_price) && balance.sol_price > 0 &&
      balance.sol >= solRequired && management.deployAmountSol * balance.sol_price <= risk.maxPositionUsd) {
    return { mint: tokens.SOL, symbol: 'SOL', amount: management.deployAmountSol,
      amountUsd: management.deployAmountSol * balance.sol_price, requiredSol: solRequired };
  }
  if (Number.isFinite(balance?.usdc) && balance.usdc >= USDC_PER_POSITION &&
      Number.isFinite(balance?.sol) && balance.sol >= reserveSol) {
    return { mint: tokens.USDC, symbol: 'USDC', amount: USDC_PER_POSITION,
      amountUsd: USDC_PER_POSITION, requiredSol: reserveSol };
  }
  return null;
}
