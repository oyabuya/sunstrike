# Sunstrike restart audit — 2026-09-23

## Objective

Reassess the Sunstrike fork after five months, establish true wallet-level economics, and test the current strategy without repeating the April losses. No live launch is authorized by this document.

## Evidence available locally

- `lessons.json`: 28 closed position records dated 19–22 April 2026. Four have zero initial value. The other 24 contain 15 positive, 6 negative, and 3 flat recorded outcomes; their summed position PnL is **−$5.33**. This is not reconciled wallet PnL.
- The largest recorded loss is **−$4.89**. Gross LP fees in the 24 nonzero records sum to about **$8.24**, already included in the recorded position PnL formula.
- `logs/actions-*.jsonl` contains deploy and close results with transaction-signature-shaped strings. Chain confirmation, exact token flows, rent, swaps, and network fees have not been independently reconciled in this audit.
- Of the 28 performance positions, 27 match a full successful deploy record and 23 match a full successful close record in the local action logs. Other action results may be truncated; missing full log entries are not proof that a chain transaction did not happen.
- Historical local `.env` and `user-config.json` were set to `DRY_RUN=false`. Both local values were changed to `true` before running the agent. Secret values were not printed or copied.
- Existing local settings include `maxPositions=1`, `maxDeployAmount=0.3 SOL`, `deployAmountSol=0.2 SOL`, `positionSizePct=0.55`, and `stopLossPct=-80`. These are historical settings, not an approved restart risk policy.
- The repository has no durable wallet-level daily or cumulative loss limit. A stop-loss trigger also cannot guarantee a fill at its threshold during a token collapse or an outage.

## Changes made in this restart pass

- Startup defaults to dry run. Live requires both `DRY_RUN=false` and `SUNSTRIKE_LIVE_ENABLED=true` in local environment.
- The agent's `update_config` tool cannot change capital limits or core anti-rug policy.
- Dry-run tool results cannot trigger live-style post-action notifications or automatic follow-up swaps.
- Live deploy rejects missing pool mint data or unavailable required token-risk data.
- The embedded Jupiter API key was removed. A live swap requires `JUPITER_API_KEY` from the local environment. The previously embedded key should be treated as exposed and replaced before use.
- The screening/agent smoke scripts now exit nonzero on an uncaught API failure; previously they printed an error but reported process success.

## Verification so far

- All repository JavaScript files pass `node --check`.
- Restart safety tests pass for blocked live startup, invalid-mode dry-run fallback, and rejection of agent edits to capital limits.
- Installed dependencies satisfy the local package manifest (`npm ls --depth=0 --omit=dev`). This does not verify current upstream compatibility.
- The screening smoke script could not reach `pool-discovery-api.datapi.meteora.ag` from this sandbox (`ENOTFOUND`). Its API behavior remains unverified; the current official Meteora Data API documentation lists `https://dlmm.datapi.meteora.ag` as the production base URL. Do not infer that the older endpoint is dead solely from this sandbox error.

## Remaining gates, in order

1. **Historical reconciliation.** Match every April deploy, claim, close, and swap signature to finalized Solana transactions. Reconstruct wallet balances and USD value at common timestamps, including rent, transaction fees, failed transactions, slippage, leftover tokens, and LLM/API charges. Investigate the four zero-value records and any skipped performance records. Keep the original files intact.
2. **Owner risk policy.** Record the actual new capital, maximum loss for the entire test, maximum per-position exposure, maximum concurrent exposure, fee reserve, and stop conditions. The historical `−80%` trigger cannot serve as the test loss limit. Add a durable cumulative loss circuit breaker before live use.
3. **Runtime verification.** Verify current Node and dependency versions against official Meteora/Solana/Jupiter interfaces. Test pool discovery, token-risk providers, RPC reads, wallet balance, Telegram allowlist, and model tool calling with live market data but no signing. Verify clean shutdown and alerts on missing data or provider outages.
4. **Paper evaluation.** Run a bounded dry-run period with timestamped candidate and rejection records. Model executable entry and exit prices, fee/rent costs, latency, and token collapse. Report candidate count, actionable rate, expected net PnL, worst-case exposure, and all provider failures. Dry-run results are not proof of live returns.
5. **Live canary decision.** Only after gates 1–4 and an explicit owner launch decision, use a dedicated wallet and a small part of the approved capital. Reconcile each transaction and wallet balance before the next entry. Stop automatically at the approved loss cap or when reconciliation/market data fails.

## Current decision

**DRY_RUN only.** Historical PnL is negative and incomplete; the new capital and acceptable maximum loss are still unspecified. Do not start `npm start`, fund a bot wallet, or enable live mode based on this audit alone.
