# btc-race-24h-20261118-1444

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/sayaaku12/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/sayaaku12/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A paper-money cbBTC trading bot (long only) for make.fun's "Race a BTC trading bot live for 24 hours" bounty. The whole program is `main.ts`: a dip-bounce bot that buys a waterfall dip once it has turned — never the falling knife.

## Strategy

- **Entry** (on a bar's close, fills at the next bar's open): price is ≥1.25% below its close 210 minutes ago AND has bounced ≥0.30% off its lowest close of the last 120 minutes. 100% of cash per trade, max 5 round trips, ≥30 bars cooldown after an exit.
- **Exit** (whole position): take profit +1.5% vs cost, stop loss −1.0% vs cost, or 360 bars max hold. Every order sets `max_slippage_bps` 100.
- Mostly in cash otherwise. Deterministic: a pure function of the closes seen so far — no clock, no randomness, no network, no files. Node 22, stdlib + vendored SDK only.

## Measured results

Dev window (frozen 24h, 2026-11-17 14:44 UTC → 2026-11-18 14:44 UTC; BTC $65,083 → $63,261, −2.80%, range $63,076–$65,190), graded with the kit's `grade-local --driver process`:

| Metric | Value |
|--------|-------|
| Net PnL | **+$13.50** (dev gate needs > $0) |
| Trades | 2 fills = 1 round trip, win rate 1.00 |
| Max drawdown | 0.64% (race bar ≤ 25%) |
| Fees | $0.81 (at 2x fees: +$12.69) |
| Exposure | 18.2% of the window |
| Determinism | L1 regrade reproduced byte for byte; two separate grade runs give the identical result hash |

Trade: buy decided bar 210, filled bar 211 @ $63,742.93 → sell decided bar 472, filled bar 473 @ $64,655.32 (+$13.50, take-profit exit). No end-of-window flatten. This window trends down, so all three previous instances' parameter sets fail when re-graded here — instance 1 (drop 1.5% / bounce 0.7% over 240 min) 0 trades, $0.00; instance 2 (drop 2.75% / bounce 0.3%) 0 trades, $0.00; instance 3 (drop 0.9% / bounce 0.1% over 60 min) −$6.30 — and were re-graded, not reused blindly. The chosen config was picked for its neighbourhood floor, not the grid top: the grid top (+$18.39, TP 2%) collapses to $0.00 one step away in DROP_PCT, while this config's worst one-step neighbour is +$8.30 and all 28 close neighbours stay above $0. The small-TP scalper that tops the flat grid (+$14.67, 5 round trips) was rejected — its neighbours go to −$45.87. Honest limit: the whole dev profit is one trade, so on a straight-rally race window this bot may trade 0 times and fail the race ≥1-trade bar.

## Files

- `main.ts` — the bot
- `vendor/makefun-bars.ts` — vendored copy of the kit SDK (byte-identical)

Built by an AI coding agent for the make.fun bounty. MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c0tz9ttj&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
