import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AuditLog } from "./audit.js";
import type { IgConfig } from "./config.js";
import * as fmt from "./format.js";
import type { IgClient } from "./ig/client.js";
import { ConfigError, GuardError, IgApiError } from "./ig/errors.js";
import type { Direction, IgDealConfirmation, IgMarketDetails } from "./ig/types.js";
import type { Redactor } from "./redact.js";
import type { ConfirmationStore, PendingAction } from "./trading/confirmations.js";
import { assertTradingEnabled, round, validateOrder } from "./trading/guards.js";

export const SERVER_NAME = "ig-broker";
export const SERVER_VERSION = "0.1.0";

export interface ServerDeps {
  config: IgConfig;
  client: IgClient;
  redactor: Redactor;
  confirmations: ConfirmationStore;
  audit: AuditLog;
}

const RESOLUTIONS = [
  "MINUTE", "MINUTE_2", "MINUTE_3", "MINUTE_5", "MINUTE_10", "MINUTE_15", "MINUTE_30",
  "HOUR", "HOUR_2", "HOUR_3", "HOUR_4", "DAY", "WEEK", "MONTH",
] as const;

const epic = z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/, "Epics look like IX.D.FTSE.DAILY.IP").describe("IG market identifier (epic), e.g. IX.D.FTSE.DAILY.IP. Use ig_search_markets to find it.");
const dealId = z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/).describe("IG deal id, e.g. DIAAAAB1234567");
const direction = z.enum(["BUY", "SELL"]);
const price = z.number().finite().positive();

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const PREVIEW = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

/** IG history endpoints expect local-style timestamps without a zone suffix. */
function igTime(d: Date): string {
  return d.toISOString().slice(0, 19);
}

function historyRange(args: { days?: number; from?: string; to?: string }) {
  const to = args.to ? new Date(args.to) : new Date();
  const from = args.from ? new Date(args.from) : new Date(to.getTime() - (args.days ?? 7) * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new GuardError("from/to must be ISO-8601 dates.");
  return { from: igTime(from), to: igTime(to) };
}

/** IG working orders take goodTillDate as `yyyy/MM/dd HH:mm:ss`. */
function igGoodTill(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new GuardError("goodTillDate must be an ISO-8601 date-time.");
  if (d.getTime() <= Date.now()) throw new GuardError("goodTillDate must be in the future.");
  return d.toISOString().slice(0, 19).replace(/-/g, "/").replace("T", " ");
}

function opposite(d: Direction): Direction {
  return d === "BUY" ? "SELL" : "BUY";
}

function orderCurrency(market: IgMarketDetails, fallback: string): string {
  return market.instrument.currencies?.find((c) => c.isDefault)?.code ?? market.instrument.currencies?.[0]?.code ?? fallback;
}

function marginEstimate(market: IgMarketDetails, entry: number, size: number): number | null {
  if (market.instrument.marginFactorUnit !== "PERCENTAGE" || market.instrument.marginFactor == null) return null;
  return round(entry * size * (market.instrument.marginFactor / 100), 2);
}

export function createServer(deps: ServerDeps): McpServer {
  const { config, client, redactor, confirmations, audit } = deps;
  const envLabel = config.environment.toUpperCase();

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        `IG Broker tools connected to the ${envLabel} environment. ` +
        (config.environment === "mock" ? "All data is SIMULATED. " : "") +
        (config.tradingEnabled
          ? "Trading is enabled: always preview a trade, show the user the preview summary verbatim, and only call ig_execute_trade after the user explicitly confirms. "
          : "Trading is disabled; only read-only tools are available. ") +
        "Never present prices as investment advice.",
    },
  );

  const envelope = (data: unknown) => {
    const base: Record<string, unknown> = { environment: config.environment };
    if (config.environment === "mock") base.notice = "SIMULATED DATA - not connected to a real IG account.";
    if (client.currentAccountId) base.accountId = client.currentAccountId;
    return data && typeof data === "object" && !Array.isArray(data) ? { ...base, ...data } : { ...base, result: data };
  };

  const ok = (data: unknown): CallToolResult => ({
    content: [{ type: "text", text: JSON.stringify(redactor.value(envelope(data)), null, 2) }],
  });

  const fail = (err: unknown): CallToolResult => {
    let message: string;
    if (err instanceof IgApiError) {
      message = `${err.message}${err.hint ? `\nHint: ${err.hint}` : ""}`;
    } else if (err instanceof GuardError || err instanceof ConfigError) {
      message = err.message;
    } else if (err instanceof Error && err.name === "TimeoutError") {
      message = "IG API request timed out. IG may be unavailable; try again shortly.";
    } else {
      message = `Unexpected error: ${(err as Error)?.message ?? String(err)}`;
    }
    return { isError: true, content: [{ type: "text", text: redactor.text(message) }] };
  };

  const handle =
    <A,>(fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return ok(await fn(args));
      } catch (err) {
        return fail(err);
      }
    };

  // ---------------------------------------------------------------- read-only

  server.registerTool(
    "ig_account_overview",
    {
      title: "IG account overview",
      description:
        "Connection status, active account balance (funds, margin used, available, unrealised P&L), open position/order counts, and the plugin's trading safety settings. Start here.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handle(async () => {
      const session = await client.sessionSummary();
      const [accounts, positions, orders] = await Promise.all([client.listAccounts(), client.getPositions(), client.getWorkingOrders()]);
      const active = accounts.find((a) => a.accountId === session.accountId);
      return {
        account: active
          ? { id: active.accountId, name: active.accountName, type: active.accountType, currency: active.currency, balance: active.balance.balance, marginUsed: active.balance.deposit, unrealisedPnL: active.balance.profitLoss, available: active.balance.available }
          : { id: session.accountId, type: session.accountType, currency: session.currency },
        openPositions: positions.length,
        workingOrders: orders.length,
        otherAccounts: accounts.filter((a) => a.accountId !== session.accountId).map((a) => ({ id: a.accountId, name: a.accountName, type: a.accountType })),
        safety: {
          tradingEnabled: config.tradingEnabled,
          dealingEnabledByIg: session.dealingEnabled,
          maxDealSize: config.maxDealSize,
          requireStopLoss: config.requireStopLoss,
          allowedEpics: config.allowedEpics ?? "all",
        },
      };
    }),
  );

  server.registerTool(
    "ig_list_accounts",
    {
      title: "List IG accounts",
      description: "List every account under this IG login (spread bet, CFD, etc.) with balances.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handle(async () => {
      const accounts = await client.listAccounts();
      return {
        accounts: accounts.map((a) => ({
          id: a.accountId, name: a.accountName, alias: a.accountAlias ?? null, type: a.accountType, status: a.status,
          preferred: a.preferred, active: a.accountId === client.currentAccountId, currency: a.currency,
          balance: a.balance.balance, marginUsed: a.balance.deposit, unrealisedPnL: a.balance.profitLoss, available: a.balance.available,
        })),
      };
    }),
  );

  server.registerTool(
    "ig_switch_account",
    {
      title: "Switch active IG account",
      description: "Make another account (from ig_list_accounts) the active one for subsequent calls. Cancels any pending trade previews.",
      inputSchema: { accountId: z.string().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handle(async ({ accountId }: { accountId: string }) => {
      const accounts = await client.listAccounts();
      if (!accounts.some((a) => a.accountId === accountId)) {
        throw new GuardError(`Account ${accountId} is not one of: ${accounts.map((a) => a.accountId).join(", ")}`);
      }
      await client.switchAccount(accountId);
      confirmations.clear();
      audit.write({ event: "account_switched", environment: config.environment, accountId });
      return { switchedTo: accountId };
    }),
  );

  server.registerTool(
    "ig_get_positions",
    {
      title: "Open positions",
      description: "List open positions on the active account with entry level, current exit price, stop/limit, and approximate running P&L.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handle(async () => {
      const positions = (await client.getPositions()).map(fmt.position);
      return {
        positions,
        totals: { count: positions.length, approxPnL: round(positions.reduce((s, p) => s + (p.approxPnL ?? 0), 0), 2) },
        note: "approxPnL = points x size x contract size in the position currency. IG's platform figure is authoritative.",
      };
    }),
  );

  server.registerTool(
    "ig_get_working_orders",
    {
      title: "Working orders",
      description: "List pending limit/stop entry orders on the active account.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handle(async () => ({ workingOrders: (await client.getWorkingOrders()).map(fmt.workingOrder) })),
  );

  server.registerTool(
    "ig_search_markets",
    {
      title: "Search markets",
      description: "Search IG markets by name or symbol (e.g. 'FTSE', 'EUR/USD', 'Apple', 'gold') and return epics with live bid/offer.",
      inputSchema: { query: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).default(15) },
      annotations: READ_ONLY,
    },
    handle(async ({ query, limit }: { query: string; limit: number }) => {
      const markets = await client.searchMarkets(query);
      return { markets: markets.slice(0, limit).map(fmt.market), totalMatches: markets.length };
    }),
  );

  server.registerTool(
    "ig_get_market",
    {
      title: "Market details",
      description: "Full details for one market: live quote, status, margin requirement and IG dealing rules (minimum size, minimum stop distance). Call before previewing a trade.",
      inputSchema: { epic },
      annotations: READ_ONLY,
    },
    handle(async ({ epic }: { epic: string }) => fmt.marketDetails(await client.getMarket(epic))),
  );

  server.registerTool(
    "ig_get_prices",
    {
      title: "Historical prices",
      description:
        "OHLC candles (mid prices) for a market. IG limits historical data to ~10,000 points per week, so request only what you need.",
      inputSchema: {
        epic,
        resolution: z.enum(RESOLUTIONS).default("HOUR"),
        max: z.number().int().min(1).max(500).default(48).describe("Number of most recent candles"),
      },
      annotations: READ_ONLY,
    },
    handle(async ({ epic, resolution, max }: { epic: string; resolution: string; max: number }) => ({
      epic,
      resolution,
      ...fmt.candles(await client.getPrices(epic, { resolution, max })),
    })),
  );

  const historyInput = {
    days: z.number().int().min(1).max(90).optional().describe("Look-back window in days (default 7)"),
    from: z.string().optional().describe("ISO-8601 start, overrides days"),
    to: z.string().optional().describe("ISO-8601 end, defaults to now"),
    pageSize: z.number().int().min(1).max(200).default(50),
  };

  server.registerTool(
    "ig_get_activity",
    {
      title: "Account activity",
      description: "Recent account activity: deals opened/closed/amended, order changes, with deal references.",
      inputSchema: historyInput,
      annotations: READ_ONLY,
    },
    handle(async (args: { days?: number; from?: string; to?: string; pageSize: number }) => {
      const range = historyRange(args);
      return { ...range, ...(await client.getActivity({ ...range, pageSize: args.pageSize })) };
    }),
  );

  server.registerTool(
    "ig_get_transactions",
    {
      title: "Transaction history",
      description: "Closed trade P&L, deposits, withdrawals, funding and fees for a date range.",
      inputSchema: { ...historyInput, type: z.enum(["ALL", "ALL_DEAL", "DEPOSIT", "WITHDRAWAL"]).default("ALL") },
      annotations: READ_ONLY,
    },
    handle(async (args: { days?: number; from?: string; to?: string; pageSize: number; type: string }) => {
      const range = historyRange(args);
      return { ...range, ...(await client.getTransactions({ ...range, type: args.type, pageSize: args.pageSize })) };
    }),
  );

  server.registerTool(
    "ig_get_watchlists",
    {
      title: "Watchlists",
      description: "Without watchlistId: list the user's IG watchlists. With watchlistId: return its markets with live prices.",
      inputSchema: { watchlistId: z.string().min(1).max(64).optional() },
      annotations: READ_ONLY,
    },
    handle(async ({ watchlistId }: { watchlistId?: string }) =>
      watchlistId
        ? { watchlistId, markets: (await client.getWatchlist(watchlistId)).map(fmt.market) }
        : { watchlists: await client.getWatchlists() },
    ),
  );

  server.registerTool(
    "ig_get_deal_confirmation",
    {
      title: "Deal confirmation",
      description: "Look up the outcome (ACCEPTED/REJECTED and reason) of a deal by its deal reference.",
      inputSchema: { dealReference: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/) },
      annotations: READ_ONLY,
    },
    handle(async ({ dealReference }: { dealReference: string }) => ({ confirmation: await client.getConfirmation(dealReference) })),
  );

  if (!config.tradingEnabled) return server;

  // ------------------------------------------------------------------ trading

  const preview = async (action: PendingAction, summary: string, details: Record<string, unknown>) => {
    const session = await client.sessionSummary();
    const trade = confirmations.create({ action, summary, environment: config.environment, accountId: session.accountId });
    audit.write({ event: "trade_previewed", environment: config.environment, accountId: session.accountId, kind: action.kind, summary });
    return {
      status: "PREVIEW_ONLY - nothing has been sent to IG",
      summary,
      details,
      confirmationToken: trade.token,
      expiresAt: new Date(trade.expiresAt).toISOString(),
      nextStep: "Show the summary to the user verbatim. Only if they explicitly approve, call ig_execute_trade with this confirmationToken.",
    };
  };

  const stopLimitInput = {
    stopLevel: price.optional().describe("Absolute stop-loss price"),
    stopDistance: price.optional().describe("Stop-loss distance in points from entry"),
    limitLevel: price.optional().describe("Absolute take-profit price"),
    limitDistance: price.optional().describe("Take-profit distance in points from entry"),
    guaranteedStop: z.boolean().default(false).describe("Guaranteed stop (IG charges a premium if triggered)"),
  };

  server.registerTool(
    "ig_preview_open_position",
    {
      title: "Preview: open position",
      description:
        "Validate a new MARKET order against IG dealing rules and the plugin's safety limits, and return a human-readable summary plus a single-use, short-lived confirmationToken. Sends nothing to IG.",
      inputSchema: {
        epic,
        direction,
        size: price.describe("Deal size (stake per point for spread bets, contracts for CFDs)"),
        ...stopLimitInput,
        trailingStop: z.boolean().default(false),
        trailingStopIncrement: price.optional(),
      },
      annotations: PREVIEW,
    },
    handle(async (a: {
      epic: string; direction: Direction; size: number; stopLevel?: number; stopDistance?: number; limitLevel?: number;
      limitDistance?: number; guaranteedStop: boolean; trailingStop: boolean; trailingStopIncrement?: number;
    }) => {
      assertTradingEnabled(config);
      const market = await client.getMarket(a.epic);
      const entry = a.direction === "BUY" ? market.snapshot.offer : market.snapshot.bid;
      if (entry == null) throw new GuardError(`No live ${a.direction === "BUY" ? "offer" : "bid"} for ${a.epic}; the market may be closed.`);
      const { stopDistance } = validateOrder(config, market, { ...a, entry, requireTradeable: true });
      const session = await client.sessionSummary();
      const currency = orderCurrency(market, session.currency);
      const request = {
        epic: market.instrument.epic, expiry: market.instrument.expiry, direction: a.direction, size: a.size,
        orderType: "MARKET" as const, guaranteedStop: a.guaranteedStop, forceOpen: true, currencyCode: currency,
        stopLevel: a.stopLevel ?? null, stopDistance: a.stopDistance ?? null,
        limitLevel: a.limitLevel ?? null, limitDistance: a.limitDistance ?? null,
        trailingStop: a.trailingStop, trailingStopIncrement: a.trailingStopIncrement ?? null,
      };
      const maxLoss = stopDistance != null ? round(stopDistance * a.size, 2) : null;
      const margin = marginEstimate(market, entry, a.size);
      const stopText = a.stopLevel != null ? `stop ${a.stopLevel}` : a.stopDistance != null ? `stop ${a.stopDistance} pts` : "NO STOP";
      const limitText = a.limitLevel != null ? `, limit ${a.limitLevel}` : a.limitDistance != null ? `, limit ${a.limitDistance} pts` : "";
      const summary =
        `[${envLabel} ${session.accountId}] OPEN ${a.direction} ${a.size} ${market.instrument.name} (${market.instrument.epic}) at market ~${entry}, ` +
        `${stopText}${a.guaranteedStop ? " (guaranteed)" : ""}${a.trailingStop ? " (trailing)" : ""}${limitText}. ` +
        (maxLoss != null ? `Approx. loss if stopped: ${maxLoss} ${currency}${a.guaranteedStop ? "" : " before slippage"}. ` : "") +
        (margin != null ? `Approx. margin: ${margin} ${currency}.` : "");
      return preview({ kind: "open_position", request }, summary.trim(), {
        indicativeEntry: entry, spread: market.snapshot.offer != null && market.snapshot.bid != null ? round(market.snapshot.offer - market.snapshot.bid) : null,
        stopDistancePoints: stopDistance != null ? round(stopDistance) : null, approxMaxLoss: maxLoss, approxMargin: margin, currency,
      });
    }),
  );

  server.registerTool(
    "ig_preview_close_position",
    {
      title: "Preview: close position",
      description: "Prepare closing all or part of an open position at market. Returns a summary and confirmationToken. Sends nothing to IG.",
      inputSchema: { dealId, size: price.optional().describe("Partial close size; omit to close fully") },
      annotations: PREVIEW,
    },
    handle(async ({ dealId, size }: { dealId: string; size?: number }) => {
      assertTradingEnabled(config);
      const p = fmt.position(await client.getPosition(dealId));
      const closeSize = size ?? p.size;
      if (closeSize > p.size) throw new GuardError(`Close size ${closeSize} is larger than the position size ${p.size}.`);
      if (p.currentExitPrice == null) throw new GuardError("No live price to close against; the market may be closed.");
      const approx = p.pnlPoints != null ? round(p.pnlPoints * closeSize, 2) : null;
      const session = await client.sessionSummary();
      const summary =
        `[${envLabel} ${session.accountId}] CLOSE ${closeSize === p.size ? "ALL" : "PART"}: ${opposite(p.direction)} ${closeSize} of ${p.direction} ${p.size} ` +
        `${p.instrument} (deal ${p.dealId}) at market ~${p.currentExitPrice}. Opened at ${p.openLevel}; approx. realised P&L ${approx ?? "n/a"} ${p.currency}.`;
      return preview(
        { kind: "close_position", request: { dealId: p.dealId, direction: opposite(p.direction), size: closeSize, orderType: "MARKET" } },
        summary,
        { position: p, closeSize, approxRealisedPnL: approx },
      );
    }),
  );

  server.registerTool(
    "ig_preview_amend_position",
    {
      title: "Preview: amend stop/limit",
      description:
        "Prepare changing the stop-loss and/or take-profit level of an open position. Omit a field to keep it; pass null to remove it. Returns a summary and confirmationToken.",
      inputSchema: { dealId, stopLevel: price.nullable().optional(), limitLevel: price.nullable().optional() },
      annotations: PREVIEW,
    },
    handle(async ({ dealId, stopLevel, limitLevel }: { dealId: string; stopLevel?: number | null; limitLevel?: number | null }) => {
      assertTradingEnabled(config);
      if (stopLevel === undefined && limitLevel === undefined) throw new GuardError("Provide stopLevel and/or limitLevel.");
      const raw = await client.getPosition(dealId);
      const p = fmt.position(raw);
      const newStop = stopLevel === undefined ? p.stopLevel : stopLevel;
      const newLimit = limitLevel === undefined ? p.limitLevel : limitLevel;
      const ref = p.currentExitPrice;
      const problems: string[] = [];
      if (config.requireStopLoss && newStop == null) problems.push("Removing the stop loss is not allowed (IG_REQUIRE_STOP_LOSS=true).");
      if (ref != null && newStop != null && (p.direction === "BUY" ? newStop >= ref : newStop <= ref)) {
        problems.push(`Stop ${newStop} would be on the wrong side of the current price ${ref}.`);
      }
      if (ref != null && newLimit != null && (p.direction === "BUY" ? newLimit <= ref : newLimit >= ref)) {
        problems.push(`Limit ${newLimit} would be on the wrong side of the current price ${ref}.`);
      }
      if (problems.length) throw new GuardError(`Amendment rejected by plugin safety checks:\n- ${problems.join("\n- ")}`);
      const trailing = raw.position.trailingStopDistance != null;
      const session = await client.sessionSummary();
      const summary =
        `[${envLabel} ${session.accountId}] AMEND ${p.direction} ${p.size} ${p.instrument} (deal ${p.dealId}): ` +
        `stop ${p.stopLevel ?? "none"} -> ${newStop ?? "none"}, limit ${p.limitLevel ?? "none"} -> ${newLimit ?? "none"}. Current price ~${ref}.`;
      return preview(
        {
          kind: "amend_position",
          dealId: p.dealId,
          request: {
            stopLevel: newStop, limitLevel: newLimit, guaranteedStop: raw.position.controlledRisk, trailingStop: trailing,
            trailingStopDistance: raw.position.trailingStopDistance, trailingStopIncrement: raw.position.trailingStep,
          },
        },
        summary,
        { before: { stopLevel: p.stopLevel, limitLevel: p.limitLevel }, after: { stopLevel: newStop, limitLevel: newLimit } },
      );
    }),
  );

  server.registerTool(
    "ig_preview_working_order",
    {
      title: "Preview: working order",
      description:
        "Prepare a resting entry order. LIMIT = enter at a better price than now (BUY below offer / SELL above bid); STOP = enter on a breakout (BUY above offer / SELL below bid). Returns a summary and confirmationToken.",
      inputSchema: {
        epic,
        direction,
        type: z.enum(["LIMIT", "STOP"]),
        size: price,
        level: price.describe("Price at which the order triggers"),
        ...stopLimitInput,
        goodTillDate: z.string().optional().describe("ISO-8601 expiry; omit for good-till-cancelled"),
      },
      annotations: PREVIEW,
    },
    handle(async (a: {
      epic: string; direction: Direction; type: "LIMIT" | "STOP"; size: number; level: number; stopLevel?: number; stopDistance?: number;
      limitLevel?: number; limitDistance?: number; guaranteedStop: boolean; goodTillDate?: string;
    }) => {
      assertTradingEnabled(config);
      const market = await client.getMarket(a.epic);
      const { bid, offer } = market.snapshot;
      if (bid != null && offer != null) {
        const ref = a.direction === "BUY" ? offer : bid;
        const expectBelow = (a.direction === "BUY") === (a.type === "LIMIT");
        if (expectBelow ? a.level >= ref : a.level <= ref) {
          throw new GuardError(
            `A ${a.direction} ${a.type} order must be ${expectBelow ? "below" : "above"} the current ${a.direction === "BUY" ? "offer" : "bid"} ${ref}.`,
          );
        }
      }
      const { stopDistance } = validateOrder(config, market, { ...a, entry: a.level, requireTradeable: false });
      const session = await client.sessionSummary();
      const currency = orderCurrency(market, session.currency);
      const request = {
        epic: market.instrument.epic, expiry: market.instrument.expiry, direction: a.direction, size: a.size, level: a.level,
        type: a.type, currencyCode: currency, guaranteedStop: a.guaranteedStop, forceOpen: true,
        timeInForce: a.goodTillDate ? ("GOOD_TILL_DATE" as const) : ("GOOD_TILL_CANCELLED" as const),
        goodTillDate: a.goodTillDate ? igGoodTill(a.goodTillDate) : null,
        stopLevel: a.stopLevel ?? null, stopDistance: a.stopDistance ?? null, limitLevel: a.limitLevel ?? null, limitDistance: a.limitDistance ?? null,
      };
      const maxLoss = stopDistance != null ? round(stopDistance * a.size, 2) : null;
      const summary =
        `[${envLabel} ${session.accountId}] WORKING ORDER ${a.direction} ${a.type} ${a.size} ${market.instrument.name} (${market.instrument.epic}) at ${a.level}` +
        ` (now bid ${bid} / offer ${offer}), ${stopDistance != null ? `stop ${round(stopDistance)} pts` : "NO STOP"}` +
        `${a.limitLevel != null ? `, limit ${a.limitLevel}` : a.limitDistance != null ? `, limit ${a.limitDistance} pts` : ""}, ` +
        `${a.goodTillDate ? `expires ${a.goodTillDate}` : "good till cancelled"}.` +
        (maxLoss != null ? ` Approx. loss if filled and stopped: ${maxLoss} ${currency}.` : "");
      return preview({ kind: "create_working_order", request }, summary, { approxMaxLoss: maxLoss, currency });
    }),
  );

  server.registerTool(
    "ig_preview_cancel_working_order",
    {
      title: "Preview: cancel working order",
      description: "Prepare cancelling a pending working order. Returns a summary and confirmationToken.",
      inputSchema: { dealId },
      annotations: PREVIEW,
    },
    handle(async ({ dealId }: { dealId: string }) => {
      assertTradingEnabled(config);
      const order = (await client.getWorkingOrders()).map(fmt.workingOrder).find((o) => o.dealId === dealId);
      if (!order) throw new GuardError(`No working order with deal id ${dealId} on the active account.`);
      const session = await client.sessionSummary();
      const summary = `[${envLabel} ${session.accountId}] CANCEL working order ${order.direction} ${order.type} ${order.size} ${order.instrument} at ${order.level} (deal ${order.dealId}).`;
      return preview({ kind: "cancel_working_order", dealId }, summary, { order });
    }),
  );

  server.registerTool(
    "ig_execute_trade",
    {
      title: "Execute previewed trade",
      description:
        `Send a previously previewed trade to IG. ONLY call this after the user has explicitly approved the exact preview summary in this conversation. The token is single-use and expires ${Math.round(config.confirmationTtlMs / 1000)} seconds after the preview.`,
      inputSchema: { confirmationToken: z.string().regex(/^igc_[a-f0-9]{32}$/, "Use the confirmationToken returned by a preview tool") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ confirmationToken }: { confirmationToken: string }): Promise<CallToolResult> => {
      try {
        assertTradingEnabled(config);
        const trade = confirmations.consume(confirmationToken);
        if ("error" in trade) throw new GuardError(trade.error);
        const session = await client.sessionSummary();
        if (trade.accountId !== session.accountId || trade.environment !== config.environment) {
          throw new GuardError("The active account changed since this trade was previewed. Preview it again.");
        }
        const a = trade.action;
        let dealReference: string;
        try {
          switch (a.kind) {
            case "open_position":
              dealReference = await client.openPosition(a.request);
              break;
            case "close_position":
              dealReference = await client.closePosition(a.request);
              break;
            case "amend_position":
              dealReference = await client.amendPosition(a.dealId, a.request);
              break;
            case "create_working_order":
              dealReference = await client.createWorkingOrder(a.request);
              break;
            case "cancel_working_order":
              dealReference = await client.deleteWorkingOrder(a.dealId);
              break;
          }
        } catch (err) {
          audit.write({ event: "trade_failed", environment: config.environment, accountId: session.accountId, kind: a.kind, summary: trade.summary, error: (err as Error).message });
          throw err;
        }
        const confirmation = await client.waitForConfirmation(dealReference);
        const result = summarizeConfirmation(dealReference, confirmation);
        audit.write({ event: "trade_executed", environment: config.environment, accountId: session.accountId, kind: a.kind, summary: trade.summary, dealReference, dealStatus: result.dealStatus, reason: result.reason, dealId: result.dealId });
        return ok({ executed: trade.summary, ...result });
      } catch (err) {
        if (err instanceof GuardError) {
          audit.write({ event: "trade_refused", environment: config.environment, accountId: client.currentAccountId, reason: err.message });
        }
        return fail(err);
      }
    },
  );

  return server;
}

const REJECTION_HINTS: Record<string, string> = {
  MARKET_CLOSED_WITH_EDITS: "The market is closed.",
  MARKET_CLOSED: "The market is closed.",
  MINIMUM_ORDER_SIZE_ERROR: "Size is below the market minimum.",
  ATTACHED_ORDER_LEVEL_ERROR: "Stop or limit is too close to the price.",
  INSUFFICIENT_FUNDS: "Not enough available funds for the margin.",
  POSITION_NOT_FOUND: "The position no longer exists.",
  REJECT_SPREADBET_ORDER_ON_CFD_ACCOUNT: "This epic is a spread bet market but the active account is CFD (or vice versa).",
  REJECT_CFD_ORDER_ON_SPREADBET_ACCOUNT: "This epic is a CFD market but the active account is a spread bet account.",
};

function summarizeConfirmation(dealReference: string, c: IgDealConfirmation | null) {
  if (!c) {
    return {
      dealReference,
      dealStatus: "UNKNOWN",
      reason: "IG did not return a confirmation yet. Check with ig_get_deal_confirmation or ig_get_positions before retrying - do NOT resubmit blindly.",
      dealId: null,
    };
  }
  return {
    dealReference,
    dealStatus: c.dealStatus,
    status: c.status,
    reason: c.reason,
    reasonExplained: c.dealStatus === "REJECTED" ? (REJECTION_HINTS[c.reason] ?? null) : undefined,
    dealId: c.dealId,
    epic: c.epic,
    direction: c.direction,
    size: c.size,
    level: c.level,
    stopLevel: c.stopLevel,
    limitLevel: c.limitLevel,
    guaranteedStop: c.guaranteedStop,
    profit: c.profit ?? undefined,
    profitCurrency: c.profitCurrency ?? undefined,
  };
}
