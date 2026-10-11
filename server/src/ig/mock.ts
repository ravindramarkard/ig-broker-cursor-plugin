import { randomUUID } from "node:crypto";
import type { FetchLike } from "./client.js";
import type {
  Direction,
  IgAccount,
  IgDealConfirmation,
  IgMarketDetails,
  IgMarketSummary,
  IgPosition,
  IgWorkingOrder,
} from "./types.js";

interface MockMarket {
  epic: string;
  name: string;
  type: string;
  expiry: string;
  mid: number;
  spread: number;
  decimals: number;
  currency: string;
  minDealSize: number;
  minStopDistance: number;
  contractSize: number;
  status: "TRADEABLE" | "CLOSED" | "EDITS_ONLY";
  volatility: number;
}

const MARKETS: MockMarket[] = [
  { epic: "IX.D.FTSE.DAILY.IP", name: "FTSE 100", type: "INDICES", expiry: "DFB", mid: 8312.4, spread: 1, decimals: 1, currency: "GBP", minDealSize: 0.5, minStopDistance: 4, contractSize: 1, status: "TRADEABLE", volatility: 0.004 },
  { epic: "IX.D.DOW.DAILY.IP", name: "Wall Street", type: "INDICES", expiry: "DFB", mid: 42150.6, spread: 2.4, decimals: 1, currency: "USD", minDealSize: 0.5, minStopDistance: 20, contractSize: 1, status: "TRADEABLE", volatility: 0.005 },
  { epic: "IX.D.SPTRD.DAILY.IP", name: "US 500", type: "INDICES", expiry: "DFB", mid: 5781.2, spread: 0.4, decimals: 1, currency: "USD", minDealSize: 0.5, minStopDistance: 4, contractSize: 1, status: "TRADEABLE", volatility: 0.005 },
  { epic: "CS.D.EURUSD.TODAY.IP", name: "EUR/USD", type: "CURRENCIES", expiry: "DFB", mid: 10941.5, spread: 0.6, decimals: 1, currency: "USD", minDealSize: 0.5, minStopDistance: 2, contractSize: 1, status: "TRADEABLE", volatility: 0.003 },
  { epic: "CS.D.GBPUSD.TODAY.IP", name: "GBP/USD", type: "CURRENCIES", expiry: "DFB", mid: 13068.2, spread: 0.9, decimals: 1, currency: "USD", minDealSize: 0.5, minStopDistance: 2, contractSize: 1, status: "TRADEABLE", volatility: 0.003 },
  { epic: "CS.D.USCGC.TODAY.IP", name: "Spot Gold", type: "COMMODITIES", expiry: "DFB", mid: 2641.35, spread: 0.3, decimals: 2, currency: "USD", minDealSize: 0.5, minStopDistance: 1, contractSize: 1, status: "TRADEABLE", volatility: 0.006 },
  { epic: "CC.D.LCO.USS.IP", name: "Oil - Brent Crude", type: "COMMODITIES", expiry: "DFB", mid: 7912.0, spread: 2.8, decimals: 1, currency: "USD", minDealSize: 0.5, minStopDistance: 12, contractSize: 1, status: "TRADEABLE", volatility: 0.012 },
  { epic: "UA.D.AAPL.DAILY.IP", name: "Apple Inc (All Sessions)", type: "SHARES", expiry: "DFB", mid: 22714, spread: 14, decimals: 0, currency: "USD", minDealSize: 0.5, minStopDistance: 50, contractSize: 1, status: "TRADEABLE", volatility: 0.01 },
  { epic: "CS.D.BITCOIN.TODAY.IP", name: "Bitcoin", type: "CURRENCIES", expiry: "DFB", mid: 63120, spread: 36, decimals: 0, currency: "USD", minDealSize: 0.1, minStopDistance: 400, contractSize: 1, status: "TRADEABLE", volatility: 0.025 },
  { epic: "IX.D.NIKKEI.DAILY.IP", name: "Japan 225", type: "INDICES", expiry: "DFB", mid: 39020, spread: 7, decimals: 0, currency: "JPY", minDealSize: 0.5, minStopDistance: 30, contractSize: 1, status: "CLOSED", volatility: 0.007 },
];

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Deterministic pseudo-random walk so charts look plausible and tests stay stable. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const RESOLUTION_MS: Record<string, number> = {
  SECOND: 1_000, MINUTE: 60_000, MINUTE_2: 120_000, MINUTE_3: 180_000, MINUTE_5: 300_000, MINUTE_10: 600_000,
  MINUTE_15: 900_000, MINUTE_30: 1_800_000, HOUR: 3_600_000, HOUR_2: 7_200_000, HOUR_3: 10_800_000,
  HOUR_4: 14_400_000, DAY: 86_400_000, WEEK: 604_800_000, MONTH: 2_592_000_000,
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const igError = (status: number, errorCode: string) => json(status, { errorCode });

export interface MockOptions {
  now?: () => number;
}

export class MockIgApi {
  private readonly now: () => number;
  private readonly tokens = new Set<string>();
  private accountId = "MOCK-SB-001";
  private readonly accounts: IgAccount[] = [
    { accountId: "MOCK-SB-001", accountName: "Spread bet", accountAlias: null, status: "ENABLED", accountType: "SPREADBET", preferred: true, balance: { balance: 25000, deposit: 1840.2, profitLoss: 0, available: 23159.8 }, currency: "GBP", canTransferFrom: true, canTransferTo: true },
    { accountId: "MOCK-CFD-002", accountName: "CFD", accountAlias: "Swing", status: "ENABLED", accountType: "CFD", preferred: false, balance: { balance: 8000, deposit: 0, profitLoss: 0, available: 8000 }, currency: "GBP", canTransferFrom: true, canTransferTo: true },
  ];
  private positions: Array<{ accountId: string; data: IgPosition["position"]; epic: string }> = [];
  private workingOrders: Array<{ accountId: string; data: IgWorkingOrder["workingOrderData"] }> = [];
  private readonly confirms = new Map<string, IgDealConfirmation>();
  private readonly transactions: unknown[] = [];

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? Date.now;
    const t = new Date(this.now() - 3 * 86_400_000).toISOString().slice(0, 19);
    this.positions.push(
      { accountId: "MOCK-SB-001", epic: "IX.D.FTSE.DAILY.IP", data: { contractSize: 1, createdDateUTC: t, dealId: "DIAAAAMOCKFTSE01", dealReference: "MOCKREF01", size: 2, direction: "BUY", limitLevel: 8450, level: 8270.5, currency: "GBP", controlledRisk: false, stopLevel: 8180, trailingStep: null, trailingStopDistance: null } },
      { accountId: "MOCK-SB-001", epic: "CS.D.USCGC.TODAY.IP", data: { contractSize: 1, createdDateUTC: t, dealId: "DIAAAAMOCKGOLD02", dealReference: "MOCKREF02", size: 1, direction: "SELL", limitLevel: null, level: 2655.1, currency: "GBP", controlledRisk: false, stopLevel: null, trailingStep: null, trailingStopDistance: null } },
    );
    this.workingOrders.push({
      accountId: "MOCK-SB-001",
      data: { dealId: "DIAAAAMOCKWO0001", direction: "BUY", epic: "IX.D.DOW.DAILY.IP", orderSize: 0.5, orderLevel: 41800, timeInForce: "GOOD_TILL_CANCELLED", goodTillDate: null, createdDateUTC: t, guaranteedStop: false, orderType: "LIMIT", stopDistance: 150, limitDistance: 400, currencyCode: "GBP" },
    });
    for (let i = 1; i <= 5; i++) {
      const d = new Date(this.now() - i * 2 * 86_400_000).toISOString().slice(0, 19);
      this.transactions.push({ date: d.slice(0, 10), dateUtc: d, openDateUtc: d, instrumentName: MARKETS[i % MARKETS.length]!.name, period: "DFB", profitAndLoss: `£${(i % 2 ? 1 : -1) * 37.5 * i}`, transactionType: "DEAL", reference: `MOCKTX${i}`, openLevel: "100", closeLevel: "101", size: "+1", currency: "£", cashTransaction: false });
    }
  }

  private market(epic: string): MockMarket | undefined {
    return MARKETS.find((m) => m.epic === epic);
  }

  private quote(m: MockMarket): { bid: number; offer: number; high: number; low: number; change: number; pct: number } {
    const wobble = Math.sin(this.now() / 600_000 + hash(m.epic)) * m.mid * m.volatility * 0.25;
    const mid = m.mid + wobble;
    const bid = round(mid - m.spread / 2, m.decimals);
    const offer = round(mid + m.spread / 2, m.decimals);
    const change = round(wobble, m.decimals);
    return {
      bid,
      offer,
      high: round(mid * (1 + m.volatility / 2), m.decimals),
      low: round(mid * (1 - m.volatility / 2), m.decimals),
      change,
      pct: round((wobble / m.mid) * 100, 2),
    };
  }

  private summary(m: MockMarket): IgMarketSummary {
    const q = this.quote(m);
    return {
      epic: m.epic, instrumentName: m.name, instrumentType: m.type, expiry: m.expiry, high: q.high, low: q.low,
      percentageChange: q.pct, netChange: q.change, updateTime: new Date(this.now()).toISOString().slice(11, 19),
      updateTimeUTC: new Date(this.now()).toISOString().slice(11, 19), bid: m.status === "CLOSED" ? null : q.bid,
      offer: m.status === "CLOSED" ? null : q.offer, delayTime: 0, streamingPricesAvailable: true,
      marketStatus: m.status, scalingFactor: 1,
    };
  }

  private details(m: MockMarket): IgMarketDetails {
    const s = this.summary(m);
    return {
      instrument: {
        epic: m.epic, name: m.name, expiry: m.expiry, type: m.type, lotSize: 1, unit: "AMOUNT",
        currencies: [{ code: "GBP", symbol: "£", isDefault: true }], marginFactor: m.type === "SHARES" ? 20 : 5,
        marginFactorUnit: "PERCENTAGE", guaranteedStopAllowed: true, streamingPricesAvailable: true,
        openingHours: null,
      },
      dealingRules: {
        minDealSize: { unit: "POINTS", value: m.minDealSize },
        minNormalStopOrLimitDistance: { unit: "POINTS", value: m.minStopDistance },
        minControlledRiskStopDistance: { unit: "POINTS", value: m.minStopDistance * 2 },
        maxStopOrLimitDistance: { unit: "PERCENTAGE", value: 75 },
        minStepDistance: { unit: "POINTS", value: 1 },
        marketOrderPreference: "AVAILABLE_DEFAULT_ON",
        trailingStopsPreference: "AVAILABLE",
      },
      snapshot: {
        marketStatus: m.status, netChange: s.netChange, percentageChange: s.percentageChange, updateTime: s.updateTime,
        delayTime: 0, bid: s.bid, offer: s.offer, high: s.high, low: s.low, decimalPlacesFactor: m.decimals, scalingFactor: 1,
      },
    };
  }

  private confirm(partial: Partial<IgDealConfirmation> & Pick<IgDealConfirmation, "epic" | "direction" | "dealStatus" | "reason">): string {
    const dealReference = `MOCK${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    this.confirms.set(dealReference, {
      date: new Date(this.now()).toISOString().slice(0, 19),
      status: null, expiry: "DFB", dealId: partial.dealId ?? `DIAAAA${dealReference.slice(4, 14)}`, level: null, size: null,
      stopLevel: null, limitLevel: null, guaranteedStop: false, affectedDeals: [], profit: null, profitCurrency: null,
      ...partial,
      dealReference,
    });
    return dealReference;
  }

  private reject(epic: string, direction: Direction, reason: string): Response {
    return json(200, { dealReference: this.confirm({ epic, direction, dealStatus: "REJECTED", reason }) });
  }

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/gateway\/deal/, "");
    const headers = new Headers(init.headers);
    const method = (headers.get("_method") ?? init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : {};

    if (path === "/session" && method === "POST") {
      if (!body.identifier || !body.password) return igError(400, "error.security.invalid-details");
      const cst = `mock-cst-${randomUUID()}`;
      const xst = `mock-xst-${randomUUID()}`;
      this.tokens.add(cst);
      const acct = this.accounts.find((a) => a.accountId === this.accountId)!;
      return json(
        200,
        { accountType: acct.accountType, accountInfo: acct.balance, currencyIsoCode: "GBP", currencySymbol: "£", currentAccountId: this.accountId, clientId: "MOCKCLIENT", timezoneOffset: 0, dealingEnabled: true, accounts: this.accounts.map((a) => ({ accountId: a.accountId, accountName: a.accountName, preferred: a.preferred, accountType: a.accountType })) },
        { CST: cst, "X-SECURITY-TOKEN": xst },
      );
    }

    const cst = headers.get("CST");
    if (!cst || !this.tokens.has(cst)) return igError(401, "error.security.client-token-invalid");

    if (path === "/session") {
      if (method === "DELETE") {
        this.tokens.delete(cst);
        return new Response(null, { status: 204 });
      }
      if (method === "PUT") {
        const acct = this.accounts.find((a) => a.accountId === body.accountId);
        if (!acct) return igError(400, "error.switch.accountId-invalid");
        if (acct.accountId === this.accountId) return igError(412, "error.switch.accountId-must-be-different");
        this.accountId = acct.accountId;
        return json(200, { accountType: acct.accountType, dealingEnabled: true }, { "X-SECURITY-TOKEN": `mock-xst-${randomUUID()}` });
      }
    }

    if (path === "/accounts" && method === "GET") {
      return json(200, { accounts: this.accounts.map((a) => ({ ...a, balance: { ...a.balance, profitLoss: a.accountId === this.accountId ? this.unrealised() : 0 } })) });
    }

    if (path === "/positions" && method === "GET") {
      return json(200, { positions: this.positions.filter((p) => p.accountId === this.accountId).map((p) => this.positionView(p)) });
    }
    const posMatch = /^\/positions\/([^/]+)$/.exec(path);
    if (posMatch && method === "GET" && posMatch[1] !== "otc") {
      const p = this.positions.find((x) => x.data.dealId === decodeURIComponent(posMatch[1]!) && x.accountId === this.accountId);
      return p ? json(200, this.positionView(p)) : igError(404, "error.position.notfound");
    }

    if (path === "/positions/otc" && method === "POST") return this.openPosition(body);
    if (path === "/positions/otc" && method === "DELETE") return this.closePosition(body);
    const amendMatch = /^\/positions\/otc\/([^/]+)$/.exec(path);
    if (amendMatch && method === "PUT") {
      const p = this.positions.find((x) => x.data.dealId === decodeURIComponent(amendMatch[1]!) && x.accountId === this.accountId);
      if (!p) return igError(404, "error.position.notfound");
      p.data.stopLevel = body.stopLevel ?? null;
      p.data.limitLevel = body.limitLevel ?? null;
      return json(200, { dealReference: this.confirm({ epic: p.epic, direction: p.data.direction, dealStatus: "ACCEPTED", reason: "SUCCESS", status: "AMENDED", dealId: p.data.dealId, stopLevel: p.data.stopLevel, limitLevel: p.data.limitLevel, size: p.data.size, level: p.data.level }) });
    }

    if (path === "/workingorders" && method === "GET") {
      return json(200, {
        workingOrders: this.workingOrders.filter((w) => w.accountId === this.accountId).map((w) => ({ workingOrderData: w.data, marketData: this.summary(this.market(w.data.epic)!) })),
      });
    }
    if (path === "/workingorders/otc" && method === "POST") {
      const m = this.market(body.epic);
      if (!m) return igError(404, "error.service.marketdata.instrument.epic.unavailable");
      if (body.size < m.minDealSize) return this.reject(m.epic, body.direction, "MINIMUM_ORDER_SIZE_ERROR");
      const dealId = `DIAAAAWO${randomUUID().slice(0, 8).toUpperCase()}`;
      this.workingOrders.push({ accountId: this.accountId, data: { dealId, direction: body.direction, epic: m.epic, orderSize: body.size, orderLevel: body.level, timeInForce: body.timeInForce, goodTillDate: body.goodTillDate ?? null, createdDateUTC: new Date(this.now()).toISOString().slice(0, 19), guaranteedStop: !!body.guaranteedStop, orderType: body.type, stopDistance: body.stopDistance ?? null, limitDistance: body.limitDistance ?? null, currencyCode: body.currencyCode } });
      return json(200, { dealReference: this.confirm({ epic: m.epic, direction: body.direction, dealStatus: "ACCEPTED", reason: "SUCCESS", status: "OPEN", dealId, level: body.level, size: body.size }) });
    }
    const woMatch = /^\/workingorders\/otc\/([^/]+)$/.exec(path);
    if (woMatch && method === "DELETE") {
      const idx = this.workingOrders.findIndex((w) => w.data.dealId === decodeURIComponent(woMatch[1]!) && w.accountId === this.accountId);
      if (idx < 0) return igError(404, "error.workingorder.notfound");
      const [wo] = this.workingOrders.splice(idx, 1);
      return json(200, { dealReference: this.confirm({ epic: wo!.data.epic, direction: wo!.data.direction, dealStatus: "ACCEPTED", reason: "SUCCESS", status: "DELETED", dealId: wo!.data.dealId }) });
    }

    if (path === "/markets" && method === "GET") {
      const term = (u.searchParams.get("searchTerm") ?? "").toLowerCase();
      const markets = MARKETS.filter((m) => m.name.toLowerCase().includes(term) || m.epic.toLowerCase().includes(term)).map((m) => this.summary(m));
      return json(200, { markets });
    }
    const mktMatch = /^\/markets\/([^/]+)$/.exec(path);
    if (mktMatch && method === "GET") {
      const m = this.market(decodeURIComponent(mktMatch[1]!));
      return m ? json(200, this.details(m)) : igError(404, "error.service.marketdata.instrument.epic.unavailable");
    }

    const priceMatch = /^\/prices\/([^/]+)$/.exec(path);
    if (priceMatch && method === "GET") {
      const m = this.market(decodeURIComponent(priceMatch[1]!));
      if (!m) return igError(404, "error.service.marketdata.instrument.epic.unavailable");
      const resolution = u.searchParams.get("resolution") ?? "HOUR";
      const step = RESOLUTION_MS[resolution];
      if (!step) return igError(400, "error.request.invalid.resolution");
      const max = Math.min(Number(u.searchParams.get("max") ?? 10), 500);
      return json(200, { prices: this.candles(m, step, max), instrumentType: m.type, metadata: { allowance: { remainingAllowance: 9850, totalAllowance: 10000, allowanceExpiry: 500000 }, size: max } });
    }

    if (path === "/history/activity" && method === "GET") {
      return json(200, { activities: [...this.confirms.values()].slice(-50).reverse().map((c) => ({ date: c.date, epic: c.epic, period: c.expiry, dealId: c.dealId, channel: "PUBLIC_WEB_API", type: c.status === "AMENDED" ? "POSITION" : "POSITION", status: c.dealStatus === "ACCEPTED" ? "ACCEPTED" : "REJECTED", description: `${c.status ?? "DEAL"} ${c.direction} ${c.size ?? ""} ${c.epic}`.trim(), details: { dealReference: c.dealReference, direction: c.direction, size: c.size, level: c.level } })) });
    }
    if (path === "/history/transactions" && method === "GET") {
      return json(200, { transactions: this.transactions, metadata: { pageData: { pageNumber: 1, pageSize: 50, totalPages: 1 }, size: this.transactions.length } });
    }

    if (path === "/watchlists" && method === "GET") {
      return json(200, { watchlists: [
        { id: "MOCKWL1", name: "Major indices", editable: true, deleteable: true, defaultSystemWatchlist: false },
        { id: "MOCKWL2", name: "FX majors", editable: true, deleteable: true, defaultSystemWatchlist: false },
      ] });
    }
    const wlMatch = /^\/watchlists\/([^/]+)$/.exec(path);
    if (wlMatch && method === "GET") {
      const ids = wlMatch[1] === "MOCKWL1" ? ["IX.D.FTSE.DAILY.IP", "IX.D.DOW.DAILY.IP", "IX.D.SPTRD.DAILY.IP", "IX.D.NIKKEI.DAILY.IP"] : wlMatch[1] === "MOCKWL2" ? ["CS.D.EURUSD.TODAY.IP", "CS.D.GBPUSD.TODAY.IP"] : null;
      if (!ids) return igError(404, "error.watchlist.notfound");
      return json(200, { markets: ids.map((id) => this.summary(this.market(id)!)) });
    }

    const confMatch = /^\/confirms\/([^/]+)$/.exec(path);
    if (confMatch && method === "GET") {
      const c = this.confirms.get(decodeURIComponent(confMatch[1]!));
      return c ? json(200, c) : igError(404, "error.confirms.deal-not-found");
    }

    return igError(404, "error.mock.endpoint-not-implemented");
  };

  private candles(m: MockMarket, stepMs: number, max: number) {
    const rnd = seeded(hash(m.epic) ^ stepMs);
    const end = Math.floor(this.now() / stepMs) * stepMs;
    const out = [];
    let price = m.mid * (1 - m.volatility * 2);
    for (let i = max - 1; i >= 0; i--) {
      const open = price;
      const close = open * (1 + (rnd() - 0.48) * m.volatility);
      const high = Math.max(open, close) * (1 + rnd() * m.volatility * 0.3);
      const low = Math.min(open, close) * (1 - rnd() * m.volatility * 0.3);
      price = close;
      const point = (v: number) => ({ bid: round(v - m.spread / 2, m.decimals), ask: round(v + m.spread / 2, m.decimals), lastTraded: null });
      const ts = new Date(end - i * stepMs).toISOString().slice(0, 19);
      out.push({ snapshotTime: ts.replace(/-/g, "/").replace("T", " "), snapshotTimeUTC: ts, openPrice: point(open), closePrice: point(close), highPrice: point(high), lowPrice: point(low), lastTradedVolume: Math.round(rnd() * 5000) });
    }
    return out;
  }

  private positionView(p: { data: IgPosition["position"]; epic: string }): IgPosition {
    return { position: p.data, market: this.summary(this.market(p.epic)!) };
  }

  private unrealised(): number {
    let total = 0;
    for (const p of this.positions.filter((x) => x.accountId === this.accountId)) {
      const q = this.quote(this.market(p.epic)!);
      const exit = p.data.direction === "BUY" ? q.bid : q.offer;
      total += (p.data.direction === "BUY" ? exit - p.data.level : p.data.level - exit) * p.data.size;
    }
    return round(total, 2);
  }

  private openPosition(body: Record<string, any>): Response {
    const m = this.market(body.epic);
    if (!m) return igError(404, "error.service.marketdata.instrument.epic.unavailable");
    const direction = body.direction as Direction;
    if (m.status !== "TRADEABLE") return this.reject(m.epic, direction, "MARKET_CLOSED_WITH_EDITS");
    if (body.size < m.minDealSize) return this.reject(m.epic, direction, "MINIMUM_ORDER_SIZE_ERROR");
    if (body.stopDistance != null && body.stopDistance < m.minStopDistance) return this.reject(m.epic, direction, "ATTACHED_ORDER_LEVEL_ERROR");
    const q = this.quote(m);
    const level = direction === "BUY" ? q.offer : q.bid;
    const sign = direction === "BUY" ? -1 : 1;
    const stopLevel = body.stopLevel ?? (body.stopDistance != null ? round(level + sign * body.stopDistance, m.decimals) : null);
    const limitLevel = body.limitLevel ?? (body.limitDistance != null ? round(level - sign * body.limitDistance, m.decimals) : null);
    if (stopLevel != null && Math.abs(level - stopLevel) < m.minStopDistance) return this.reject(m.epic, direction, "ATTACHED_ORDER_LEVEL_ERROR");
    const dealId = `DIAAAA${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const ref = this.confirm({ epic: m.epic, direction, dealStatus: "ACCEPTED", reason: "SUCCESS", status: "OPEN", dealId, level, size: body.size, stopLevel, limitLevel, guaranteedStop: !!body.guaranteedStop });
    this.positions.push({ accountId: this.accountId, epic: m.epic, data: { contractSize: m.contractSize, createdDateUTC: new Date(this.now()).toISOString().slice(0, 19), dealId, dealReference: ref, size: body.size, direction, limitLevel, level, currency: body.currencyCode ?? "GBP", controlledRisk: !!body.guaranteedStop, stopLevel, trailingStep: null, trailingStopDistance: null } });
    return json(200, { dealReference: ref });
  }

  private closePosition(body: Record<string, any>): Response {
    const p = this.positions.find((x) => x.data.dealId === body.dealId && x.accountId === this.accountId);
    if (!p) return igError(404, "error.position.notfound");
    const m = this.market(p.epic)!;
    if (body.direction === p.data.direction) return this.reject(p.epic, body.direction, "POSITION_NOT_FOUND");
    if (m.status !== "TRADEABLE") return this.reject(p.epic, body.direction, "MARKET_CLOSED_WITH_EDITS");
    const size = Math.min(body.size, p.data.size);
    const q = this.quote(m);
    const level = p.data.direction === "BUY" ? q.bid : q.offer;
    const profit = round((p.data.direction === "BUY" ? level - p.data.level : p.data.level - level) * size, 2);
    p.data.size = round(p.data.size - size, 4);
    if (p.data.size <= 0) this.positions = this.positions.filter((x) => x !== p);
    const acct = this.accounts.find((a) => a.accountId === this.accountId)!;
    acct.balance.balance = round(acct.balance.balance + profit, 2);
    return json(200, { dealReference: this.confirm({ epic: p.epic, direction: body.direction, dealStatus: "ACCEPTED", reason: "SUCCESS", status: p.data.size <= 0 ? "CLOSED" : "PARTIALLY_CLOSED", dealId: p.data.dealId, level, size, profit, profitCurrency: "GBP" }) });
  }
}
