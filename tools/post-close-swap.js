export function getPostCloseSwapCandidate(tokens, mint, minimumKnownUsd = 0.10) {
  if (!Array.isArray(tokens)) return { status: "unknown", reason: "wallet token balances are unavailable" };
  const token = tokens.find((entry) => entry?.mint === mint);
  if (!token) return { status: "none" };

  const amount = Number(token.balance);
  if (!Number.isFinite(amount) || amount < 0) {
    return { status: "unknown", reason: "base token balance is invalid" };
  }
  if (amount === 0) return { status: "none" };
  if (Number.isFinite(token.usd) && token.usd < minimumKnownUsd) {
    return { status: "dust", token, amount };
  }
  return { status: "ready", token, amount };
}

export function isConfirmedSwapResult(result) {
  return result?.success === true &&
    typeof result.tx === "string" && result.tx.trim().length > 0 &&
    !result.error && result.dry_run !== true;
}
