#!/usr/bin/env node
// Cursor `beforeMCPExecution` hook for the IG Broker plugin.
//
// Forces a human approval prompt for every `ig_execute_trade` call, even when the
// user runs the agent with auto-run enabled. The prompt shows the summary written by
// the MCP server at preview time, so the user approves what will actually be sent to
// IG rather than the agent's description of it. Unknown or expired tokens are denied.
//
// Contract: JSON on stdin, JSON on stdout. Dependency-free on purpose.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_RE = /^igc_[a-f0-9]{32}$/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function respond(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function parseMaybeJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function decide(input, stateDir) {
  const toolName = String(input.tool_name ?? input.toolName ?? "");
  if (!/ig_execute_trade/.test(toolName)) return {};

  const args = parseMaybeJson(input.tool_input ?? input.toolInput ?? input.arguments);
  const token = String(args.confirmationToken ?? "");
  if (!TOKEN_RE.test(token)) {
    return {
      permission: "deny",
      user_message: "IG Broker blocked a trade: missing or malformed confirmation token.",
      agent_message: "ig_execute_trade needs the confirmationToken returned by an ig_preview_* tool.",
    };
  }

  const file = join(stateDir, "pending", `${token}.json`);
  let pending = null;
  if (existsSync(file)) {
    try {
      pending = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      pending = null;
    }
  }
  if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
    return {
      permission: "deny",
      user_message: "IG Broker blocked a trade: no matching preview (it may have expired or already been used).",
      agent_message:
        "No pending preview matches this confirmationToken. Preview the trade again, show the summary to the user, and wait for their approval.",
    };
  }

  const env = String(pending.environment ?? "").toUpperCase();
  return {
    permission: "ask",
    user_message:
      `${env === "LIVE" ? "LIVE MONEY - " : ""}Approve this IG trade?\n\n${pending.summary}\n\n` +
      `Expires ${pending.expiresAt}. Deny to cancel; nothing is sent to IG unless you approve.`,
    agent_message: "The user is being asked to approve this trade in Cursor.",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const stateDir = process.env.IG_STATE_DIR || join(homedir(), ".cursor", "ig-broker");
  const raw = readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    respond({ permission: "deny", user_message: "IG Broker hook received invalid input; trade blocked." });
  }
  respond(decide(input, stateDir));
}
