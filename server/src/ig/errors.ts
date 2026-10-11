const HINTS: Array<[RegExp, string]> = [
  [/invalid-details/, "IG rejected the username or password. Check IG_IDENTIFIER / IG_PASSWORD."],
  [/api-key-(invalid|missing|revoked)/, "The API key was rejected. Demo API keys only work with IG_ENVIRONMENT=demo, live keys only with live."],
  [/api-key-disabled/, "This API key is disabled. Re-enable it under My IG > Settings > API keys."],
  [/api-key-restricted/, "This API key is restricted from the requested operation."],
  [/exceeded-.*-allowance/, "IG rate limit reached. Wait a minute before retrying (historical price data has a weekly allowance)."],
  [/account-suspended|account-not-enabled/, "The IG account is suspended or not enabled for API access."],
  [/client-token|account-token|oauth-token/, "The IG session expired."],
  [/market-closed|MARKET_CLOSED/, "The market is closed."],
  [/insufficient-funds|INSUFFICIENT_FUNDS/, "Insufficient funds for this deal."],
];

export class IgApiError extends Error {
  readonly status: number;
  readonly errorCode: string | undefined;
  readonly hint: string | undefined;

  constructor(message: string, opts: { status: number; errorCode?: string }) {
    super(message);
    this.name = "IgApiError";
    this.status = opts.status;
    this.errorCode = opts.errorCode;
    this.hint = opts.errorCode ? HINTS.find(([re]) => re.test(opts.errorCode!))?.[1] : undefined;
  }

  get isSessionExpired(): boolean {
    return this.status === 401 && /client-token|account-token|oauth-token|security\.token/.test(this.errorCode ?? "");
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}
