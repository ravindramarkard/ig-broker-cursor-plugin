import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AmendPositionRequest,
  ClosePositionRequest,
  CreateWorkingOrderRequest,
  OpenPositionRequest,
} from "../ig/types.js";

export type PendingAction =
  | { kind: "open_position"; request: OpenPositionRequest }
  | { kind: "close_position"; request: ClosePositionRequest }
  | { kind: "amend_position"; dealId: string; request: AmendPositionRequest }
  | { kind: "create_working_order"; request: CreateWorkingOrderRequest }
  | { kind: "cancel_working_order"; dealId: string };

export interface PendingTrade {
  token: string;
  action: PendingAction;
  summary: string;
  environment: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
}

export const CONFIRMATION_TTL_MS = 120_000;

/**
 * Single-use, short-lived confirmation tokens. A trade can only execute with a token
 * produced by a preview tool, and it executes exactly what was previewed.
 *
 * When `pendingDir` is set, each pending trade's human-readable summary is mirrored to
 * disk so the `beforeMCPExecution` hook can show it in Cursor's approval prompt.
 */
export class ConfirmationStore {
  private readonly pending = new Map<string, PendingTrade>();

  constructor(
    private readonly pendingDir: string | null,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = CONFIRMATION_TTL_MS,
  ) {}

  create(input: Omit<PendingTrade, "token" | "createdAt" | "expiresAt">): PendingTrade {
    this.sweep();
    const token = `igc_${randomBytes(16).toString("hex")}`;
    const createdAt = this.now();
    const trade: PendingTrade = { ...input, token, createdAt, expiresAt: createdAt + this.ttlMs };
    this.pending.set(token, trade);
    this.mirror(trade);
    return trade;
  }

  /** Removes the token whether or not it is still valid, so it can never be replayed. */
  consume(token: string): PendingTrade | { error: string } {
    const trade = this.pending.get(token);
    this.pending.delete(token);
    this.unmirror(token);
    if (!trade) {
      return {
        error:
          "Unknown, expired, or already-used confirmation token (tokens are single-use and only valid in the server session that issued them). Run a preview tool again.",
      };
    }
    if (this.now() > trade.expiresAt) {
      return { error: `Confirmation token expired (tokens are valid for ${Math.round(this.ttlMs / 1000)} seconds). Preview the trade again.` };
    }
    return trade;
  }

  size(): number {
    this.sweep();
    return this.pending.size;
  }

  clear(): void {
    for (const token of this.pending.keys()) this.unmirror(token);
    this.pending.clear();
  }

  private sweep(): void {
    const now = this.now();
    for (const [token, trade] of this.pending) {
      if (now > trade.expiresAt) {
        this.pending.delete(token);
        this.unmirror(token);
      }
    }
  }

  private mirror(trade: PendingTrade): void {
    if (!this.pendingDir) return;
    try {
      mkdirSync(this.pendingDir, { recursive: true, mode: 0o700 });
      const body = {
        token: trade.token,
        kind: trade.action.kind,
        summary: trade.summary,
        environment: trade.environment,
        accountId: trade.accountId,
        expiresAt: new Date(trade.expiresAt).toISOString(),
      };
      writeFileSync(join(this.pendingDir, `${trade.token}.json`), JSON.stringify(body, null, 2), { mode: 0o600 });
    } catch {
      // The hook falls back to a generic approval prompt.
    }
  }

  private unmirror(token: string): void {
    if (!this.pendingDir || !/^igc_[a-f0-9]{32}$/.test(token)) return;
    try {
      rmSync(join(this.pendingDir, `${token}.json`), { force: true });
    } catch {
      // Ignore.
    }
  }
}
