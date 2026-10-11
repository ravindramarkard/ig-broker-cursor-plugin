<p align="center"><img src="assets/logo.svg" width="96" alt="IG Broker plugin logo"></p>

# IG Broker plugin for Cursor

A Cursor Marketplace plugin that lets Cursor's AI agents work with your **IG** trading account (spread betting and CFDs) through the official [IG REST Trading API](https://labs.ig.com/rest-trading-api-reference). Agents can review your portfolio and P&L, research markets and price history, and, if you allow it, place and manage trades behind several layers of protection.

> **Read-only by default.** Trading tools do not exist until you turn them on. Even then, every trade needs a preview, an explicit "yes" in chat, *and* your approval in a Cursor prompt.

> Independent open-source project. Not affiliated with or endorsed by IG Group. Trading leveraged products carries a high risk of losing money.

## What's in the bundle

| Component | Path | What it does |
|---|---|---|
| MCP server | `mcp.json` → `dist/ig-broker-mcp.mjs` | 18 tools wrapping the IG REST API (source in `server/src`) |
| Hook | `hooks/hooks.json` | `beforeMCPExecution` guard: every `ig_execute_trade` call needs your approval in Cursor, and stale or unknown confirmation tokens are denied |
| Rule | `rules/ig-trading-safety.mdc` | Safety protocol the agent follows whenever IG tools are involved |
| Skills | `skills/` | `ig-portfolio-review`, `ig-market-research`, `ig-trade-execution`, `ig-trading-journal` |
| Subagent | `agents/ig-risk-analyst.md` | Read-only risk assessment (exposure, loss-to-stops, margin, concentration) |
| Commands | `commands/` | `/ig-portfolio`, `/ig-quote <market>`, `/ig-trade <instruction>` |

### Tools

**Read-only (always available):** `ig_account_overview`, `ig_list_accounts`, `ig_switch_account`, `ig_get_positions`, `ig_get_working_orders`, `ig_search_markets`, `ig_get_market`, `ig_get_prices`, `ig_get_activity`, `ig_get_transactions`, `ig_get_watchlists`, `ig_get_deal_confirmation`

**Trading (only when `IG_TRADING_ENABLED=true`):** `ig_preview_open_position`, `ig_preview_close_position`, `ig_preview_amend_position`, `ig_preview_working_order`, `ig_preview_cancel_working_order`, `ig_execute_trade`

## Security model

1. **Credentials stay out of the model's context.** The API key, username and password are passed to the MCP server process through plugin variables. They are sent only to IG over HTTPS. No tool ever returns them, and secrets and session tokens are masked in all tool output and errors.
2. **Least privilege by default.** With trading disabled, only read tools are registered. The agent cannot call what does not exist.
3. **Preview, then execute.** Preview tools validate the order and send nothing to IG. They return a human-readable summary and a confirmation token. The token is random, single-use, expires after 2 minutes, and is bound to the exact order and the active account. `ig_execute_trade` executes *only* that previewed order.
4. **Human approval in Cursor.** The bundled hook intercepts `ig_execute_trade` and shows the server-generated summary in Cursor's approval prompt, so you approve what will actually be sent, not the agent's paraphrase. This works even with auto-run enabled. Unknown or expired tokens are denied. The hook is fail-closed: if it can't run, trading is blocked.
5. **Hard guardrails** enforced server-side, which the agent cannot override:
   - maximum size per order (`IG_MAX_DEAL_SIZE`)
   - mandatory stop loss on new exposure, and stops can't be removed (`IG_REQUIRE_STOP_LOSS`)
   - optional market allowlist (`IG_ALLOWED_EPICS`)
   - IG's own dealing rules: minimum size, minimum stop distance, stop/limit on the correct side, market open
6. **Audit trail.** Every preview, execution, refusal and account switch is appended to `~/.cursor/ig-broker/audit.jsonl` (mode 600, secrets redacted).
7. **No blind retries.** If IG doesn't confirm a deal, the agent is told to check positions before doing anything else.

## Configuration

Set these in Cursor under **Plugins → IG Broker → Configure**:

| Variable | Default | Description |
|---|---|---|
| `IG_API_KEY` | required | My IG → Settings → API keys. Demo and live keys are separate. |
| `IG_IDENTIFIER` | required | Your IG username |
| `IG_PASSWORD` | required | Your IG password |
| `IG_ENVIRONMENT` | `demo` | `demo`, `live`, or `mock` (simulated, no credentials) |
| `IG_ACCOUNT_ID` | preferred account | Pick the spread bet or CFD account |
| `IG_TRADING_ENABLED` | `false` | Expose trading tools |
| `IG_MAX_DEAL_SIZE` | `1` | Max size per order (stake per point or contracts) |
| `IG_REQUIRE_STOP_LOSS` | `true` | Require stops on new positions and orders |
| `IG_ALLOWED_EPICS` | any | Comma-separated epic allowlist |

**Local fallback:** if plugin variables aren't available (e.g. while developing locally), the server also reads `~/.cursor/ig-broker/config.env`. Copy [`config.env.example`](config.env.example) there and run `chmod 600` on it. Plugin variables take precedence over the file.

Start on **demo**. Get a demo account and API key from [IG](https://www.ig.com/uk/demo-account), and switch to `live` once you're comfortable.

## Using it

Ask the agent things like:

- "How is my IG account doing?" or `/ig-portfolio`
- `/ig-quote gold`, or "Show me the FTSE 100 over the last 30 days with its 20-day average"
- "Have the risk analyst review my positions"
- "Make a trading journal for September and save it as markdown"
- `/ig-trade buy £2 a point FTSE 100, stop 30 points, limit 60`. The agent previews it, asks you, and Cursor asks you again before anything reaches IG.

## Development

Requires Node.js 20+.

```bash
npm install
npm run check        # typecheck + unit tests + build + plugin validation + stdio smoke test
```

| Script | Purpose |
|---|---|
| `npm test` | Vitest suite: config, IG client (session refresh, errors, redaction), every tool against the mock IG API, confirmation tokens, approval hook |
| `npm run build` | Bundle `server/src` into `dist/ig-broker-mcp.mjs` (committed, because Cursor runs plugins straight from the repo with no `npm install`) |
| `npm run validate` | Check manifest, frontmatter, variables and paths against the Marketplace submission checklist |
| `npm run smoke` | Launch the bundled server over stdio exactly as `mcp.json` does, and run a full mock preview→execute flow |
| `npm run dev` | Run the server from source in mock mode |
| `npm run install-local` | Copy the plugin into `~/.cursor/plugins/local/ig-broker` for testing in Cursor |

### Try it in Cursor locally

```bash
npm run build && npm run install-local
```

Then run **Developer: Reload Window** in Cursor and open **Customize** to confirm the MCP server, skills, rules, commands, subagent and hook loaded. To try it without an IG account, put `IG_ENVIRONMENT=mock` (and optionally `IG_TRADING_ENABLED=true`) in `~/.cursor/ig-broker/config.env`. Mock mode serves realistic simulated markets, positions and fills, and every response is labelled `SIMULATED`.

### Project layout

```
.cursor-plugin/plugin.json   manifest + variable schema
mcp.json                     launches dist/ig-broker-mcp.mjs with plugin variables
server/src/                  MCP server (TypeScript)
  ig/client.ts               IG REST client: session auth, re-login, IG quirks (_method: DELETE, versions)
  ig/mock.ts                 offline IG API used by mock mode and tests
  trading/                   guardrails and confirmation tokens
  server.ts                  tool definitions
server/test/                 vitest suite
hooks/                       trade-approval hook (dependency-free Node script)
rules/ skills/ agents/ commands/ assets/
scripts/                     build, validate, smoke, install-local
```

### Publishing

1. Push this repo to a **public** Git repository and make sure `npm run check` passes.
2. Submit the repository URL at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).
3. Bump `version` in both `package.json` and `.cursor-plugin/plugin.json`, then rebuild `dist/` for each release. Marketplace updates are reviewed manually.

### Known limitations

- Uses IG session auth (API v2 `CST` / `X-SECURITY-TOKEN`). IG's OAuth (v3) and the Lightstreamer streaming API are not implemented, so quotes are request/response snapshots.
- `approxPnL` is points × size × contract size in the position currency, which is right for spread bets and most CFDs. IG's platform is authoritative.
- The hook command (`node ./hooks/ig-trade-approval.mjs`) assumes Cursor runs plugin hooks from the plugin root, following Cursor's plugin examples. If a Cursor version resolves it differently, the hook fails closed, which blocks `ig_execute_trade` rather than letting it through.
- IG limits non-trading requests (~30/min per account) and historical price data (~10,000 points/week). The tools ask for small windows by default.
