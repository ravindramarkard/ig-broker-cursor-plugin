#!/usr/bin/env node
// Copies the plugin into ~/.cursor/plugins/local/ig-broker for local testing.
// Cursor ignores symlinks that point outside that folder, so files are copied.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const target = join(process.env.CURSOR_PLUGINS_DIR || join(homedir(), ".cursor", "plugins", "local"), "ig-broker");
const include = [".cursor-plugin", "mcp.json", "dist", "hooks", "rules", "skills", "agents", "commands", "assets", "README.md", "LICENSE"];

if (!existsSync(join(root, "dist", "ig-broker-mcp.mjs"))) {
  console.error("dist/ig-broker-mcp.mjs is missing - run `npm run build` first.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const item of include) {
  if (existsSync(join(root, item))) cpSync(join(root, item), join(target, item), { recursive: true });
}

console.log(`Installed IG Broker plugin to ${target}`);
console.log("Next: in Cursor run 'Developer: Reload Window', then open Customize to check the plugin's MCP server, skills, rules and hooks.");
console.log("Credentials: configure the plugin variables in Cursor, or create ~/.cursor/ig-broker/config.env (chmod 600). See README.");
