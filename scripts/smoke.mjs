#!/usr/bin/env node
// End-to-end check of the *bundled* server over stdio, exactly as Cursor launches it
// from mcp.json. Runs against the built-in mock IG API, so no credentials are needed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const mcp = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));
const def = mcp.mcpServers["ig-broker"];

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
  // Simulate Cursor substituting variables: unset optional ones stay as literal placeholders.
  ...def.env,
  IG_ENVIRONMENT: "mock",
  IG_TRADING_ENABLED: "true",
  IG_MAX_DEAL_SIZE: "2",
  IG_STATE_DIR: mkdtempSync(join(tmpdir(), "ig-smoke-")),
  IG_CONFIG_FILE: "/nonexistent/config.env",
};

const transport = new StdioClientTransport({
  command: def.command === "node" ? process.execPath : def.command,
  args: def.args.map((a) => a.replace("${CURSOR_PLUGIN_ROOT}", root.replace(/\/$/, ""))),
  env,
  stderr: "pipe",
});
const client = new Client({ name: "ig-smoke", version: "1.0.0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name} failed: ${res.content[0].text}`);
  return JSON.parse(res.content[0].text);
};

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log(`tools (${tools.length}): ${tools.join(", ")}`);

const overview = await call("ig_account_overview");
console.log(`account ${overview.account.id} balance ${overview.account.balance} ${overview.account.currency}, ${overview.openPositions} positions`);

const quote = await call("ig_get_market", { epic: "IX.D.FTSE.DAILY.IP" });
console.log(`FTSE 100 ${quote.bid}/${quote.offer} (${quote.status})`);

const preview = await call("ig_preview_open_position", { epic: "IX.D.FTSE.DAILY.IP", direction: "BUY", size: 1, stopDistance: 25 });
console.log(`preview: ${preview.summary}`);

const exec = await call("ig_execute_trade", { confirmationToken: preview.confirmationToken });
console.log(`execute: ${exec.dealStatus} ${exec.direction} ${exec.size} @ ${exec.level}, stop ${exec.stopLevel}, deal ${exec.dealId}`);

const positions = await call("ig_get_positions");
console.log(`positions now: ${positions.positions.length}`);

await client.close();
if (exec.dealStatus !== "ACCEPTED" || positions.positions.length !== 3) {
  console.error("smoke test FAILED");
  process.exit(1);
}
console.log("smoke test passed");
