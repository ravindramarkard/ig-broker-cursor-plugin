---
name: ig-market-research
description: Research IG markets - find epics, live quotes, spreads, dealing rules, margin and historical OHLC price action (trend, range, volatility, support/resistance). Use when the user asks about a market's price, chart, levels, or how something has moved on IG.
---

# IG market research

## 1. Find the market

- Use `ig_search_markets` with the plain name ("FTSE", "Apple", "EUR/USD", "Brent").
- The same underlying often has several epics (daily funded bet `DFB`, futures with a month expiry, CFD vs spread bet). Prefer the `DFB` / undated epic unless the user names an expiry. If unclear, list the 2-3 best matches and ask.
- Check `status`: `TRADEABLE`, `EDITS_ONLY`, `CLOSED`, `OFFLINE`. Note `delayMinutes` if prices are delayed.

## 2. Snapshot

`ig_get_market` gives bid/offer, spread, day range, margin and dealing rules. Report:
- Price (mid), spread in points, and day change %.
- Minimum deal size and minimum stop distance, which the user will need for any trade.

## 3. Price history

Use `ig_get_prices`. IG gives each account a weekly allowance of historical data points (about 10,000), so ask only for what the question needs:

| Question | resolution | max |
|---|---|---|
| Today / intraday | `MINUTE_15` | 32-96 |
| Last week | `HOUR` | 120 |
| Last month or two | `DAY` | 30-60 |
| Longer trend | `WEEK` | 52 |

Rows are `[timeUtc, open, high, low, close, volume]` mid prices. Calculate in your reasoning, or with a short script if the user wants a chart or file:
- Net change and % over the window; highest high / lowest low and their dates.
- Simple moving averages (e.g. 20 and 50 periods) and where price sits relative to them.
- Average true range (ATR, 14 periods) as a volatility gauge, expressed in points. It is useful for sizing stops.
- Obvious support/resistance: price levels touched several times.

Report `allowance.remaining` if it drops below 1,000.

## 4. Output

Use a compact table of key numbers, then 3-5 bullets of observations. Keep it descriptive ("price is 2.1% above its 20-day average"), not predictive or advisory. If the user wants to act on it, hand off to the `ig-trade-execution` skill and suggest an ATR-based stop distance that respects the market's minimum stop distance.
