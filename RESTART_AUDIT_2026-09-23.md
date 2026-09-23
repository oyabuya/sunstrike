# Sunstrike restart audit — 2026-09-23

## Objective

Reassess the Sunstrike fork after five months, establish true wallet-level economics, and test the current strategy without repeating the April losses. No live launch is authorized by this document.

## Evidence available locally

- `lessons.json`: 28 closed position records dated 19–22 April 2026. Four have zero initial value. The other 24 contain 15 positive, 6 negative, and 3 flat recorded outcomes; their summed position PnL is **−$5.33**. This is not reconciled wallet PnL.
- The largest recorded loss is **−$4.89**. Gross LP fees in the 24 nonzero records sum to about **$8.24**, already included in the recorded position PnL formula.
- The 15 wins averaged **+$0.28** each ($4.25 total); the 6 losses averaged **−$1.60** each (−$9.58 total). Winning often did not offset loss severity. This is a sample diagnosis, not a forecast.
- `logs/actions-*.jsonl` contains deploy and close results with transaction-signature-shaped strings. Chain confirmation, exact token flows, rent, swaps, and network fees have not been independently reconciled in this audit.
- Of the 28 performance positions, 27 match a full successful deploy record and 23 match a full successful close record in the local action logs. Other action results may be truncated; missing full log entries are not proof that a chain transaction did not happen.
- Historical local `.env` and `user-config.json` were set to `DRY_RUN=false`. Both local values were changed to `true` before running the agent. Secret values were not printed or copied.
- Existing local settings include `maxPositions=1`, `maxDeployAmount=0.3 SOL`, `deployAmountSol=0.2 SOL`, `positionSizePct=0.55`, and `stopLossPct=-80`. These are historical settings, not an approved restart risk policy.
- The repository has no durable wallet-level daily or cumulative loss limit. A stop-loss trigger also cannot guarantee a fill at its threshold during a token collapse or an outage.
- The current management rules wait up to four hours for ordinary closes and hold loss-making positions through low-yield exits (`config.js`, `index.js`). These choices need replay against the April losses before re-use; a token collapse may outrun the scheduled management cycle.

## Changes made in this restart pass

- Startup defaults to dry run. Live requires both `DRY_RUN=false` and `SUNSTRIKE_LIVE_ENABLED=true` in local environment.
- The agent's `update_config` tool cannot change capital limits or core anti-rug policy.
- Dry-run tool results cannot trigger live-style post-action notifications or automatic follow-up swaps.
- Live deploy rejects missing pool mint data or unavailable required token-risk data.
- Live deploy also rejects a failed open-position query; the underlying reader can return `total_positions: 0` together with an error, which previously looked like free capacity.
- The embedded Jupiter API key was removed. A live swap requires `JUPITER_API_KEY` from the local environment. The previously embedded key should be treated as exposed and replaced before use.
- The screening/agent smoke scripts now exit nonzero on an uncaught API failure; previously they printed an error but reported process success.
- Default OpenRouter model slugs were updated to `openai/gpt-4.1-mini` after the public model catalog no longer listed `openrouter/healer-alpha` or `openrouter/hunter-alpha`. The replacement is listed with tool support; an authenticated tool-call smoke test is still required.
- For the owner's cheaper model trial, the public OpenRouter catalog on 2026-09-23 listed `openai/gpt-6-luna` at $0.10/M input and $0.50/M output tokens with tool calling and structured outputs, but without a `temperature` parameter. The agent now omits that parameter for Luna and uses the currently listed `openai/gpt-4.1-mini` as its transient-error fallback. Luna was released 2026-09-22, so operational stability and report consistency remain unverified.
- Optional Jev 1.13 shadow measurement is prepared for dry-run screening only. It records separate fee, momentum, and holder-risk scores for up to five post-filter candidates when `JEV_SHADOW_ENABLED=true` and an OpenRouter key exists. It cannot change candidate order, Luna's prompt, or execution. No authenticated Jev call has been run yet; scores need outcome validation before use.

## Verification so far

- All repository JavaScript files pass `node --check`.
- Restart safety tests pass for blocked live startup, invalid-mode dry-run fallback, and rejection of agent edits to capital limits.
- Installed dependencies satisfy the local package manifest (`npm ls --depth=0 --omit=dev`). This does not verify current upstream compatibility.
- The screening smoke script could not reach `pool-discovery-api.datapi.meteora.ag` from this sandbox (`ENOTFOUND`). Its API behavior remains unverified; the current official Meteora Data API documentation lists `https://dlmm.datapi.meteora.ag` as the production base URL. Do not infer that the older endpoint is dead solely from this sandbox error.
- On the selected Hetzner VPS, both public Meteora endpoints returned HTTP 200. The old discovery endpoint had over 240,000 pools in an unfiltered query, but the current Sunstrike filter returned **zero** candidates. A bounded filter probe found 8 candidates before strict warning flags, 1 after those flags, and 0 after the 12-hour minimum age rule. This is a current opportunity shortage under the configured rules, not an API outage. Do not loosen safety rules simply to force a trade.
- The Hetzner host has about 6.6 GiB available RAM and 43 GiB available disk at the audit time. Some existing Next.js and PM2 processes and ports remain present; they were left untouched. A private checkout exists at `/home/ubuntu/projects/sunstrike`, with dependencies installed and minimal secret-free `.env` and `user-config.json` files in dry-run mode. No Sunstrike service or bot is running. The three restart safety tests pass on the VPS.

## Remaining gates, in order

1. **Historical reconciliation.** Match every April deploy, claim, close, and swap signature to finalized Solana transactions. Reconstruct wallet balances and USD value at common timestamps, including rent, transaction fees, failed transactions, slippage, leftover tokens, and LLM/API charges. Investigate the four zero-value records and any skipped performance records. Keep the original files intact.
2. **Owner risk policy.** The owner confirmed $100 starting capital and $20 maximum total test loss. Set maximum per-position exposure, maximum concurrent exposure, fee reserve, and stop conditions. The historical `−80%` trigger cannot serve as the test loss limit. Add a durable cumulative loss circuit breaker before live use.
3. **Runtime verification.** Verify current Node and dependency versions against official Meteora/Solana/Jupiter interfaces. Test pool discovery, token-risk providers, RPC reads, wallet balance, Telegram allowlist, and model tool calling with live market data but no signing. Verify clean shutdown and alerts on missing data or provider outages.
4. **Paper evaluation.** Run a bounded dry-run period with timestamped candidate and rejection records. Model executable entry and exit prices, fee/rent costs, latency, and token collapse. Report candidate count, actionable rate, expected net PnL, worst-case exposure, and all provider failures. Dry-run results are not proof of live returns.
5. **Live canary decision.** Only after gates 1–4 and an explicit owner launch decision, use a dedicated wallet and a small part of the approved capital. Reconcile each transaction and wallet balance before the next entry. Stop automatically at the approved loss cap or when reconciliation/market data fails.

## Current decision

**DRY_RUN only.** Historical PnL is negative and incomplete. The $20 loss cap is recorded but not yet enforced in code. Do not fund a bot wallet or enable live mode based on this audit alone.
