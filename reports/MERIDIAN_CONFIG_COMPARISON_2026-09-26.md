# Meridian vs Sunstrike configuration audit — 2026-09-26

## Scope

Compared this checkout with `upstream/main` at `5ab14b476e4e8d25c58f989c77b161721e1a505f` (2026-06-25), and checked the current local resolved config. The read-only VPS query was denied by the sandbox (`Operation not permitted`), so VPS values below are taken only from the existing handoff. Local `user-config.json` is gitignored and was last modified 2026-09-24; it is not proof of the current VPS config.

## Differences that change LP behavior

| Area | Meridian upstream defaults | Sunstrike current policy / local behavior |
|---|---|---|
| Position sizing | Up to 3 positions; 0.5 SOL base with 35% dynamic sizing and 0.2 SOL reserve. | At most 2 positions; fixed 0.2 SOL, or 20 USDC per position when SOL is insufficient and reserve passes. |
| Strategy and range | Default `bid_ask`; 35–69 bins below and zero above for the single-side SOL path. | `spot` is the owner-approved strategy. Autonomous screening computes `bins_below` from volatility and bin step and recommends 10 bins above; local `binsBelow=70` is not the screening plan. |
| Exits | Code defaults: −50% stop, 5% fee take-profit, low-yield exit after 60 minutes, trailing TP on (3% trigger / 1.5% drop), and 30-minute OOR wait. | No percentage stop/TP/trailing or low-yield-only exit. Hold in-range while fees run; close above-range immediately; review below-range after 4 hours with token, volume, and fee evidence. |
| Candidate screen | 5m; fee/active-TVL ≥0.05%; TVL $10k–$150k; volume $500; organic ≥60; holders ≥500; market cap $150k–$10m; bin step 80–125; no minimum token age. | Owner gates include age ≥12h and Jupiter Organic Score ≥80; screening also uses a 5m+1h activity policy in DRY_RUN. The Sept 25 handoff records fee floor 0.02%, volume $500, holders ≥500, token fees ≥50 SOL, and max TVL $500k. |
| Cadence | Management 10m; screening 30m. | Handoff records management 15m and screening 45m. Local ignored config currently resolves to 15m/60m. |

The local resolved config also differs from the handoff on `maxTvl` ($800k vs the recorded $500k), `minHolders` (450 vs 500), and `minTokenFeesSol` (30 vs 50). Treat this as local config drift, not as confirmed VPS behavior. Do not copy these local overrides into the VPS without reconciling the operator config.

The strategy difference is not just the word `spot`: Sunstrike's screening plan derives the lower range from volatility/bin step and places a small upper range. Meridian's current single-side SOL path fixes the upper bin at the active bin. This changes where liquidity is placed and how quickly a pump can move a position OOR. The old `binsBelow` user-config field alone does not describe Sunstrike's autonomous plan.

## What the Morning Briefing does and does not show

- The 14 `PREFER` lines are selected lessons, not the full set of 26 closes. Meridian emits `PREFER` only when a position is classified good and had over 80% in-range efficiency. A position counts as good at ≥5% PnL, or at nonnegative PnL with fee yield ≥2%.
- Meridian stores PnL as `final_value + fees_earned - initial_value`. Thus the reported +$83.54 already includes the $101.82 fees; do not add them. On those figures, the inventory-value component is about −$18.28 before transaction and operating costs that this formula does not show.
- If the daily and all-time numbers use the same ledger, +$83.54 for the last day and +$14.44 all-time imply roughly −$69.10 before that day. The daily result is strong, but it does not establish positive long-run net PnL.
- The briefing does not identify the user's config or Meridian version. The sample itself includes `bin_step=200` and an entry TVL of $7k, outside the current source defaults of max bin step 125 and min TVL $10k (assuming the displayed TVL is the same screen field). That points to an override, different version, or different metric semantics; it is not evidence of untouched defaults.

## Conclusion and next evidence

The largest structural causes to investigate are position sizing/range construction and exit policy; screen cadence and candidate gates also change which pools are entered. The briefing is not enough to attribute its outcome to Meridian defaults, and it is not a sound basis to change Sunstrike's owner-approved risk rules.

No runtime configuration, wallet, or service was changed. Before proposing strategy changes, reconcile the local ignored config with the actual VPS config and compare per-position records for both systems: initial/final value, fees, hold time, range, close reason, swaps, rent, and transaction costs. Also obtain the Meridian user's config/version if available.

## Sources

- [Meridian `config.js`](https://github.com/yunus-0x/meridian/blob/main/config.js)
- [Meridian `user-config.example.json`](https://github.com/yunus-0x/meridian/blob/main/user-config.example.json)
- [Meridian `strategy-library.js`](https://github.com/yunus-0x/meridian/blob/main/strategy-library.js)
- [Meridian `lessons.js`](https://github.com/yunus-0x/meridian/blob/main/lessons.js)
- [Meridian `briefing.js`](https://github.com/yunus-0x/meridian/blob/main/briefing.js)
