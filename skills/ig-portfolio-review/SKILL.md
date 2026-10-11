---
name: ig-portfolio-review
description: Review an IG trading account - balance, margin, open positions, unrealised P&L, stops and limits, working orders and concentration risk. Use when the user asks how their IG account, portfolio, positions or P&L are doing.
---

# IG portfolio review

Produce a clear, factual snapshot of the user's IG account using read-only tools only.

## Steps

1. Call `ig_account_overview`. Note the `environment` (LIVE / DEMO / SIMULATED) and the account type (spread bet / CFD).
2. Call `ig_get_positions` and `ig_get_working_orders`.
3. If the user has several accounts and asks about "everything", call `ig_list_accounts`. Do not switch accounts unless asked.
4. For positions without a stop, or with a stop far from price, call `ig_get_market` to get the current price and dealing rules.

## Report format

Start with one line: environment, account name and type, currency.

**Account**: balance, margin used, available funds, unrealised P&L, and margin used as a % of balance.

**Positions** table, sorted by absolute P&L:

| Market | Dir | Size | Open | Now | Stop | Limit | P&L (pts) | ~P&L |
|---|---|---|---|---|---|---|---|---|

**Working orders** table (if any): market, direction, type, size, level, distance from current price.

**Risk notes** (bullets, only the ones that apply):
- Positions with **no stop loss**: flag these first.
- Approximate loss to stop per position: `|open - stop| x size`.
- Concentration: several positions in the same asset class or currency, or the same direction on correlated markets (e.g. long FTSE and long US 500).
- Margin used above 50% of balance.
- Markets that are currently closed (stops can gap).

Finish with "Approx. P&L uses points x size; IG's platform figures are authoritative." Do not recommend trades unless the user asks; if they do, hand off to the `ig-trade-execution` skill.
