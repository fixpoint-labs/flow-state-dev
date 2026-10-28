/**
 * A user's own conversation with a worker opens on a project (FIX-2161),
 * on the real engine and HTTP router, through the workforce client:
 * `setWorkProject` stores the project on the conversation, checked against
 * the user's membership, and the tasks the conversation files run there.
 *
 * Each delegate's turn asks `runProjectOf` the way a coding run's would, and
 * keeps what it answered; every assertion reads that answer or the client's,
 * never a stored key.
 */
import { createClient } from "@flow-state-dev/client";
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import {
  COORDINATOR_FLOW,
  defineCoordinatorFlow,
  defineProjectBlocks,
  defineSessionBoard,
  defineWorkstreamBlocks,
  projectWorkspaceCapability,
  SET_WORK_PROJECT_ACTION,
  setWorkProjectAction,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
import { claimedTask } from "../src/conversation-board/held-task";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerManifest } from "../src/manifest";
import { runProjectOf } from "../src/projects/run-project";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootProjectsHost, ORG } from "./projects-harness";

const doorInput = z.object({ message: z.string() });
type Address = { visibility: "shared" | "private"; id: string };

/** One run of a delegate: where it ran, the task it held, and what `runProjectOf` answered. */
type Run = { worker: string; sessionId: string; state: Record<string, unknown>; goal: string | undefined; answer: unknown };

/** A plain view of `runProjectOf`'s answer. */
function view(found: Awaited<ReturnType<typeof runProjectOf>>) {
  if (found.kind === "refused") return { kind: "refused", reason: found.reason };
  return { kind: "found", project: `${found.visibility}/${found.project.id}`, owner: found.owner };
}

/**
 * The delegates' flow. A turn asks `runProjectOf` and keeps its answer; a
 * turn holding a task whose goal starts "split" files one piece for
 * `eng.coder` through its own board first, once, and one whose goal starts
 * "plan" files a step for itself in a session of its own, once.
 */
function takerFlow(installation: WorkerInstallation, runs: Run[]) {
  const board = defineSessionBoard({ installation, flowKind: "taker" });
  const split = new Set<string>();
  const turn = handler({
    name: "taker-turn",
    inputSchema: doorInput,
    uses: [projectWorkspaceCapability],
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const worker = (await installation.resolveWorker(rawCtx, "taker")).id;
      const held = (await claimedTask(ctx))?.row;
      // The answer turn after a step runs holding the same task: record only the first.
      if (input.message.startsWith("The steps you filed for yourself have ended")) return "answered";
      runs.push({
        worker,
        sessionId: ctx.session.identity.id,
        state: { ...(ctx.session.state as object) },
        // A step in a session of its own arrives as its goal, holding no conversation task.
        goal: held?.goal ?? input.message.trim(),
        answer: view(await runProjectOf(ctx as never))
      });
      if (held !== undefined && held.goal.startsWith("split") && !split.has(held.id)) {
        split.add(held.id);
        const ref = await board.board.resolver(ctx as never);
        // The delegate names a project of its own: the board writes the one it
        // works in over the guess, so the piece isn't refused other-project.
        await ref!.addTask({
          goal: `piece of ${held.goal}`,
          assignee: "eng.coder",
          input: { message: "piece", project: { visibility: "shared", id: "beta" } }
        });
      }
      if (held !== undefined && held.goal.startsWith("plan") && !split.has(held.id)) {
        split.add(held.id);
        const ref = await board.board.turnResolver(ctx as never);
        await ref!.addTask({ id: "s-own", goal: `step of ${held.goal}`, assignee: worker, session: "new" });
      }
      return "asked";
    }
  });
  const planned = board.planned(turn);
  return defineFlow({
    kind: "taker",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: {
      respond: { inputSchema: doorInput, block: planned, userMessage: (i: { message: string }) => i.message },
      ...board.actions,
      [SET_WORK_PROJECT_ACTION]: setWorkProjectAction
    },
    internal: { actions: board.entries(planned) },
    task: { actions: { [WORKER_TASK_ENTRY]: workerTaskEntry({ name: "taker-task", turn: planned }) } }
  } as never);
}

const PROJECT_COORDINATOR = "pc";
const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const standardWorkers: WorkerManifest[] = [
  worker(PROJECT_COORDINATOR, { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }),
  // Two task-taking delegates, so a task filed with no assignee waits on the board.
  worker("lead", { flow: COORDINATOR_FLOW, delegates: ["eng.taker", "eng.coder"] }),
  worker("main", { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }),
  worker("eng.taker", { flow: "taker", description: "Takes tasks.", delegates: ["eng.coder"] }),
  worker("eng.coder", { flow: "taker", description: "Codes." })
];

async function boot() {
  const runs: Run[] = [];
  const projects = defineProjectBlocks();
  const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] });
  const leadRef = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost({
    standardWorkers,
    projectCoordinator: PROJECT_COORDINATOR,
    lab: (installation) => ({ ...projects.actions, ...defineWorkstreamBlocks({ installation, leadFlows: [leadRef] }).actions }),
    // The harness's own `lead` flow is the workstream lead: an app's own worker
    // flow, declaring the action as every worker flow does.
    lead: () => ({ [SET_WORK_PROJECT_ACTION]: setWorkProjectAction }),
    leadInternal: () => ({ [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() }),
    flows: (installation) => ({
      taker: { flow: takerFlow(installation, runs), roles: ["contributor", "manager"] },
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" })
    }),
    models: { generators: { "coordinator-judgment": judgment } },
    // A step in a session of its own parks its request until the step ends.
    durable: true
  });
  const settled = async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const all = await h.runtime.stores.request.list({});
      if (!all.some((request: { status: string }) => request.status === "in_progress")) return;
      if (Date.now() > deadline) throw new Error("a request never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const client = (user: string) => createWorkforceClient(createClient({ userId: user, fetcher: h.fetcherFor(user, ORG) }));
  const createProject = async (user: string, input: Record<string, unknown>) =>
    h.ok(user, "lab", await h.openSession(user, "lab"), "createProject", input);
  /** File `goal` from `session` (on the coordinator flow) and wait for every run it starts. */
  const file = async (user: string, session: string, goal: string, settings: Record<string, unknown> = { assignee: "eng.taker" }) => {
    const filed = (await h.ok(user, COORDINATOR_FLOW, session, "createTask_tasks", { goal, ...settings })) as { ok: boolean; taskId: string };
    expect(filed).toMatchObject({ ok: true });
    await settled();
    return filed.taskId;
  };
  /** What the run of the task whose goal is `goal` answered. */
  const answerOf = (goal: string) => {
    const found = runs.filter((run) => run.goal === goal);
    expect(found, `runs of "${goal}"`).toHaveLength(1);
    return found[0]!.answer;
  };
  return { ...h, runs, client, createProject, file, settled, answerOf };
}

const apollo: Address = { visibility: "shared", id: "apollo" };
const beta: Address = { visibility: "shared", id: "beta" };
const inApollo = { kind: "found", project: "shared/apollo", owner: "alice" };
const inBeta = { kind: "found", project: "shared/beta", owner: "alice" };

async function withProjects() {
  const h = await boot();
  await h.createProject("alice", { id: "apollo", title: "Apollo" });
  await h.createProject("alice", { id: "beta", title: "Beta" });
  await h.createProject("bob", { id: "bobs", title: "Bob's", visibility: "private" });
  return h;
}

describe("a user's conversation with a worker, set to a project", () => {
  it("default: the worker's one conversation, set after it has talked, files a task that runs in the project", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = await alice.ensureWorkerSession({ worker: "lead" });
    await h.ok("alice", COORDINATOR_FLOW, lead.id, "respond", { message: "hi" });

    expect(await alice.setWorkProject("lead", apollo)).toEqual({ project: apollo });
    await h.file("alice", lead.id, "look at the repo");
    expect(h.answerOf("look at the repo")).toEqual(inApollo);
    // The task's session was handed the project, readonly.
    expect(h.runs[0]!.state).toMatchObject({ filingProjectId: "shared/apollo" });
  });

  it("new-session: a session of the worker created at its own id, then set, runs its tasks in the project", async () => {
    const h = await withProjects();
    const session = await h.openSession("alice", COORDINATOR_FLOW, { workerId: "main" });
    await h.client("alice").setWorkProject("main", apollo, { sessionId: session });
    await h.file("alice", session, "look at the repo");
    expect(h.answerOf("look at the repo")).toEqual(inApollo);
  });

  it("listWorkerSessions lists a session with workProjectId: both conversations set to a project, not the coordinator's own", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const main = await alice.ensureWorkerSession({ worker: "main" });
    const other = await h.openSession("alice", COORDINATOR_FLOW, { workerId: "main" });
    expect(await alice.setWorkProject("main", apollo)).toEqual({ project: apollo });
    expect(await alice.setWorkProject("main", beta, { sessionId: other })).toEqual({ project: beta });
    const listed = (await alice.listWorkerSessions("main")).map((entry) => [entry.session.id, entry.isDefault]);
    expect(listed).toHaveLength(2);
    expect(listed).toContainEqual([main.id, true]);
    expect(listed).toContainEqual([other, false]);
    // The project coordinator's session for a project is still left out.
    const coordinator = await alice.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: apollo });
    expect((await alice.listWorkerSessions(PROJECT_COORDINATOR)).map((entry) => entry.session.id)).not.toContain(coordinator.id);
  });

  it("change: a task filed before the change keeps its project, and one filed after takes the new one", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    await alice.setWorkProject("lead", apollo);
    await h.file("alice", lead, "first");
    expect(await alice.setWorkProject("lead", beta)).toEqual({ project: beta });
    await h.file("alice", lead, "second");
    expect(h.answerOf("first")).toEqual(inApollo);
    expect(h.answerOf("second")).toEqual(inBeta);
  });

  it("follow-up: a follow-up filed after the change runs in its root's session, in the root's project", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    await alice.setWorkProject("lead", apollo);
    const first = await h.file("alice", lead, "first");
    await alice.setWorkProject("lead", beta);
    // Named either way, the follow-up works where its root's session works.
    await h.file("alice", lead, "follow up in apollo", { followUpOf: first, input: { project: apollo } });
    await h.file("alice", lead, "follow up in beta", { followUpOf: first, input: { project: beta } });
    expect(h.answerOf("follow up in apollo")).toEqual(inApollo);
    expect(h.answerOf("follow up in beta")).toEqual(inApollo);
    expect(new Set(h.runs.map((run) => run.sessionId)).size).toBe(1);
  });

  it("legacy follow-up: a follow-up of a task filed before rows kept their project stays in the task's project after a change", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    // Filed with no conversation project, naming Apollo, as rows were before the stamp.
    const first = await h.file("alice", lead, "first", { assignee: "eng.taker", input: { project: apollo } });
    expect(h.answerOf("first")).toEqual(inApollo);
    await h.unstamp("alice", first);
    await alice.setWorkProject("lead", beta);
    await h.file("alice", lead, "follow up first", { followUpOf: first, input: { project: apollo } });
    expect(h.answerOf("follow up first")).toEqual(inApollo);
  });

  it("legacy follow-up in a project: a follow-up of a task the project coordinator filed before rows kept their project stays in the coordinator's project", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const pc = (await alice.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: apollo })).id;
    const first = await h.file("alice", pc, "first", { assignee: "eng.taker" });
    expect(h.answerOf("first")).toEqual(inApollo);
    // A row from before the board wrote the conversation's project over the one an input named.
    await h.unstamp("alice", first, { project: beta });
    await h.file("alice", pc, "follow up first", { followUpOf: first, input: { project: beta } });
    expect(h.answerOf("follow up first")).toEqual(inApollo);
  });

  it("waiting: a task filed under one project and assigned after the change still runs in the first", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    await alice.setWorkProject("lead", apollo);
    // Two delegates take tasks, so a task with no assignee waits on the board.
    const waiting = await h.file("alice", lead, "waiting", {});
    expect(h.runs).toHaveLength(0);
    await alice.setWorkProject("lead", beta);
    await h.ok("alice", COORDINATOR_FLOW, lead, "updateTask_tasks", { id: waiting, assignee: "eng.taker" });
    await h.settled();
    expect(h.answerOf("waiting")).toEqual(inApollo);
  });

  it("legacy waiting: a task filed before rows kept their project, assigned after a change, still runs in its project", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    // Filed with no conversation project, naming Apollo, as rows were before the stamp.
    const waiting = await h.file("alice", lead, "waiting", { input: { project: apollo } });
    expect(h.runs).toHaveLength(0);
    await h.unstamp("alice", waiting);
    await alice.setWorkProject("lead", beta);
    await h.ok("alice", COORDINATOR_FLOW, lead, "updateTask_tasks", { id: waiting, assignee: "eng.taker" });
    await h.settled();
    expect(h.answerOf("waiting")).toEqual(inApollo);
  });

  it("ongoing: a task routed to a delegate's ongoing session runs in the project, and so does a piece it files", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    await alice.setWorkProject("lead", apollo);
    await h.file("alice", lead, "split the work", { assignee: "eng.taker", session: "ongoing", resultTo: "conversation" });
    const ongoing = h.runs.find((run) => run.goal === "split the work")!;
    // The delegate's ongoing session works no one task: it carries no project of its own.
    expect(ongoing.state).not.toHaveProperty("taskId");
    expect(ongoing.state).not.toHaveProperty("filingProjectId");
    expect(ongoing.answer).toEqual(inApollo);
    // One hop further down: the piece it filed while holding the task, naming
    // another project, which the board wrote over.
    expect(h.answerOf("piece of split the work")).toEqual(inApollo);
  });

  it("ongoing step: a step that delegate files for itself in a session of its own runs in the project too", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    await alice.setWorkProject("lead", apollo);
    await h.file("alice", lead, "plan the work", { assignee: "eng.taker", session: "ongoing", resultTo: "conversation" });
    expect(h.answerOf("plan the work")).toEqual(inApollo);
    expect(h.answerOf("step of plan the work")).toEqual(inApollo);
  });

  it("not-a-member: a reader of the project who may not work in it is refused, another user's private project isn't found, and nothing is stored", async () => {
    const h = await withProjects();
    const carol = h.client("carol");
    const lead = (await carol.ensureWorkerSession({ worker: "lead" })).id;
    await expect(carol.setWorkProject("lead", apollo)).rejects.toThrow(/not-a-member/);
    await expect(h.client("alice").setWorkProject("lead", { visibility: "private", id: "bobs" })).rejects.toThrow(
      /no private project "bobs"/
    );
    await h.file("carol", lead, "look at the repo");
    expect(h.answerOf("look at the repo")).toEqual({ kind: "refused", reason: "no-project" });
  });

  it("other worker: a session named for one worker but running another is refused, and nothing is stored", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const main = (await alice.ensureWorkerSession({ worker: "main" })).id;
    // "lead" and "main" share the coordinator flow, so only the session's worker tells them apart.
    await expect(alice.setWorkProject("lead", apollo, { sessionId: main })).rejects.toThrow(/this session runs "main", not "lead"/);
    await h.file("alice", main, "look at the repo");
    expect(h.answerOf("look at the repo")).toEqual({ kind: "refused", reason: "no-project" });
  });

  it("not-seeded: a create that seeds the field is refused", async () => {
    const h = await withProjects();
    const forged = await h.tryOpenSession("alice", COORDINATOR_FLOW, { workerId: "main", workProjectId: "shared/apollo" });
    expect(forged.status).toBe(400);
    expect(JSON.stringify(forged.json)).toContain("workProjectId");
  });

  it("not-these: the project coordinator's, a task's and a workstream lead's sessions are refused", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const pc = await alice.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: apollo });
    await expect(alice.setWorkProject(PROJECT_COORDINATOR, beta, { sessionId: pc.id })).rejects.toThrow(/a project coordinator's session/);

    const lead = (await alice.ensureWorkerSession({ worker: "lead" })).id;
    await h.file("alice", lead, "look at the repo");
    const task = h.runs[0]!.sessionId;
    await expect(alice.setWorkProject("eng.taker", beta, { sessionId: task })).rejects.toThrow(/a task's session/);

    await h.hire("alice", "alice-filer", "lead", ORG, { delegates: ["eng.taker"] });
    const opened = (await h.ok("alice", "lab", await h.openSession("alice", "lab"), "openWorkstream", {
      project: apollo,
      id: "ws",
      title: "ws",
      lead: "alice-filer"
    })) as { workstream: { sessionId: string } };
    await expect(alice.setWorkProject("alice-filer", beta, { sessionId: opened.workstream.sessionId })).rejects.toThrow(/a workstream lead's session/);
  });

  it("messages: setting the project leaves the conversation where messages land", async () => {
    const h = await withProjects();
    const alice = h.client("alice");
    const before = await alice.ensureWorkerSession({ worker: "lead" });
    await alice.setWorkProject("lead", apollo);
    expect((await alice.findWorkerSession({ worker: "lead" }))?.id).toBe(before.id);
  });
});
