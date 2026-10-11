---
name: ig-trade-execution
description: Safely place, close, or modify trades on IG - market orders, closing positions, moving stops and limits, and creating or cancelling working (limit/stop entry) orders - via preview, explicit user confirmation, and execution. Use when the user asks to buy, sell, go long/short, close, take profit, move a stop, or place an order on IG.
---

# IG trade execution

Trading tools only exist when the account owner has set `IG_TRADING_ENABLED=true`. If `ig_preview_*` tools are missing, tell the user that trading is disabled in the plugin configuration. Do not try to work around it.

## Non-negotiable sequence

1. **Clarify the order.** Market (epic), direction, size, stop, and optional limit. If the user did not give a stop and `requireStopLoss` is on (see `ig_account_overview` → `safety`), ask for one. Offer a suggestion based on the market's minimum stop distance and recent volatility.
2. **Check the market.** Call `ig_get_market` for status, live price, minimum deal size, minimum stop distance and margin. Check the account type matches the epic: spread bet epics need a spread bet account, CFD epics a CFD account.
3. **Preview.** Call the matching tool:
   - New position at market: `ig_preview_open_position`
   - Close all or part: `ig_preview_close_position` (find `dealId` with `ig_get_positions`)
   - Move a stop or limit: `ig_preview_amend_position`
   - Entry order at a level: `ig_preview_working_order` (LIMIT = better price than now, STOP = breakout)
   - Cancel an entry order: `ig_preview_cancel_working_order`
4. **Show the preview.** Paste the `summary` string verbatim in a quote block, plus the approximate loss to stop and margin if present. State the environment (LIVE/DEMO) explicitly. Then ask: "Do you want me to execute this? (yes/no)"
5. **Wait for an explicit yes** in the user's next message. Anything else means do not execute. If the user changes any detail, preview again.
6. **Execute.** Call `ig_execute_trade` with the `confirmationToken`. Cursor will also show the user an approval prompt; that is expected.
7. **Report the outcome.**
   - `ACCEPTED`: report deal id, fill level, stop and limit, and realised profit for closes.
   - `REJECTED`: report `reason` and `reasonExplained`, then suggest a fix (e.g. widen the stop). Do not auto-retry.
   - `UNKNOWN`: call `ig_get_deal_confirmation` with the `dealReference`, then `ig_get_positions`. **Never resubmit** until you know the first order did not go through.

## Rules

- Tokens expire after 2 minutes and are single-use. If one expires, preview again. Never reuse a token.
- One trade per approval. For several trades, preview and confirm each one separately.
- Never split an order to get around `IG_MAX_DEAL_SIZE`, and never pick a different epic to get around `IG_ALLOWED_EPICS`.
- Never remove a stop when stops are required. Moving a stop further away is allowed but should be pointed out.
- Size is in IG units: stake per point for spread bets, contracts for CFDs. If the user says "£10 a point", that is size 10 on a spread bet account.
- No investment advice. You can explain risk ("a 40-point stop at £2/pt risks about £80 plus slippage"), but not whether a trade is a good idea.
