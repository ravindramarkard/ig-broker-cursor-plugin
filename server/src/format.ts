import type { IgMarketDetails, IgMarketSummary, IgPosition, IgPricesResponse, IgWorkingOrder } from "./ig/types.js";

const r = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function market(m: IgMarketSummary) {
  return {
    epic: m.epic,
    name: m.instrumentName,
    type: m.instrumentType,
    expiry: m.expiry,
    status: m.marketStatus,
    bid: m.bid,
    offer: m.offer,
    spread: m.bid != null && m.offer != null ? r(m.offer - m.bid) : null,
    dayHigh: m.high ?? null,
    dayLow: m.low ?? null,
    dayChange: m.netChange ?? null,
    dayChangePct: m.percentageChange ?? null,
    delayMinutes: m.delayTime ?? 0,
    updated: m.updateTimeUTC ?? m.updateTime ?? null,
  };
}

export function position(p: IgPosition) {
  const { position: pos, market: mkt } = p;
  const exit = pos.direction === "BUY" ? mkt.bid : mkt.offer;
  const pnlPoints = exit == null ? null : r(pos.direction === "BUY" ? exit - pos.level : pos.level - exit);
  return {
    dealId: pos.dealId,
    epic: mkt.epic,
    instrument: mkt.instrumentName,
    direction: pos.direction,
    size: pos.size,
    openLevel: pos.level,
    currentExitPrice: exit,
    stopLevel: pos.stopLevel,
    limitLevel: pos.limitLevel,
    guaranteedStop: pos.controlledRisk,
    trailingStopDistance: pos.trailingStopDistance,
    pnlPoints,
    approxPnL: pnlPoints == null ? null : r(pnlPoints * pos.size * (pos.contractSize || 1), 2),
    currency: pos.currency,
    openedAtUtc: pos.createdDateUTC,
    marketStatus: mkt.marketStatus,
  };
}

export function workingOrder(w: IgWorkingOrder) {
  const d = w.workingOrderData;
  return {
    dealId: d.dealId,
    epic: d.epic,
    instrument: w.marketData.instrumentName,
    direction: d.direction,
    type: d.orderType,
    size: d.orderSize,
    level: d.orderLevel,
    stopDistance: d.stopDistance,
    limitDistance: d.limitDistance,
    guaranteedStop: d.guaranteedStop,
    timeInForce: d.timeInForce,
    goodTillDate: d.goodTillDateISO ?? d.goodTillDate,
    currency: d.currencyCode,
    createdAtUtc: d.createdDateUTC,
    currentBid: w.marketData.bid,
    currentOffer: w.marketData.offer,
  };
}

export function marketDetails(m: IgMarketDetails) {
  const rule = (x?: { unit: string; value: number }) => (x ? `${x.value} ${x.unit.toLowerCase()}` : null);
  return {
    epic: m.instrument.epic,
    name: m.instrument.name,
    type: m.instrument.type,
    expiry: m.instrument.expiry,
    status: m.snapshot.marketStatus,
    bid: m.snapshot.bid,
    offer: m.snapshot.offer,
    dayHigh: m.snapshot.high ?? null,
    dayLow: m.snapshot.low ?? null,
    dayChangePct: m.snapshot.percentageChange ?? null,
    delayMinutes: m.snapshot.delayTime ?? 0,
    currencies: m.instrument.currencies?.map((c) => c.code) ?? [],
    margin: m.instrument.marginFactor != null ? `${m.instrument.marginFactor}${m.instrument.marginFactorUnit === "PERCENTAGE" ? "%" : ` ${m.instrument.marginFactorUnit ?? ""}`}` : null,
    guaranteedStopAllowed: m.instrument.guaranteedStopAllowed ?? null,
    dealingRules: {
      minDealSize: rule(m.dealingRules.minDealSize),
      minStopOrLimitDistance: rule(m.dealingRules.minNormalStopOrLimitDistance),
      minGuaranteedStopDistance: rule(m.dealingRules.minControlledRiskStopDistance),
      maxStopOrLimitDistance: rule(m.dealingRules.maxStopOrLimitDistance),
      trailingStops: m.dealingRules.trailingStopsPreference ?? null,
    },
  };
}

const mid = (p: { bid: number | null; ask: number | null; lastTraded: number | null }) =>
  p.bid != null && p.ask != null ? r((p.bid + p.ask) / 2, 5) : (p.lastTraded ?? p.bid ?? p.ask);

export function candles(res: IgPricesResponse) {
  return {
    columns: ["timeUtc", "open", "high", "low", "close", "volume"],
    priceType: "mid",
    rows: res.prices.map((c) => [c.snapshotTimeUTC, mid(c.openPrice), mid(c.highPrice), mid(c.lowPrice), mid(c.closePrice), c.lastTradedVolume]),
    allowance: res.metadata?.allowance
      ? { remaining: res.metadata.allowance.remainingAllowance, total: res.metadata.allowance.totalAllowance }
      : undefined,
  };
}
