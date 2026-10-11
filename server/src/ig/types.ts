// Subset of the IG REST API (https://labs.ig.com/rest-trading-api-reference) used by this plugin.

export type Direction = "BUY" | "SELL";

export interface IgBalance {
  balance: number;
  deposit: number;
  profitLoss: number;
  available: number;
}

export interface IgSessionResponse {
  accountType: string;
  accountInfo: IgBalance;
  currencyIsoCode: string;
  currencySymbol?: string;
  currentAccountId: string;
  lightstreamerEndpoint?: string;
  clientId: string;
  timezoneOffset?: number;
  dealingEnabled?: boolean;
  accounts?: Array<{ accountId: string; accountName: string; preferred: boolean; accountType: string }>;
}

export interface IgAccount {
  accountId: string;
  accountName: string;
  accountAlias?: string | null;
  status: string;
  accountType: string;
  preferred: boolean;
  balance: IgBalance;
  currency: string;
  canTransferFrom?: boolean;
  canTransferTo?: boolean;
}

export interface IgMarketSummary {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  expiry: string;
  high?: number | null;
  low?: number | null;
  percentageChange?: number | null;
  netChange?: number | null;
  updateTime?: string | null;
  updateTimeUTC?: string | null;
  bid: number | null;
  offer: number | null;
  delayTime?: number;
  streamingPricesAvailable?: boolean;
  marketStatus: string;
  scalingFactor?: number;
  lotSize?: number;
}

export interface IgPosition {
  position: {
    contractSize: number;
    createdDate?: string;
    createdDateUTC: string;
    dealId: string;
    dealReference: string;
    size: number;
    direction: Direction;
    limitLevel: number | null;
    level: number;
    currency: string;
    controlledRisk: boolean;
    stopLevel: number | null;
    trailingStep: number | null;
    trailingStopDistance: number | null;
    limitedRiskPremium?: number | null;
  };
  market: IgMarketSummary;
}

export interface IgWorkingOrder {
  workingOrderData: {
    dealId: string;
    direction: Direction;
    epic: string;
    orderSize: number;
    orderLevel: number;
    timeInForce: string;
    goodTillDate: string | null;
    goodTillDateISO?: string | null;
    createdDate?: string;
    createdDateUTC: string;
    guaranteedStop: boolean;
    orderType: "LIMIT" | "STOP";
    stopDistance: number | null;
    limitDistance: number | null;
    currencyCode: string;
    dma?: boolean;
  };
  marketData: IgMarketSummary;
}

export interface IgMarketDetails {
  instrument: {
    epic: string;
    name: string;
    expiry: string;
    type: string;
    lotSize?: number;
    unit?: string;
    marketId?: string;
    currencies?: Array<{ code: string; symbol?: string; isDefault: boolean }>;
    marginFactor?: number;
    marginFactorUnit?: string;
    openingHours?: { marketTimes: Array<{ openTime: string; closeTime: string }> } | null;
    guaranteedStopAllowed?: boolean;
    streamingPricesAvailable?: boolean;
  };
  dealingRules: {
    minDealSize?: { unit: string; value: number };
    minNormalStopOrLimitDistance?: { unit: string; value: number };
    minControlledRiskStopDistance?: { unit: string; value: number };
    maxStopOrLimitDistance?: { unit: string; value: number };
    minStepDistance?: { unit: string; value: number };
    marketOrderPreference?: string;
    trailingStopsPreference?: string;
  };
  snapshot: {
    marketStatus: string;
    netChange?: number | null;
    percentageChange?: number | null;
    updateTime?: string | null;
    delayTime?: number;
    bid: number | null;
    offer: number | null;
    high?: number | null;
    low?: number | null;
    decimalPlacesFactor?: number;
    scalingFactor?: number;
  };
}

export interface IgPricePoint {
  bid: number | null;
  ask: number | null;
  lastTraded: number | null;
}

export interface IgPricesResponse {
  prices: Array<{
    snapshotTime?: string;
    snapshotTimeUTC: string;
    openPrice: IgPricePoint;
    closePrice: IgPricePoint;
    highPrice: IgPricePoint;
    lowPrice: IgPricePoint;
    lastTradedVolume: number | null;
  }>;
  instrumentType: string;
  metadata?: {
    allowance?: { remainingAllowance: number; totalAllowance: number; allowanceExpiry: number };
    size?: number;
  };
}

export interface IgDealConfirmation {
  date: string;
  dealStatus: "ACCEPTED" | "REJECTED";
  status: string | null;
  reason: string;
  epic: string;
  expiry: string | null;
  dealReference: string;
  dealId: string;
  affectedDeals?: Array<{ dealId: string; status: string }>;
  level: number | null;
  size: number | null;
  direction: Direction;
  stopLevel: number | null;
  limitLevel: number | null;
  stopDistance?: number | null;
  limitDistance?: number | null;
  guaranteedStop: boolean;
  trailingStop?: boolean;
  profit?: number | null;
  profitCurrency?: string | null;
}

export interface OpenPositionRequest {
  epic: string;
  expiry: string;
  direction: Direction;
  size: number;
  orderType: "MARKET" | "LIMIT";
  level?: number | null;
  timeInForce?: "FILL_OR_KILL" | "EXECUTE_AND_ELIMINATE";
  guaranteedStop: boolean;
  forceOpen: boolean;
  stopLevel?: number | null;
  stopDistance?: number | null;
  limitLevel?: number | null;
  limitDistance?: number | null;
  trailingStop?: boolean;
  trailingStopIncrement?: number | null;
  currencyCode: string;
}

export interface ClosePositionRequest {
  dealId: string;
  direction: Direction;
  size: number;
  orderType: "MARKET";
}

export interface AmendPositionRequest {
  stopLevel: number | null;
  limitLevel: number | null;
  guaranteedStop?: boolean;
  trailingStop?: boolean;
  trailingStopDistance?: number | null;
  trailingStopIncrement?: number | null;
}

export interface CreateWorkingOrderRequest {
  epic: string;
  expiry: string;
  direction: Direction;
  size: number;
  level: number;
  type: "LIMIT" | "STOP";
  currencyCode: string;
  timeInForce: "GOOD_TILL_CANCELLED" | "GOOD_TILL_DATE";
  goodTillDate?: string | null;
  guaranteedStop: boolean;
  forceOpen: boolean;
  stopLevel?: number | null;
  stopDistance?: number | null;
  limitLevel?: number | null;
  limitDistance?: number | null;
}
