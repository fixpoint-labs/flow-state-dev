/**
 * An app's session fields (`sessionFields`, declared on the installation) are
 * written by the server when a user's conversation opens, through
 * `setSessionFields`, and carried down every hand-over from it: a task its
 * board hands a delegate, and a piece that delegate files in turn. Never by a
 * caller: a create seeding one is refused, naming it.
 *
 * On the real engine and HTTP router. Each delegate's turn keeps the session
 * state it ran with, the state a coding run's source would read, and the
 * assertions read that, or the client's answer.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { COORDINATOR_FLOW, defineCoordinatorFlow, defineSessionBoard, SET_SESSION_FIELDS_ACTION, workerConfigSchema } from "../src/index";
import { claimedTask } from "../src/conversation-board/held-task";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerManifest } from "../src/manifest";
import type { WorkerInstallation } from "../src/workers/installation";
import type { SessionFields } from "../src/workers/session-fields";
import { setSessionFieldsAction } from "../src/workers/session-fields";
import { bootProjectsHost, ORG } from "./projects-harness";

const doorInput = z.object({ message: z.string() });

/** One delegate's turn: the task it held and the session state it ran with. */
type Run = { goal: string; sessionId: string; state: Record<string, unknown> };

/** The delegates' flow: a turn keeps its state, and a task whose goal starts "split" files one piece for `eng.coder`. */
function takerFlow(installation: WorkerInstallation, runs: Run[]) {
  const board = defineSessionBoard({ installation, flowKind: "taker" });
  const turn = handler({
    name: "taker-turn",
    inputSchema: doorInput,
    resources: { ...installation.resources, ...board.resources },
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      await installation.resolveWorker(rawCtx, "taker");
      const held = (await claimedTask(ctx))?.row;
      // A notice wakes the turn again holding the same task: take only its first.
      if (held === undefined || runs.some((run) => run.goal === held.goal)) return "idle";
      runs.push({ goal: held.goal, sessionId: ctx.session.identity.id, state: { ...(ctx.session.state as object) } });
      if (held.goal.startsWith("split")) {
        const ref = await board.board.resolver(ctx as never);
        await ref!.createTask({ goal: `piece of ${held.goal}`, assignee: "eng.coder", input: { message: "piece" } });
      }
      return "done";
    }
  });
  const planned = board.planned(turn);
  return defineFlow({
    kind: "taker",
    configSchema: workerConfigSchema(),
    session: installation.session(board.sessionStateShape),
    resources: { ...installation.resources, ...board.resources },
    actions: {
      respond: { inputSchema: doorInput, block: planned, userMessage: (i: { message: string }) => i.message },
      // Declared here as the agent and coordinator flows declare it, so a task session's write reaches the action's refusal.
      [SET_SESSION_FIELDS_ACTION]: setSessionFieldsAction(installation.sessionFields),
      ...board.actions
    },
    internal: { actions: board.entries(planned) },
    task: { actions: { work: workerTaskEntry({ name: "taker-task", turn: planned }) } }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const standardWorkers: WorkerManifest[] = [
  worker("lead", { flow: COORDINATOR_FLOW, delegates: ["eng.taker"] }),
  worker("eng.taker", { flow: "taker", description: "Takes tasks.", delegates: ["eng.coder"] }),
  worker("eng.coder", { flow: "taker", description: "Codes." })
];

async function boot(sessionFields: SessionFields = { repository: z.string().min(1) }) {
  const runs: Run[] = [];
  const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] });
  const h = await bootProjectsHost({
    standardWorkers,
    sessionFields,
    lab: () => ({}),
    flows: (installation) => ({
      taker: { flow: takerFlow(installation, runs), roles: ["contributor", "manager"] },
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" })
    }),
    models: { generators: { "coordinator-judgment": judgment } }
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
  /** A new conversation with `lead`, opened on `repository` by the server. */
  const open = async (repository: string) => {
    const session = await h.openSession("alice", COORDINATOR_FLOW, { workerId: "lead" });
    await h.ok("alice", COORDINATOR_FLOW, session, SET_SESSION_FIELDS_ACTION, { worker: "lead", fields: { repository } });
    return session;
  };
  const stateOf = async (sessionId: string) => (await h.runtime.stores.session.get(sessionId))!.state as Record<string, unknown>;
  return { ...h, runs, settled, open, stateOf };
}

describe("an app's session field, written at open and carried down the hand-over", () => {
  it("is written by the server at open, and a caller can't seed it", async () => {
    const h = await boot();
    const session = await h.open("repo-b");
    expect(await h.stateOf(session)).toMatchObject({ repository: "repo-b" });

    const seeded = await h.tryOpenSession("alice", COORDINATOR_FLOW, { workerId: "lead", repository: "repo-a" }, ORG);
    expect(seeded.status).toBe(400);
    expect(JSON.stringify(seeded.json)).toContain("repository");
  });

  it("is carried down the hand-over: the task its board hands a delegate, and the piece that delegate files, see the conversation's", { timeout: 30_000 }, async () => {
    const h = await boot();
    await h.open("repo-a");
    const second = await h.open("repo-b");
    const filed = (await h.ok("alice", COORDINATOR_FLOW, second, "createTask_tasks", { goal: "split the work", assignee: "eng.taker" })) as { ok: boolean };
    expect(filed).toMatchObject({ ok: true });
    await h.settled();
    const ran = Object.fromEntries(h.runs.map((run) => [run.goal, run.state.repository]));
    expect(ran).toEqual({ "split the work": "repo-b", "piece of split the work": "repo-b" });
  });

  it("is read-only after open: a second write, a task session's write and an undeclared field are refused, storing nothing", { timeout: 30_000 }, async () => {
    const h = await boot();
    const session = await h.open("repo-b");
    const again = await h.act("alice", COORDINATOR_FLOW, session, SET_SESSION_FIELDS_ACTION, { fields: { repository: "repo-a" } });
    expect(JSON.stringify(again.error)).toContain("already has one");
    const undeclared = await h.act("alice", COORDINATOR_FLOW, session, SET_SESSION_FIELDS_ACTION, { fields: { branch: "main" } });
    expect(JSON.stringify(undeclared.error)).toContain("no session field");
    expect(await h.stateOf(session)).toMatchObject({ repository: "repo-b" });

    // A task's session takes its field from the hand-over, never from a write.
    await h.ok("alice", COORDINATOR_FLOW, session, "createTask_tasks", { goal: "look", assignee: "eng.taker" });
    await h.settled();
    const task = { id: h.runs.find((run) => run.goal === "look")!.sessionId };
    const write = await h.act("alice", "taker", task.id, SET_SESSION_FIELDS_ACTION, { fields: { repository: "repo-a" } });
    expect(JSON.stringify(write.error)).toContain("can't be set");
    expect(await h.stateOf(task.id)).toMatchObject({ repository: "repo-b" });
  });

  it("is written once when two opens race: one wins, the other is refused, and the winner's value stays", { timeout: 30_000 }, async () => {
    const h = await boot();
    const session = await h.openSession("alice", COORDINATOR_FLOW, { workerId: "lead" });
    const write = (repository: string) =>
      h.act("alice", COORDINATOR_FLOW, session, SET_SESSION_FIELDS_ACTION, { worker: "lead", fields: { repository } });
    const [a, b] = await Promise.all([write("repo-a"), write("repo-b")]);
    const won = [a, b].filter((result) => result.settled === "completed");
    const refused = [a, b].filter((result) => result.settled !== "completed");
    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(refused[0]!.error)).toContain("already has one");
    expect((await h.stateOf(session)).repository).toBe(won[0] === a ? "repo-a" : "repo-b");
  });

  it("keeps the value its schema parsed at open, once, at every hop: a transforming schema doesn't run again on the stored value", { timeout: 30_000 }, async () => {
    const h = await boot({ repository: z.string().transform((name) => `${name}-repo`) });
    const session = await h.open("billing");
    expect((await h.stateOf(session)).repository).toBe("billing-repo");
    await h.ok("alice", COORDINATOR_FLOW, session, "createTask_tasks", { goal: "split the work", assignee: "eng.taker" });
    await h.settled();
    const ran = Object.fromEntries(h.runs.map((run) => [run.goal, run.state.repository]));
    expect(ran).toEqual({ "split the work": "billing-repo", "piece of split the work": "billing-repo" });
  });
});
