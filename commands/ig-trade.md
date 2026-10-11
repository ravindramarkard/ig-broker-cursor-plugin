---
name: ig-trade
description: Guided IG trade with preview and explicit confirmation, e.g. /ig-trade buy 1 FTSE stop 30
---

# IG guided trade

The text after the command describes the trade (e.g. "buy £2 a point FTSE stop 30 points limit 60", "close my gold short", "move my FTSE stop to 8200").

Follow the `ig-trade-execution` skill exactly:

1. Parse the request. Ask for anything missing (market, direction, size, stop). Do not guess the size.
2. Check the market with `ig_get_market`.
3. Call the right `ig_preview_*` tool.
4. Show the preview `summary` verbatim and ask for an explicit yes/no.
5. Only on an explicit yes, call `ig_execute_trade`. Then report the confirmation.

If trading tools are unavailable, explain that trading is disabled (`IG_TRADING_ENABLED=false`) and offer a read-only analysis instead.
