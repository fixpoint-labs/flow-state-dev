/**
 * Unit tests for the MCP transport adapter — covers tool name derivation,
 * the JSON-RPC dispatcher's per-method behavior, principal resolution
 * mapping to `-32001`, and the GET/DELETE 405 responses.
 *
 * End-to-end roundtrips against the real runtime (action execution +
 * RequestRecord.source assertions) live in `end-to-end.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createMockTransportHost,
  createInboundTransportConformanceTests
} from "@flow-state-dev/testing/conformance";
import { ConcurrencyRejectedError } from "@flow-state-dev/engine";
import {
  createMcpTransportAdapter,
  MCP_TRANSPORT_SOURCE,
  toolNameFromActionKey,
  resolveExposedActions,
  toolInputJsonSchema
} from "../src";

const noopBlock = handler({
  name: "noop",
  inputSchema: z.object({}),
  execute: () => ({ ok: true })
});

function buildFlow() {
  return defineFlow({
    kind: "billing",
    mcp: { enabled: true },
    actions: {
      recordPayment: {
        inputSchema: z.object({ amount: z.number() }),
        block: noopBlock,
        description: "Record a payment for an invoice."
      },
      privateInternal: {
        inputSchema: z.object({}),
        block: noopBlock,
        mcp: { enabled: false }
      }
    }
  });
}

function postRequest(kind: string, body: unknown): { request: Request; ctx: { params: Record<string, string> } } {
  const request = new Request(`http://localhost/api/flows/${kind}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { request, ctx: { params: { kind } } };
}

async function callAdapter(
  adapter: ReturnType<typeof createMcpTransportAdapter>,
  host: ReturnType<typeof createMockTransportHost>,
  method: "POST" | "GET" | "DELETE",
  kind: string,
  body?: unknown
): Promise<Response> {
  const bindings = adapter.createBindings(host);
  const route = bindings.routes!.find((r) => r.method === method)!;
  if (method === "POST") {
    const { request, ctx } = postRequest(kind, body);
    return route.handler(request, ctx);
  }
  const request = new Request(`http://localhost/api/flows/${kind}/mcp`, { method });
  return route.handler(request, { params: { kind } });
}

function withFlow(host: ReturnType<typeof createMockTransportHost>, flow: ReturnType<typeof defineFlow>) {
  // Wire a single flow into the mock registry so the adapter's
  // `host.registry.get(kind)` lookup succeeds.
  (host as unknown as { registry: { get: (k: string) => unknown } }).registry = {
    get: (kind: string) => (kind === flow.kind ? flow() : undefined),
    list: () => [flow()],
    register: () => undefined,
    unregister: () => undefined,
    has: (kind: string) => kind === flow.kind
  } as unknown as typeof host.registry;
  return host;
}

describe("toolNameFromActionKey", () => {
  it.each([
    ["recordPayment", "record_payment"],
    ["URLParser", "url_parser"],
    ["getHTTPSProxy", "get_https_proxy"],
    ["IOError", "io_error"],
    ["event_queue", "event_queue"],
    ["event-queue", "event-queue"]
  ])("%s -> %s", (input, expected) => {
    expect(toolNameFromActionKey(input)).toBe(expected);
  });
});

describe("resolveExposedActions", () => {
  it("excludes actions opted out via action.mcp.enabled: false", () => {
    const flow = buildFlow();
    const exposed = resolveExposedActions(flow.kind, flow.actions);
    expect([...exposed.keys()]).toEqual(["record_payment"]);
  });

  it("does not expose webhook handlers as MCP tools (they live off `flow.actions`)", () => {
    // FIX-439: a webhook binding is an action in webhook form, living on
    // `flow.webhooks`, never `flow.actions`. So it is structurally absent from
    // the MCP tool surface — no filtering needed.
    const flow = defineFlow({
      kind: "billing",
      mcp: { enabled: true },
      actions: {
        recordPayment: {
          inputSchema: z.object({ amount: z.number() }),
          block: noopBlock,
          description: "Record a payment for an invoice."
        }
      },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": { block: noopBlock, input: () => ({}) }
          }
        }
      }
    });
    const exposed = resolveExposedActions(flow.kind, flow.actions);
    expect([...exposed.keys()]).toEqual(["record_payment"]);
  });

  it("honors per-action mcp.name overrides", () => {
    const flow = defineFlow({
      kind: "demo",
      mcp: { enabled: true },
      actions: {
        recordPayment: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "Record a payment.",
          mcp: { name: "log-payment" }
        }
      }
    });
    const exposed = resolveExposedActions(flow.kind, flow.actions);
    expect([...exposed.keys()]).toEqual(["log-payment"]);
    expect(exposed.get("log-payment")?.actionKey).toBe("recordPayment");
  });

  it("throws when two exposed actions resolve to the same tool name", () => {
    const collidingFlow = defineFlow({
      kind: "demo",
      mcp: { enabled: true },
      actions: {
        recordPayment: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "A."
        },
        record_payment: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "B."
        }
      }
    });
    expect(() =>
      resolveExposedActions(collidingFlow.kind, collidingFlow.actions)
    ).toThrow(/resolve to the MCP tool name "record_payment"/);
  });

  it("throws when an mcp.name override collides with another tool name", () => {
    const collidingFlow = defineFlow({
      kind: "demo",
      mcp: { enabled: true },
      actions: {
        recordPayment: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "A."
        },
        otherAction: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "B.",
          mcp: { name: "record_payment" }
        }
      }
    });
    expect(() =>
      resolveExposedActions(collidingFlow.kind, collidingFlow.actions)
    ).toThrow(/resolve to the MCP tool name "record_payment"/);
  });
});

describe("toolInputJsonSchema", () => {
  it("returns an object schema with additionalProperties: false for empty zod objects", () => {
    const schema = toolInputJsonSchema(z.object({}));
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
  });

  it("preserves zod object properties", () => {
    const schema = toolInputJsonSchema(z.object({ amount: z.number() }));
    expect(schema.type).toBe("object");
    expect(schema.properties).toMatchObject({ amount: { type: "number" } });
  });
});

describe("MCP adapter — route layout", () => {
  it.each(["", "/", "///", " / "])(
    "rejects root-only dedicated base path %j",
    (basePath) => {
      expect(() =>
        createMcpTransportAdapter({ basePath, dedicatedBasePath: true })
      ).toThrow(/non-root prefix/);
    }
  );

  it.each([
    {
      name: "preserves the default shared route",
      options: undefined,
      expectedPath: "/api/flows/:kind/mcp"
    },
    {
      name: "preserves a custom shared base path",
      options: { basePath: "/custom" },
      expectedPath: "/custom/:kind/mcp"
    },
    {
      name: "normalizes a trailing slash on a dedicated base path",
      options: { basePath: "/mcp/", dedicatedBasePath: true },
      expectedPath: "/mcp/:kind"
    }
  ] as const)("$name", ({ options, expectedPath }) => {
    const adapter = createMcpTransportAdapter(options);
    const bindings = adapter.createBindings(createMockTransportHost());

    expect(bindings.routes?.map(({ path }) => path)).toEqual([
      expectedPath,
      expectedPath,
      expectedPath
    ]);
  });

  it("mounts each method at /mcp/:kind when the base path is dedicated", () => {
    const adapter = createMcpTransportAdapter({ dedicatedBasePath: true });
    const bindings = adapter.createBindings(createMockTransportHost());

    expect(bindings.routes?.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "POST", path: "/mcp/:kind" },
      { method: "GET", path: "/mcp/:kind" },
      { method: "DELETE", path: "/mcp/:kind" }
    ]);
  });
});

describe("MCP adapter — JSON-RPC dispatch", () => {
  it("source identifier is 'mcp'", () => {
    const adapter = createMcpTransportAdapter();
    expect(adapter.source).toBe(MCP_TRANSPORT_SOURCE);
  });

  it("GET returns 405", async () => {
    const adapter = createMcpTransportAdapter();
    const host = createMockTransportHost();
    const response = await callAdapter(adapter, host, "GET", "billing");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("DELETE returns 405", async () => {
    const adapter = createMcpTransportAdapter();
    const host = createMockTransportHost();
    const response = await callAdapter(adapter, host, "DELETE", "billing");
    expect(response.status).toBe(405);
  });

  it("notifications/initialized returns 202 with no body", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("initialize falls back to the newest supported version when the client requests an unknown one", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 11,
      method: "initialize",
      params: { protocolVersion: "2099-01-01" }
    });
    const json = (await response.json()) as { result: { protocolVersion: string } };
    expect(json.result.protocolVersion).toBe("2025-06-18");
  });

  it("initialize echoes a supported version when the client requests one", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 12,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    });
    const json = (await response.json()) as { result: { protocolVersion: string } };
    expect(json.result.protocolVersion).toBe("2025-03-26");
  });

  it("initialize returns server capabilities and serverInfo named after the flow", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" }
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { result: { serverInfo: { name: string }; capabilities: { resources: { subscribe: boolean } } } };
    expect(json.result.serverInfo.name).toBe("billing");
    expect(json.result.capabilities.resources.subscribe).toBe(false);
  });

  it("tools/call resolves an action via its mcp.name override", async () => {
    const flow = defineFlow({
      kind: "demo",
      mcp: { enabled: true },
      actions: {
        recordPayment: {
          inputSchema: z.object({ amount: z.number() }),
          block: noopBlock,
          description: "Record a payment.",
          mcp: { name: "log-payment" }
        }
      }
    });
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), flow);
    const response = await callAdapter(adapter, host, "POST", "demo", {
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name: "log-payment", arguments: { amount: 42 } }
    });
    expect(response.status).toBe(200);
    expect(host.dispatchCalls).toHaveLength(1);
    expect(host.dispatchCalls[0]!.envelope.action).toBe("recordPayment");
  });

  it("tools/call maps a concurrency reject to a retryable server-busy JSON-RPC error", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    // The arbiter throws `ConcurrencyRejectedError` synchronously from
    // `host.dispatch` when the key is held; the adapter must map it to the
    // server-busy code (retryable), not the generic invalid-params path.
    host.dispatch = () => {
      throw new ConcurrencyRejectedError("u_busy", "req_inflight");
    };
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "record_payment", arguments: { amount: 1 } }
    });
    const json = (await response.json()) as {
      error?: { code: number; data?: { retryable?: boolean } };
    };
    expect(json.error?.code).toBe(-32000); // JSON_RPC_SERVER_BUSY
    expect(json.error?.data?.retryable).toBe(true);
  });

  it("tools/list returns only exposed actions with descriptions and JSON schemas", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });
    const json = (await response.json()) as {
      result: { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    };
    expect(json.result.tools).toHaveLength(1);
    expect(json.result.tools[0]?.name).toBe("record_payment");
    expect(json.result.tools[0]?.description).toBe("Record a payment for an invoice.");
    expect(json.result.tools[0]?.inputSchema).toMatchObject({ type: "object" });
  });

  it("tools/call dispatches to host with source='mcp' and resolved principal", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(
      createMockTransportHost({ resolvePrincipal: () => ({ userId: "u_mcp" }) }),
      buildFlow()
    );
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "record_payment", arguments: { amount: 100 } }
    });
    expect(response.status).toBe(200);
    expect(host.dispatchCalls).toHaveLength(1);
    const envelope = host.dispatchCalls[0]!.envelope;
    expect(envelope.source).toBe("mcp");
    expect(envelope.flowKind).toBe("billing");
    expect(envelope.action).toBe("recordPayment");
    expect(envelope.principal.userId).toBe("u_mcp");
    expect(envelope.input).toEqual({ amount: 100 });
  });

  it("tools/call for an unknown tool returns -32601", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "ghost", arguments: {} }
    });
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });

  it("tools/call for an opted-out action returns -32601", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "private_internal", arguments: {} }
    });
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });

  it("flow without mcp.enabled returns -32601", async () => {
    const flow = defineFlow({
      kind: "no-mcp",
      actions: {
        run: { inputSchema: z.object({}), block: noopBlock }
      }
    });
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), flow);
    const response = await callAdapter(adapter, host, "POST", "no-mcp", {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/list"
    });
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });

  it("PrincipalResolutionError surfaces as 401 with -32001 and WWW-Authenticate", async () => {
    const { PrincipalResolutionError } = await import("@flow-state-dev/engine");
    const adapter = createMcpTransportAdapter();
    const host = withFlow(
      createMockTransportHost({
        resolvePrincipal: () => {
          throw new PrincipalResolutionError("Bearer token required.", { status: 401 });
        }
      }),
      buildFlow()
    );
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list"
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="MCP"');
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32001);
  });

  it("unknown JSON-RPC method returns -32601", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 8,
      method: "completion/complete",
      params: {}
    });
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });

  it("malformed JSON-RPC envelope returns -32600", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      method: "tools/list"
    });
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32600);
  });

  it("resources/list returns an empty list in v1", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 9,
      method: "resources/list"
    });
    const json = (await response.json()) as { result: { resources: unknown[] } };
    expect(json.result.resources).toEqual([]);
  });

  it("resources/subscribe returns -32601 (not supported in v1)", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    const response = await callAdapter(adapter, host, "POST", "billing", {
      jsonrpc: "2.0",
      id: 10,
      method: "resources/subscribe",
      params: { uri: "flow://billing/resources/x" }
    });
    const json = (await response.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32601);
  });
});

describe("MCP adapter — forwardQueryParams", () => {
  async function callToolsCall(
    adapter: ReturnType<typeof createMcpTransportAdapter>,
    host: ReturnType<typeof createMockTransportHost>,
    kind: string,
    args: unknown,
    query = ""
  ): Promise<void> {
    const bindings = adapter.createBindings(host);
    const route = bindings.routes!.find((r) => r.method === "POST")!;
    const request = new Request(`http://localhost/api/flows/${kind}/mcp${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "record_payment", arguments: args }
      })
    });
    await route.handler(request, { params: { kind } });
  }

  it("merges an allowlisted query param into the tools/call input", async () => {
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", { amount: 5 }, "?source=claude-desktop");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ amount: 5, source: "claude-desktop" });
  });

  it("does not forward a query param that is not allowlisted", async () => {
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", { amount: 5 }, "?other=x");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ amount: 5 });
  });

  it("lets the query param override a same-named tool argument (installation wins)", async () => {
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", { amount: 5, source: "model-guess" }, "?source=endpoint");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ amount: 5, source: "endpoint" });
  });

  it("passes arguments through untouched when the endpoint carries no query string", async () => {
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", { amount: 5 });
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ amount: 5 });
  });

  it("forwards nothing by default (no forwardQueryParams configured)", async () => {
    const adapter = createMcpTransportAdapter();
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", { amount: 5 }, "?source=claude-desktop");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ amount: 5 });
  });

  it("passes a non-object `arguments` through unchanged even with a matching query param (symmetry with the no-forwarding path)", async () => {
    // A malformed call must reach the zod boundary with the SAME value whether or
    // not forwarding is configured — no silent substitution of {} + forwarded key.
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", "not-an-object", "?source=endpoint");
    expect(host.dispatchCalls[0]!.envelope.input).toBe("not-an-object");
  });

  it("passes an array `arguments` through unchanged rather than spreading it into numeric keys", async () => {
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", [1, 2], "?source=endpoint");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual([1, 2]);
  });

  it("still forwards the query param on a no-argument call (arguments omitted)", async () => {
    // A no-arg tool call is valid, not malformed — the forwarded provenance must
    // survive rather than being dropped with the empty {}.
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", undefined, "?source=endpoint");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ source: "endpoint" });
  });

  it("still forwards the query param when arguments is explicitly null", async () => {
    const adapter = createMcpTransportAdapter({ forwardQueryParams: ["source"] });
    const host = withFlow(createMockTransportHost(), buildFlow());
    await callToolsCall(adapter, host, "billing", null, "?source=endpoint");
    expect(host.dispatchCalls[0]!.envelope.input).toEqual({ source: "endpoint" });
  });
});

describe("MCP adapter — mcp.session directive → dispatch sessionId", () => {
  // A flow whose actions each carry a different `mcp.session` directive, plus
  // one with none — so a single tools/call exercises one derivation arm.
  function buildSessionFlow() {
    return defineFlow({
      kind: "sessions",
      mcp: { enabled: true },
      actions: {
        stateless: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "No session directive — a fresh ephemeral session per call."
        },
        openContext: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "Mints a fresh conv_ id.",
          mcp: { session: "conv_*" }
        },
        constantPrefix: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "Template with no * — token is appended.",
          mcp: { session: "ctx" }
        },
        routed: {
          inputSchema: z.object({ conversationId: z.string().optional() }),
          block: noopBlock,
          description: "Reads the session id from input.conversationId.",
          mcp: { session: { fromInput: "conversationId" } }
        }
      }
    });
  }

  async function callTool(
    host: ReturnType<typeof createMockTransportHost>,
    tool: string,
    args: unknown
  ): Promise<void> {
    const adapter = createMcpTransportAdapter();
    await callAdapter(adapter, host, "POST", "sessions", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args }
    });
  }

  it("dispatches sessionId: undefined when the action has no session directive", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "stateless", {});
    expect(host.dispatchCalls[0]!.envelope.sessionId).toBeUndefined();
  });

  it("mints a fresh conv_-prefixed id from a `*` template, and two calls differ", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "open_context", {});
    await callTool(host, "open_context", {});
    const first = host.dispatchCalls[0]!.envelope.sessionId;
    const second = host.dispatchCalls[1]!.envelope.sessionId;
    expect(first).toMatch(/^conv_/);
    expect(second).toMatch(/^conv_/);
    expect(first).not.toBe(second);
  });

  it("appends the token when the template has no `*` (never a colliding constant)", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "constant_prefix", {});
    const id = host.dispatchCalls[0]!.envelope.sessionId!;
    expect(id.startsWith("ctx")).toBe(true);
    expect(id).not.toBe("ctx");
  });

  it("uses the caller-supplied input field as the sessionId for `{ fromInput }`", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "routed", { conversationId: "conv_abc123" });
    expect(host.dispatchCalls[0]!.envelope.sessionId).toBe("conv_abc123");
  });

  it("groups two calls sharing a conversationId into the same session", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "routed", { conversationId: "conv_shared" });
    await callTool(host, "routed", { conversationId: "conv_shared" });
    expect(host.dispatchCalls[0]!.envelope.sessionId).toBe("conv_shared");
    expect(host.dispatchCalls[1]!.envelope.sessionId).toBe("conv_shared");
  });

  it("falls back to undefined when the `fromInput` field is missing or blank", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "routed", {});
    await callTool(host, "routed", { conversationId: "" });
    expect(host.dispatchCalls[0]!.envelope.sessionId).toBeUndefined();
    expect(host.dispatchCalls[1]!.envelope.sessionId).toBeUndefined();
  });

  it("falls back to undefined when the `fromInput` value is not a string", async () => {
    const host = withFlow(createMockTransportHost(), buildSessionFlow());
    await callTool(host, "routed", { conversationId: 42 });
    expect(host.dispatchCalls[0]!.envelope.sessionId).toBeUndefined();
  });
});

createInboundTransportConformanceTests({
  name: "mcp",
  factory: () => createMcpTransportAdapter(),
  helpers: {
    buildEnvelope: async (adapter, host) => {
      const flow = buildFlow();
      withFlow(host, flow);
      const bindings = adapter.createBindings(host);
      const route = bindings.routes!.find((r) => r.method === "POST")!;
      const { request, ctx } = postRequest("billing", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "record_payment", arguments: { amount: 1 } }
      });
      await route.handler(request, ctx);
      const envelope = host.dispatchCalls[0]?.envelope;
      if (envelope === undefined) throw new Error("Adapter did not call host.dispatch");
      return envelope;
    }
  }
});
