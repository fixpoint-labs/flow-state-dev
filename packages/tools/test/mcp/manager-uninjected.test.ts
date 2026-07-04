/**
 * Un-injected MCP manager smoke (AI SDK 7).
 *
 * Every other `getTools()` test injects `_createClient`, so the default
 * dynamic `import("@ai-sdk/mcp")` → `createMCPClient` path is never executed.
 * This smoke runs the real client against a minimal in-process HTTP server
 * that speaks just enough MCP (Streamable HTTP transport: initialize →
 * notifications/initialized → tools/list) to list tools. Hermetic — the
 * server binds 127.0.0.1 on an ephemeral port, no network.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpManager } from "../../src/mcp/manager";

const ECHO_TOOL = {
  name: "echo",
  description: "Echo a message back",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
};

function startMockMcpServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      // The transport's optional inbound SSE stream (GET) is declined with
      // 405, which the client treats as "server does not offer one".
      res.writeHead(405).end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body) as {
        jsonrpc: string;
        id?: number | string;
        method?: string;
        params?: { protocolVersion?: string };
      };

      // Notifications (no id) are acknowledged with 202 and no body.
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }

      const reply = (result: unknown) => {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };

      switch (message.method) {
        case "initialize":
          reply({
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "mock-mcp", version: "1.0.0" },
          });
          return;
        case "tools/list":
          reply({ tools: [ECHO_TOOL] });
          return;
        default:
          res.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: `Method not found: ${message.method}` },
            }),
          );
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
    });
  });
}

describe("createMcpManager — un-injected createMCPClient smoke", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await startMockMcpServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("connects through the real @ai-sdk/mcp client and lists tools", async () => {
    const manager = createMcpManager({
      servers: [{ name: "mock", transport: { type: "http", url } }],
    });

    try {
      const tools = await manager.getTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe("mcp__mock__echo");
      expect(tools[0]!.description).toBe("Echo a message back");
      expect(manager.getConnectedServerNames()).toEqual(["mock"]);

      const catalog = manager.getCatalog();
      expect(catalog.servers[0]!.status).toBe("connected");
      expect(catalog.servers[0]!.tools[0]!.originalName).toBe("echo");
    } finally {
      await manager.close();
    }
  });
});
