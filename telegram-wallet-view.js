function amount(value) {
  if (value > 0 && value < 0.000001) return value.toExponential(3);
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 9 }).format(value);
}

function usd(value) {
  return value == null ? "nilai USD belum tersedia" : `$${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value)}`;
}

export function formatWalletTokenMessages(wallet, maxLength = 3500) {
  if (!Array.isArray(wallet?.tokens)) throw new Error("Daftar token wallet tidak tersedia");
  const tokens = wallet.tokens.filter((token) => Number.isFinite(token.balance) && token.balance > 0)
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const header = `💰 Aset wallet ${wallet.wallet}\nTotal wallet: ${usd(wallet.total_usd)}\n${tokens.length} token dengan saldo positif`;
  if (!tokens.length) return [`${header}\nTidak ada token dengan saldo positif.`];

  const messages = [];
  let page = header;
  for (const token of tokens) {
    const mint = token.mint || "mint tidak tersedia";
    const label = mint.length > 16 ? `${mint.slice(0, 8)}…${mint.slice(-4)}` : mint;
    const line = `\n• ${token.symbol || "?"} (${label}): ${amount(token.balance)} · ${usd(token.usd)}`;
    if (page.length + line.length > maxLength) {
      messages.push(page);
      page = "💰 Aset wallet (lanjutan)";
    }
    page += line;
  }
  messages.push(page);
  return messages;
}
