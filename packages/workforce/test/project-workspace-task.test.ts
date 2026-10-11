/**
 * `projectWorkspace()` for a run in a task session a conversation's board
 * handed over, on the real engine: where the run's project comes from, in
 * order.
 *
 * 1. The workstream the task was filed from (the session's
 *    `filingWorkstreamId`; its own tests are in
 *    `project-workspace-workstream.test.ts`).
 * 2. The project the task was filed from: a project conversation's
 *    `projectId`, which the hand-over copies onto the task session as its
 *    readonly `filingProjectId`.
 * 3. The project the task names in `input.project`, by visibility and id,
 *    read off the row the run holds, with membership checked against the
 *    run's own user, never anything in the task.
 * 4. With none of these, `no-project`, saying the task can name one.
 *
 * A task that names a project other than its conversation's is refused. Each
 * delegate's turn asks the source the way a coding run's would, and keeps
 * what it answered.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { RunSourceAnswer } from "@flow-state-dev/workspace";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import {
  COORDINATOR_FLOW,
  defineCoordinatorFlow,
  defineProjectBlocks,
  defineSessionBoard,
  defineWorkstreamBlocks,
  projectWorkspace,
  projectWorkspaceCapability,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerManifest } from "../src/manifest";
import { PROJECT_ROW_RESOURCES } from "../src/projects/project-address";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootProjectsHost } from "./projects-harness";

const doorInput = z.object({ message: z.string() });
const PROJECT_COORDINATOR = "pc";

/** A plain view of an answer: the collection ref does not cross the action boundary. */
function view(answer: RunSourceAnswer) {
  if (answer.kind === "refused") return answer;
  if (answer.kind === "files") return { kind: answer.kind, projectId: answer.projectId };
  return { kind: answer.kind, repo: answer.repo, projectId: answer.projectId };
}

/** The filer's flow: it leads workstreams, links to a project as its coordinator, and files for its delegates. */
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
    actions: { run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: { ...board.entries(door), [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() } }
  } as never);
}

/** One run of a delegate's task: its session's state and what the source answered. */
type Asked = { state: Record<string, unknown>; answer: unknown };

/** A delegate that takes a task: its turn asks the run source, as a coding run's would, and keeps the answer. */
function takerFlow(installation: WorkerInstallation, asked: Asked[]) {
  const turn = handler({
    name: "taker-turn",
    inputSchema: doorInput,
    uses: [projectWorkspaceCapability],
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, "taker");
      asked.push({ state: { ...(ctx.session.state as object) }, answer: view(await projectWorkspace()(ctx as never)) });
      return "asked";
    }
  });
  return defineFlow({
    kind: "taker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { [WORKER_TASK_ENTRY]: workerTaskEntry({ name: "taker-task", turn }) } }
  } as never);
}

const standardWorkers: WorkerManifest[] = [
  { id: PROJECT_COORDINATOR, declared: { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }, body: "", skills: [] },
  { id: "chief", declared: { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }, body: "", skills: [] },
  { id: "eng.taker", declared: { flow: "taker", description: "Takes tasks." }, body: "", skills: [] }
];

async function boot() {
  const asked: Asked[] = [];
  const projects = defineProjectBlocks();
  const filerRef = { kind: "filer", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost({
    standardWorkers,
    projectCoordinator: PROJECT_COORDINATOR,
    lab: (installation) => ({
      ...projects.actions,
      ...defineWorkstreamBlocks({ installation, leadFlows: [filerRef] }).actions
    }),
    flows: (installation) => ({
      filer: filerFlow(installation),
      taker: takerFlow(installation, asked),
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, delegateFlows: [], routeModel: "typesafe-ai/jev" })
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const createProject = async (user: string, input: Record<string, unknown>) => h.ok(user, "lab", await lab(user), "createProject", input);
  /** `user`'s project conversation for `project`. */
  const projectConversation = async (user: string, project: { visibility: "shared" | "private"; id: string }) =>
    (await createWorkforceClient({ userId: user, fetcher: h.fetcherFor(user) }).ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: project })).id;
  /** `user`'s conversation with no project. */
  const plainConversation = (user: string) => h.openSession(user, COORDINATOR_FLOW, { workerId: "chief" });
  /** `user` opens workstream `id` in `project`, led by a filer of theirs, and returns its session. */
  const workstreamConversation = async (user: string, project: { visibility: "shared" | "private"; id: string }, id: string) => {
    const roster = await h.openSession(user, "workforce-roster");
    await h.ok(user, "workforce-roster", roster, "hire", { id: `${user}-filer`, flow: "filer", settings: { delegates: ["eng.taker"] } });
    const opened = (await h.ok(user, "lab", await lab(user), "openWorkstream", { project, id, title: id, lead: `${user}-filer` })) as any;
    return opened.workstream.sessionId as string;
  };
  /** File a task for the taker from `session`, and wait for its run. */
  const file = async (user: string, session: string, input: Record<string, unknown> = {}, flow = COORDINATOR_FLOW) => {
    const filed = (await h.ok(user, flow, session, "addTask_tasks", { goal: "Look at the repo", assignee: "eng.taker", ...input })) as any;
    expect(filed).toMatchObject({ ok: true });
    await settled();
    expect(asked).toHaveLength(1);
    return asked[0]!;
  };
  return { ...h, asked, createProject, projectConversation, plainConversation, workstreamConversation, file };
}

const storefront = { visibility: "shared" as const, id: "storefront" };
const STOREFRONT_REPO = "https://github.com/acme/storefront.git";

describe("the project a task is filed from", () => {
  it("reaches the task session as its readonly filing project, from a project conversation", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: STOREFRONT_REPO });
    const run = await h.file("alice", await h.projectConversation("alice", storefront));
    expect(run.state).toMatchObject({ filingProjectId: "shared/storefront", workerId: "eng.taker" });
  });

  it("can't be set by a caller opening a worker session", async () => {
    const h = await boot();
    const forged = await h.tryOpenSession("alice", "taker", { workerId: "eng.taker", filingProjectId: "shared/storefront" });
    expect(forged.status).toBe(400);
    expect(JSON.stringify(forged.json)).toContain("filingProjectId");
  });
});

describe("projectWorkspace for a task a conversation filed", () => {
  it("works in the project of the conversation that filed it, with nothing named (BR-5)", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: STOREFRONT_REPO });
    const run = await h.file("alice", await h.projectConversation("alice", storefront));
    expect(run.answer).toEqual({ kind: "repo", repo: STOREFRONT_REPO, projectId: "storefront" });
  });

  it("works in the project the task names, from a conversation with no project, for a member (BR-6)", async () => {
    const h = await boot();
    await h.createProject("bob", { id: "storefront", title: "Storefront", repository: STOREFRONT_REPO, members: ["alice"] });
    const run = await h.file("alice", await h.plainConversation("alice"), { input: { project: storefront } });
    expect(run.answer).toEqual({ kind: "repo", repo: STOREFRONT_REPO, projectId: "storefront" });
  });

  it("works on the named project's files when it has no repository (BR-10)", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "sandbox", title: "Sandbox" });
    const run = await h.file("alice", await h.plainConversation("alice"), { input: { project: { visibility: "shared", id: "sandbox" } } });
    expect(run.answer).toEqual({ kind: "files", projectId: "sandbox" });
  });

  it("refuses a named project the run's own user isn't a member of, whatever else the task says (BR-7)", async () => {
    const h = await boot();
    await h.createProject("bob", { id: "storefront", title: "Storefront", repository: STOREFRONT_REPO });
    // The task can say anything about who it's for; membership is read off the run's user.
    const run = await h.file("alice", await h.plainConversation("alice"), {
      input: { project: storefront, userId: "bob", members: ["alice"] }
    });
    expect(run.answer).toMatchObject({ kind: "refused", reason: "not-a-member" });
    expect((run.answer as { message: string }).message).toContain('"alice"');
  });

  it("refuses a named project that doesn't exist as no-project (BR-7)", async () => {
    const h = await boot();
    const run = await h.file("alice", await h.plainConversation("alice"), { input: { project: { visibility: "shared", id: "nope" } } });
    expect(run.answer).toMatchObject({ kind: "refused", reason: "no-project" });
    expect((run.answer as { message: string }).message).toContain('"nope"');
  });

  it("refuses a task that names no project, from a conversation with none, saying the task can name one (BR-8)", async () => {
    const h = await boot();
    const run = await h.file("alice", await h.plainConversation("alice"));
    expect(run.answer).toMatchObject({ kind: "refused", reason: "no-project" });
    expect((run.answer as { message: string }).message).toContain("input.project");
  });

  it("refuses a named project other than the project conversation's, naming both (BR-9)", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: STOREFRONT_REPO });
    await h.createProject("alice", { id: "billing", title: "Billing" });
    const run = await h.file("alice", await h.projectConversation("alice", storefront), {
      input: { project: { visibility: "shared", id: "billing" } }
    });
    expect(run.answer).toMatchObject({ kind: "refused", reason: "other-project" });
    const message = (run.answer as { message: string }).message;
    expect(message).toContain('"billing"');
    expect(message).toContain('"storefront"');

    // Naming the conversation's own project is no conflict.
    h.asked.length = 0;
    const same = await h.file("alice", await h.projectConversation("alice", storefront), { input: { project: storefront } });
    expect(same.answer).toEqual({ kind: "repo", repo: STOREFRONT_REPO, projectId: "storefront" });
  });

  it("refuses a named project other than the workstream's it was filed from (BR-9)", async () => {
    const h = await boot();
    await h.createProject("alice", { id: "storefront", title: "Storefront", repository: STOREFRONT_REPO });
    await h.createProject("alice", { id: "billing", title: "Billing" });
    const session = await h.workstreamConversation("alice", storefront, "checkout");
    const run = await h.file("alice", session, { input: { project: { visibility: "shared", id: "billing" } } }, "filer");
    expect(run.answer).toMatchObject({ kind: "refused", reason: "other-project" });
    expect((run.answer as { message: string }).message).toContain('"billing"');
  });

  it("works in the one named by visibility and id when a private and a shared project share an id, and refuses an id alone (BR-9a)", async () => {
    const h = await boot();
    await h.createProject("bob", { id: "storefront", title: "The org's", repository: STOREFRONT_REPO, members: ["alice"] });
    await h.createProject("alice", { id: "storefront", title: "Mine", visibility: "private" });

    const mine = await h.file("alice", await h.plainConversation("alice"), {
      input: { project: { visibility: "private", id: "storefront" } }
    });
    expect(mine.answer).toEqual({ kind: "files", projectId: "storefront" });

    h.asked.length = 0;
    const bare = await h.file("alice", await h.plainConversation("alice"), { input: { project: "storefront" } });
    expect(bare.answer).toMatchObject({ kind: "refused", reason: "no-project" });
    expect((bare.answer as { message: string }).message).toMatch(/visibility and (its )?id/);
  });
});
