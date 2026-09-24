# Sunstrike

> Restart status (2026-09-23): dry-run preparation only. Read [the restart audit](RESTART_AUDIT_2026-09-23.md) before using capital. Live now requires both `DRY_RUN=false` and `SUNSTRIKE_LIVE_ENABLED=true`; the example environment defaults to dry run.

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

Sunstrike is a fork that started from `yunus-0x/meridian` and has since evolved into its own strategy stack. It no longer runs a head-to-head copy of the original repo approach. Instead, it uses a strategy fusion: the original Meridian framework and execution flow combined with EvilPanda-inspired screening, exit logic, and a different risk-management posture.

Sunstrike runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data. It learns from every position it closes.

---

## Strategy Identity

- **Foundation:** Meridian provides the autonomous agent loop, tool orchestration, portfolio management flow, and DLMM execution framework
- **Fusion layer:** EvilPanda ideas inform screening filters, pool selection bias, exit interpretation, and chart-based risk controls
- **Risk posture:** this fork uses its own parameter tuning, safeguards, and management thresholds rather than trying to mirror the upstream risk profile
- **Project stance:** this repo should be understood as a strategy fusion, not a straight merge and not a like-for-like clone of upstream behavior

---

## What it does

- **Screens pools** — scans Meteora DLMM pools against configurable thresholds, then applies fusion filters from Meridian, EvilPanda, GMGN, OKX, pool memory, and launchpad risk controls before the LLM sees the shortlist

- **Manages positions** — monitors, claims fees, and closes LP positions autonomously using a layered flow: deterministic JS exits first, chart-based EvilPanda signals second, LLM judgment only when action is required
- **Learns from performance** — records closed-position outcomes, studies strong LPers or smart wallets, and evolves parts of screening based on real position history
- **Discord signals** — optional Discord listener watches LP Army channels for Solana token calls and queues them for screening
- **Telegram chat** — full agent chat via Telegram, plus cycle reports and OOR alerts
- **Claude Code integration** — run AI-powered screening and management directly from your terminal using Claude Code slash commands

With the default 5m setting, screening samples Meteora Pool Discovery at 5m,
30m, 1h, and 2h, then deduplicates pools and applies the same risk gates.
The API rejects 15m for discovery; the candidate records which supported window
supplied its activity metrics. Final Jupiter audit and deploy preflight still apply.
Every candidate is also checked against the Solana RPC for an existing account
owned by the Meteora DLMM program before it is shown to the agent.
During an automated screening cycle, `deploy_position` accepts only an exact
pool address from that cycle's shortlist; a mistyped address is returned to the
agent with the canonical addresses for retry.

---

## How it works

Sunstrike does not operate as a pure "let the LLM decide everything" bot. The runtime is now a layered execution system:

- deterministic filters and safety checks reduce low-quality or dangerous pools before the model sees them
- deterministic management rules catch obvious exits, trailing logic, OOR state, and claim conditions without spending LLM budget
- the LLM is used as a final decision layer for screening selection and ambiguous management actions

Two specialized agents run on independent cron schedules:

| Agent | Default interval | Role |
|---|---|---|
| **Screening Agent** | Every 45 min | Pool screening — finds and deploys into the best candidate |
| **Management Agent** | Every 15 min | Position management — evaluates each open position and acts |

There is also a lightweight position poller between management cycles for peak/trailing confirmation and fast exit detection. After a deploy, the screener may tighten management cadence dynamically based on pool volatility.

**Data sources:**
- `@meteora-ag/dlmm` SDK — on-chain position data, active bin, deploy/close transactions
- Meteora DLMM PnL API — position yield, fee accrual, PnL
- OKX OnchainOS — smart money signals, token risk scoring
- Pool screening API — fee/TVL ratios, volume, organic scores, holder counts
- Jupiter API — token audit, mcap, launchpad, price stats

Agents are powered via **OpenRouter** and can be swapped for any compatible model.

## Strategy Flow

### Screening flow

1. Pool discovery pulls Meteora DLMM pools using threshold gates such as TVL, volume, holder count, bin step, market cap, organic score, and fee-active-TVL ratio.
2. Hard filters remove blacklisted tokens, blocked deployers, thematic scam patterns, CTO/community-takeover coins, occupied pools, occupied base mints, and cooldowned pools.
3. Candidate enrichment adds GMGN security data, GMGN token info, OKX risk and price signals, smart-wallet checks, token narrative, token audit, and pool memory.
4. More hard filters remove honeypots, excessive creator/dev ownership, wash-trading flags, blocked launchpads, excessive bot-holder concentration, and overheated price-vs-ATH setups.
5. EvilPanda-inspired entry context is attached through SuperTrend-on-15m and smart-wallet/KOL signals.
6. The screener LLM receives only the surviving shortlist and chooses one pool to deploy into, using a wide single-sided spot shape with `bins_above=0` and `bins_below` scaled by volatility.

### Management flow

1. Open positions are fetched from on-chain and Meteora portfolio/PnL sources, then reconciled with local state.
2. JS rules update OOR state, peak tracking, trailing-drop confirmation, low-yield checks, stop-loss checks, and claim thresholds before any LLM call.
3. EvilPanda-inspired 15m chart signals are fetched through GMGN OHLCV: RSI(2), Bollinger Bands, MACD, and green-candle bounce context.
4. If every position is a clear `STAY`, the management cycle ends without invoking the LLM.
5. If action is needed, the manager LLM receives a compact action block and executes only the required close, claim, or instruction-driven operations.
6. After closes, base tokens are swapped back to SOL when value is meaningful, performance is recorded, and screening can be re-triggered if capacity opens up.

### Learning and memory

- `state.json` tracks position-local state such as deployment context, OOR timestamps, notes, peak PnL, and trailing confirmation state
- `pool-memory.json` stores deploy history and pool-level recall
- `lessons.json` records closed-position performance and can evolve parts of screening config
- `smart-wallets.json` stores tracked LP and holder wallets, including auto-discovered wallets from LPAgent or GMGN

---

## Requirements

- Node.js 18+
- [OpenRouter](https://openrouter.ai) API key
- Solana wallet (base58 private key)
- Solana RPC endpoint ([Helius](https://helius.xyz) recommended)
- Telegram bot token (optional)
- [Claude Code](https://claude.ai/code) CLI (optional, for terminal slash commands)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/oyabuya/sunstrike
cd sunstrike
npm install
```

### 2. Run the setup wizard

```bash
npm run setup
```

The wizard walks you through creating `.env` (API keys, wallet, RPC, Telegram) and `user-config.json` (risk preset, deploy size, thresholds, models). Takes about 2 minutes.

**Or set up manually:**

Create `.env`:

```env
WALLET_PRIVATE_KEY=your_base58_private_key
# Optional: auto-derived from WALLET_PRIVATE_KEY if omitted; if set, it must match.
SUNSTRIKE_LIVE_WALLET=
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OPENROUTER_API_KEY=sk-or-...
HELIUS_API_KEY=your_helius_key          # for wallet balance lookups
JUPITER_API_KEY=your_jupiter_key         # required for live post-close swaps
TELEGRAM_BOT_TOKEN=123456:ABC...        # optional — for notifications + chat
TELEGRAM_CHAT_ID=                       # set the exact approved chat ID
TELEGRAM_ALLOWED_USER_IDS=              # approved controller user IDs
DRY_RUN=true
SUNSTRIKE_LIVE_ENABLED=false
```

> Never put your private key or API keys in `user-config.json` — use `.env` only. Both files are gitignored.

For the September 2026 restart, use a new dedicated wallet. Put its private key only in the VPS `.env`, restrict that file to the service account (`chmod 600 .env`), and never send the key in chat. Sunstrike derives the public address from that key; `SUNSTRIKE_LIVE_WALLET` is optional and, when set, must match it. `OPENROUTER_API_KEY` is for model analysis and tool decisions; it cannot by itself trade. The `RPC_URL` and `HELIUS_API_KEY` support wallet/chain reads, while `JUPITER_API_KEY` supports post-close swaps. Telegram credentials are needed for bot reports and control. `LPAGENT_API_KEY` and `GMGN_API_KEY` are optional enrichment; GMGN additionally needs `gmgn-cli`. Check the provider model slug and tool-call behavior before relying on the agent. The current default is `openai/gpt-4.1-mini`.

The owner set a **$100 planning capital**, accepts the possibility of losing it all, and removed the former $20 portfolio loss breaker. At most two LP positions may be open, with an exact 0.2 SOL entry each. Entry requires token age of at least 12 hours and a fresh Jupiter Organic Score of at least 80; there is no maximum age. Live entry still requires a wallet-bound ledger and fresh wallet/position snapshots; missing, stale, mismatched, or over-limit snapshots block new entries. Positions stay open while in range and earning fees, regardless of unrealized drawdown. A fresh critical token-risk flag or a move above range triggers immediate close; a move below range is reviewed after four hours using token health, volume, and fees. There is no automatic pause after two losing closes. Automated close cannot guarantee a fill during provider outages or rapid price moves.

For a low-cost model trial, set `managementModel`, `screeningModel`, and `generalModel` to `openai/gpt-6-luna` in `user-config.json`. It is newly released and must pass an authenticated dry-run tool-call and report-format check before use for decisions. The code's fallback model is `openai/gpt-4.1-mini`; unlike the primary model, the fallback is only attempted for certain transient provider errors. Monitor actual OpenRouter usage and report accuracy rather than assuming the model price alone makes the strategy profitable.

Optional Jev market advice: set `JEV_SHADOW_ENABLED=true` in `.env` while `DRY_RUN=true`. Every 15 minutes Sunstrike samples trending Meteora pools from 5m and 1h windows, even when positions fill the deploy limit, and asks `typesafe/jev-1.13` to score up to five distinct pools. This wider scout is advisory only. During an eligible screening cycle, Jev also scores up to five hard-filtered candidates. Luna receives bounded Jev fee, momentum, and holder-risk scores only for matching eligible pool addresses; it must check the raw metrics and cannot bypass deploy gates. Scores, confidence, served model, API cost, and cycle ID are recorded in `logs/actions-*.jsonl`. Provider failures leave Luna's normal screening path intact. Jev scores are not probabilities of profit and need comparison with later net LP outcomes before any live use.

To review a screening cycle, filter `logs/actions-*.jsonl` by `args.cycle_id` (`screen-<timestamp>`). `screening_funnel` records local filter rejections; `screening_candidates` records the full local rejection list and final shortlist with comparable 5m metrics; `jev_shadow` records scored pools or an error; `screening_decision` records Jev scores, Luna's report, and actual `deploy_position` attempts. `no_deploy_selected` means Luna made no deploy call, while `deploy_tool_failed` means an attempted call did not succeed. Pools excluded by the upstream discovery API are only counted in discovery totals, so their individual rejection reasons are unavailable. These logs show decisions, not realized LP returns.

When both position slots are occupied in `DRY_RUN`, screening still records the preliminary funnel under the same cycle ID. It logs `position_limit_observation` and makes no Jev/Luna call or deploy attempt. Live mode keeps the position-limit skip.

Copy config and edit as needed:

```bash
cp user-config.example.json user-config.json
```

See [Config reference](#config-reference) below.

### 3. Run

```bash
npm run dev    # dry run — no on-chain transactions
npm start      # uses configured mode; defaults to dry run
```

For a bounded Telegram dry run, `node scripts/ten-dry-run-cycles.js` runs one screening immediately, then follows the configured cron expression for nine more cycles. It writes progress to `logs/ten-dry-run-cycles.json` and stops automatically after cycle 10. The script requires `DRY_RUN=true` and live disabled. Dry-run reports label simulated deployments explicitly.

On startup Sunstrike fetches your wallet balance, open positions, and top pool candidates, then begins autonomous cycles immediately. Live execution is blocked unless both local live settings are explicitly set after the restart gates are satisfied.

---

## Running modes

### Autonomous agent

```bash
npm start
```

Starts the full autonomous agent with cron-based screening + management cycles and an interactive REPL. The prompt shows a live countdown to the next cycle:

```
[manage: 8m 12s | screen: 24m 3s]
>
```

REPL commands:

| Command | Description |
|---|---|
| `/status` | Wallet balance and open positions |
| `/candidates` | Re-screen and display top pool candidates |
| `/learn` | Study top LPers across all current candidate pools |
| `/learn <pool_address>` | Study top LPers for a specific pool |
| `/thresholds` | Current screening thresholds and performance stats |
| `/evolve` | Trigger threshold evolution from performance data (needs 5+ closed positions) |
| `/stop` | Graceful shutdown |
| `<anything>` | Free-form chat — ask the agent anything, request actions, analyze pools |

---

### Claude Code terminal (recommended)

Install [Claude Code](https://claude.ai/code) and use it from inside the `sunstrike` directory. Claude Code has built-in agents and slash commands that use the CLI under the hood.

```bash
cd sunstrike
claude
```

#### Slash commands

| Command | What it does |
|---|---|
| `/screen` | Full AI screening cycle — checks Discord queue, reads config, fetches candidates, runs deep research, and deploys if a winner is found |
| `/manage` | Full AI management cycle — checks all positions, evaluates PnL, claims fees, closes OOR/losing positions |
| `/balance` | Check wallet SOL and token balances |
| `/positions` | List all open DLMM positions with range status |
| `/candidates` | Fetch and enrich top pool candidates (pool metrics + token audit + smart money) |
| `/study-pool` | Study top LPers on a specific pool |
| `/pool-ohlcv` | Fetch price/volume history for a pool |
| `/pool-compare` | Compare all Meteora DLMM pools for a token pair by APR, fee/TVL ratio, and volume |

#### Claude Code agents

Two specialized sub-agents run inside Claude Code:

**`screener`** — pool screening specialist. Invoke when you want to evaluate candidates, analyse token risk, or deploy a position. Has access to OKX smart money signals, full token audit pipeline, and all strategy logic.

**`manager`** — position management specialist. Invoke when reviewing open positions, assessing PnL, claiming fees, or closing positions.

To trigger an agent directly, just describe what you want:
```
> screen for new pools and deploy if you find something good
> review all my positions and close anything out of range
> what do you think of the SOL/BONK pool?
```

#### Loop mode

Run screening or management on a timer inside Claude Code:

```
/loop 45m /screen     # screen every 45 minutes
/loop 15m /manage     # manage every 15 minutes
```

---

### CLI (direct tool invocation)

The `meridian` CLI gives you direct access to every tool with JSON output — useful for scripting, debugging, or piping into other tools.

```bash
npm install -g .   # install globally (once)
meridian <command> [flags]
```

Or run without installing:

```bash
node cli.js <command> [flags]
```

**Positions & PnL**

```bash
meridian positions
meridian pnl <position_address>
meridian wallet-positions --wallet <addr>
```

**Screening**

```bash
meridian candidates --limit 5
meridian pool-detail --pool <addr> [--timeframe 5m]
meridian active-bin --pool <addr>
meridian search-pools --query <name_or_symbol>
meridian study --pool <addr> [--limit 4]
```

**Token research**

```bash
meridian token-info --query <mint_or_symbol>
meridian token-holders --mint <addr> [--limit 20]
meridian token-narrative --mint <addr>
```

**Deploy & manage**

```bash
meridian deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot|curve] [--dry-run]
meridian claim --position <addr>
meridian close --position <addr> [--skip-swap] [--dry-run]
meridian swap --from <mint> --to <mint> --amount <n> [--dry-run]
meridian add-liquidity --position <addr> --pool <addr> [--amount-x <n>] [--amount-y <n>] [--strategy spot]
meridian withdraw-liquidity --position <addr> --pool <addr> [--bps 10000]
```

**Agent cycles**

```bash
meridian screen [--dry-run] [--silent]   # one AI screening cycle
meridian manage [--dry-run] [--silent]   # one AI management cycle
meridian start [--dry-run]               # start autonomous agent with cron jobs
```

**Config**

```bash
meridian config get
meridian config set <key> <value>
```

**Learning & memory**

```bash
meridian lessons
meridian lessons add "your lesson text"
meridian performance [--limit 200]
meridian evolve
meridian pool-memory --pool <addr>
```

**Blacklist**

```bash
meridian blacklist list
meridian blacklist add --mint <addr> --reason "reason"
```

**Discord signals**

```bash
meridian discord-signals
meridian discord-signals clear
```

**Balance**

```bash
meridian balance
```

**Flags**

| Flag | Effect |
|---|---|
| `--dry-run` | Skip all on-chain transactions |
| `--silent` | Suppress Telegram notifications for this run |

---

## Discord listener

The Discord listener watches configured channels (e.g. LP Army) for Solana token calls and queues them as signals for the screener agent.

### Setup

```bash
cd discord-listener
npm install
```

Add to your root `.env`:

```env
DISCORD_USER_TOKEN=your_discord_account_token   # from browser DevTools → Network
DISCORD_GUILD_ID=the_server_id
DISCORD_CHANNEL_IDS=channel1,channel2            # comma-separated
DISCORD_MIN_FEES_SOL=5                           # minimum pool fees to pass pre-check
```

> This uses a selfbot (personal account automation, not a bot token). Use responsibly.

### Run

```bash
cd discord-listener
npm start
```

Or run it in a separate terminal alongside the main agent. Signals are written to `discord-signals.json` and picked up automatically by `/screen` and `node cli.js screen`.

### Signal pipeline

Each incoming token address passes through a pre-check pipeline before being queued:
1. **Dedup** — ignores addresses seen in the last 10 minutes
2. **Blacklist** — rejects blacklisted token mints
3. **Pool resolution** — resolves the address to a Meteora DLMM pool
4. **Rug check** — checks deployer against `deployer-blacklist.json`
5. **Fees check** — rejects pools below `DISCORD_MIN_FEES_SOL`

Signals that pass all checks are queued with status `pending`. The screener picks up pending signals and processes them as priority candidates before running the normal screening cycle.

### Deployer blacklist

Add known rug/farm deployer wallet addresses to `deployer-blacklist.json`:

```json
{
  "_note": "Known farm/rug deployers — add addresses to auto-reject their pools",
  "addresses": [
    "WaLLeTaDDressHere"
  ]
}
```

---

## Telegram

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add `TELEGRAM_BOT_TOKEN=<token>` to your `.env`
3. Send `/start` to the bot in a private Telegram chat, then run `node scripts/telegram-check.js` on the VPS. Copy its `chat_id` and `user_id` into `TELEGRAM_CHAT_ID` and `TELEGRAM_ALLOWED_USER_IDS` in `.env`.
4. Run `node scripts/telegram-check.js --send-test` to verify delivery. The check prints IDs and bot username, never the token. Keep `DRY_RUN=true` and `SUNSTRIKE_LIVE_ENABLED=false`.

### Notifications

Meridian sends notifications automatically for:
- Management cycle reports (reasoning + decisions)
- Screening cycle reports (what it found, whether it deployed)
- OOR alerts when a position leaves range past `outOfRangeWaitMinutes`
- Deploy: pair, amount, position address, tx hash
- Close: pair and PnL

### Telegram commands

| Command | Action |
|---|---|
| `/positions` | List open positions with progress bar |
| `/close <n>` | Close position by list index |
| `/set <n> <note>` | Set a note on a position |

You can also chat freely via Telegram using the same interface as the REPL.

---

## Config reference

All fields are optional — defaults shown. Edit `user-config.json`.

### Screening

| Field | Default | Description |
|---|---|---|
| `minFeeActiveTvlRatio` | `0.02` | Minimum fee/active-TVL ratio |
| `minTvl` | `10000` | Minimum pool TVL (USD) |
| `maxTvl` | `500000` | Maximum pool TVL (USD); higher TVL widens discovery, while fee and risk gates still apply |
| `minVolume` | `500` | Minimum pool volume |
| `minOrganic` | `80` | Minimum Jupiter Organic Score (0–100) |
| `minHolders` | `500` | Minimum token holder count |
| `minMcap` | `250000` | Minimum market cap (USD) |
| `maxMcap` | `20000000` | Maximum market cap (USD) |
| `minBinStep` | `50` | Minimum bin step |
| `maxBinStep` | `150` | Maximum bin step |
| `timeframe` | `5m` | Default multi-window discovery profile; other configured values query only that window |
| `category` | `trending` | Pool category filter |
| `minTokenFeesSol` | `50` | Minimum all-time fees in SOL |
| `maxBundlePct` | `60` | Maximum bundle holding % |
| `maxTop10Pct` | `30` | Maximum top-10 holder concentration |
| `blockedLaunchpads` | `[]` | Launchpad names to never deploy into |

### Management

| Field | Default | Description |
|---|---|---|
| `deployAmountSol` | `0.5` | Base SOL per new position |
| `positionSizePct` | `0.35` | Fraction of deployable balance to use |
| `maxDeployAmount` | `50` | Maximum SOL cap per position |
| `gasReserve` | `0.2` | Minimum SOL to keep for gas |
| `minSolToOpen` | `0.55` | Minimum wallet SOL before opening |
| `outOfRangeWaitMinutes` | `30` | Minutes OOR before acting |
| `stopLossPct` | `-15` | Close position if price drops by this % |

### Schedule

| Field | Default | Description |
|---|---|---|
| `managementIntervalMin` | `15` | Management cycle frequency (minutes) |
| `screeningIntervalMin` | `45` | Screening cycle frequency (minutes) |

### Models

| Field | Default | Description |
|---|---|---|
| `managementModel` | `openai/gpt-oss-20b:free` | LLM for management cycles |
| `screeningModel` | `openai/gpt-oss-20b:free` | LLM for screening cycles |
| `generalModel` | `openai/gpt-oss-20b:free` | LLM for REPL / chat |

<<<<<<< HEAD
> Override model at runtime: `node cli.js config set screeningModel anthropic/claude-opus-4-5`

---

## Telegram

**Setup:**

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add `TELEGRAM_BOT_TOKEN=<token>` to your `.env`
3. Set the exact Telegram chat and allowed controller user IDs in `.env`

Meridian no longer auto-registers the first chat for safety. You must set:

```env
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<target chat id>
TELEGRAM_ALLOWED_USER_IDS=<comma-separated Telegram user ids allowed to control the bot>
```

Security notes:
- If `TELEGRAM_CHAT_ID` is not set, inbound Telegram control is ignored.
- If the target chat is a group/supergroup and `TELEGRAM_ALLOWED_USER_IDS` is empty, inbound control is ignored.
- Notifications still go to the configured chat, but command/control is limited to the allowed user IDs.

**Notifications sent:**
- After every management cycle: full agent report (reasoning + decisions)
- After every screening cycle: full agent report (what it found, whether it deployed)
- When a position goes out of range past `outOfRangeWaitMinutes`
- On deploy: pair, amount, position address, tx hash
- On close: pair and PnL

You can also chat with the agent via Telegram using the same free-form interface as the REPL: `"check wallet 7tB8..."`, `"who are the top LPers in pool ABC..."`, `"close all positions"`, etc. Only explicitly allowed Telegram user IDs can issue commands.

---

## How it learns

### Lessons

After every closed position the agent runs `studyTopLPers` on candidate pools, analyzes on-chain behavior of top performers (hold duration, entry/exit timing, win rates), and saves concrete lessons. Lessons are injected into subsequent agent cycles as part of the system context.

Add a lesson manually:
```bash
node cli.js lessons add "Never deploy into pump.fun tokens under 2h old"
```

### Threshold evolution

After 5+ positions have been closed, run:
```bash
node cli.js evolve
```

This analyzes closed position performance (win rate, avg PnL, fee yields) and automatically adjusts screening thresholds in `user-config.json`. Changes take effect immediately.

---

## Hive Mind (optional)

Opt-in collective intelligence — share lessons and pool outcomes, receive crowd wisdom from other Meridian agents.

**What you get:** Pool consensus ("8 agents deployed here, 72% win rate"), strategy rankings, threshold medians.

**What you share:** Lessons, deploy outcomes, screening thresholds. No wallet addresses, private keys, or balances are ever sent.

### Setup

```bash
node -e "import('./hive-mind.js').then(m => m.register('https://meridian-hive-api-production.up.railway.app', 'YOUR_TOKEN'))"
```

Get `YOUR_TOKEN` from the private Telegram discussion. This saves your credentials to `user-config.json` automatically.

### Disable

```json
{
  "hiveMindUrl": "",
  "hiveMindApiKey": ""
}
```

### Self-hosting

See [meridian-hive](https://github.com/fciaf420/meridian-hive) for the server source.

---

## Using a local model (LM Studio)

```env
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=your-local-model-name
```

Any OpenAI-compatible endpoint works.

---

## Architecture

```
index.js            Main entry: REPL + cron orchestration + Telegram bot polling
agent.js            ReAct loop: LLM → tool call → repeat
config.js           Runtime config from user-config.json + .env
prompt.js           System prompt builder (SCREENER / MANAGER / GENERAL roles)
state.js            Position registry (state.json)
lessons.js          Learning engine: records performance, derives lessons, evolves thresholds
pool-memory.js      Per-pool deploy history + snapshots
strategy-library.js Saved LP strategies
telegram.js         Telegram bot: polling + notifications
hive-mind.js        Optional collective intelligence server sync
smart-wallets.js    KOL/alpha wallet tracker
token-blacklist.js  Permanent token blacklist
cli.js              Direct CLI — every tool as a subcommand with JSON output

tools/
  definitions.js    Tool schemas (OpenAI format)
  executor.js       Tool dispatch + safety checks
  dlmm.js           Meteora DLMM SDK wrapper
  screening.js      Pool discovery
  wallet.js         SOL/token balances + Jupiter swap
  token.js          Token info, holders, narrative
  study.js          Top LPer study via LPAgent API

discord-listener/
  index.js          Selfbot Discord listener
  pre-checks.js     Signal pre-check pipeline

.claude/
  agents/
    screener.md     Claude Code screener sub-agent
    manager.md      Claude Code manager sub-agent
  commands/
    screen.md       /screen slash command
    manage.md       /manage slash command
    balance.md      /balance slash command
    positions.md    /positions slash command
    candidates.md   /candidates slash command
    study-pool.md   /study-pool slash command
    pool-ohlcv.md   /pool-ohlcv slash command
    pool-compare.md /pool-compare slash command
```

---

## Disclaimer

This software is provided as-is, with no warranty. Running an autonomous trading agent carries real financial risk — you can lose funds. Always start with `DRY_RUN=true` to verify behavior before going live. Never deploy more capital than you can afford to lose. This is not financial advice.

The authors are not responsible for any losses incurred through use of this software.

### Telegram runtime mode

The operator chat has a collapsible reply keyboard: tap the four-square icon
inside the message field to open its two-column shortcut panel. `/start` or
`/help` shows usage and restores the keyboard. The slash command menu also works.
`/status` and `/check` read the current mode, positions, and every positive wallet token balance reported by Helius (paginated for Telegram); `/candidates`,
`/candidat`, and `/refresh` refresh the candidate list without deploying.
`/positions` lists positions, `/thresholds` shows screening limits, and `/briefing`
shows the daily report. `/evolve` can change learned screening thresholds after
five closed positions; owner hard limits remain enforced. `/close 1` closes the
first current position in LIVE and uses the normal post-close swap path.
Unknown slash commands return `/help` instead of being sent to the model.

Authorized Telegram users can send `/mode`, `/dry_run`, or `/live` directly.
`/live` requires `SUNSTRIKE_LIVE_ENABLED=true`, Helius/Jupiter credentials, a
wallet-bound portfolio ledger, a fresh wallet/LP snapshot, sufficient SOL, and
a fresh, wallet-bound risk ledger. Initialize the ledger once using
`DRY_RUN=true node scripts/init-portfolio-risk.js`; keep it for wallet reconciliation.
Busy or expired mode commands are rejected; resend after the operation finishes.
Mode changes last for the current process. Restart follows `.env` (keep
`DRY_RUN=true` for a safe restart). `/dry_run` does not close existing positions
and suspends real management transactions. The VPS service template is
`deploy/sunstrike.service`.

GMGN and OKX are optional risk enrichment, as in the April flow. A current
matching-mint Jupiter audit is mandatory; any adverse GMGN/OKX signal received
still blocks deployment. The portfolio ledger remains mandatory for wallet reconciliation and entry limits.
