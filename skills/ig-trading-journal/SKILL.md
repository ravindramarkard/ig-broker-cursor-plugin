---
name: ig-trading-journal
description: Build a trading journal or performance report from IG transaction and activity history - realised P&L by market, win rate, average win/loss, fees and funding - and optionally save it as Markdown or CSV in the workspace. Use when the user asks how their trading went over a period, wants a P&L summary, or wants to export IG history.
---

# IG trading journal

## Gather data (read-only)

1. Ask for or infer the period: default last 30 days, maximum 90 days per call (paginate by date range if longer).
2. `ig_get_transactions` with `type: "ALL_DEAL"` gives closed-trade P&L. `type: "ALL"` also includes deposits, withdrawals, funding and dividends.
3. `ig_get_activity` gives what happened and when (opens, closes, stop/limit amendments, rejected orders), useful for spotting patterns such as frequently moved stops.

`profitAndLoss` is a string with a currency prefix (e.g. `"£-37.50"`). Strip the symbol and parse the number. `size` is signed (`"+1"` / `"-2"`).

## Metrics

- Total realised P&L, number of trades, win rate.
- Average win, average loss, payoff ratio (avg win / |avg loss|), largest win and largest loss.
- P&L by instrument (sorted), and by weekday if there are 20 or more trades.
- Funding / overnight charges and other non-deal cash items, listed separately.
- Activity observations: rejected orders and their reasons, positions closed by stop vs manually (when visible).

## Output

Lead with the environment (LIVE/DEMO/SIMULATED), account and date range. Then a summary table, a per-instrument table, and 3-5 neutral observations.

If the user asks to save it, write `trading-journal/YYYY-MM-DD_to_YYYY-MM-DD.md` (and `.csv` with one row per transaction if requested) in the workspace. Never include credentials, session tokens, or confirmation tokens in files. Ask before committing the files to git, since account history is personal financial data.
