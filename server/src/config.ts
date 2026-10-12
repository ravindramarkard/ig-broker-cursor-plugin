import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type IgEnvironment = "demo" | "live" | "mock";

export interface IgConfig {
  environment: IgEnvironment;
  baseUrl: string;
  apiKey?: string;
  identifier?: string;
  password?: string;
  accountId?: string;
  tradingEnabled: boolean;
  maxDealSize: number;
  allowedEpics: string[] | null;
  requireStopLoss: boolean;
  confirmationTtlMs: number;
  missingCredentials: string[];
  configFile?: string;
  warnings: string[];
}

export const BASE_URLS: Record<IgEnvironment, string> = {
  live: "https://api.ig.com/gateway/deal",
  demo: "https://demo-api.ig.com/gateway/deal",
  mock: "https://mock.ig.invalid/gateway/deal",
};

export const DEFAULT_CONFIG_FILE = join(homedir(), ".cursor", "ig-broker", "config.env");

const KNOWN_KEYS = [
  "IG_API_KEY",
  "IG_IDENTIFIER",
  "IG_PASSWORD",
  "IG_ENVIRONMENT",
  "IG_ACCOUNT_ID",
  "IG_TRADING_ENABLED",
  "IG_MAX_DEAL_SIZE",
  "IG_ALLOWED_EPICS",
  "IG_REQUIRE_STOP_LOSS",
  "IG_CONFIRMATION_TTL_SECONDS",
] as const;

type Env = Record<string, string | undefined>;

/**
 * Cursor substitutes `${VAR}` placeholders from plugin variables. When a variable
 * has no value the literal placeholder can reach us, so treat it as unset.
 */
export function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || /^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

export function parseEnvFile(text: string): Env {
  const out: Env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    out[key] = value;
  }
  return out;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadConfigFile(path: string, warnings: string[]): Env {
  if (!existsSync(path)) return {};
  try {
    if (process.platform !== "win32") {
      const mode = statSync(path).mode & 0o777;
      if (mode & 0o077) {
        warnings.push(
          `Config file ${path} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 "${path}"`,
        );
      }
    }
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch (err) {
    warnings.push(`Could not read config file ${path}: ${(err as Error).message}`);
    return {};
  }
}

export function loadConfig(env: Env = process.env): IgConfig {
  const warnings: string[] = [];
  const configFile = clean(env.IG_CONFIG_FILE) ?? DEFAULT_CONFIG_FILE;
  const fileEnv = loadConfigFile(configFile, warnings);

  // Values supplied by Cursor (plugin variables) win over the local config file.
  const get = (key: (typeof KNOWN_KEYS)[number]) => clean(env[key]) ?? clean(fileEnv[key]);

  const envName = (get("IG_ENVIRONMENT") ?? "demo").toLowerCase();
  let environment: IgEnvironment = "demo";
  if (envName === "live" || envName === "demo" || envName === "mock") {
    environment = envName;
  } else {
    warnings.push(`Unknown IG_ENVIRONMENT "${envName}", falling back to "demo".`);
  }

  const apiKey = get("IG_API_KEY");
  const identifier = get("IG_IDENTIFIER");
  const password = get("IG_PASSWORD");

  const missingCredentials: string[] = [];
  if (environment !== "mock") {
    if (!apiKey) missingCredentials.push("IG_API_KEY");
    if (!identifier) missingCredentials.push("IG_IDENTIFIER");
    if (!password) missingCredentials.push("IG_PASSWORD");
  }

  const maxDealSizeRaw = get("IG_MAX_DEAL_SIZE") ?? "1";
  let maxDealSize = Number(maxDealSizeRaw);
  if (!Number.isFinite(maxDealSize) || maxDealSize <= 0) {
    warnings.push(`Invalid IG_MAX_DEAL_SIZE "${maxDealSizeRaw}", using 1.`);
    maxDealSize = 1;
  }

  const ttlRaw = get("IG_CONFIRMATION_TTL_SECONDS");
  let ttlSeconds = ttlRaw === undefined ? 120 : Number(ttlRaw);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) {
    warnings.push(`IG_CONFIRMATION_TTL_SECONDS must be between 30 and 600, using 120.`);
    ttlSeconds = 120;
  }

  const allowedRaw = get("IG_ALLOWED_EPICS");
  const allowedEpics = allowedRaw
    ? allowedRaw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null;

  return {
    environment,
    baseUrl: BASE_URLS[environment],
    apiKey,
    identifier,
    password,
    accountId: get("IG_ACCOUNT_ID"),
    tradingEnabled: parseBool(get("IG_TRADING_ENABLED"), false),
    maxDealSize,
    allowedEpics: allowedEpics && allowedEpics.length > 0 ? allowedEpics : null,
    requireStopLoss: parseBool(get("IG_REQUIRE_STOP_LOSS"), true),
    confirmationTtlMs: ttlSeconds * 1000,
    missingCredentials,
    configFile: existsSync(configFile) ? configFile : undefined,
    warnings,
  };
}

export function secretsOf(config: IgConfig): string[] {
  return [config.apiKey, config.password, config.identifier].filter((s): s is string => !!s && s.length >= 3);
}
