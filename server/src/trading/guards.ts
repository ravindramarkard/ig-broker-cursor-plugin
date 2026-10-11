import type { IgConfig } from "../config.js";
import { GuardError } from "../ig/errors.js";
import type { Direction, IgMarketDetails } from "../ig/types.js";

export interface OrderIntent {
  epic: string;
  direction: Direction;
  size: number;
  /** Reference entry price: current offer/bid for market orders, the order level for working orders. */
  entry: number;
  stopLevel?: number | null;
  stopDistance?: number | null;
  limitLevel?: number | null;
  limitDistance?: number | null;
  guaranteedStop?: boolean;
  trailingStop?: boolean;
  trailingStopIncrement?: number | null;
  requireTradeable: boolean;
}

export function assertTradingEnabled(config: IgConfig): void {
  if (!config.tradingEnabled) {
    throw new GuardError(
      "Trading is disabled for this plugin. The account owner must set IG_TRADING_ENABLED=true in the plugin configuration.",
    );
  }
}

export function assertEpicAllowed(config: IgConfig, epic: string): void {
  if (config.allowedEpics && !config.allowedEpics.includes(epic.toUpperCase())) {
    throw new GuardError(`${epic} is not in IG_ALLOWED_EPICS (${config.allowedEpics.join(", ")}).`);
  }
}

function points(rule?: { unit: string; value: number }): number | null {
  return rule && rule.unit === "POINTS" ? rule.value : null;
}

/** Returns the effective stop distance in points (or null when no stop is set). */
export function validateOrder(config: IgConfig, market: IgMarketDetails, o: OrderIntent): { stopDistance: number | null } {
  const problems: string[] = [];
  assertTradingEnabled(config);
  assertEpicAllowed(config, o.epic);

  if (!(o.size > 0)) problems.push("Size must be greater than zero.");
  if (o.size > config.maxDealSize) {
    problems.push(`Size ${o.size} exceeds the configured maximum deal size (IG_MAX_DEAL_SIZE=${config.maxDealSize}).`);
  }
  const minSize = market.dealingRules.minDealSize?.value;
  if (minSize != null && o.size < minSize) problems.push(`Size ${o.size} is below IG's minimum deal size of ${minSize}.`);

  if (o.requireTradeable && market.snapshot.marketStatus !== "TRADEABLE") {
    problems.push(`Market is ${market.snapshot.marketStatus}, not TRADEABLE.`);
  }

  if (o.stopLevel != null && o.stopDistance != null) problems.push("Set either stopLevel or stopDistance, not both.");
  if (o.limitLevel != null && o.limitDistance != null) problems.push("Set either limitLevel or limitDistance, not both.");

  let stopDistance: number | null = o.stopDistance ?? null;
  if (o.stopLevel != null) {
    const wrongSide = o.direction === "BUY" ? o.stopLevel >= o.entry : o.stopLevel <= o.entry;
    if (wrongSide) problems.push(`A ${o.direction} stop must be ${o.direction === "BUY" ? "below" : "above"} the entry price ${o.entry}.`);
    stopDistance = Math.abs(o.entry - o.stopLevel);
  }
  if (o.limitLevel != null) {
    const wrongSide = o.direction === "BUY" ? o.limitLevel <= o.entry : o.limitLevel >= o.entry;
    if (wrongSide) problems.push(`A ${o.direction} limit must be ${o.direction === "BUY" ? "above" : "below"} the entry price ${o.entry}.`);
  }

  if (config.requireStopLoss && stopDistance == null) {
    problems.push("A stop loss is required (IG_REQUIRE_STOP_LOSS=true). Provide stopLevel or stopDistance.");
  }

  const minStop = o.guaranteedStop
    ? points(market.dealingRules.minControlledRiskStopDistance)
    : points(market.dealingRules.minNormalStopOrLimitDistance);
  if (stopDistance != null && minStop != null && stopDistance < minStop) {
    problems.push(`Stop distance ${round(stopDistance)} is below the minimum of ${minStop} points for this market.`);
  }

  if (o.guaranteedStop && stopDistance == null) problems.push("A guaranteed stop needs stopLevel or stopDistance.");
  if (o.trailingStop) {
    if (o.guaranteedStop) problems.push("Trailing stops cannot be guaranteed.");
    if (o.stopDistance == null || o.trailingStopIncrement == null) {
      problems.push("Trailing stops need stopDistance and trailingStopIncrement.");
    }
  }

  if (problems.length) throw new GuardError(`Order rejected by plugin safety checks:\n- ${problems.join("\n- ")}`);
  return { stopDistance };
}

export function round(n: number, d = 4): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}
