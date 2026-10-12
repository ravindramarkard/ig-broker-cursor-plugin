#!/usr/bin/env node
// Opens the bundled IG Broker MCP server in the official MCP Inspector (browser UI),
// launched the same way Cursor launches it from mcp.json.
//
// Defaults to mock mode with trading enabled so every tool can be exercised without an
// IG account. Override with env vars, e.g. `IG_ENVIRONMENT=demo npm run inspect`.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const server = join(root, "dist", "ig-broker-mcp.mjs");
if (!existsSync(server)) {
  console.error("dist/ig-broker-mcp.mjs is missing - run `npm run build` first.");
  process.exit(1);
}

const clientPort = process.env.CLIENT_PORT || "46274";
const serverPort = process.env.SERVER_PORT || "46277";
const token = process.env.MCP_PROXY_AUTH_TOKEN || randomBytes(32).toString("hex");

const serverEnv = {
  IG_ENVIRONMENT: process.env.IG_ENVIRONMENT || "mock",
  IG_TRADING_ENABLED: process.env.IG_TRADING_ENABLED || "true",
  IG_MAX_DEAL_SIZE: process.env.IG_MAX_DEAL_SIZE || "2",
  // Clicking through by hand is slower than an agent, so give previews 10 minutes here.
  IG_CONFIRMATION_TTL_SECONDS: process.env.IG_CONFIRMATION_TTL_SECONDS || "600",
};
for (const key of ["IG_ACCOUNT_ID", "IG_REQUIRE_STOP_LOSS", "IG_ALLOWED_EPICS", "IG_CONFIG_FILE", "IG_STATE_DIR"]) {
  if (process.env[key]) serverEnv[key] = process.env[key];
}

const args = [
  ...Object.entries(serverEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
  "--",
  process.execPath,
  server,
];

console.log(`IG Broker MCP server: ${Object.entries(serverEnv).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`Inspector UI: http://localhost:${clientPort}/?MCP_PROXY_AUTH_TOKEN=${token}&MCP_PROXY_PORT=${serverPort}`);
console.log("In the UI: click Connect, open the Tools tab, then List Tools.\n");

const child = spawn(join(root, "node_modules", ".bin", "mcp-inspector"), args, {
  stdio: "inherit",
  env: {
    ...process.env,
    CLIENT_PORT: clientPort,
    SERVER_PORT: serverPort,
    MCP_PROXY_AUTH_TOKEN: token,
    MCP_AUTO_OPEN_ENABLED: process.env.MCP_AUTO_OPEN_ENABLED || "false",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
