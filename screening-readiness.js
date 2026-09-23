// Provider failures must never be interpreted as an empty wallet or free capacity.
export function assertScreeningInputs(positions, balance) {
  if (positions?.error || !Array.isArray(positions?.positions) ||
      !Number.isInteger(positions?.total_positions) ||
      positions.total_positions !== positions.positions.length) {
    throw new Error('Screening blocked: open positions could not be verified');
  }
  if (balance?.error || !balance?.wallet ||
      !Number.isFinite(balance.sol) || balance.sol < 0 ||
      !Number.isFinite(balance.total_usd) || balance.total_usd < 0) {
    throw new Error('Screening blocked: wallet balance could not be verified');
  }
}
