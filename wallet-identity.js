import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function deriveWalletAddress(privateKey) {
  if (!privateKey) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey)).publicKey.toBase58();
  } catch {
    throw new Error("WALLET_PRIVATE_KEY is invalid or unreadable.");
  }
}

/** Resolve the public identity from the configured signing key without exposing it. */
export function resolveLiveWalletAddress({ required = false } = {}) {
  const configured = process.env.SUNSTRIKE_LIVE_WALLET?.trim() || "";
  let derived = null;

  if (process.env.WALLET_PRIVATE_KEY) {
    try {
      derived = deriveWalletAddress(process.env.WALLET_PRIVATE_KEY);
    } catch (error) {
      if (required) throw error;
    }
  }

  if (configured && derived && configured !== derived) {
    throw new Error("SUNSTRIKE_LIVE_WALLET does not match WALLET_PRIVATE_KEY.");
  }
  if (required && !derived) {
    throw new Error("A valid WALLET_PRIVATE_KEY is required to bind the live wallet.");
  }

  const address = derived || configured || null;
  if (address) process.env.SUNSTRIKE_LIVE_WALLET = address;
  return address;
}
