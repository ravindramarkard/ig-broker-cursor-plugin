import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connect } from "./helpers.js";

const TRADING = { IG_TRADING_ENABLED: "true", IG_MAX_DEAL_SIZE: "2" };
const TRADING_TOOLS = [
  "ig_preview_open_position",
  "ig_preview_close_position",
  "ig_preview_amend_position",
  "ig_preview_working_order",
  "ig_preview_cancel_working_order",
  "ig_execute_trade",
];

describe("read-only mode (default)", () => {
  it("exposes only read tools", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("ig_get_positions");
    for (const t of TRADING_TOOLS) expect(names).not.toContain(t);
    for (const t of (await client.listTools()).tools) {
      if (t.name !== "ig_switch_account") expect(t.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("returns an account overview flagged as simulated", async () => {
    const { call } = await connect();
    const { data, isError } = await call("ig_account_overview");
    expect(isError).toBe(false);
    expect(data.environment).toBe("mock");
    expect(data.notice).toMatch(/SIMULATED/);
    expect(data.account.id).toBe("MOCK-SB-001");
    expect(data.openPositions).toBe(2);
    expect(data.safety).toMatchObject({ tradingEnabled: false, requireStopLoss: true });
  });

  it("searches markets, fetches details and candles", async () => {
    const { call } = await connect();
    const search = await call("ig_search_markets", { query: "ftse" });
    expect(search.data.markets[0].epic).toBe("IX.D.FTSE.DAILY.IP");
    const details = await call("ig_get_market", { epic: "IX.D.FTSE.DAILY.IP" });
    expect(details.data.dealingRules.minStopOrLimitDistance).toBe("4 points");
    const prices = await call("ig_get_prices", { epic: "IX.D.FTSE.DAILY.IP", resolution: "DAY", max: 30 });
    expect(prices.data.rows).toHaveLength(30);
    expect(prices.data.columns).toEqual(["timeUtc", "open", "high", "low", "close", "volume"]);
  });

  it("lists positions with P&L, working orders, watchlists and history", async () => {
    const { call } = await connect();
    const pos = await call("ig_get_positions");
    expect(pos.data.positions).toHaveLength(2);
    expect(typeof pos.data.positions[0].approxPnL).toBe("number");
    expect((await call("ig_get_working_orders")).data.workingOrders).toHaveLength(1);
    expect((await call("ig_get_watchlists")).data.watchlists).toHaveLength(2);
    expect((await call("ig_get_watchlists", { watchlistId: "MOCKWL2" })).data.markets).toHaveLength(2);
    expect((await call("ig_get_transactions", { days: 30 })).data.transactions.length).toBeGreaterThan(0);
  });

  it("rejects malformed epics before calling IG", async () => {
    const { call } = await connect();
    const res = await call("ig_get_market", { epic: "../../session" });
    expect(res.isError).toBe(true);
  });

  it("returns setup instructions when credentials are missing", async () => {
    const { call } = await connect({ IG_ENVIRONMENT: "demo" });
    const res = await call("ig_list_accounts");
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing IG_API_KEY, IG_IDENTIFIER, IG_PASSWORD/);
  });
});

describe("trading mode", () => {
  it("previews then executes a market order exactly once", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "igstate-"));
    const { call } = await connect(TRADING, { stateDir });
    const preview = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", size: 1, stopDistance: 20, limitDistance: 40 });
    expect(preview.isError).toBe(false);
    expect(preview.data.status).toMatch(/PREVIEW_ONLY/);
    expect(preview.data.summary).toMatch(/OPEN BUY 1 FTSE 100/);
    const token = preview.data.confirmationToken;
    expect(token).toMatch(/^igc_[a-f0-9]{32}$/);

    const pending = JSON.parse(readFileSync(join(stateDir, "pending", `${token}.json`), "utf8"));
    expect(pending.summary).toBe(preview.data.summary);

    // Nothing has been sent yet.
    expect((await call("ig_get_positions")).data.positions).toHaveLength(2);

    const exec = await call("ig_execute_trade", { confirmationToken: token });
    expect(exec.isError).toBe(false);
    expect(exec.data.dealStatus).toBe("ACCEPTED");
    expect(exec.data.stopLevel).toBeLessThan(exec.data.level);
    expect((await call("ig_get_positions")).data.positions).toHaveLength(3);
    expect(existsSync(join(stateDir, "pending", `${token}.json`))).toBe(false);

    const replay = await call("ig_execute_trade", { confirmationToken: token });
    expect(replay.isError).toBe(true);
    expect(replay.text).toMatch(/already-used/);

    const audit = readFileSync(join(stateDir, "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(audit.map((e) => e.event)).toEqual(["trade_previewed", "trade_executed", "trade_refused"]);
  });

  it("enforces max size, stop-loss requirement and stop side", async () => {
    const { call } = await connect(TRADING);
    const big = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", size: 5, stopDistance: 20 });
    expect(big.isError).toBe(true);
    expect(big.text).toMatch(/exceeds the configured maximum/);

    const noStop = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "SELL", size: 1 });
    expect(noStop.text).toMatch(/stop loss is required/);

    const wrongSide = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", size: 1, stopLevel: 99999 });
    expect(wrongSide.text).toMatch(/must be below/);

    const tooTight = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", size: 1, stopDistance: 1 });
    expect(tooTight.text).toMatch(/below the minimum of 4 points/);

    const closed = await call("ig_preview_open_position", { epic: "IX.D.NIKKEI.DAILY.IP", direction: "BUY", size: 1, stopDistance: 100 });
    expect(closed.isError).toBe(true);
  });

  it("enforces the epic allowlist", async () => {
    const { call } = await connect({ ...TRADING, IG_ALLOWED_EPICS: "CS.D.EURUSD.TODAY.IP" });
    const res = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", size: 1, stopDistance: 20 });
    expect(res.text).toMatch(/not in IG_ALLOWED_EPICS/);
  });

  it("closes a position fully with realised P&L", async () => {
    const { call } = await connect(TRADING);
    const preview = await call("ig_preview_close_position", { dealId: "DIAAAAMOCKFTSE01" });
    expect(preview.data.summary).toMatch(/CLOSE ALL: SELL 2 of BUY 2 FTSE 100/);
    const exec = await call("ig_execute_trade", { confirmationToken: preview.data.confirmationToken });
    expect(exec.data.status).toBe("CLOSED");
    expect(typeof exec.data.profit).toBe("number");
    expect((await call("ig_get_positions")).data.positions).toHaveLength(1);
  });

  it("amends a stop but refuses to remove it while stops are required", async () => {
    const { call } = await connect(TRADING);
    const remove = await call("ig_preview_amend_position", { dealId: "DIAAAAMOCKFTSE01", stopLevel: null });
    expect(remove.text).toMatch(/Removing the stop loss is not allowed/);
    const amend = await call("ig_preview_amend_position", { dealId: "DIAAAAMOCKFTSE01", stopLevel: 8200 });
    expect(amend.data.summary).toMatch(/stop 8180 -> 8200/);
    const exec = await call("ig_execute_trade", { confirmationToken: amend.data.confirmationToken });
    expect(exec.data.stopLevel).toBe(8200);
  });

  it("validates working order side and cancels orders", async () => {
    const { call } = await connect(TRADING);
    const bad = await call("ig_preview_working_order", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", type: "LIMIT", size: 1, level: 99999, stopDistance: 20 });
    expect(bad.text).toMatch(/must be below the current offer/);
    const good = await call("ig_preview_working_order", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", type: "LIMIT", size: 1, level: 8000, stopDistance: 20 });
    expect(good.isError).toBe(false);
    expect((await call("ig_execute_trade", { confirmationToken: good.data.confirmationToken })).data.dealStatus).toBe("ACCEPTED");
    expect((await call("ig_get_working_orders")).data.workingOrders).toHaveLength(2);

    const cancel = await call("ig_preview_cancel_working_order", { dealId: "DIAAAAMOCKWO0001" });
    await call("ig_execute_trade", { confirmationToken: cancel.data.confirmationToken });
    expect((await call("ig_get_working_orders")).data.workingOrders).toHaveLength(1);
  });

  it("invalidates previews when the active account changes", async () => {
    const { call } = await connect(TRADING);
    const preview = await call("ig_preview_open_position", { epic: "CS.D.EURUSD.TODAY.IP", direction: "SELL", size: 1, stopDistance: 10 });
    await call("ig_switch_account", { accountId: "MOCK-CFD-002" });
    const exec = await call("ig_execute_trade", { confirmationToken: preview.data.confirmationToken });
    expect(exec.isError).toBe(true);
    expect((await call("ig_account_overview")).data.account.id).toBe("MOCK-CFD-002");
  });

  it("rejects tokens that were never issued", async () => {
    const { call } = await connect(TRADING);
    const res = await call("ig_execute_trade", { confirmationToken: `igc_${"0".repeat(32)}` });
    expect(res.isError).toBe(true);
  });
});
