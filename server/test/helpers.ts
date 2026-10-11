import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { MockIgApi } from "../src/ig/mock.js";
import { createRuntime } from "../src/runtime.js";

export async function connect(env: Record<string, string> = {}, opts: { stateDir?: string | null } = {}) {
  const config = loadConfig({ IG_CONFIG_FILE: "/nonexistent/config.env", IG_ENVIRONMENT: "mock", ...env });
  const api = new MockIgApi();
  const runtime = createRuntime(config, { stateDir: opts.stateDir ?? null, fetch: api.fetch, sleep: async () => {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    const text = res.content[0]?.text ?? "";
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { isError: !!res.isError, text, data };
  };

  return { client, call, runtime, api };
}
