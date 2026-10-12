# Security policy

This plugin can read and trade a brokerage account, so security reports are treated as the highest priority.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report privately via the repository's private vulnerability reporting ("Security" tab → "Report a vulnerability"), or contact the maintainer listed in `.cursor-plugin/plugin.json`.

Include the plugin version, steps to reproduce, and impact. You will get an acknowledgement within 72 hours and a fix or mitigation plan within 7 days for confirmed issues. Fixed releases are submitted to the Cursor Marketplace for review right away.

## In scope

- Any path that lets an agent execute a trade without a fresh preview and user approval
- Bypasses of `IG_MAX_DEAL_SIZE`, `IG_REQUIRE_STOP_LOSS`, `IG_ALLOWED_EPICS`, or `IG_TRADING_ENABLED`
- Leakage of IG credentials, session tokens (`CST`, `X-SECURITY-TOKEN`) or confirmation tokens into tool output, logs, or files
- Weaknesses in the trade-approval hook (`hooks/ig-trade-approval.mjs`)
- Discrepancies between `dist/ig-broker-mcp.mjs` and `server/src` (the bundle must be reproducible with `npm ci && npm run build`)

## Design summary

See "Security model" in the [README](README.md). In short: read-only by default, trading tools only registered on opt-in, preview → single-use short-lived token → execute, a fail-closed approval hook, server-side guardrails, secret redaction, and an append-only audit log at `~/.cursor/ig-broker/audit.jsonl`.

The plugin talks only to IG's official API hosts (`api.ig.com`, `demo-api.ig.com`). It has no telemetry and no other network destinations.
