import type { IgConfig } from "../config.js";
import type { Redactor } from "../redact.js";
import { ConfigError, IgApiError } from "./errors.js";
import type {
  AmendPositionRequest,
  ClosePositionRequest,
  CreateWorkingOrderRequest,
  IgAccount,
  IgDealConfirmation,
  IgMarketDetails,
  IgMarketSummary,
  IgPosition,
  IgPricesResponse,
  IgSessionResponse,
  IgWorkingOrder,
  OpenPositionRequest,
} from "./types.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface Session {
  cst: string;
  securityToken: string;
  accountId: string;
  accountType: string;
  currency: string;
  clientId: string;
  dealingEnabled: boolean;
  createdAt: number;
}

interface RequestOptions {
  version?: number;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** IG expects DELETE-with-body as a POST carrying a `_method: DELETE` header. */
  methodOverride?: "DELETE";
  auth?: boolean;
}

const REQUEST_TIMEOUT_MS = 20_000;

export class IgClient {
  private session: Session | null = null;
  private loggingIn: Promise<Session> | null = null;

  constructor(
    readonly config: IgConfig,
    private readonly redactor: Redactor,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get currentAccountId(): string | undefined {
    return this.session?.accountId;
  }

  private assertConfigured(): void {
    if (this.config.missingCredentials.length > 0) {
      throw new ConfigError(
        `IG credentials are not configured (missing ${this.config.missingCredentials.join(", ")}). ` +
          "Open Customize in the sidebar, select IG Broker, and edit the plugin settings. " +
          "Enter the API key, username, and password, and set Environment to demo, live, or mock.",
      );
    }
  }

  private async raw(method: string, path: string, opts: RequestOptions, session: Session | null): Promise<Response> {
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json; charset=UTF-8",
      "X-IG-API-KEY": this.config.apiKey ?? "mock-api-key",
      Version: String(opts.version ?? 1),
    };
    if (session) {
      headers.CST = session.cst;
      headers["X-SECURITY-TOKEN"] = session.securityToken;
    }
    if (opts.methodOverride) headers._method = opts.methodOverride;

    return this.fetchImpl(url.toString(), {
      method: opts.methodOverride ? "POST" : method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async toError(res: Response, method: string, path: string): Promise<IgApiError> {
    let errorCode: string | undefined;
    try {
      const data = (await res.json()) as { errorCode?: string };
      errorCode = data.errorCode;
    } catch {
      // Non-JSON error body.
    }
    const msg = this.redactor.text(`IG API ${method} ${path} failed with HTTP ${res.status}${errorCode ? ` (${errorCode})` : ""}`);
    return new IgApiError(msg, { status: res.status, errorCode });
  }

  async login(): Promise<Session> {
    this.assertConfigured();
    if (this.loggingIn) return this.loggingIn;
    this.loggingIn = (async () => {
      const res = await this.raw(
        "POST",
        "/session",
        { version: 2, body: { identifier: this.config.identifier, password: this.config.password } },
        null,
      );
      if (!res.ok) throw await this.toError(res, "POST", "/session");
      const cst = res.headers.get("CST");
      const securityToken = res.headers.get("X-SECURITY-TOKEN");
      if (!cst || !securityToken) {
        throw new IgApiError("IG login succeeded but no session tokens were returned", { status: res.status });
      }
      this.redactor.add(cst);
      this.redactor.add(securityToken);
      const data = (await res.json()) as IgSessionResponse;
      let session: Session = {
        cst,
        securityToken,
        accountId: data.currentAccountId,
        accountType: data.accountType,
        currency: data.currencyIsoCode,
        clientId: data.clientId,
        dealingEnabled: data.dealingEnabled ?? true,
        createdAt: Date.now(),
      };
      if (this.config.accountId && this.config.accountId !== session.accountId) {
        session = await this.switchSessionAccount(session, this.config.accountId);
      }
      this.session = session;
      return session;
    })();
    try {
      return await this.loggingIn;
    } finally {
      this.loggingIn = null;
    }
  }

  private async switchSessionAccount(session: Session, accountId: string): Promise<Session> {
    const res = await this.raw("PUT", "/session", { version: 1, body: { accountId, defaultAccount: false } }, session);
    if (!res.ok) {
      const err = await this.toError(res, "PUT", "/session");
      if (err.errorCode !== "error.switch.accountId-must-be-different") throw err;
    }
    const newSt = res.headers.get("X-SECURITY-TOKEN");
    if (newSt) this.redactor.add(newSt);
    let accountType = session.accountType;
    try {
      const body = (await res.clone().json()) as { accountType?: string };
      accountType = body.accountType ?? accountType;
    } catch {
      // Empty body.
    }
    return { ...session, accountId, accountType, securityToken: newSt ?? session.securityToken };
  }

  async logout(): Promise<void> {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    try {
      await this.raw("DELETE", "/session", { version: 1 }, session);
    } catch {
      // Best effort; tokens expire on their own.
    }
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    if (opts.auth === false) {
      const res = await this.raw(method, path, opts, null);
      if (!res.ok) throw await this.toError(res, method, path);
      return (await res.json()) as T;
    }
    this.assertConfigured();
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = this.session ?? (await this.login());
      const res = await this.raw(method, path, opts, session);
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      const err = await this.toError(res, opts.methodOverride ?? method, path);
      if (err.isSessionExpired && attempt === 0) {
        this.session = null;
        continue;
      }
      throw err;
    }
    throw new IgApiError("IG session could not be re-established", { status: 401 });
  }

  async sessionSummary() {
    const s = this.session ?? (await this.login());
    return {
      accountId: s.accountId,
      accountType: s.accountType,
      currency: s.currency,
      dealingEnabled: s.dealingEnabled,
      sessionAgeMinutes: Math.round((Date.now() - s.createdAt) / 60000),
    };
  }

  async listAccounts(): Promise<IgAccount[]> {
    return (await this.request<{ accounts: IgAccount[] }>("GET", "/accounts")).accounts;
  }

  async switchAccount(accountId: string): Promise<void> {
    const s = this.session ?? (await this.login());
    this.session = await this.switchSessionAccount(s, accountId);
  }

  async getPositions(): Promise<IgPosition[]> {
    return (await this.request<{ positions: IgPosition[] }>("GET", "/positions", { version: 2 })).positions;
  }

  async getPosition(dealId: string): Promise<IgPosition> {
    return this.request<IgPosition>("GET", `/positions/${encodeURIComponent(dealId)}`, { version: 2 });
  }

  async getWorkingOrders(): Promise<IgWorkingOrder[]> {
    return (await this.request<{ workingOrders: IgWorkingOrder[] }>("GET", "/workingorders", { version: 2 }))
      .workingOrders;
  }

  async searchMarkets(searchTerm: string): Promise<IgMarketSummary[]> {
    return (await this.request<{ markets: IgMarketSummary[] }>("GET", "/markets", { query: { searchTerm } })).markets;
  }

  async getMarket(epic: string): Promise<IgMarketDetails> {
    return this.request<IgMarketDetails>("GET", `/markets/${encodeURIComponent(epic)}`, { version: 3 });
  }

  async getPrices(
    epic: string,
    params: { resolution: string; max?: number; from?: string; to?: string },
  ): Promise<IgPricesResponse> {
    return this.request<IgPricesResponse>("GET", `/prices/${encodeURIComponent(epic)}`, {
      version: 3,
      query: { resolution: params.resolution, max: params.max, from: params.from, to: params.to, pageSize: 0 },
    });
  }

  async getActivity(params: { from: string; to?: string; pageSize?: number }) {
    return this.request<{ activities: unknown[] }>("GET", "/history/activity", {
      version: 3,
      query: { from: params.from, to: params.to, detailed: true, pageSize: params.pageSize ?? 50 },
    });
  }

  async getTransactions(params: { from: string; to?: string; type?: string; pageSize?: number }) {
    return this.request<{ transactions: unknown[] }>("GET", "/history/transactions", {
      version: 2,
      query: { from: params.from, to: params.to, type: params.type ?? "ALL", pageSize: params.pageSize ?? 50, pageNumber: 1 },
    });
  }

  async getWatchlists() {
    return (
      await this.request<{ watchlists: Array<{ id: string; name: string; editable: boolean; defaultSystemWatchlist: boolean }> }>(
        "GET",
        "/watchlists",
      )
    ).watchlists;
  }

  async getWatchlist(id: string): Promise<IgMarketSummary[]> {
    return (await this.request<{ markets: IgMarketSummary[] }>("GET", `/watchlists/${encodeURIComponent(id)}`)).markets;
  }

  async getConfirmation(dealReference: string): Promise<IgDealConfirmation> {
    return this.request<IgDealConfirmation>("GET", `/confirms/${encodeURIComponent(dealReference)}`);
  }

  /** Confirmations can 404 for a short moment after a deal is submitted. */
  async waitForConfirmation(dealReference: string, attempts = 5): Promise<IgDealConfirmation | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.getConfirmation(dealReference);
      } catch (err) {
        if (!(err instanceof IgApiError) || err.status !== 404) throw err;
        await this.sleep(400 * (i + 1));
      }
    }
    return null;
  }

  async openPosition(req: OpenPositionRequest): Promise<string> {
    return (await this.request<{ dealReference: string }>("POST", "/positions/otc", { version: 2, body: req })).dealReference;
  }

  async closePosition(req: ClosePositionRequest): Promise<string> {
    return (
      await this.request<{ dealReference: string }>("DELETE", "/positions/otc", {
        version: 1,
        body: req,
        methodOverride: "DELETE",
      })
    ).dealReference;
  }

  async amendPosition(dealId: string, req: AmendPositionRequest): Promise<string> {
    return (
      await this.request<{ dealReference: string }>("PUT", `/positions/otc/${encodeURIComponent(dealId)}`, {
        version: 2,
        body: req,
      })
    ).dealReference;
  }

  async createWorkingOrder(req: CreateWorkingOrderRequest): Promise<string> {
    return (await this.request<{ dealReference: string }>("POST", "/workingorders/otc", { version: 2, body: req }))
      .dealReference;
  }

  async deleteWorkingOrder(dealId: string): Promise<string> {
    return (
      await this.request<{ dealReference: string }>("DELETE", `/workingorders/otc/${encodeURIComponent(dealId)}`, {
        version: 2,
        body: {},
        methodOverride: "DELETE",
      })
    ).dealReference;
  }
}
