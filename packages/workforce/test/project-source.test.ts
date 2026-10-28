/**
 * `projectSourceCapability`: a worker reads its session's project with no
 * coding run, on the real engine, against a real `file://` repository and the
 * real local workspace host.
 *
 * The tools ask the host's run source, `projectWorkspace()`, so every refusal
 * here is the one a coding run in the same session would get, and it arrives
 * as a tool result. A refused read reaches no file: the host's root holds no
 * clone after one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@flow-state-dev/client";
import { defineFlow, handler } from "@flow-state-dev/core";
import { resolveActivePresets } from "@flow-state-dev/core/capability";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { localWorkspaceHost, type WorkspaceHost } from "@flow-state-dev/workspace";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers } from "../src/hire";
import {
  COORDINATOR_FLOW,
  defineCoordinatorFlow,
  defineProjectBlocks,
  defineProjectFilesCollection,
  defineWorkstreamBlocks,
  projectSourceCapability,
  projectWorkspace,
  projectWorkspaceCapability,
  SET_WORK_PROJECT_ACTION,
  setWorkProjectAction,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerManifest } from "../src/manifest";
import { PROJECT_ROW_RESOURCES, projectRowsAt } from "../src/projects/project-address";
import { projectSourceTools, readProjectSourceFor } from "../src/projects/project-source";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootProjectsHost } from "./projects-harness";

const VALUE = "LC-4242-HELD-OUT";
const scratch = mkdtempSync(join(tmpdir(), "project-source-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A bare `file://` repository holding `files` on `main`. */
function repository(files: Record<string, string>): string {
  const work = mkdtempSync(join(scratch, "work-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@e.st", "-c", "user.name=t", ...args], { cwd: work });
  git("init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  }
  git("add", ".");
  git("commit", "-q", "-m", "start");
  const bare = `${work}.git`;
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);
  return pathToFileURL(bare).href;
}

const REPO = repository({ "README.md": "# Billing\n", "src/billing/ledger/codes.ts": `export const LEDGER_CODE = "${VALUE}";\n` });
const doorInput = z.object({ message: z.string() });
const standardWorkers: WorkerManifest[] = [
  { id: "pc", declared: { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }, body: "", skills: [] },
  { id: "eng.reader", declared: { flow: "reader" }, body: "", skills: [] },
  { id: "eng.taker", declared: { flow: "taker", description: "Takes tasks." }, body: "", skills: [] }
];

/** Takes `user` off a shared project's members by editing the stored row: the package has no write for it. */
const takeOffProject = handler({
  name: "take-off-project",
  inputSchema: z.object({ id: z.string(), user: z.string() }),
  outputSchema: z.object({}),
  resources: { ...PROJECT_ROW_RESOURCES },
  execute: async (input, ctx) => {
    const row = await projectRowsAt(ctx, "shared").get(input.id);
    await row.updateState((state) => ({ ...state, members: state.members.filter((member) => member !== input.user) }));
    return {};
  }
});

/** Writes one of a shared project's kept files, as a run's save does. */
const seedFile = handler({
  name: "seed-file",
  inputSchema: z.object({ key: z.string(), content: z.string() }),
  outputSchema: z.object({}),
  resources: { files: defineProjectFilesCollection() },
  execute: async (input, ctx) => {
    const files = ctx.resources.files as unknown as ResourceCollectionRef;
    const ref = await files.create(input.key, { path: input.key, hash: null, updatedAt: null });
    await ref.writeContent(input.content);
    return {};
  }
});

/** Boot a host whose `reader` worker flow has the three tools as actions, and a `taker` whose task turn reads. */
async function boot() {
  const root = mkdtempSync(join(scratch, "host-"));
  const workspace = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: projectWorkspace() });
  const tools = projectSourceTools(workspace);
  const toolActions = {
    glob: { block: tools.globProjectSource },
    read: { block: tools.readProjectSource },
    grep: { block: tools.grepProjectSource }
  };
  const taskReads: unknown[] = [];
  const readerFlow = (installation: WorkerInstallation) => {
    const door = handler({ name: "reader-run", inputSchema: doorInput, resources: { ...installation.resources }, execute: () => "ok" });
    return defineFlow({
      kind: "reader",
      configSchema: workerConfigSchema(),
      session: installation.session(),
      resources: { ...installation.resources },
      actions: {
        respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
        [SET_WORK_PROJECT_ACTION]: setWorkProjectAction,
        ...toolActions
      }
    } as never);
  };
  // A delegate whose task turn reads its project the way the grep tool does.
  const takerFlow = (installation: WorkerInstallation) => {
    const turn = handler({
      name: "taker-turn",
      inputSchema: doorInput,
      uses: [projectWorkspaceCapability],
      resources: { ...installation.resources },
      execute: async (_input, ctx) => {
        await installation.resolveWorker(ctx, "taker");
        taskReads.push({ state: { ...(ctx.session.state as object) }, read: await readProjectSourceFor(workspace, ctx, { kind: "grep", pattern: "LEDGER_CODE =" }) });
        return "read";
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
  };
  const projects = defineProjectBlocks();
  const leadRef = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost({
    standardWorkers,
    projectCoordinator: "pc",
    lab: (installation) => ({
      ...projects.actions,
      ...defineWorkstreamBlocks({ installation, leadFlows: [leadRef] }).actions,
      takeOffProject: { block: takeOffProject },
      seedFile: { block: seedFile }
    }),
    lead: () => toolActions,
    leadInternal: () => ({ [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() }),
    flows: (installation) => ({
      reader: { flow: readerFlow(installation), roles: [] },
      taker: { flow: takerFlow(installation), roles: ["contributor"] },
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" })
    }),
    models: { generators: { "coordinator-judgment": mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }) } }
  });
  const lab = (user: string) => h.openSession(user, "lab");
  const createProject = async (user: string, input: Record<string, unknown>) => h.ok(user, "lab", await lab(user), "createProject", input);
  /** `user`'s own conversation with the reader, set to `project`. */
  const readerIn = async (user: string, project?: { visibility: "shared" | "private"; id: string }) => {
    const session = await h.openSession(user, "reader", { workerId: "eng.reader" });
    if (project !== undefined) await h.ok(user, "reader", session, SET_WORK_PROJECT_ACTION, { project });
    return session;
  };
  const clones = () => (existsSync(join(root, ".clones")) ? readdirSync(join(root, ".clones")).filter((name) => name.endsWith(".git")) : []);
  const places = () => (existsSync(root) ? readdirSync(root).filter((name) => !name.startsWith(".")) : []);
  const settled = async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const all = await h.runtime.stores.request.list({});
      if (!all.some((request: { status: string }) => request.status === "in_progress")) return;
      if (Date.now() > deadline) throw new Error("a request never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return { ...h, lab, createProject, readerIn, clones, places, taskReads, settled };
}

const storefront = { visibility: "shared" as const, id: "storefront" };

describe("a member's session reads its project's repository", () => {
  it("lists, reads a line range and greps the default branch, with no place made", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: REPO });
    const session = await h.readerIn("alice", storefront);

    const glob = (await h.ok("alice", "reader", session, "glob", { pattern: "src/**" })) as any;
    const grep = (await h.ok("alice", "reader", session, "grep", { pattern: "LEDGER_CODE =" })) as any;
    const read = (await h.ok("alice", "reader", session, "read", { path: "src/billing/ledger/codes.ts", startLine: 1, endLine: 1 })) as any;

    expect(glob).toMatchObject({ kind: "glob", paths: ["src/billing/ledger/codes.ts"], at: { kind: "repo", branch: "main" } });
    expect(grep).toMatchObject({ kind: "grep", dialect: "extended-regex", matches: [{ path: "src/billing/ledger/codes.ts", line: 1 }] });
    expect(read).toMatchObject({ kind: "read", status: "ok", totalLines: 1 });
    expect(read.content).toContain(VALUE);
    expect(h.clones()).toHaveLength(1);
    expect(h.places()).toEqual([]);
  });

  it("reads a project with no repository from its kept files", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "notes", title: "Notes" });
    await h.ok("alice", "lab", await h.lab("alice"), "seedFile", { key: "notes/plan.md", content: `# Plan\nThe code is ${VALUE}\n` });
    await h.ok("alice", "lab", await h.lab("alice"), "seedFile", { key: "other/plan.md", content: "not this project's\n" });
    const session = await h.readerIn("alice", { visibility: "shared", id: "notes" });

    const glob = (await h.ok("alice", "reader", session, "glob", {})) as any;
    const grep = (await h.ok("alice", "reader", session, "grep", { pattern: "code is" })) as any;

    expect(glob).toMatchObject({ kind: "glob", at: { kind: "files" }, paths: ["plan.md"] });
    expect(grep).toMatchObject({ dialect: "javascript-regex", matches: [{ path: "plan.md", line: 2 }] });
    expect(h.clones()).toEqual([]);
  });
});

describe("a session that may not see the project gets the coding run's refusal, as a tool result", () => {
  it("refuses a session with no project no-project, and reads nothing", async () => {
    const h = await boot();
    const session = await h.readerIn("alice");

    const grep = (await h.ok("alice", "reader", session, "grep", { pattern: "LEDGER" })) as any;
    expect(grep).toMatchObject({ kind: "refused", reason: "no-project" });
    expect(grep.message).toEqual(expect.any(String));
    expect(h.clones()).toEqual([]);
  });

  it("refuses a user taken off the project's members not-a-member, and reads nothing", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: REPO, members: ["bob"] });
    const session = await h.readerIn("bob", storefront);
    await h.ok("alice", "lab", await h.lab("alice"), "takeOffProject", { id: "storefront", user: "bob" });

    const read = (await h.ok("bob", "reader", session, "read", { path: "src/billing/ledger/codes.ts" })) as any;
    const grep = (await h.ok("bob", "reader", session, "grep", { pattern: "LEDGER" })) as any;
    expect(read).toMatchObject({ kind: "refused", reason: "not-a-member" });
    expect(grep).toMatchObject({ kind: "refused", reason: "not-a-member" });
    expect(JSON.stringify([read, grep])).not.toContain(VALUE);
    expect(h.clones()).toEqual([]);
  });

  it("refuses a workstream owner taken off the project's members, for a read as for a coding run", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: REPO });
    await h.hire("alice", "alice-lead", "lead");
    const opened = (await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: storefront,
      id: "checkout",
      title: "Checkout",
      lead: "alice-lead"
    })) as any;
    const session = opened.workstream.sessionId as string;
    expect(await h.ok("alice", "lead", session, "glob", { pattern: "README.md" })).toMatchObject({ kind: "glob", paths: ["README.md"] });

    await h.ok("alice", "lab", await h.lab("alice"), "takeOffProject", { id: "storefront", user: "alice" });
    expect(await h.ok("alice", "lead", session, "grep", { pattern: "LEDGER" })).toMatchObject({ kind: "refused", reason: "not-a-member" });
  });

  it("answers a path that is not a repository path with the host's refusal", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: REPO });
    const session = await h.readerIn("alice", storefront);

    expect(await h.ok("alice", "reader", session, "read", { path: "../storefront.git/config" })).toMatchObject({
      kind: "refused",
      reason: "invalid-path"
    });
  });
});

describe("a delegate's task session finds its project the way a coding run does", () => {
  it("reads the project its task was filed from, by the session's filing project", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: REPO });
    const conversation = (
      await createWorkforceClient(createClient({ userId: "alice", fetcher: h.fetcherFor("alice") })).ensureWorkerSession({
        worker: "pc",
        projectId: storefront
      })
    ).id;
    await h.ok("alice", COORDINATOR_FLOW, conversation, "createTask_tasks", { goal: "Find the ledger code", assignee: "eng.taker" });
    await h.settled();

    expect(h.taskReads).toEqual([
      {
        state: expect.objectContaining({ filingProjectId: "shared/storefront", workerId: "eng.taker" }),
        read: expect.objectContaining({ kind: "grep", matches: [expect.objectContaining({ path: "src/billing/ledger/codes.ts" })] })
      }
    ]);
  });
});

describe("the capability", () => {
  const stub = (reads: { count: number }): WorkspaceHost =>
    ({
      source: () => ({ kind: "refused", reason: "no-project", message: "none" }),
      readSource: async () => {
        reads.count += 1;
        throw new Error("unreachable");
      }
    }) as unknown as WorkspaceHost;

  it("is refused when it is built over a host with no read view", () => {
    const host = { source: () => ({ kind: "refused", reason: "x", message: "x" }) } as unknown as WorkspaceHost;
    expect(() => projectSourceCapability({ workspace: host })).toThrow(/no read view/);
  });

  it("offers exactly three read tools, in one preset that is off until a worker names it", () => {
    const capability = projectSourceCapability({ workspace: stub({ count: 0 }) });
    expect(resolveActivePresets(capability)).toEqual([]);
    const presets = resolveActivePresets(capability.presets({ read: true }));
    expect(presets.map((p) => p.name)).toEqual(["read"]);
    const tools = (presets[0]!.preset.tools as Array<{ name: string }>).map((tool) => tool.name);
    // No tool writes: a change to the project's files is a coding run's job.
    expect(tools).toEqual(["globProjectSource", "readProjectSource", "grepProjectSource"]);
  });

  it("reaches the model of a worker whose file names the preset, and no other worker's", async () => {
    let asked = 0;
    const host = {
      source: () => {
        asked += 1;
        return { kind: "refused", reason: "no-project", message: "none" };
      },
      readSource: async () => ({})
    } as unknown as WorkspaceHost;
    const flow = defineAgentWorkerFlow({ uses: [projectSourceCapability({ workspace: host })] });
    const workers = mintWorkers(
      [
        { id: "desk.main", declared: { capabilities: { projectSource: ["read"] } }, body: "" },
        { id: "desk.other", declared: {}, body: "" }
      ],
      { workerFlows: { [AGENT_FLOW]: flow } }
    );
    const turn = async (id: string) => {
      const worker = workers.find((candidate) => candidate.id === id)!;
      const answer = mockGenerator({
        name: "agent-answer",
        script: [{ toolCalls: [{ toolCallId: "call-1", toolName: "grepProjectSource", args: { pattern: "x" } }] }, { text: "done" }]
      });
      const runtime = await createTestContext({
        flow: { ...worker, cardinality: "singleton" },
        orgId: "test-org",
        org: { state: {} },
        sessionId: `session-${id}`,
        sequencerName: worker.actions.respond!.block.name,
        declaredResources: worker.actions.respond!.block.declaredResources,
        generators: { "agent-answer": answer },
        unmockedGeneratorPolicy: "allow"
      });
      return await executeBlock({ block: worker.actions.respond.block, input: { message: "read it" }, ctx: runtime.ctx });
    };

    expect((await turn("desk.other")).error).toBeUndefined();
    expect(asked).toBe(0);
    expect((await turn("desk.main")).error).toBeUndefined();
    expect(asked).toBe(1);
  });
});
