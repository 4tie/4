---
description: Strategy refinement workflow (backtest → metrics → edit → validate)
---

This workflow is a repeatable loop for improving a Freqtrade strategy using the Backtest Dashboard + ChatPanel actions you already added.

1. Pick a baseline
   - Open the Backtest Dashboard.
   - Select a strategy file.
   - Set:
     - timeframe
     - pairs
     - date range (From/To)
     - stake_amount
     - risk knobs (stoploss, trailing stop, minimal_roi, max_open_trades, tradable_balance_ratio)
   - Click **Run Backtest**.

2. Capture baseline metrics
   - In the Results section, record:
     - Profit, Max Drawdown, Win Rate, Sharpe
     - Advanced Metrics: Profit Factor / PF(Abs), Expectancy, Payoff Ratio, return stddev, best/worst trade, streaks, trade-series max DD, top/bottom pairs.
   - If a Batch ID exists, open the Batch Results panel and note variance across windows.

3. Ask the assistant for a refinement plan
   - In ChatPanel, ask a targeted question like:
     - "Given these results, propose 3 concrete strategy changes that improve expectancy without increasing drawdown." 
     - "Based on the top/bottom pairs, propose a filter to avoid the worst pairs." 
   - If the assistant returns a JSON config patch, review it and use **Apply Config**.

4. Apply strategy changes (code)
   - Ask for a targeted edit to your strategy (preferably `populate_indicators`, `populate_entry_trend`, `populate_exit_trend`).
   - If you need indicators, use the ChatPanel **Indicator Pack** quick action.
   - Apply the returned Python code via your Apply/Save flow.

5. Re-run a single backtest
   - Run the same timerange again.
   - Compare baseline vs new run. If worse, revert the last change.

6. Validate stability (rolling windows)
   - Use **Rolling Validation** (4 × 90-day windows ending at To Date).
   - Compare:
     - consistency of profit
     - stability of max DD
     - trade count sufficiency
     - whether improvements hold across windows

7. Iterate with constraints
   - Only change ONE of:
     - entry logic
     - exit logic
     - risk knobs
     - universe/pairs
     at a time.
   - Stop when:
     - profit improves AND trade-series max DD does not materially worsen
     - batch results variance is acceptable

8. Finalize
   - Save config if needed (Save Config button).
   - Keep the final strategy changes.

Optional: sanity typecheck
// turbo
- Run:
  - `npm run check`
