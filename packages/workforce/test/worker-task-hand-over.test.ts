/**
 * A task names a worker, and the list hands it to that worker.
 *
 * Two halves. The lookup on its own, over an installation, so each rule about
 * who a name reaches is one assertion: a standard worker, nobody, a user's
 * own worker, one whose flow takes no tasks.
 *
 * Then the whole path on a real host: a mailbox with one task list that no
 * worker flow was wired to, a coordinator board over it whose fallback asks
 * the lookup, and the one `agent` copy taking tasks from the mailbox's lists.
 * A task filed for a worker runs on the shared copy, in a session of its own
 * created naming the worker, as one turn holding the task's goal, and settles
 * with the answer.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createWorkerInstallation,
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  mailboxBoard,
  mailboxInstances,
  openMailboxes,
  type MailboxManifest,
  type WorkerInstallation,
  type WorkerLookup
} from "../src/index";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";

const ORG = DEFAULT_ORG_ID;
const USER_ID = "u_coordinator";
const ctx = {} as BlockContext;

/** An app's own worker flow with no task entry, bound to `installation`. */
function deskClerk(installation: WorkerInstallation) {
  return defineFlow({
    kind: "desk-clerk",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      ...workerDoor,
      answer: {
        inputSchema: z.object({ note: z.string() }),
        block: handler({
          name: "desk-answer",
          inputSchema: z.object({ note: z.string() }),
          outputSchema: z.object({ note: z.string() }),
          execute: (input) => input
        })
      }
    }
  });
}

/** An installation whose `agent` takes tasks from `listId`, with an auditor on it and a clerk on `desk-clerk`. */
function installationFor(listId: string) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "eng.auditor", declared: {}, body: "You audit." },
      { id: "ops.clerk", declared: { flow: "desk-clerk" }, body: "You file." }
    ],
    workerFlows: () => flows as never
  });
  flows = { agent: defineAgentWorkerFlow({ installation, taskLists: [listId] }), "desk-clerk": deskClerk(installation) };
  return installation;
}

describe("which worker a name on a task means", () => {
  const list = mailboxBoard("ops.desk", "work");
  const lookup = createWorkerLookup({ installation: installationFor(list.id) });

  it("finds a standard worker by its id, on the flow it runs on", () => {
    expect(lookup.find("eng.auditor", ctx)).toEqual({ found: true, flowId: "agent" });
  });

  it("finds no worker for a name the files don't declare, a user's own worker's included", () => {
    expect(lookup.find("frontend", ctx)).toMatchObject({ found: false, reason: "not-found" });
  });

  it("refuses a worker whose flow takes no tasks, still saying which flow it runs on", () => {
    const answer = lookup.find("ops.clerk", ctx);
    expect(answer).toMatchObject({ found: false, reason: "takes-no-tasks", flowId: "desk-clerk" });
    expect(!answer.found && answer.message).toMatch(/"ops.clerk" takes no tasks: its flow "desk-clerk"/);
  });

  it("names the task's worker in the child session's starting state", async () => {
    expect(await lookup.state({ assignee: "eng.auditor", taskId: "t1", input: {} }, ctx)).toEqual({ workerId: "eng.auditor" });
  });

  it("lets a list's own seat names through the filing check without asking", () => {
    const check = lookup.filingCheck({ [list.id]: ["coder"] });
    expect(check("coder", list.id, ctx)).toBeUndefined();
    expect(check("coder", "other.list", ctx)).toMatch(/No worker is named "coder"/);
    expect(check("eng.auditor", list.id, ctx)).toBeUndefined();
  });

  it("refuses a hand-over to a worker whose flow takes no tasks, and hands nobody's over to nothing", async () => {
    await expect(
      Promise.resolve().then(() => lookup.flowKind({ assignee: "ops.clerk", taskId: "t1", input: {} }, ctx))
    ).rejects.toThrow(/task "t1" could not be handed over: "ops.clerk" takes no tasks/);
    expect(await lookup.flowKind({ assignee: "nobody", taskId: "t2", input: {} }, ctx)).toBeUndefined();
  });
});

describe("a task filed for a worker by name, on a real host", () => {
  const mailboxId = "ops.desk";
  const roster: MailboxManifest[] = [
    { id: mailboxId, declared: { members: ["eng.auditor"], boards: ["work"] }, body: "The desk." }
  ];
  const list = mailboxBoard(mailboxId, "work");

  async function host() {
    const answered: string[] = [];
    const heard: string[] = [];
    const installation = installationFor(list.id);
    const lookup: WorkerLookup = createWorkerLookup({ installation });
    const copies = hireWorkforce(installation);
    const [mailbox] = mailboxInstances(roster, {
      kinds: { mailbox: defineMailboxFlow({ checkAssignee: lookup.filingCheck() }) as never }
    });

    // The coordinator's board over the list: no seat of its own, and a
    // fallback that hands each task to whichever worker its name means.
    const board = taskBoard({
      name: "desk-coordinator",
      boardId: list.id,
      collection: list,
      workers: {},
      defaultWorker: dispatcher({
        name: "desk-hand-over",
        action: "work",
        session: "per-task",
        flowKind: lookup.flowKind,
        state: lookup.state
      })
    });
    const coordinator = defineFlow({ kind: "desk-coordinator", actions: { drain: { block: board.drain } } })({
      id: "desk-coordinator"
    });

    const state = createFlowState({
      flows: {
        [mailbox!.kind]: mailbox!,
        [coordinator.id]: coordinator,
        ...Object.fromEntries(copies.map((copy) => [copy.id, copy]))
      },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({
        generators: {
          "agent-answer": mockGenerator({
            name: "agent-answer",
            script: [
              {
                when: (input: unknown) => {
                  const seen = JSON.stringify(input);
                  heard.push(seen);
                  const match = /GOAL-([a-z0-9]+)/.exec(seen);
                  if (match) answered.push(match[1]!);
                  return match !== null;
                },
                then: { text: "answered" }
              },
              { when: () => true, then: { text: "no goal in sight" } }
            ]
          })
        },
        policy: "allow"
      })
    });
    const runtime: FlowStateRuntime = await state.getRuntime();
    await openMailboxes(roster, { client: sessionApi(runtime), userId: USER_ID });

    const act = (flow: FlowInstance, sessionId: string, actionName: string, input: unknown) =>
      runAction({
        orgId: ORG,
        flow,
        actionName,
        input,
        userId: USER_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never) as Promise<{ output?: any; error?: any }>;

    return {
      state,
      runtime,
      answered,
      heard,
      file: (assignee: string, goal: string, extra: Record<string, unknown> = {}) =>
        act(mailbox!, mailboxId, "fileTask", { board: "work", goal, assignee, ...extra }),
      drain: () => act(coordinator, "s_coordinator", "drain", {}),
      listed: async () =>
        (await act(mailbox!, mailboxId, "readBoard", { board: "work" })).output.tasks as unknown[],
      row: async (taskId: string) =>
        (await runtime.stores.resourceState.get("org", ORG, `${list.id}/${taskId}`))?.state as
          | Record<string, any>
          | undefined
    };
  }

  async function until(predicate: () => Promise<boolean>, label: string) {
    for (let i = 0; i < 300; i += 1) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  it("shows the worker the task's structured input, not only its goal", async () => {
    const h = await host();
    try {
      const taskId = (await h.file("eng.auditor", "GOAL-input1 audit this", { input: { ticket: "TICKET-7Q2" } }))
        .output.taskId as string;
      expect((await h.drain()).error).toBeUndefined();
      await until(async () => (await h.row(taskId))?.status === "completed", "the task to settle");
      expect(h.heard.some((seen) => seen.includes("TICKET-7Q2"))).toBe(true);
    } finally {
      await h.state.dispose();
    }
  });

  it("refuses at filing a name no worker holds, and files nothing", async () => {
    const h = await host();
    try {
      const refused = await h.file("frontend", "GOAL-abc123 audit the licenses");
      expect(String(refused.error?.message)).toMatch(/unknown-assignee: No worker is named "frontend"/);
      expect(await h.listed()).toEqual([]);
    } finally {
      await h.state.dispose();
    }
  });

  it("hands a worker a task on a list no code wired it to: the shared copy, each task in its own session naming the worker", async () => {
    const h = await host();
    try {
      const one = (await h.file("eng.auditor", "GOAL-one1 first")).output.taskId as string;
      const two = (await h.file("eng.auditor", "GOAL-two2 second")).output.taskId as string;
      expect((await h.drain()).error).toBeUndefined();
      for (const id of [one, two]) {
        await until(async () => (await h.row(id))?.status === "completed", id);
      }
      const [a, b] = [(await h.row(one))!, (await h.row(two))!];
      expect(a.run.sessionId).not.toBe(b.run.sessionId);
      for (const row of [a, b]) {
        const linked = await h.runtime.stores.session.get(row.run.sessionId);
        expect(linked?.flowId ?? linked?.flowKind).toBe("agent");
        expect((linked?.state as { workerId?: string }).workerId).toBe("eng.auditor");
      }
      expect(h.answered.sort()).toEqual(["one1", "two2"]);
    } finally {
      await h.state.dispose();
    }
  });
});

/** `openMailboxes`'s session API over the runtime's own stores. */
function sessionApi(runtime: FlowStateRuntime) {
  const stores = runtime.stores;
  return {
    createSession: async (options: { flowKind: string; userId: string; sessionId?: string; orgId?: string; state?: Record<string, unknown> }) => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: options.orgId ?? DEFAULT_ORG_ID,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        } as never,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = await stores.session.get(sessionId);
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        orgId: (found as { orgId?: string } | undefined)?.orgId,
        state: found?.state as Record<string, unknown> | undefined
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
}
