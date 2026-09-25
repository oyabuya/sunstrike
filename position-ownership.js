// Autonomous exits and claims apply only to positions deployed by Sunstrike.
export function isBotManagedPosition(position, tracked) {
  return Boolean(
    position?.position &&
    tracked?.position === position.position &&
    tracked.closed === false &&
    tracked.deployed_at &&
    (!position.pool || !tracked.pool || tracked.pool === position.pool)
  );
}

export function isAllowedAutonomousManagementTool(name, args, approvedAddresses) {
  if (!Array.isArray(approvedAddresses)) return true;
  if (!["close_position", "claim_fees", "swap_token", "deploy_position"].includes(name)) return true;
  return ["close_position", "claim_fees"].includes(name) &&
    approvedAddresses.includes(args?.position_address);
}
