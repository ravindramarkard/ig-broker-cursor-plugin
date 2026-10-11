import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfirmationStore } from "../src/trading/confirmations.js";

const HOOK = join(import.meta.dirname, "..", "..", "hooks", "ig-trade-approval.mjs");

function runHook(input: unknown, stateDir: string) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    env: { ...process.env, IG_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  expect(res.status).toBe(0);
  return JSON.parse(res.stdout);
}

describe("trade approval hook", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ighook-"));
  const store = new ConfirmationStore(join(stateDir, "pending"));

  it("asks the user with the server-side summary for a pending trade", () => {
    const trade = store.create({
      action: { kind: "cancel_working_order", dealId: "D1" },
      summary: "[LIVE ACC1] CANCEL working order BUY LIMIT 1 FTSE 100 at 8000 (deal D1).",
      environment: "live",
      accountId: "ACC1",
    });
    const out = runHook(
      { hook_event_name: "beforeMCPExecution", tool_name: "ig_execute_trade", tool_input: JSON.stringify({ confirmationToken: trade.token }) },
      stateDir,
    );
    expect(out.permission).toBe("ask");
    expect(out.user_message).toContain("LIVE MONEY");
    expect(out.user_message).toContain(trade.summary);
  });

  it("denies unknown or malformed tokens", () => {
    expect(runHook({ tool_name: "ig_execute_trade", tool_input: { confirmationToken: `igc_${"a".repeat(32)}` } }, stateDir).permission).toBe("deny");
    expect(runHook({ tool_name: "ig_execute_trade", tool_input: "{}" }, stateDir).permission).toBe("deny");
  });

  it("does not interfere with other tools", () => {
    expect(runHook({ tool_name: "ig_get_positions", tool_input: "{}" }, stateDir)).toEqual({});
  });
});
