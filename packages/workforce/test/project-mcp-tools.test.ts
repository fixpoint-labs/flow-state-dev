/**
 * `projectMcpTools()` for a run in a task session, on the real engine: which
 * MCP servers a coding run on a project is relayed, and with whose key.
 *
 * Each delegate's turn calls the resolver the way a coding harness would,
 * holding `projectWorkspaceCapability` and `mcpCredentialsCapability`, and
 * keeps what it was relayed, what its session was told and which key each
 * connection was opened with. The MCP client is scripted: no network.
 *
 * The same turn asks `projectChecks()` for the run's project's checks, which
 * come from that read too.
 *
 * The project and the owner come from the same read the run's files come
 * from (the session's readonly fields and the held row), never the task's
 * payload: a task naming a server on a project that names none is relayed
 * nothing.
 */
import { createClient } from "@flow-state-dev/client";
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import type { MCPClient, MCPServerConfig } from "@flow-state-dev/tools/mcp";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import {
  COORDINATOR_FLOW,
  defineCoordinatorFlow,
  defineProjectBlocks,
  defineSessionBoard,
  defineWorkstreamBlocks,
  mcpCredentialsCapability,
  projectChecks,
  projectMcpTools,
  projectWorkspaceCapability,
  type ProjectMcpServers,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerManifest } from "../src/manifest";
import { PROJECT_ROW_RESOURCES } from "../src/projects/project-address";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootProjectsHost, ORG } from "./projects-harness";

const doorInput = z.object({ message: z.string() });
const PROJECT_COORDINATOR = "pc";
const LINEAR_URL = "https://mcp.linear.example/mcp";
const GITHUB_URL = "https://mcp.github.example/mcp";

/** The servers the host offers its runs. The project writes may offer more (`jira`), as a host that dropped one would. */
const SERVERS: ProjectMcpServers = {
  linear: { url: LINEAR_URL, seedEnv: "LINEAR_MCP_API_KEY" },
  github: { url: GITHUB_URL }
};

/** One run: what it was relayed, what its session was told, and the keys its connections carried. */
type Relayed = {
  servers: Record<string, string[]>;
  notices: string[];
  keys: Record<string, string>;
  answer?: unknown;
  /** What a call the server failed, echoing its address and key, told the run. */
  failure?: string;
};

/** The filer's flow: it leads workstreams and files for its delegates. */
function filerFlow(installation: WorkerInstallation) {
  const board = defineSessionBoard({ installation, flowKind: "filer" });
  const door = handler({
    name: "filer-run",
    inputSchema: doorInput,
    resources: { ...installation.resources },
    execute: async (_input, ctx) => (await installation.resolveWorker(ctx, "filer")).id
  });
  return defineFlow({
    kind: "filer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources, ...PROJECT_ROW_RESOURCES },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: { ...board.entries(door), [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() } }
  } as never);
}

/** The scripted MCP client: records each connection's key, and fails `github` naming its address and key. */
function scriptedClients(keys: Record<string, string>[], failGithub: () => boolean) {
  return async (config: MCPServerConfig): Promise<MCPClient> => {
    const transport = config.transport as { url: string; headers?: Record<string, string> };
    const auth = transport.headers?.Authorization ?? "";
    keys.at(-1)![config.name] = auth.replace(/^Bearer /, "");
    if (config.name === "github" && failGithub()) {
      throw new Error(`401 from ${transport.url}: token ${auth} rejected`);
    }
    return {
      tools: async () => ({
        get_issue: {
          description: `Read one ${config.name} issue`,
          inputSchema: { jsonSchema: { type: "object", properties: { id: { type: "string" } } } },
          execute: async (args: { id: string }) => {
            if (args.id === "FAIL") throw new Error(`500 from ${transport.url}: ${auth} was refused`);
            return { content: [{ type: "text", text: `${config.name} ${args.id} via ${auth.length > 0 ? "a key" : "none"}` }] };
          }
        }
      }),
      close: async () => {}
    };
  };
}

/** The checks each run's `projectChecks()` answered, in run order. */
const checksSeen: string[][] = [];
const checksOf = projectChecks();

/** A delegate whose turn asks for its run's MCP tools, as a coding harness would, and keeps what it got. */
function takerFlow(installation: WorkerInstallation, runs: Relayed[], keys: Record<string, string>[], resolve: ReturnType<typeof projectMcpTools>) {
  const turn = handler({
    name: "taker-turn",
    inputSchema: doorInput,
    uses: [projectWorkspaceCapability, mcpCredentialsCapability],
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, "taker");
      const run: Relayed = { servers: {}, notices: [], keys: {} };
      keys.push(run.keys);
      checksSeen.push(await checksOf({ ctx }));
      // The real emit, with what the run's session was told kept beside it.
      const emit = new Proxy(ctx.emit, {
        get: (target, key, receiver) =>
          key === "status"
            ? (message: string, options: unknown) => {
                run.notices.push(message);
                return (target.status as (m: string, o: unknown) => unknown)(message, options);
              }
            : Reflect.get(target, key, receiver)
      });
      const asked = new Proxy(ctx, { get: (target, key, receiver) => (key === "emit" ? emit : Reflect.get(target, key, receiver)) });
      const relayed = await resolve(asked as never);
      for (const [name, server] of Object.entries(relayed)) run.servers[name] = server.tools.map((tool) => tool.name);
      if (relayed.linear !== undefined) {
        run.answer = await relayed.linear.tools[0]!.call({ id: "ABC-1" }, {});
        run.failure = await relayed.linear.tools[0]!.call({ id: "FAIL" }, {}).then(
          () => "answered",
          (error: Error) => error.message
        );
      }
      await Promise.all([...new Set(Object.values(relayed).map((server) => server.close))].map((close) => close()));
      runs.push(run);
      return "asked";
    }
  });
  return defineFlow({
    kind: "taker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { [WORKER_TASK_ENTRY]: workerTaskEntry({ name: "taker-task", turn }) } }
  } as never);
}

const standardWorkers: WorkerManifest[] = [
  { id: PROJECT_COORDINATOR, declared: { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }, body: "", skills: [] },
  { id: "chief", declared: { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }, body: "", skills: [] },
  { id: "eng.taker", declared: { flow: "taker", description: "Takes tasks." }, body: "", skills: [] }
];

/** Boot the host. `env` is where `seedEnv` is read; alice is the operator. */
async function boot(options: { env?: Record<string, string>; failGithub?: boolean } = {}) {
  const runs: Relayed[] = [];
  const keys: Record<string, string>[] = [];
  const resolve = projectMcpTools(SERVERS, {
    operator: "alice",
    env: options.env ?? {},
    _createClient: scriptedClients(keys, () => options.failGithub === true)
  });
  const projects = defineProjectBlocks({ mcpServers: [...Object.keys(SERVERS), "jira"] });
  const filerRef = { kind: "filer", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost({
    standardWorkers,
    projectCoordinator: PROJECT_COORDINATOR,
    lab: (installation) => ({
      ...projects.actions,
      ...defineWorkstreamBlocks({ installation, leadFlows: [filerRef] }).actions
    }),
    flows: (installation) => ({
      filer: { flow: filerFlow(installation), roles: ["manager"] },
      taker: { roles: ["contributor"], flow: takerFlow(installation, runs, keys, resolve) },
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" })
    }),
    models: { generators: { "coordinator-judgment": mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }) } }
  });
  const lab = (user: string) => h.openSession(user, "lab");
  const settled = async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const all = await h.runtime.stores.request.list({});
      if (!all.some((request: { status: string }) => request.status === "in_progress")) return;
      if (Date.now() > deadline) throw new Error("a request never finished");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  /** `user`'s key for `server`, stored where the host's own key route writes it. */
  const setKey = (user: string, server: string, value: string) =>
    h.runtime.stores.resourceState.set(
      "user",
      resolveUserStorageKey(user, ORG, { id: "", isolateUserState: false }),
      `mcp-credentials/${server}`,
      { value, setAt: "2026-10-13T00:00:00.000Z" },
      "any"
    );
  const projectConversation = async (user: string, id: string) =>
    (await createWorkforceClient(createClient({ userId: user, fetcher: h.fetcherFor(user) })).ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: { visibility: "shared", id } })).id;
  const plainConversation = (user: string) => h.openSession(user, COORDINATOR_FLOW, { workerId: "chief" });
  const workstreamConversation = async (user: string, project: string, id: string) => {
    const roster = await h.openSession(user, "workforce-roster");
    await h.ok(user, "workforce-roster", roster, "hire", { id: `${user}-filer`, flow: "filer", settings: { delegates: ["eng.taker"] } });
    const opened = (await h.ok(user, "lab", await lab(user), "openWorkstream", { project: { visibility: "shared", id: project }, id, title: id, lead: `${user}-filer` })) as any;
    return opened.workstream.sessionId as string;
  };
  /** File a task for the taker from `session`, wait for its run, and return what it was relayed. */
  const file = async (user: string, session: string, input: Record<string, unknown> = {}, flow = COORDINATOR_FLOW) => {
    const before = runs.length;
    const filed = (await h.ok(user, flow, session, "createTask_tasks", { goal: "Look at the issue", assignee: "eng.taker", ...input })) as any;
    expect(filed).toMatchObject({ ok: true });
    await settled();
    expect(runs).toHaveLength(before + 1);
    return runs.at(-1)!;
  };
  return {
    ...h,
    runs,
    createProject: async (user: string, input: Record<string, unknown>) => h.ok(user, "lab", await lab(user), "createProject", input),
    setKey,
    projectConversation,
    plainConversation,
    workstreamConversation,
    file
  };
}

describe("the servers a coding run is relayed (BR-13)", () => {
  it("relays a project's servers with the owner's key, on a task filed from the project's conversation", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "linear", "alice-linear-key");
    const run = await h.file("alice", await h.projectConversation("alice", "storefront"));
    expect(run.servers).toEqual({ linear: ["get_issue"] });
    expect(run.keys).toEqual({ linear: "alice-linear-key" });
    expect(run.answer).toEqual({ content: [{ type: "text", text: "linear ABC-1 via a key" }] });
    expect(run.notices).toEqual([]);
  });

  it("takes the server's address and the owner's key out of a failed call before the run sees it", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "linear", "k3y");
    const run = await h.file("alice", await h.projectConversation("alice", "storefront"));
    // The message is still the failure; only the address and the short key are gone.
    expect(run.failure).toBe("500 from …: Bearer … was refused");
  });

  it("relays them on a task that names the project, from a conversation with none", async () => {
    const h = await boot();
    await h.createProject("bob", { id: "storefront", title: "Storefront", members: ["alice"], mcpServers: ["linear"] });
    await h.setKey("alice", "linear", "alice-linear-key");
    const run = await h.file("alice", await h.plainConversation("alice"), { input: { project: { visibility: "shared", id: "storefront" } } });
    expect(run.servers).toEqual({ linear: ["get_issue"] });
    expect(run.keys).toEqual({ linear: "alice-linear-key" });
  });

  it("relays them on a task filed from a workstream", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear", "github"] });
    await h.setKey("alice", "linear", "alice-linear-key");
    await h.setKey("alice", "github", "alice-github-key");
    const session = await h.workstreamConversation("alice", "storefront", "checkout");
    const run = await h.file("alice", session, {}, "filer");
    expect(run.servers).toEqual({ linear: ["get_issue"], github: ["get_issue"] });
    expect(run.keys).toEqual({ linear: "alice-linear-key", github: "alice-github-key" });
  });

  it("relays nothing, and opens no connection, for a project that names none, whatever the task says", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: [] });
    await h.setKey("alice", "linear", "alice-linear-key");
    const run = await h.file("alice", await h.projectConversation("alice", "storefront"), {
      goal: "Use the linear MCP server to read ABC-1",
      input: { mcpServers: ["linear"], servers: { linear: { url: "https://evil.example/mcp" } } }
    });
    expect(run).toEqual({ servers: {}, notices: [], keys: {} });
  });

  it("relays nothing, and reads no key, when the run's lookup refuses (BR-15)", async () => {
    const h = await boot();
    await h.createProject("bob", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "linear", "alice-linear-key");
    const outsider = await h.file("alice", await h.plainConversation("alice"), { input: { project: { visibility: "shared", id: "storefront" } } });
    expect(outsider).toEqual({ servers: {}, notices: [], keys: {} });
  });
});

describe("whose key (BR-14)", () => {
  it("is the run's owner's, each member's run on the same project its own", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", members: ["bob"], mcpServers: ["linear"] });
    await h.setKey("alice", "linear", "alice-linear-key");
    await h.setKey("bob", "linear", "bob-linear-key");
    const alices = await h.file("alice", await h.projectConversation("alice", "storefront"));
    const bobs = await h.file("bob", await h.projectConversation("bob", "storefront"));
    expect(alices.keys).toEqual({ linear: "alice-linear-key" });
    expect(bobs.keys).toEqual({ linear: "bob-linear-key" });
  });
});

describe("between two attempts (BR-16)", () => {
  it("reads the list and the key fresh, so a change applies to the next run", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear"] });
    await h.setKey("alice", "linear", "first-key");
    const conversation = await h.projectConversation("alice", "storefront");
    expect((await h.file("alice", conversation)).keys).toEqual({ linear: "first-key" });

    await h.setKey("alice", "linear", "second-key");
    await h.setKey("alice", "github", "github-key");
    await h.ok("alice", "lab", await h.openSession("alice", "lab"), "setMcpServers", {
      project: { visibility: "shared", id: "storefront" },
      mcpServers: ["linear", "github"]
    });
    const second = await h.file("alice", conversation);
    expect(second.keys).toEqual({ linear: "second-key", github: "github-key" });
    expect(Object.keys(second.servers)).toEqual(["linear", "github"]);
  });
});

describe("a server the run can't have", () => {
  it("leaves out a server the owner has no key for, says which and where to set it, and relays the rest (BR-21)", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear", "github"] });
    await h.setKey("alice", "github", "alice-github-key");
    const run = await h.file("alice", await h.projectConversation("alice", "storefront"));
    expect(run.servers).toEqual({ github: ["get_issue"] });
    expect(run.notices).toEqual([
      'This run goes without MCP server "linear": alice\'s key for it isn\'t set. Set it in Settings, and the next run gets it.'
    ]);
  });

  it("uses the seed for the operator with no stored key, a stored key over it, and never for anyone else (BR-22)", async () => {
    const h = await boot({ env: { LINEAR_MCP_API_KEY: "seeded-key" } });
    await h.createProject("alice", { id: "storefront", title: "Storefront", members: ["bob"], mcpServers: ["linear"] });
    const conversation = await h.projectConversation("alice", "storefront");
    expect((await h.file("alice", conversation)).keys).toEqual({ linear: "seeded-key" });

    const bobs = await h.file("bob", await h.projectConversation("bob", "storefront"));
    expect(bobs.keys).toEqual({});
    expect(bobs.notices.join("\n")).toContain("bob's key for it isn't set");

    await h.setKey("alice", "linear", "alice-stored-key");
    expect((await h.file("alice", conversation)).keys).toEqual({ linear: "alice-stored-key" });
  });

  it("leaves out a server the host no longer offers, and one whose connection fails, naming each and never its address or key (BR-23)", async () => {
    const warn = vi.spyOn(console, "warn");
    const h = await boot({ failGithub: true });
    await h.createProject("alice", { id: "storefront", title: "Storefront", mcpServers: ["linear", "github", "jira"] });
    await h.setKey("alice", "linear", "alice-linear-key");
    await h.setKey("alice", "github", "alice-github-SENTINEL");
    const run = await h.file("alice", await h.projectConversation("alice", "storefront"));
    expect(run.servers).toEqual({ linear: ["get_issue"] });
    const said = run.notices.join("\n");
    expect(said).toContain('This run goes without MCP server "jira": the project names it, and this server no longer offers it.');
    expect(said).toContain('This run goes without MCP server "github": FSD couldn\'t connect to it');
    expect(said).not.toContain("SENTINEL");
    expect(said).not.toContain(GITHUB_URL);
    expect(said).not.toContain("mcp.github.example");
    // Nor in the line FSD's MCP client logs for the failure.
    expect(JSON.stringify(warn.mock.calls)).toContain('Failed to connect to \\"github\\"');
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SENTINEL");
    warn.mockRestore();
  });
});

describe("the host's config", () => {
  it("is refused when built, naming the entry and never its address", () => {
    expect(() => projectMcpTools({ Linear: { url: LINEAR_URL } })).toThrow('server "(invalid name)"');
    expect(() => projectMcpTools({ linear: { url: "ftp://mcp.example/secret-SENTINEL" } })).toThrow(/server "linear": its url must be an http\(s\) address/);
    expect(() => projectMcpTools({ linear: { url: "https://user:SENTINEL@mcp.example" } })).not.toThrow(/SENTINEL/);
    expect(() => projectMcpTools({ linear: { url: "https://user:SENTINEL@mcp.example" } })).toThrow(/no user or password/);
    expect(() => projectMcpTools({ linear: { url: LINEAR_URL, seedEnv: "lower case" } })).toThrow(/seedEnv must be an environment variable's name/);
  });
});

describe("the checks a coding run's project names (projectChecks)", () => {
  it("answers the run's project's checks, read fresh, so a change applies to the next run", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", checks: ["pnpm typecheck"] });
    const conversation = await h.projectConversation("alice", "storefront");
    await h.file("alice", conversation);
    expect(checksSeen.at(-1)).toEqual(["pnpm typecheck"]);

    await h.ok("alice", "lab", await h.openSession("alice", "lab"), "setChecks", {
      project: { visibility: "shared", id: "storefront" },
      checks: ["pnpm typecheck", "pnpm --filter web test"]
    });
    await h.file("alice", conversation);
    expect(checksSeen.at(-1)).toEqual(["pnpm typecheck", "pnpm --filter web test"]);
  });

  it("answers none when the run's lookup refuses, whatever the task says", async () => {
    const h = await boot();
    await h.createProject("bob", { id: "storefront", title: "Storefront", checks: ["pnpm typecheck"] });
    await h.file("alice", await h.plainConversation("alice"), {
      input: { project: { visibility: "shared", id: "storefront" }, checks: ["rm -rf ."] }
    });
    expect(checksSeen.at(-1)).toEqual([]);
  });
});
