import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Redactor } from "./redact.js";

export interface AuditEvent {
  event: "trade_previewed" | "trade_executed" | "trade_failed" | "trade_refused" | "account_switched";
  environment: string;
  accountId?: string;
  [key: string]: unknown;
}

/** Append-only JSON Lines log of every trading action the agent takes. */
export class AuditLog {
  constructor(
    private readonly path: string | null,
    private readonly redactor: Redactor,
  ) {}

  write(event: AuditEvent): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const line = JSON.stringify(this.redactor.value({ ts: new Date().toISOString(), ...event }));
      appendFileSync(this.path, line + "\n", { mode: 0o600 });
    } catch (err) {
      process.stderr.write(`[ig-broker] audit log write failed: ${(err as Error).message}\n`);
    }
  }
}
