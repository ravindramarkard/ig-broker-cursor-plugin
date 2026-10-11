---
name: ig-quote
description: Live IG quote and quick context for a market, e.g. /ig-quote FTSE 100
---

# IG quote

The text after the command is the market to look up (e.g. "FTSE 100", "gold", "EUR/USD"). If it is empty, ask which market.

1. `ig_search_markets` to resolve the epic. Prefer the undated/DFB contract. If ambiguous, show the top 3 and ask.
2. `ig_get_market` for the live snapshot and dealing rules.
3. `ig_get_prices` with `resolution: "DAY", max: 10` for recent context.

Reply with a single compact table: epic, status, bid / offer / spread, day change %, day range, 10-day high / low, minimum deal size, minimum stop distance, margin. Add one sentence on where price sits in its 10-day range. Mention the environment (LIVE / DEMO / SIMULATED) and any price delay.
