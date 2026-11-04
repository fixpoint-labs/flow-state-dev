/**
 * `projectMcpCapability()`: an agent or coordinator worker's model gets the
 * MCP servers its conversation's project names, as tools, keyed with the
 * user it is talking to. On the real engine, with a scripted MCP client (no
 * network) and a scripted model that calls a server's tool.
 *
 * A tool the model calls that it was not offered answers the mock's own
 * `{ ok: true }`, so every answer below says which: the server's text, or that.
 *
 * The project and the owner come from the conversation's server-written
 * fields, never from what the model or the user writes: a conversation
 * with no project gets nothing, whatever its message names.
 */
import { createClient } from "@flow-state-dev/client";
import { resolveActivePresets } from "@flow-state-dev/core/capability";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import type { MCPClient, MCPServerConfig } from "@flow-state-dev/tools/mcp";
import type { MockGeneratorInstance } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";
import { createWorkforceClient } from "../src/browser";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import {
  COORDINATOR_FLOW,
  defineCoordinatorFlow,
  defineProjectBlocks,
  projectMcpCapability,
  SET_WORK_PROJECT_ACTION,
  type ProjectMcpCapabilityOptions,
  type ProjectMcpServers
} from "../src/index";
import type { WorkerManifest } from "../src/manifest";
import { bootProjectsHost, ORG } from "./projects-harness";

const LINEAR_URL = "https://mcp.linear.example/mcp";
const SERVERS: ProjectMcpServers = { linear: { url: LINEAR_URL, seedEnv: "LINEAR_API_KEY" } };
const PICKS = { projectMcp: ["tools"] };
const storefront = { visibility: "shared" as const, id: "storefront" };
/** What a model is handed for a tool it was not offered. */
const NOT_OFFERED = { ok: true };

/** Each connection the scripted client opened: the key it carried, and whether it was closed. */
type Opened = { key: string; closed: boolean };

/** The scripted MCP client: a read tool and a write tool, each answering with the key it came in on. */
function scriptedClients(opened: Opened[]) {
  return async (config: MCPServerConfig): Promise<MCPClient> => {
    const auth = (config.transport as { headers?: Record<string, string> }).headers?.Authorization ?? "";
    const connection: Opened = { key: auth.replace(/^Bearer /, ""), closed: false };
    opened.push(connection);
    const answer = (what: string) => async (args: { id: string }) => {
      if (args.id === "FAIL") throw new Error(`500 from ${LINEAR_URL}: ${auth} was refused`);
      return { content: [{ type: "text", text: `${what} ${args.id} with ${connection.key}` }] };
    };
    return {
      tools: async () => ({
        get_issue: { description: "Read one issue", inputSchema: { jsonSchema: { type: "object" } }, execute: answer("read") },
        create_issue: { description: "File an issue", inputSchema: { jsonSchema: { type: "object" } }, execute: answer("filed") }
      }),
      close: async () => {
        connection.closed = true;
      }
    };
  };
}

/**
 * A model that, on each turn, calls the tools the message names in
 * `call:<tool>:<id>` (one per step), keeps what each answered, then replies.
 */
function scriptedModel(name: string, answers: unknown[][]): MockGeneratorInstance {
  return {
    name,
    calls: [],
    reset: () => undefined,
    next: (messages: Array<{ role: string; content: unknown }>, state: { toolResults: Array<{ result: unknown }> }) => {
      const said = JSON.stringify([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const wanted = [...said.matchAll(/call:([\w]+):([\w-]+)/g)];
      const done = state.toolResults.length;
      if (done < wanted.length) {
        const [, toolName, id] = wanted[done]!;
        return { toolCalls: [{ toolCallId: `c${answers.length}-${done}`, toolName, args: { id } }] };
      }
      answers.push(state.toolResults.map((r) => r.result));
      return { text: "done" };
    }
  } as unknown as MockGeneratorInstance;
}

/** Boot a host with a project coordinator, a plain coordinator and an agent worker, each picking the preset unless `picks` is false. */
async function boot(options: { picks?: boolean; capability?: ProjectMcpCapabilityOptions } = {}) {
  const opened: Opened[] = [];
  const answers: unknown[][] = [];
  const capability = projectMcpCapability(SERVERS, { env: {}, _createClient: scriptedClients(opened), ...options.capability });
  const declared = (flow: string) => ({
    flow,
    ...(flow === COORDINATOR_FLOW ? { routing: "judgment" } : {}),
    ...(options.picks === false ? {} : { capabilities: PICKS })
  });
  const standardWorkers: WorkerManifest[] = [
    { id: "pc", declared: declared(COORDINATOR_FLOW), body: "", skills: [] },
    { id: "chief", declared: declared(COORDINATOR_FLOW), body: "", skills: [] },
    { id: "desk.reader", declared: declared(AGENT_FLOW), body: "", skills: [] }
  ];
  const projects = defineProjectBlocks({ mcpServers: Object.keys(SERVERS) });
  const h = await bootProjectsHost({
    standardWorkers,
    projectCoordinator: "pc",
    lab: () => ({ ...projects.actions }),
    flows: (installation) => ({
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev", agent: { uses: [capability] } }),
      [AGENT_FLOW]: { flow: defineAgentWorkerFlow({ installation, uses: [capability] }), roles: ["manager", "contributor"] }
    }),
    models: {
      generators: {
        "coordinator-judgment": scriptedModel("coordinator-judgment", answers),
        "agent-answer": scriptedModel("agent-answer", answers)
      }
    }
  });
  const client = (user: string) => createWorkforceClient(createClient({ userId: user, fetcher: h.fetcherFor(user) }));
  const setKey = (user: string, value: string) =>
    h.runtime.stores.resourceState.set(
      "user",
      resolveUserStorageKey(user, ORG, { id: "", isolateUserState: false }),
      "mcp-credentials/linear",
      { value, setAt: "2026-10-31T00:00:00.000Z" },
      "any"
    );
  const createProject = async (user: string, input: Record<string, unknown>) =>
    h.ok(user, "lab", await h.openSession(user, "lab"), "createProject", input);
  /** `user`'s project coordinator conversation on storefront. */
  const projectConversation = async (user: string) =>
    (await client(user).ensureWorkerSession({ worker: "pc", projectId: storefront })).id;
  /** One turn: what each tool the message names answered the model. */
  const turn = async (user: string, flow: string, session: string, message: string) => {
    const before = answers.length;
    const result = await h.act(user, flow, session, "respond", { message });
    expect(result.settled, JSON.stringify(result.error)).toBe("completed");
    expect(answers).toHaveLength(before + 1);
    return answers.at(-1)!;
  };
  /** The status lines a conversation was told. */
  const told = async (session: string) => {
    const requests = await h.runtime.stores.request.list({ sessionId: session, withItems: true });
    return requests
      .flatMap((request: unknown) => (request as { items?: Array<{ type: string; message?: string }> }).items ?? [])
      .filter((item) => item.type === "status" && (item.message ?? "").includes("MCP server"))
      .map((item) => item.message);
  };
  return { ...h, opened, setKey, createProject, projectConversation, turn, told };
}

const read = (id: string, key: string) => ({ content: [{ type: "text", text: `read ${id} with ${key}` }] });

describe("a worker's project MCP tools", () => {
  it("reach a project coordinator's model, with the user's own key, and its call reads the tracker", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", members: ["bob"], mcpServers: ["linear"] });
    await h.setKey("alice", "alice-key");
    await h.setKey("bob", "bob-key");
    expect(await h.turn("alice", COORDINATOR_FLOW, await h.projectConversation("alice"), "implement call:mcp__linear__get_issue:FIX-2165")).toEqual([
      read("FIX-2165", "alice-key")
    ]);
    // Bob's conversation on the same project reads with Bob's key, never Alice's.
    expect(await h.turn("bob", COORDINATOR_FLOW, await h.projectConversation("bob"), "call:mcp__linear__get_issue:FIX-1")).toEqual([
      read("FIX-1", "bob-key")
    ]);
  });

  it("reach an agent worker's model once its conversation is set to the project", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "alice-key");
    const session = await h.openSession("alice", AGENT_FLOW, { workerId: "desk.reader" });
    expect(await h.turn("alice", AGENT_FLOW, session, "call:mcp__linear__get_issue:FIX-7")).toEqual([NOT_OFFERED]);
    await h.ok("alice", AGENT_FLOW, session, SET_WORK_PROJECT_ACTION, { project: storefront });
    expect(await h.turn("alice", AGENT_FLOW, session, "call:mcp__linear__get_issue:FIX-7")).toEqual([read("FIX-7", "alice-key")]);
  });

  it("stay off for a worker whose own file doesn't pick the preset (control: no pick)", async () => {
    const h = await boot({ picks: false });
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "alice-key");
    expect(await h.turn("alice", COORDINATOR_FLOW, await h.projectConversation("alice"), "call:mcp__linear__get_issue:FIX-1")).toEqual([NOT_OFFERED]);
    expect(h.opened).toEqual([]);
  });

  it("are none, and open no connection, in a conversation with no project, whatever it names", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "alice-key");
    const chief = await h.openSession("alice", COORDINATOR_FLOW, { workerId: "chief" });
    expect(await h.turn("alice", COORDINATOR_FLOW, chief, 'project {"visibility":"shared","id":"storefront"} call:mcp__linear__get_issue:FIX-1')).toEqual([
      NOT_OFFERED
    ]);
    expect(h.opened).toEqual([]);
    expect(await h.told(chief)).toEqual([]);
  });

  it("keep only what `allow` lets through: a read-only tracker", async () => {
    const h = await boot({ capability: { allow: (_server, tool) => tool.startsWith("get_") } });
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "alice-key");
    expect(
      await h.turn("alice", COORDINATOR_FLOW, await h.projectConversation("alice"), "call:mcp__linear__create_issue:NEW call:mcp__linear__get_issue:FIX-1")
    ).toEqual([NOT_OFFERED, read("FIX-1", "alice-key")]);
  });

  it("leave a server out when the user has no key, saying so once in the conversation, and the operator's seed stands in for the operator only", async () => {
    const h = await boot({ capability: { operator: "ops", env: { LINEAR_API_KEY: "seeded-key" } } });
    await h.createProject("alice", { id: "storefront", title: "Storefront", members: ["ops"], mcpServers: ["linear"] });
    const hers = await h.projectConversation("alice");
    expect(await h.turn("alice", COORDINATOR_FLOW, hers, "call:mcp__linear__get_issue:FIX-1")).toEqual([NOT_OFFERED]);
    expect(await h.turn("alice", COORDINATOR_FLOW, hers, "call:mcp__linear__get_issue:FIX-1")).toEqual([NOT_OFFERED]);
    expect(await h.told(hers)).toEqual([
      `This conversation goes without MCP server "linear": alice's key for it isn't set. Set it in Settings, and the next turn gets it.`
    ]);
    expect(await h.turn("ops", COORDINATOR_FLOW, await h.projectConversation("ops"), "call:mcp__linear__get_issue:FIX-1")).toEqual([
      read("FIX-1", "seeded-key")
    ]);
  });

  it("take the server's address and the key out of a failed call before the model sees it", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "k3y");
    const session = await h.projectConversation("alice");
    // The scripted model doesn't catch a tool's failure, so it ends the turn with the tool's message.
    const result = await h.act("alice", COORDINATOR_FLOW, session, "respond", { message: "call:mcp__linear__get_issue:FAIL" });
    // The failure still reads as one; only the address and the short key are gone.
    expect(result.error).toMatchObject({ message: "500 from …: Bearer … was refused" });
    const stored = JSON.stringify(await h.runtime.stores.request.list({ sessionId: session, withItems: true }));
    expect(stored).toContain("500 from …");
    expect(stored).not.toContain("k3y");
    expect(stored).not.toContain(LINEAR_URL);
  });
});

describe("the kept connection", () => {
  it("is opened once for a project, user and key across steps and turns, and anew when the key changes", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "first-key");
    const session = await h.projectConversation("alice");
    await h.turn("alice", COORDINATOR_FLOW, session, "call:mcp__linear__get_issue:A call:mcp__linear__get_issue:B");
    await h.turn("alice", COORDINATOR_FLOW, session, "call:mcp__linear__get_issue:C");
    expect(h.opened.map(({ key }) => key)).toEqual(["first-key"]);

    await h.setKey("alice", "second-key");
    expect(await h.turn("alice", COORDINATOR_FLOW, session, "call:mcp__linear__get_issue:D")).toEqual([read("D", "second-key")]);
    expect(h.opened.map(({ key }) => key)).toEqual(["first-key", "second-key"]);
  });

  it("is closed once it goes idle, and the next turn opens a fresh one", async () => {
    const h = await boot({ capability: { idleMs: 50 } });
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "alice-key");
    const session = await h.projectConversation("alice");
    await h.turn("alice", COORDINATOR_FLOW, session, "call:mcp__linear__get_issue:A");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.opened).toEqual([{ key: "alice-key", closed: true }]);
    expect(await h.turn("alice", COORDINATOR_FLOW, session, "call:mcp__linear__get_issue:B")).toEqual([read("B", "alice-key")]);
    expect(h.opened.map(({ closed }) => closed)).toEqual([true, false]);
  });
});

describe("the capability", () => {
  it("offers one preset, off until it is picked, so a generator that merely holds it connects to nothing", () => {
    const capability = projectMcpCapability(SERVERS);
    expect(resolveActivePresets(capability)).toEqual([]);
    expect(resolveActivePresets(capability.presets({ tools: true })).map((preset) => preset.name)).toEqual(["tools"]);
  });

  it("refuses a server entry the coding relay refuses, and an idle window that isn't a positive whole number", () => {
    expect(() => projectMcpCapability({ Linear: { url: LINEAR_URL } })).toThrow(/projectMcpCapability: server "\(invalid name\)"/);
    expect(() => projectMcpCapability({ linear: { url: "ftp://x" } })).toThrow(/http\(s\) address/);
    expect(() => projectMcpCapability(SERVERS, { idleMs: 0 })).toThrow(/idleMs/);
  });
});
