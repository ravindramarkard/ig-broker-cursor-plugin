import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

// stdout carries the MCP protocol, so all diagnostics go to stderr.
const log = (msg: string) => process.stderr.write(`[ig-broker] ${msg}\n`);

async function main() {
  const config = loadConfig();
  const { server, client, confirmations, redactor } = createRuntime(config);

  config.warnings.forEach((w) => log(`warning: ${w}`));
  log(
    `starting (environment=${config.environment}, trading=${config.tradingEnabled ? "ENABLED" : "disabled"}, ` +
      `maxDealSize=${config.maxDealSize}, requireStopLoss=${config.requireStopLoss}` +
      `${config.configFile ? `, configFile=${config.configFile}` : ""})`,
  );
  if (config.missingCredentials.length) {
    log(`not configured: missing ${config.missingCredentials.join(", ")}. Tools will return setup instructions.`);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    confirmations.clear();
    await Promise.race([client.logout(), new Promise((r) => setTimeout(r, 2000))]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
  process.on("uncaughtException", (err) => log(`uncaught: ${redactor.text(err.stack ?? err.message)}`));
  process.on("unhandledRejection", (err) => log(`unhandled rejection: ${redactor.text(String(err))}`));

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
