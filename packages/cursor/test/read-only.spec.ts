/**
 * `cursorAgent({ access })` (FIX-2900): a run fed `read-only` creates or
 * resumes its agent offered reading tools only, with no MCP server, no custom
 * tool, no subagent and no checkout settings, whatever the host's options say.
 * A full run, or one with no feed, keeps the host's options.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import type { HarnessAccess } from "@flow-state-dev/core/harness";
import { cursorAgent, INTERNAL_CURSOR_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { TESTED_CURSOR_SDK, type CursorCreateOptions, type CursorSendOptions, type ResolvedCursorClient } from "../src/types";

const GATE_OFF = {
  [INTERNAL_CURSOR_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CURSOR_SDK.range }),
} as CursorAgentOptions;

/** A Cursor client that records what each create, resume and send was handed. */
function recording() {
  const opened: CursorCreateOptions[] = [];
  const sent: Array<CursorSendOptions | undefined> = [];
  const agent = (agentId: string) => ({
    agentId,
    async send(_prompt: unknown, options?: CursorSendOptions) {
      sent.push(options);
      return {
        id: "run_1",
        stream: () => (async function* () {})(),
        wait: async () => ({ status: "finished", result: "It merged." }),
        cancel: async () => {},
        supports: () => false,
      };
    },
    close() {},
  });
  const resolve = (): ResolvedCursorClient =>
    ({
      create: async (options: CursorCreateOptions) => (opened.push(options), agent("agent_1")),
      resume: async (id: string, options: CursorCreateOptions) => (opened.push(options), agent(id)),
    }) as never;
  return { opened, sent, resolve };
}

/** The host's bag, widened as far as a host can: every tool, a server, a custom tool, a subagent, the checkout's settings. */
const HOST: CursorAgentOptions = {
  agent: {
    model: { id: "composer-2.5" },
    mode: "agent",
    tools: ["shell", "edit", "mcp", "task"],
    mcpServers: { evil: { command: "sh" } },
    agents: { helper: { description: "d", prompt: "p" } },
    local: { settingSources: ["project"], customTools: { push: {} }, dirs: ["/work/extra"] },
  },
  send: { mcpServers: { evil: { command: "sh" } }, local: { customTools: { push: {} } } },
};

async function openedFor(access: HarnessAccess | undefined, resume: string | null) {
  const client = recording();
  const result = await testBlock(
    cursorAgent({
      ...GATE_OFF,
      ...HOST,
      resolveCursorClient: client.resolve,
      cwd: () => "/work",
      resume: () => resume,
      ...(access === undefined ? {} : { access: () => access }),
    }),
    { input: { prompt: "Is it in?" } },
  );
  expect(result.error ?? null).toBeNull();
  return { opened: client.opened[0]!, sent: client.sent[0] };
}

const READING = ["read", "grep", "glob", "ls", "semSearch", "readLints", "readTodos"];

describe("a read-only Cursor run", () => {
  it.each([
    ["created", null],
    ["resumed", "agent_0"],
  ])("an agent %s is offered reading tools only, with no server, custom tool, subagent or checkout settings", async (_name, resume) => {
    const { opened, sent } = await openedFor("read-only", resume);
    expect(opened.tools).toEqual(READING);
    expect(opened.mcpServers).toEqual({});
    expect(opened.agents).toBeUndefined();
    expect(opened.local?.settingSources).toEqual([]);
    expect(opened.local?.customTools).toBeUndefined();
    // The rest of the host's local bag stands, and the directory is the run's.
    expect(opened.local).toMatchObject({ cwd: "/work", dirs: ["/work/extra"] });
    expect(sent?.mcpServers).toBeUndefined();
    expect(sent?.local?.customTools).toBeUndefined();
  });

  it("control: a full run, and a run with no access feed, keep the host's options", async () => {
    for (const access of ["full", undefined] as const) {
      const { opened, sent } = await openedFor(access, null);
      expect(opened.tools).toEqual(HOST.agent!.tools);
      expect(opened.mcpServers).toEqual(HOST.agent!.mcpServers);
      expect(opened.local?.settingSources).toEqual(["project"]);
      expect(sent).toEqual(HOST.send);
    }
  });

  it("the block declares enforcesReadOnly", () => {
    expect(cursorAgent({ ...GATE_OFF }).enforcesReadOnly).toBe(true);
  });
});
