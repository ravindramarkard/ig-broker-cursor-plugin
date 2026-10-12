import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clean, loadConfig, parseEnvFile } from "../src/config.js";

const NO_FILE = { IG_CONFIG_FILE: "/nonexistent/config.env" };

describe("config", () => {
  it("treats unresolved ${VAR} placeholders as unset", () => {
    expect(clean("${IG_ACCOUNT_ID}")).toBeUndefined();
    expect(clean("${env:IG_API_KEY}")).toBeUndefined();
    expect(clean("${user_config.IG_ENVIRONMENT}")).toBeUndefined();
    expect(clean("  ")).toBeUndefined();
    expect(clean(" ABC ")).toBe("ABC");
  });

  it("defaults to demo, read-only, stop required, max size 1", () => {
    const c = loadConfig({ ...NO_FILE });
    expect(c.environment).toBe("demo");
    expect(c.baseUrl).toBe("https://demo-api.ig.com/gateway/deal");
    expect(c.tradingEnabled).toBe(false);
    expect(c.requireStopLoss).toBe(true);
    expect(c.maxDealSize).toBe(1);
    expect(c.missingCredentials).toEqual(["IG_API_KEY", "IG_IDENTIFIER", "IG_PASSWORD"]);
  });

  it("parses live trading settings and allowlist", () => {
    const c = loadConfig({
      ...NO_FILE,
      IG_ENVIRONMENT: "LIVE",
      IG_API_KEY: "k".repeat(20),
      IG_IDENTIFIER: "me",
      IG_PASSWORD: "pw123",
      IG_TRADING_ENABLED: "true",
      IG_MAX_DEAL_SIZE: "2.5",
      IG_ALLOWED_EPICS: " ix.d.ftse.daily.ip, CS.D.EURUSD.TODAY.IP ,",
      IG_REQUIRE_STOP_LOSS: "false",
      IG_ACCOUNT_ID: "${IG_ACCOUNT_ID}",
    });
    expect(c.environment).toBe("live");
    expect(c.baseUrl).toBe("https://api.ig.com/gateway/deal");
    expect(c.tradingEnabled).toBe(true);
    expect(c.maxDealSize).toBe(2.5);
    expect(c.allowedEpics).toEqual(["IX.D.FTSE.DAILY.IP", "CS.D.EURUSD.TODAY.IP"]);
    expect(c.requireStopLoss).toBe(false);
    expect(c.accountId).toBeUndefined();
    expect(c.missingCredentials).toEqual([]);
  });

  it("rejects nonsense numeric limits", () => {
    const c = loadConfig({ ...NO_FILE, IG_MAX_DEAL_SIZE: "-4", IG_CONFIRMATION_TTL_SECONDS: "86400" });
    expect(c.maxDealSize).toBe(1);
    expect(c.confirmationTtlMs).toBe(120_000);
    expect(c.warnings.join()).toMatch(/IG_MAX_DEAL_SIZE/);
    expect(c.warnings.join()).toMatch(/IG_CONFIRMATION_TTL_SECONDS/);
  });

  it("accepts a bounded confirmation TTL", () => {
    expect(loadConfig({ ...NO_FILE }).confirmationTtlMs).toBe(120_000);
    expect(loadConfig({ ...NO_FILE, IG_CONFIRMATION_TTL_SECONDS: "600" }).confirmationTtlMs).toBe(600_000);
  });

  it("parses env files", () => {
    expect(parseEnvFile(`# comment\nexport IG_API_KEY="abc def"\nIG_PASSWORD='p#w'\nIG_ENVIRONMENT=demo # trailing\n`)).toEqual({
      IG_API_KEY: "abc def",
      IG_PASSWORD: "p#w",
      IG_ENVIRONMENT: "demo",
    });
  });

  it("falls back to the config file, with plugin variables taking precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "igcfg-"));
    const file = join(dir, "config.env");
    writeFileSync(file, "IG_API_KEY=fromfile\nIG_IDENTIFIER=fileuser\nIG_PASSWORD=filepass\n");
    chmodSync(file, 0o644);
    const c = loadConfig({ IG_CONFIG_FILE: file, IG_IDENTIFIER: "envuser" });
    expect(c.apiKey).toBe("fromfile");
    expect(c.identifier).toBe("envuser");
    expect(c.configFile).toBe(file);
    if (process.platform !== "win32") expect(c.warnings.join()).toMatch(/chmod 600/);
  });
});
