import { homedir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "./audit.js";
import { type IgConfig, secretsOf } from "./config.js";
import { type FetchLike, IgClient } from "./ig/client.js";
import { MockIgApi } from "./ig/mock.js";
import { Redactor } from "./redact.js";
import { createServer } from "./server.js";
import { ConfirmationStore } from "./trading/confirmations.js";

export interface RuntimeOptions {
  /** Directory for the audit log and pending-trade files. `null` disables both. */
  stateDir?: string | null;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export function defaultStateDir(): string {
  return process.env.IG_STATE_DIR || join(homedir(), ".cursor", "ig-broker");
}

export function createRuntime(input: IgConfig, opts: RuntimeOptions = {}) {
  const config: IgConfig =
    input.environment === "mock"
      ? { ...input, identifier: input.identifier ?? "mock-user", password: input.password ?? "mock-password", missingCredentials: [] }
      : input;
  const stateDir = opts.stateDir === undefined ? defaultStateDir() : opts.stateDir;
  const redactor = new Redactor(secretsOf(config));
  const mock = config.environment === "mock" && !opts.fetch ? new MockIgApi() : null;
  const client = new IgClient(config, redactor, opts.fetch ?? mock?.fetch ?? fetch, opts.sleep);
  const confirmations = new ConfirmationStore(stateDir ? join(stateDir, "pending") : null, Date.now, config.confirmationTtlMs);
  const audit = new AuditLog(stateDir ? join(stateDir, "audit.jsonl") : null, redactor);
  const server = createServer({ config, client, redactor, confirmations, audit });
  return { config, client, server, confirmations, redactor, stateDir };
}
