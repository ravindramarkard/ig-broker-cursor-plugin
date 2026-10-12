#!/usr/bin/env node
// Shows what Cursor's approval prompt would display for a pending trade, by feeding the
// trade-approval hook the same JSON Cursor sends before an `ig_execute_trade` call.
//
// Usage: npm run hook:simulate -- <confirmationToken>
//        npm run hook:simulate            (uses the most recent pending preview)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const stateDir = process.env.IG_STATE_DIR || join(homedir(), ".cursor", "ig-broker");
const pendingDir = join(stateDir, "pending");

let token = process.argv[2];
if (!token) {
  const files = existsSync(pendingDir)
    ? readdirSync(pendingDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ f, t: statSync(join(pendingDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
    : [];
  if (!files.length) {
    console.error(`No pending previews in ${pendingDir}. Run an ig_preview_* tool first (tokens are short-lived).`);
    process.exit(1);
  }
  token = files[0].f.replace(/\.json$/, "");
}

const input = {
  hook_event_name: "beforeMCPExecution",
  tool_name: "ig_execute_trade",
  tool_input: JSON.stringify({ confirmationToken: token }),
};
const res = spawnSync(process.execPath, [join(root, "hooks", "ig-trade-approval.mjs")], {
  input: JSON.stringify(input),
  encoding: "utf8",
  env: { ...process.env, IG_STATE_DIR: stateDir },
});
const out = JSON.parse(res.stdout || "{}");

console.log(`Hook decision: ${String(out.permission ?? "(none)").toUpperCase()}\n`);
if (out.user_message) {
  const lines = out.user_message.split("\n");
  const width = Math.min(100, Math.max(...lines.map((l) => l.length)));
  console.log(`+${"-".repeat(width + 2)}+`);
  for (const l of lines.flatMap((l) => l.match(new RegExp(`.{1,${width}}`, "g")) ?? [""])) {
    console.log(`| ${l.padEnd(width)} |`);
  }
  console.log(`+${"-".repeat(width + 2)}+`);
}
if (out.agent_message) console.log(`\nMessage to agent: ${out.agent_message}`);
