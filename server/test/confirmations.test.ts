import { describe, expect, it } from "vitest";
import { ConfirmationStore } from "../src/trading/confirmations.js";

const action = { kind: "cancel_working_order" as const, dealId: "D1" };

describe("ConfirmationStore", () => {
  it("expires tokens after the TTL", () => {
    let now = 1_000;
    const store = new ConfirmationStore(null, () => now, 120_000);
    const t = store.create({ action, summary: "x", environment: "mock", accountId: "A" });
    now += 120_001;
    expect(store.consume(t.token)).toEqual({ error: expect.stringMatching(/expired/) });
  });

  it("issues unique unguessable tokens", () => {
    const store = new ConfirmationStore(null);
    const tokens = new Set(Array.from({ length: 200 }, () => store.create({ action, summary: "x", environment: "mock", accountId: "A" }).token));
    expect(tokens.size).toBe(200);
  });
});
