/**
 * `claudeCodeAgent({ mcpTools })`: tools this process serves to a run, as
 * in-process MCP servers, against a scripted `query`.
 *
 * What it promises: unset, the SDK call is exactly what it was; set, the run
 * gets the handed servers and nothing from settings files or the account,
 * each tool allowed and answered through its own `call`, and every server
 * closed however the run ends.
 */
import { describe, expect, it, vi } from "vitest";
import { createTestContext, testBlock } from "@flow-state-dev/testing";
import { abortExitGrace, claudeCodeAgent } from "../../src/sdk/agent";
import { inProcessMcpServer, toCallToolResult, type ClaudeCodeMcpTools } from "../../src/sdk/mcp-tools";
import type { ClaudeAgentQueryOptions, ResolveClaudeAgent, SdkMessageLike } from "../../src/sdk/types";

const shippedGraceMs = abortExitGrace.ms;

const RESULT_OK: SdkMessageLike = { type: "result", subtype: "success", result: "done", session_id: "sess_mcp" };

/** A scripted `query` that records its options and, when given, does something with them mid-run. */
function scripted(
  seen: ClaudeAgentQueryOptions[],
  options: { messages?: SdkMessageLike[]; during?: (options: ClaudeAgentQueryOptions) => Promise<void>; fail?: Error } = {},
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      seen.push(args.options!);
      await options.during?.(args.options!);
      if (options.fail !== undefined) throw options.fail;
      for (const message of options.messages ?? [RESULT_OK]) yield message;
    },
  });
}

/** One server's tools, with a log of its calls and closes. */
function linearTools(log: string[] = []): ClaudeCodeMcpTools {
  return {
    linear: {
      tools: [
        {
          name: "get_issue",
          description: "Read one issue",
          inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
          call: async (args) => {
            log.push(`call ${JSON.stringify(args)}`);
            return { content: [{ type: "text", text: `issue ${String(args.id)}: Make the build green` }] };
          },
        },
      ],
      close: () => {
        log.push("close");
      },
    },
  };
}

/** Speak to an in-process server the way the SDK does: connect a transport, send requests, read replies. */
async function client(instance: { connect(t: any): Promise<void> }) {
  const replies = new Map<number, (message: any) => void>();
  const transport = {
    send: async (message: any) => replies.get(message.id)?.(message),
    close: async () => {},
    onmessage: undefined as undefined | ((message: unknown) => void),
  };
  await instance.connect(transport);
  let id = 0;
  return (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve) => {
      id += 1;
      replies.set(id, resolve);
      transport.onmessage!({ jsonrpc: "2.0", id, method, params });
    });
}

describe("mcpTools unset", () => {
  it("hands the SDK exactly the options it hands with no mcpTools, key for key (BR-27)", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    const common = { allowedTools: ["Read"], disallowedTools: ["Bash"], env: { PATH: "/usr/bin" } };
    await testBlock(claudeCodeAgent({ ...common, resolveClaudeAgent: scripted(seen) }), { input: { prompt: "go" } });
    await testBlock(claudeCodeAgent({ ...common, mcpTools: {}, resolveClaudeAgent: scripted(seen) }), { input: { prompt: "go" } });
    const [without, withEmpty] = seen;

    for (const key of ["mcpServers", "strictMcpConfig", "settings"]) expect(without).not.toHaveProperty(key);
    // Setting it, even to nothing, adds exactly its three keys and changes no other.
    const { mcpServers, strictMcpConfig, settings, ...rest } = withEmpty!;
    expect(Object.keys(rest).sort()).toEqual(Object.keys(without!).sort());
    const comparable = (options: object) => {
      const { abortController: _a, spawnClaudeCodeProcess: _s, ...plain } = options as Record<string, unknown>;
      return plain;
    };
    expect(comparable(rest)).toEqual(comparable(without!));
    expect({ mcpServers, strictMcpConfig, settings }).toEqual({
      mcpServers: {},
      strictMcpConfig: true,
      settings: { disableClaudeAiConnectors: true },
    });
  });
});

describe("mcpTools set", () => {
  it("hands each server in-process, and nothing from settings files or the account (BR-12, BR-28)", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    await testBlock(claudeCodeAgent({ mcpTools: linearTools(), resolveClaudeAgent: scripted(seen) }), { input: { prompt: "go" } });
    const options = seen[0]!;
    expect(options.strictMcpConfig).toBe(true);
    expect(options.settings).toEqual({ disableClaudeAiConnectors: true });
    expect(Object.keys(options.mcpServers!)).toEqual(["linear"]);
    expect(options.mcpServers!.linear).toMatchObject({ type: "sdk", name: "linear" });
    // An in-process server carries no address, no headers and no environment of its own.
    expect(JSON.stringify(options.mcpServers, (key, value) => (key === "instance" ? undefined : value))).toBe(
      '{"linear":{"type":"sdk","name":"linear"}}',
    );
  });

  it("allows each relayed tool without asking, and leaves disallowedTools to block one (BR-17)", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    await testBlock(
      claudeCodeAgent({
        allowedTools: ["Read"],
        disallowedTools: ["mcp__linear__get_issue"],
        mcpTools: linearTools(),
        resolveClaudeAgent: scripted(seen),
      }),
      { input: { prompt: "go" } },
    );
    expect(seen[0]!.allowedTools).toEqual(expect.arrayContaining(["Read", "mcp__linear__get_issue"]));
    expect(seen[0]!.disallowedTools).toEqual(["mcp__linear__get_issue"]);
  });

  it("lists each tool with its schema as handed, and answers a call through the tool's own call (BR-17)", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    const log: string[] = [];
    const answers: any[] = [];
    await testBlock(
      claudeCodeAgent({
        mcpTools: linearTools(log),
        resolveClaudeAgent: scripted(seen, {
          during: async (options) => {
            const send = await client((options.mcpServers!.linear as { instance: any }).instance);
            answers.push(await send("initialize", { protocolVersion: "2025-06-18" }));
            answers.push(await send("tools/list"));
            answers.push(await send("tools/call", { name: "get_issue", arguments: { id: "ABC-1" } }));
            answers.push(await send("tools/call", { name: "nope", arguments: {} }));
          },
        }),
      }),
      { input: { prompt: "go" } },
    );
    expect(answers[0].result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    expect(answers[1].result.tools).toEqual([
      {
        name: "get_issue",
        description: "Read one issue",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    ]);
    expect(answers[2].result).toEqual({ content: [{ type: "text", text: "issue ABC-1: Make the build green" }] });
    expect(answers[3].result.isError).toBe(true);
    expect(log).toEqual(['call {"id":"ABC-1"}', "close"]);
  });

  it("answers a tool that throws as a failed call, and cancels a call the run cancels", async () => {
    let aborted = false;
    const server = inProcessMcpServer("probe", [
      { name: "boom", inputSchema: { type: "object" }, call: async () => Promise.reject(new Error("upstream said no")) },
      {
        name: "slow",
        inputSchema: {},
        call: (_args, { signal }) =>
          new Promise((_resolve, reject) =>
            signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("cancelled"));
            }),
          ),
      },
    ]);
    const replies: any[] = [];
    const transport = { send: async (m: any) => void replies.push(m), onmessage: undefined as any };
    await server.connect(transport);
    transport.onmessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom", arguments: {} } });
    transport.onmessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "slow", arguments: {} } });
    transport.onmessage({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } });
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(replies.find((r) => r.id === 1).result).toEqual({ content: [{ type: "text", text: "upstream said no" }], isError: true });
    expect(aborted).toBe(true);
    expect(toCallToolResult({ a: 1 })).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
  });

  it("says so when the run reports a server it wasn't handed (BR-12)", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    const { items } = await testBlock(
      claudeCodeAgent({
        mcpTools: linearTools(),
        resolveClaudeAgent: scripted(seen, {
          messages: [
            {
              type: "system",
              subtype: "init",
              session_id: "sess_mcp",
              mcp_servers: [
                { name: "linear", status: "connected" },
                { name: "claude.ai Gmail", status: "connected" },
              ],
            } as SdkMessageLike,
            RESULT_OK,
          ],
        }),
      }),
      { input: { prompt: "go" } },
    );
    const said = JSON.stringify(items.filter((item) => item.type === "status"));
    expect(said).toContain('MCP server \\"claude.ai Gmail\\" was offered to this run');
    expect(said).not.toContain('MCP server \\"linear\\" was offered');
  });

  it("calls a resolver once per run, with that run's context, before the SDK call (BR-28)", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    const calls: string[] = [];
    const block = claudeCodeAgent({
      mcpTools: (ctx) => {
        calls.push(`${ctx.session.identity.id} before ${seen.length} queries`);
        return linearTools();
      },
      resolveClaudeAgent: scripted(seen),
    });
    await testBlock(block, { input: { prompt: "one" } });
    await testBlock(block, { input: { prompt: "two" } });
    expect(calls).toEqual(["test-session before 0 queries", "test-session before 1 queries"]);
    expect(seen.map((options) => Object.keys(options.mcpServers!))).toEqual([["linear"], ["linear"]]);
  });
});

describe("closing the servers (BR-18)", () => {
  it("closes each server when the run completes, when it fails, and when it is aborted", async () => {
    const completed: string[] = [];
    await testBlock(claudeCodeAgent({ mcpTools: linearTools(completed), resolveClaudeAgent: scripted([]) }), { input: { prompt: "go" } });
    expect(completed).toEqual(["close"]);

    const failed: string[] = [];
    const { error } = await testBlock(
      claudeCodeAgent({ mcpTools: linearTools(failed), resolveClaudeAgent: scripted([], { fail: new Error("the SDK fell over") }) }),
      { input: { prompt: "go" } },
    );
    expect(error).not.toBeNull();
    expect(failed).toEqual(["close"]);

    // Aborted mid-run, against a vendor stream that never ends on its own.
    const aborted: string[] = [];
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => (started = resolve));
    const hang: ResolveClaudeAgent = () => ({
      query: async function* () {
        yield { type: "system", subtype: "init", session_id: "sess_mcp" } as SdkMessageLike;
        started();
        await new Promise(() => {});
      },
    });
    abortExitGrace.ms = 0;
    try {
      const block = claudeCodeAgent({ mcpTools: linearTools(aborted), resolveClaudeAgent: hang });
      const runtime = await createTestContext({ declaredResources: block.declaredResources });
      const controller = new AbortController();
      (runtime.ctx as unknown as { signal: AbortSignal }).signal = controller.signal;
      const run = block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
      await running;
      expect(aborted).toEqual([]);
      controller.abort();
      await expect(run).rejects.toBeTruthy();
    } finally {
      abortExitGrace.ms = shippedGraceMs;
    }
    expect(aborted).toEqual(["close"]);
  });

  it("calls a close several servers share once, so one manager's clients aren't closed twice", async () => {
    let closes = 0;
    const close = async () => void closes++;
    const tools: ClaudeCodeMcpTools = { linear: { tools: [], close }, github: { tools: [], close } };
    await testBlock(claudeCodeAgent({ mcpTools: tools, resolveClaudeAgent: scripted([]) }), { input: { prompt: "go" } });
    expect(closes).toBe(1);
  });

  it("closes what the resolver opened when setup throws before the run starts", async () => {
    const log: string[] = [];
    const seen: ClaudeAgentQueryOptions[] = [];
    // A server with no tools list: building its in-process server throws.
    const broken = { linear: { tools: undefined as never, close: () => void log.push("close") } };
    const { error } = await testBlock(claudeCodeAgent({ mcpTools: async () => broken, resolveClaudeAgent: scripted(seen) }), {
      input: { prompt: "go" },
    });
    expect(error).not.toBeNull();
    expect(seen).toEqual([]);
    expect(log).toEqual(["close"]);
  });

  it("stops waiting on a resolver still connecting when the run is aborted, and closes what it answers later", async () => {
    const log: string[] = [];
    const seen: ClaudeAgentQueryOptions[] = [];
    let connected: () => void = () => {};
    let asked: () => void = () => {};
    const resolving = new Promise<void>((resolve) => (asked = resolve));
    const block = claudeCodeAgent({
      mcpTools: () =>
        new Promise<ClaudeCodeMcpTools>((resolve) => {
          asked();
          connected = () => resolve(linearTools(log));
        }),
      resolveClaudeAgent: scripted(seen),
    });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    const controller = new AbortController();
    (runtime.ctx as unknown as { signal: AbortSignal }).signal = controller.signal;
    const run = block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
    await resolving;
    controller.abort();
    await expect(run).rejects.toBeTruthy();
    expect(seen).toEqual([]);
    expect(log).toEqual([]);
    connected();
    await vi.waitFor(() => expect(log).toEqual(["close"]));
  });

  it("closes the rest when one server's close throws", async () => {
    const log: string[] = [];
    const tools: ClaudeCodeMcpTools = {
      bad: { tools: [], close: () => Promise.reject(new Error("close failed")) },
      ...linearTools(log),
    };
    const { error } = await testBlock(claudeCodeAgent({ mcpTools: tools, resolveClaudeAgent: scripted([]) }), { input: { prompt: "go" } });
    expect(error).toBeNull();
    expect(log).toEqual(["close"]);
  });
});
