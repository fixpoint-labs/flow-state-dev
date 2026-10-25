/**
 * A Lab's MCP servers (`openLab({ mcpServers })`): each user's key, set
 * through the Lab's own route, and a coding run on a project relayed the
 * servers its project names with its owner's key.
 *
 * The server here is a real Streamable-HTTP MCP endpoint on 127.0.0.1 that
 * records the key each connection carried, reached through FSD's own MCP
 * client. The coder is a recording harness: it asks the Lab's fourth feed for
 * its tools, calls one, and commits, so nothing spends a model.
 *
 * The key promise is graded with a sentinel: after a set, a relayed run and a
 * clear, the key is in the user's own record and nowhere else the Lab writes
 * or says anything (request and active-request records, items, sessions, log
 * lines, responses, the start line).
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { mcpCredentialsCapability, projectWorkspaceCapability, type ProjectMcpServers } from "@flow-state-dev/workforce";
import { commitScriptedWork, type HarnessFeeds } from "../teams/devteam/harness.mts";
import { harnessStub } from "../teams/devteam/harness-stub.mts";
import { LAB_USER_ID, openLab, type Lab, type OpenLabOptions } from "../teams/devteam/host.mts";

const CODER = "eng.coder";
const SENTINEL = `lin_api_SENTINEL${Math.random().toString(36).slice(2)}`;

// --- A real MCP server over HTTP, recording the key each request carried ---

type McpServer = { url: string; keys: string[]; calls: unknown[] };
let mcp: McpServer & { server: Server };

function startMcpServer(): Promise<McpServer & { server: Server }> {
  const keys: string[] = [];
  const calls: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST") return void res.writeHead(405).end();
    keys.push(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body) as { id?: number; method?: string; params?: any };
      if (message.id === undefined) return void res.writeHead(202).end();
      const reply = (result: unknown) =>
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      if (message.method === "initialize") {
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "issues", version: "1" } });
      }
      if (message.method === "tools/list") {
        return reply({
          tools: [{ name: "get_issue", description: "Read one issue", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
        });
      }
      if (message.method === "tools/call") {
        calls.push(message.params);
        return reply({ content: [{ type: "text", text: `${message.params.arguments.id}: Make the build green` }] });
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no such method" } }),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${address.port}/mcp`, keys, calls });
    }),
  );
}

beforeAll(async () => {
  mcp = await startMcpServer();
});
afterAll(async () => {
  await new Promise<void>((resolve) => mcp.server.close(() => resolve()));
});

// --- A coder that asks for its relayed tools, as Claude Code's harness does ---

type Relayed = { servers: Record<string, string[]>; answer?: unknown };

/** The harness slot: relays through the fourth feed when the Lab hands one, calls `get_issue`, commits. */
function recordingHarness(runs: Relayed[]) {
  return ({ cwd, onSession, mcpTools }: HarnessFeeds): HarnessBlock =>
    handler({
      name: "recording-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      ...(mcpTools === undefined ? {} : { uses: [projectWorkspaceCapability, mcpCredentialsCapability] }),
      execute: async (input: { prompt: string }, ctx) => {
        const context = ctx as unknown as HarnessCallbackContext;
        const dir = await cwd(context);
        await onSession(`sess_rec_${runs.length + 1}`, context);
        const run: Relayed = { servers: {} };
        const relayed = mcpTools === undefined ? {} : await mcpTools(context);
        try {
          for (const [name, server] of Object.entries(relayed)) run.servers[name] = server.tools.map((tool) => tool.name);
          if (relayed.linear !== undefined) run.answer = await relayed.linear.tools[0]!.call({ id: "ABC-1" }, {});
        } finally {
          await Promise.all([...new Set(Object.values(relayed).map((server) => server.close))].map((close) => close()));
        }
        runs.push(run);
        commitScriptedWork({ prompt: input.prompt, cwd: dir, resume: null });
        return {
          source: "recording-harness",
          status: "completed" as const,
          sessionId: `sess_rec_${runs.length}`,
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished" as const,
          finalMessage: "Read the issue.",
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

// --- The Lab ---

let opened: Lab[] = [];
afterEach(async () => {
  for (const lab of opened) await lab.dispose();
  opened = [];
  vi.restoreAllMocks();
});

const servers = (): ProjectMcpServers => ({ linear: { url: mcp.url, seedEnv: "FSD_TEST_LINEAR_SEED" } });

/** A Lab offering `linear` (unless told otherwise), with `notes` naming it and `plain` naming none. */
async function open(options: Partial<OpenLabOptions> & { slot?: OpenLabOptions["harness"] } = {}) {
  const runs: Relayed[] = [];
  const lines: string[] = [];
  const lab = await openLab({
    stores: inMemoryStores(),
    harness: options.slot ?? (recordingHarness(runs) as OpenLabOptions["harness"]),
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "sm-mcp-runs-")), remotes: { allow: [] } },
    coderWorkerId: CODER,
    withoutJudge: true,
    projects: [
      { id: "notes", title: "Notes", mcpServers: ["linear"] },
      { id: "plain", title: "Plain" },
    ],
    mcpServers: servers(),
    log: (line) => lines.push(line),
    ...options,
  });
  opened.push(lab);
  return { lab, runs, lines };
}

/** File `issue` on the EM's board for `project`, and drain until it settles. */
async function fileOnBoard(lab: Lab, issue: string, project: string) {
  const filed = await lab.file("eng.em", { issue, goal: `Read the issue for ${project}.`, maxAttempts: 1, project: { visibility: "shared", id: project } });
  expect(filed.error).toBeUndefined();
  let row = await lab.featureRow(issue);
  for (let i = 0; i < 100 && (row === undefined || row.status === "pending" || row.status === "in_progress"); i += 1) {
    await lab.drain("eng.em");
    row = await lab.featureRow(issue);
  }
  return row;
}

/** Every item the Lab's requests recorded. */
async function allItems(lab: Lab) {
  const runtime = await lab.state.getRuntime();
  const requests = await runtime.stores.request.list({ withItems: true } as never);
  return requests.flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []));
}

const statusTexts = (items: any[]) => items.filter((item) => item.type === "status").map((item) => JSON.stringify(item));

describe("a user's MCP server keys, through the Lab's route", () => {
  it("sets, replaces and clears the caller's own key, and answers only whether it is set and when (BR-8, BR-9, BR-10)", async () => {
    const { lab } = await open();
    expect(await lab.door("GET", "mcp-credentials")).toEqual({ status: 200, body: { servers: [{ name: "linear", setAt: null }] } });

    const set = await lab.door("POST", "mcp-credentials/linear", { body: { value: SENTINEL } });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ name: "linear", setAt: expect.any(String) });
    const read = await lab.door("GET", "mcp-credentials");
    expect(read.body.servers).toEqual([{ name: "linear", setAt: set.body.setAt }]);
    expect(JSON.stringify([set, read])).not.toContain("SENTINEL");

    // Each user's own: the other user's read says nothing of the owner's key.
    expect((await lab.door("GET", "mcp-credentials", { as: "member" })).body.servers).toEqual([{ name: "linear", setAt: null }]);
    expect((await lab.door("POST", "mcp-credentials/linear", { as: "member", body: { value: "other-key" } })).status).toBe(200);
    expect((await lab.door("GET", "mcp-credentials")).body.servers[0].setAt).toBe(set.body.setAt);

    expect(await lab.door("DELETE", "mcp-credentials/linear")).toEqual({ status: 200, body: { name: "linear", setAt: null } });
    expect((await lab.door("GET", "mcp-credentials")).body.servers).toEqual([{ name: "linear", setAt: null }]);
    expect((await lab.door("GET", "mcp-credentials", { as: "member" })).body.servers[0].setAt).not.toBeNull();
  });

  it("refuses a server the Lab doesn't offer, an empty key and one with whitespace, without echoing it (BR-10)", async () => {
    const { lab } = await open();
    const unknown = await lab.door("POST", "mcp-credentials/jira", { body: { value: SENTINEL } });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: "unknown-mcp-server", message: expect.stringContaining('It offers: linear') });
    for (const value of ["", `${SENTINEL} trailing`, `${SENTINEL}\n`, 42]) {
      const refused = await lab.door("POST", "mcp-credentials/linear", { body: { value } });
      expect(refused.status, JSON.stringify(value)).toBe(400);
      expect(refused.body.error).toBe("invalid-mcp-credential");
    }
    expect(JSON.stringify(unknown)).not.toContain("SENTINEL");
    expect((await lab.door("GET", "mcp-credentials")).body.servers[0].setAt).toBeNull();
  });

  it("refuses a caller the Lab's resolver can't verify, before anything is read or written", async () => {
    const { lab } = await open();
    expect((await lab.door("GET", "mcp-credentials", { bearer: false })).status).toBe(401);
    expect((await lab.door("POST", "mcp-credentials/linear", { bearer: false, body: { value: SENTINEL } })).status).toBe(401);
    expect((await lab.door("GET", "mcp-credentials")).body.servers[0].setAt).toBeNull();
  });

  it("is not served by a Lab given no MCP servers", async () => {
    const { lab } = await open({ mcpServers: undefined, projects: [{ id: "plain", title: "Plain" }] });
    expect((await lab.door("GET", "mcp-credentials")).status).toBe(404);
  });
});

describe("a coding run on a project naming a server (BR-13, BR-21, BR-25)", () => {
  it("is relayed the project's server with its owner's key, through FSD's own connection", async () => {
    const { lab, runs } = await open();
    await lab.door("POST", "mcp-credentials/linear", { body: { value: SENTINEL } });
    mcp.keys.length = 0;
    mcp.calls.length = 0;
    const row = await fileOnBoard(lab, "read-abc-1", "notes");
    expect(row?.status, JSON.stringify(row?.error ?? null)).toBe("completed");
    expect(runs).toMatchObject([{ servers: { linear: ["get_issue"] }, answer: { content: [{ type: "text", text: "ABC-1: Make the build green" }] } }]);
    expect(mcp.calls).toEqual([{ name: "get_issue", arguments: { id: "ABC-1" } }]);
    expect(new Set(mcp.keys)).toEqual(new Set([SENTINEL]));
  }, 60_000);

  it("is relayed nothing on a project that names none", async () => {
    const { lab, runs } = await open();
    await lab.door("POST", "mcp-credentials/linear", { body: { value: SENTINEL } });
    mcp.keys.length = 0;
    await fileOnBoard(lab, "read-plain", "plain");
    expect(runs).toEqual([{ servers: {} }]);
    expect(mcp.keys).toEqual([]);
  }, 60_000);

  it("goes without a server its owner has no key for, and its session says to set it in Settings", async () => {
    const { lab, runs } = await open();
    await fileOnBoard(lab, "no-key", "notes");
    expect(runs).toEqual([{ servers: {} }]);
    expect(statusTexts(await allItems(lab)).join("\n")).toContain(
      `This run goes without MCP server \\"linear\\": ${LAB_USER_ID}'s key for it isn't set. Set it in Settings, and the next run gets it.`,
    );
  }, 60_000);

  it("keeps the key out of every record, item, session, log line and response, after a set, a run and a clear (BR-11, BR-25)", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    }
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (logged.push(String(chunk)), true));
    const logger = { debug: (...a: unknown[]) => logged.push(JSON.stringify(a)), info: (...a: unknown[]) => logged.push(JSON.stringify(a)), warn: (...a: unknown[]) => logged.push(JSON.stringify(a)), error: (...a: unknown[]) => logged.push(JSON.stringify(a)) };
    const { lab, lines } = await open({ logger });
    const responses = [await lab.door("POST", "mcp-credentials/linear", { body: { value: SENTINEL } })];
    await fileOnBoard(lab, "sentinel-run", "notes");
    responses.push(await lab.door("GET", "mcp-credentials"));
    responses.push(await lab.door("POST", "mcp-credentials/linear", { body: { value: `${SENTINEL} x` } }));
    stderr.mockRestore();

    const runtime = await lab.state.getRuntime();
    const where = {
      requests: await runtime.stores.request.list({ withItems: true } as never),
      activeRequests: await runtime.stores.activeRequests.listAll(),
      sessions: await runtime.stores.session.list({ parentage: "all" } as never),
      items: await allItems(lab),
      logged,
      lines,
      responses,
    };
    for (const [name, value] of Object.entries(where)) expect(JSON.stringify(value), name).not.toContain("SENTINEL");
    // The run did connect with it: the check above reaches a run that had the key.
    expect(mcp.keys).toContain(SENTINEL);
  }, 60_000);
});

describe("the harness a Lab runs", () => {
  it("hands Claude Code's harness exactly what it handed before when the Lab offers no servers, and the env never carries a seed (BR-19, BR-25)", async () => {
    vi.resetModules();
    const handed: Record<string, unknown>[] = [];
    vi.doMock("@flow-state-dev/claude-code/sdk", async (original) => ({
      ...((await original()) as object),
      claudeCodeAgent: (options: Record<string, unknown>) => (handed.push(options), handler({ name: "x", execute: async () => null } as never)),
    }));
    const { claudeCodeHarness } = await import("../teams/devteam/harness.mts");
    process.env.FSD_TEST_LINEAR_SEED = SENTINEL;
    try {
      const feeds = { cwd: () => "/w", resume: () => null, onSession: () => {}, onUsage: () => {} };
      claudeCodeHarness(feeds);
      claudeCodeHarness({ ...feeds, mcpTools: Object.assign(async () => ({}), { named: async () => [] }) });
    } finally {
      delete process.env.FSD_TEST_LINEAR_SEED;
      vi.doUnmock("@flow-state-dev/claude-code/sdk");
    }
    const [without, withTools] = handed;
    expect(Object.keys(without!).sort()).toEqual(
      ["allowedTools", "cwd", "detached", "env", "onSession", "onUsage", "permissionMode", "recordWork", "resume", "systemPrompt"].sort(),
    );
    const { mcpTools, uses, ...rest } = withTools!;
    expect(rest).toEqual(without);
    expect(typeof mcpTools).toBe("function");
    expect(uses).toHaveLength(2);
    expect(JSON.stringify(handed.map((options) => options.env))).not.toContain("SENTINEL");
  });

  it("says in its session that the scripted coder runs without the project's servers (BR-24)", async () => {
    const stub = harnessStub({ duringRun: commitScriptedWork, finalMessage: "done" });
    const { lab } = await open({ slot: stub.slot });
    await lab.door("POST", "mcp-credentials/linear", { body: { value: SENTINEL } });
    mcp.keys.length = 0;
    const row = await fileOnBoard(lab, "stub-run", "notes");
    expect(row?.status, JSON.stringify(row?.error ?? null)).toBe("completed");
    expect(statusTexts(await allItems(lab)).join("\n")).toContain(
      "This run goes without MCP servers linear: the scripted coder takes no relayed tools.",
    );
    // It said so without connecting.
    expect(mcp.keys).toEqual([]);
  }, 60_000);
});

describe("the start line (BR-20)", () => {
  it("names the servers and whether the Lab user's key is stored, seeded or not set, never the key", async () => {
    const stores = inMemoryStores();
    const first = await open({ stores });
    expect(first.lines).toEqual([`MCP servers: linear (${LAB_USER_ID}'s key: not set).`]);

    process.env.FSD_TEST_LINEAR_SEED = SENTINEL;
    try {
      const seeded = await open();
      expect(seeded.lines).toEqual([`MCP servers: linear (${LAB_USER_ID}'s key: seeded from FSD_TEST_LINEAR_SEED).`]);
    } finally {
      delete process.env.FSD_TEST_LINEAR_SEED;
    }

    await first.lab.door("POST", "mcp-credentials/linear", { body: { value: SENTINEL } });
    await first.lab.dispose();
    opened = opened.filter((lab) => lab !== first.lab);
    const again = await open({ stores });
    expect(again.lines).toEqual([`MCP servers: linear (${LAB_USER_ID}'s key: stored).`]);
  }, 60_000);

  it("is not printed by a Lab given no servers", async () => {
    const { lines } = await open({ mcpServers: undefined, projects: [{ id: "plain", title: "Plain" }] });
    expect(lines).toEqual([]);
  });
});
