// Dip-bounce bot for make.fun "Race a BTC trading bot live for 24 hours"
// (btc-race-24h-20261118-1444). Long only, $1,000 paper, cbBTC 1-minute bars.
//
// THIS instance's dev window (2026-11-17 14:44 UTC -> 2026-11-18 14:44 UTC,
// BTC $65,083 -> $63,261, -2.80%) is a DOWN-TRENDING window, not the flat
// window of instance 3: an early waterfall (worst 60-min move -2.31% at bar
// 68), a recovery rally back to ~$64,948, then a slow grind down to the
// window low $63,076 at bar 1436. All three old parameter sets FAIL here
// when re-graded on this window:
//   instance 1 (drop 1.5% / bounce 0.7% over 240 min): 0 trades, $0.00
//   instance 2 (drop 2.75% / bounce 0.3% over 240 min): 0 trades, $0.00
//   instance 3 (drop 0.9% / bounce 0.1% over 60 min): -$6.30, 2 RT, 0 wins
// So the bot must buy the early waterfall's turn and ride the recovery,
// not scalp the small hourly dips the way instance 3 did.
//
// Chosen config (from a 51,840-config coarse grid + a 95,040-config
// floor search over the deep-drop region, exact-fill simulator):
//   buy when price is >= 1.25% below its close 210 minutes ago AND has
//   bounced >= 0.30% off its lowest close of the last 120 minutes;
//   sell at +1.5% take profit, -1.0% stop loss, or after 360 bars held.
//   100% of cash per trade, max 5 round trips, >= 30 bars cooldown.
// The config was picked for its NEIGHBOURHOOD FLOOR, not its grid top:
// the grid top (+$18.39, TP 2%) collapses to $0.00 one step away in
// DROP_PCT, while this config's worst one-step neighbour is +$8.30 and
// all 28 one-step neighbours stay above $0. The small-TP scalper that
// tops the flat grid (+$14.67, 5 RT) was rejected: its neighbours go to
// -$45.87, i.e. the peak is sharp noise, not a plateau.
//
// Sim numbers (exact-fill simulator, calibrated to grade-local to the
// cent on instances 2-3): net +$13.50, 2 fills = 1 round trip, 1 win,
// fees $0.81, max drawdown 0.64%, exposure 18.2%.
// Trade: buy decided bar 210, filled bar 211 @ $63,742.93 -> sell
// decided bar 472, filled bar 473 @ $64,655.32 (+$13.50, take-profit
// exit). No end-of-window flatten.
//
// Verified with grade-local (--driver process, same as server dev
// grading): net PnL +$13.501708, 2 trades, win rate 1.00, max drawdown
// 0.6425%, exposure 18.19%, Sharpe 0.0337, Sortino 0.0573, fees
// $0.805563 (at 2x fees still +$12.692169), 0 rejected, guardrails met,
// L1 regrade reproduced byte for byte. The grade matches the simulator
// to the cent, and the action log matches the simulator's trade list
// bar for bar. The action_log_sha256 is f8a8a9686a214c6c234aaaf5cace4741
// 420d717b48a1ce167ae7921a0d35fded (stable across all three passes).
// The final result_sha256 is recorded in NOTES.md: it changes with
// every edit to this file, so it is not written here. (Process driver,
// node v24.22.1 on this VM vs server v26.13.1 — the server's hash will
// differ in the harness-version note only.) A pass-2 structural refactor
// (fill observation and the pure decide() split out of onBatch)
// re-graded to the identical action log, proving the refactor is
// behaviour-preserving.
// Honest limits: the race window is a different, unseen 24h. This bot's
// whole dev profit is ONE trade — buy the waterfall bottom, ride the
// mean reversion. On a ranging race window it may trade once or twice;
// on a straight rally it may trade 0 times (no >= 1.25% drop over 210
// min) and fail the race >= 1-trade bar; on a waterfall it buys dips and
// stops out at -1% each (max 5 round trips, worst case ~-$55, max DD
// ~5.5%, still inside the 25% race bar). The failure mode of a too-tight
// trigger is $0.00 (no trade), not a loss. This is a free lottery ticket
// for a top-10 slot, not a reliable payout.
//
// Deterministic: pure function of the closes seen so far; no clock, no
// randomness, no network, no files. Stdlib + vendored SDK only.

import { runBars, type BarsState, type Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DROP_WINDOW = 210; // minutes of history the drop is measured over
const DROP_PCT = 0.0125; // entry needs a >= 1.25% drop over DROP_WINDOW
const CONFIRM_WINDOW = 120; // minutes of history the bounce low is measured over
const CONFIRM_PCT = 0.003; // entry needs a >= 0.30% bounce off that low
const TAKE_PROFIT = 0.015;
const STOP_LOSS = 0.01;
const MAX_HOLD_BARS = 360;
const MAX_TRADES = 5;
const COOLDOWN_BARS = 30;
const MAX_SLIPPAGE_BPS = 100;

const closes: number[] = [];
let entrySeq = -1;
let buys = 0;
let lastExitSeq = -1_000_000;

function rollingLow(n: number): number {
  let lo = Infinity;
  const start = Math.max(0, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    if (closes[i] < lo) lo = closes[i];
  }
  return lo;
}

// Entry gate, factored out so the decision reads as one predicate:
// trade budget left, cooldown elapsed, enough history, then the dip +
// bounce conditions on the closes seen so far.
function shouldEnter(state: BarsState): boolean {
  if (buys >= MAX_TRADES) return false;
  if (state.seq - lastExitSeq < COOLDOWN_BARS) return false;
  if (closes.length <= DROP_WINDOW) return false;
  const now = closes[closes.length - 1];
  if (now / closes[closes.length - 1 - DROP_WINDOW] - 1 > -DROP_PCT) return false;
  if (now / rollingLow(CONFIRM_WINDOW) - 1 < CONFIRM_PCT) return false;
  if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return false;
  return true;
}

// Exit gate: take profit, stop loss, or max hold, on value vs cost.
// A zero-quantity position can never be exited (defensive: the harness
// should never surface one, but a divide-by-zero cost would be worse).
function shouldExit(state: BarsState, held: { qty: bigint; cost: bigint }): boolean {
  if (held.qty === 0n || held.cost === 0n) return false;
  const value = state.value(SYMBOL, held.qty);
  const ret = Number(value) / Number(held.cost) - 1;
  return ret >= TAKE_PROFIT || ret <= -STOP_LOSS || state.seq - entrySeq >= MAX_HOLD_BARS;
}

// Observe fills decided on the previous bar. Only a filled buy counts
// against the trade budget and starts the hold clock; a rejected buy
// leaves both untouched so the gate can retry on the next bar.
function observeFills(state: BarsState, batch: Batch): void {
  for (const fill of batch.fills) {
    if (fill.symbol !== SYMBOL) continue;
    if (fill.side === 'buy' && fill.status === 'filled') {
      buys++;
      // The hold clock starts at the fill's bar (state.seq), not at the
      // bar the position first appears in: the fill is reported in the
      // batch of the bar it filled on, so this matches the simulator's
      // entrySeq exactly and MAX_HOLD counts held bars, not decisions.
      entrySeq = state.seq;
    }
    if (fill.side === 'sell' && fill.status === 'filled') lastExitSeq = state.seq;
  }
}

// The pure decision for one bar: entry when flat and the gate passes,
// exit of the whole position when the gate fires, nothing otherwise.
// Kept separate from the runBars wiring so the strategy reads without
// the harness plumbing around it.
function decide(state: BarsState): { side: 'buy'; symbol: string; notional_quote_units: bigint; max_slippage_bps: number } | { side: 'sell'; symbol: string; qty: bigint; max_slippage_bps: number } | null {
  const held = state.positions.get(SYMBOL);
  if (held === undefined) {
    // Entry: waterfall dip + confirmed bounce, 100% of cash per trade.
    if (!shouldEnter(state)) return null;
    return { side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
  }
  // Exit: whole position when the exit gate fires.
  if (shouldExit(state, held)) {
    return { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
  }
  return null;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    if (state.warmingUp) return [];
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(Number(bar.c) / 1e5);
    }
    if (!batch.bars.some((b) => b.symbol === SYMBOL)) return [];

    observeFills(state, batch);
    const order = decide(state);
    return order === null ? [] : [order];
  },
});
