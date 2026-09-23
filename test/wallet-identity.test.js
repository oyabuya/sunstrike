import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { deriveWalletAddress, resolveLiveWalletAddress } from "../wallet-identity.js";

test("derives and binds the public wallet when the optional address is absent", () => {
  const previousKey = process.env.WALLET_PRIVATE_KEY;
  const previousAddress = process.env.SUNSTRIKE_LIVE_WALLET;
  const keypair = Keypair.generate();
  process.env.WALLET_PRIVATE_KEY = bs58.encode(keypair.secretKey);
  delete process.env.SUNSTRIKE_LIVE_WALLET;

  try {
    assert.equal(resolveLiveWalletAddress({ required: true }), keypair.publicKey.toBase58());
    assert.equal(process.env.SUNSTRIKE_LIVE_WALLET, keypair.publicKey.toBase58());
  } finally {
    if (previousKey === undefined) delete process.env.WALLET_PRIVATE_KEY;
    else process.env.WALLET_PRIVATE_KEY = previousKey;
    if (previousAddress === undefined) delete process.env.SUNSTRIKE_LIVE_WALLET;
    else process.env.SUNSTRIKE_LIVE_WALLET = previousAddress;
  }
});

test("rejects a public wallet address that differs from the signing key", () => {
  const previousKey = process.env.WALLET_PRIVATE_KEY;
  const previousAddress = process.env.SUNSTRIKE_LIVE_WALLET;
  process.env.WALLET_PRIVATE_KEY = bs58.encode(Keypair.generate().secretKey);
  process.env.SUNSTRIKE_LIVE_WALLET = Keypair.generate().publicKey.toBase58();

  try {
    assert.throws(() => resolveLiveWalletAddress({ required: true }), /does not match/);
  } finally {
    if (previousKey === undefined) delete process.env.WALLET_PRIVATE_KEY;
    else process.env.WALLET_PRIVATE_KEY = previousKey;
    if (previousAddress === undefined) delete process.env.SUNSTRIKE_LIVE_WALLET;
    else process.env.SUNSTRIKE_LIVE_WALLET = previousAddress;
  }
});

test("does not turn an invalid key into a wallet identity", () => {
  assert.throws(() => deriveWalletAddress("not-a-key"), /invalid or unreadable/);
});
