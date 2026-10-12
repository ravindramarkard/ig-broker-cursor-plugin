# Changelog

## 0.1.0

Initial release.

- MCP server for the IG REST API with 12 read-only tools: account overview, accounts, account switching, positions, working orders, market search, market details, historical prices, activity, transactions, watchlists, deal confirmations.
- Opt-in trading (`IG_TRADING_ENABLED=true`) with preview tools for opening, closing and amending positions, and for creating and cancelling working orders, plus `ig_execute_trade` gated by single-use, short-lived confirmation tokens.
- Server-side guardrails: max deal size, required stop loss, epic allowlist, and IG dealing rules.
- `beforeMCPExecution` hook that requires human approval of every trade in Cursor and shows the server-generated order summary.
- Skills (portfolio review, market research, trade execution, trading journal), a read-only risk-analyst subagent, `/ig-portfolio`, `/ig-quote` and `/ig-trade` commands, and an always-on safety rule.
- Mock mode (`IG_ENVIRONMENT=mock`) with a simulated IG API for trying the plugin without an account.
