import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { IgClient, type FetchLike } from "../src/ig/client.js";
import { ConfigError, IgApiError } from "../src/ig/errors.js";
import { Redactor } from "../src/redact.js";

const creds = {
  IG_CONFIG_FILE: "/nonexistent",
  IG_API_KEY: "apikey-SECRET-123",
  IG_IDENTIFIER: "trader-joe",
  IG_PASSWORD: "hunter2-SECRET",
};

function recorder(handler: (url: URL, init: RequestInit, n: number) => Response) {
  const calls: Array<{ url: URL; init: RequestInit; headers: Headers }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init, headers: new Headers(init.headers) });
    return handler(u, init, calls.length);
  };
  return { calls, fetchImpl };
}

const loginOk = () =>
  new Response(
    JSON.stringify({ accountType: "SPREADBET", accountInfo: { balance: 1, deposit: 0, profitLoss: 0, available: 1 }, currencyIsoCode: "GBP", currentAccountId: "ACC1", clientId: "C1" }),
    { status: 200, headers: { CST: "cst-token-abc", "X-SECURITY-TOKEN": "xst-token-def" } },
  );

describe("IgClient", () => {
  it("refuses to call IG without credentials", async () => {
    const config = loadConfig({ IG_CONFIG_FILE: "/nonexistent" });
    const client = new IgClient(config, new Redactor(), async () => new Response("{}"));
    await expect(client.listAccounts()).rejects.toBeInstanceOf(ConfigError);
  });

  it("logs in with v2 and sends session headers to the demo gateway", async () => {
    const { calls, fetchImpl } = recorder((url) =>
      url.pathname.endsWith("/session") ? loginOk() : new Response(JSON.stringify({ accounts: [] }), { status: 200 }),
    );
    const client = new IgClient(loadConfig(creds), new Redactor(), fetchImpl);
    await client.listAccounts();
    expect(calls[0]!.url.toString()).toBe("https://demo-api.ig.com/gateway/deal/session");
    expect(calls[0]!.headers.get("Version")).toBe("2");
    expect(calls[0]!.headers.get("X-IG-API-KEY")).toBe("apikey-SECRET-123");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ identifier: "trader-joe", password: "hunter2-SECRET" });
    expect(calls[1]!.headers.get("CST")).toBe("cst-token-abc");
    expect(calls[1]!.headers.get("X-SECURITY-TOKEN")).toBe("xst-token-def");
  });

  it("re-authenticates once when the session token expires", async () => {
    let accountsCalls = 0;
    const { calls, fetchImpl } = recorder((url) => {
      if (url.pathname.endsWith("/session")) return loginOk();
      accountsCalls++;
      return accountsCalls === 1
        ? new Response(JSON.stringify({ errorCode: "error.security.client-token-invalid" }), { status: 401 })
        : new Response(JSON.stringify({ accounts: [{ accountId: "ACC1" }] }), { status: 200 });
    });
    const client = new IgClient(loadConfig(creds), new Redactor(), fetchImpl);
    const accounts = await client.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(calls.filter((c) => c.url.pathname.endsWith("/session"))).toHaveLength(2);
  });

  it("uses POST + _method: DELETE to close positions", async () => {
    const { calls, fetchImpl } = recorder((url) =>
      url.pathname.endsWith("/session") ? loginOk() : new Response(JSON.stringify({ dealReference: "REF1" }), { status: 200 }),
    );
    const client = new IgClient(loadConfig(creds), new Redactor(), fetchImpl);
    await client.closePosition({ dealId: "D1", direction: "SELL", size: 1, orderType: "MARKET" });
    const close = calls[1]!;
    expect(close.init.method).toBe("POST");
    expect(close.headers.get("_method")).toBe("DELETE");
    expect(close.url.pathname).toBe("/gateway/deal/positions/otc");
  });

  it("maps IG error codes to hints and never leaks secrets", async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ errorCode: "error.security.invalid-details" }), { status: 401 }));
    const redactor = new Redactor([creds.IG_API_KEY, creds.IG_PASSWORD]);
    const client = new IgClient(loadConfig(creds), redactor, fetchImpl);
    const err = (await client.listAccounts().catch((e) => e)) as IgApiError;
    expect(err).toBeInstanceOf(IgApiError);
    expect(err.hint).toMatch(/username or password/);
    expect(err.message).not.toContain("SECRET");
  });

  it("polls for deal confirmations that are not ready yet", async () => {
    let n = 0;
    const { fetchImpl } = recorder((url) => {
      if (url.pathname.endsWith("/session")) return loginOk();
      n++;
      return n < 3
        ? new Response(JSON.stringify({ errorCode: "error.confirms.deal-not-found" }), { status: 404 })
        : new Response(JSON.stringify({ dealStatus: "ACCEPTED", dealReference: "R" }), { status: 200 });
    });
    const client = new IgClient(loadConfig(creds), new Redactor(), fetchImpl, async () => {});
    const c = await client.waitForConfirmation("R");
    expect(c?.dealStatus).toBe("ACCEPTED");
  });
});

describe("Redactor", () => {
  it("masks secrets in strings and sensitive keys in objects", () => {
    const r = new Redactor(["s3cr3t-key"]);
    r.add("cst-xyz");
    expect(r.text("key=s3cr3t-key cst=cst-xyz")).toBe("key=[REDACTED] cst=[REDACTED]");
    expect(r.value({ password: "x", nested: [{ CST: "abc", ok: "s3cr3t-key!" }] })).toEqual({
      password: "[REDACTED]",
      nested: [{ CST: "[REDACTED]", ok: "[REDACTED]!" }],
    });
  });
});
