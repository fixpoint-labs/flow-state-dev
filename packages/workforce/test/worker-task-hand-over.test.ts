/**
 * A task names a worker, and the list hands it to that worker.
 *
 * Two halves. The lookup on its own, over a registry this test holds, so each
 * rule about who a name reaches is one assertion: a declared worker, one hired
 * for the organization, one a member hired for themselves, nobody, two at
 * once, one in another organization, one whose kind takes no tasks, a hire
 * made after start, a fired worker.
 *
 * Then the whole path on a real host: a mailbox with one task list that no
 * worker kind was wired to, a coordinator board over it whose fallback asks
 * the lookup, and `agent` workers whose kind takes tasks from the mailbox's
 * lists. A task filed for a worker hired after start runs on that worker's
 * own flow, as one turn holding the task's goal, and settles with the answer.
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
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  hiredSeatManifest,
  mailboxBoard,
  mailboxInstances,
  openMailboxes,
  seatAddress,
  toHiredSeatRow,
  type MailboxManifest,
  type WorkerLookup
} from "../src/index";
import { workerConfigSchema } from "../src/worker-config";

const ORG = DEFAULT_ORG_ID;
const USER_ID = "u_coordinator";

function run(orgId: string | undefined, userId?: string): BlockContext {
  return {
    ...(orgId === undefined ? {} : { org: { identity: { orgId } } }),
    ...(userId === undefined ? {} : { user: { identity: { id: userId } } })
  } as unknown as BlockContext;
}

/** A flow kind with no task door: an app's own worker kind that takes no tasks. */
const deskClerk = defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
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

describe("which worker a name on a task means", () => {
  const list = mailboxBoard("ops.desk", "work");
  const kinds = {
    agent: defineAgentWorkerFlow({ taskLists: [list.id] }),
    "desk-clerk": deskClerk
  } as never;

  /** A registry this test holds, standing in for the host's. */
  function registry() {
    const flows = new Map<string, FlowInstance>();
    const add = (seat: FlowInstance) => flows.set(seat.id, seat);
    const hire = (orgId: string, seatId: string, flow = "agent", ownerUserId: string | null = null) => {
      const bound = hiredSeatManifest(
        orgId,
        toHiredSeatRow({ seatId, flow, instructions: "Hired.", owningOrgId: orgId, ownerUserId })
      );
      if (!("manifest" in bound)) throw new Error(bound.problem);
      const [seat] = hireWorkforce([bound.manifest], { kinds });
      add(seat!);
      return seat!;
    };
    const [declared] = hireWorkforce([{ id: "eng.auditor", declared: {}, body: "You audit." }], { kinds });
    add(declared!);
    const lookup = createWorkerLookup({ instanceAt: (id) => flows.get(id), declared: ["eng.auditor"] });
    return { flows, hire, lookup };
  }

  it("finds a worker the files declare, by its name", () => {
    const { lookup } = registry();
    expect(lookup.find("eng.auditor", run(ORG))).toEqual({ found: true, flowId: "eng.auditor" });
  });

  it("finds a worker hired after the lookup was built, and loses it when it is fired", () => {
    const { flows, hire, lookup } = registry();
    expect(lookup.find("frontend", run("acme")).found).toBe(false);
    const seat = hire("acme", "frontend");
    expect(lookup.find("frontend", run("acme"))).toEqual({ found: true, flowId: seat.id });
    expect(seat.id).toBe(seatAddress("acme", "frontend"));
    flows.delete(seat.id);
    const fired = lookup.find("frontend", run("acme"));
    expect(fired).toMatchObject({ found: false, reason: "not-found" });
  });

  it("finds a member's own worker for that member only", () => {
    const { hire, lookup } = registry();
    const own = hire("acme", "scout", "agent", "alice");
    expect(lookup.find("scout", run("acme", "alice"))).toEqual({ found: true, flowId: own.id });
    expect(lookup.find("scout", run("acme", "bob"))).toMatchObject({ found: false, reason: "not-found" });
  });

  it("does not reach another organization's worker", () => {
    const { hire, lookup } = registry();
    hire("acme", "frontend");
    expect(lookup.find("frontend", run("globex"))).toMatchObject({ found: false, reason: "not-found" });
  });

  it("refuses a name held by the organization's worker and the caller's own, naming both", () => {
    const { hire, lookup } = registry();
    hire("acme", "frontend");
    hire("acme", "frontend", "agent", "alice");
    const answer = lookup.find("frontend", run("acme", "alice"));
    expect(answer).toMatchObject({ found: false, reason: "ambiguous" });
    expect(!answer.found && answer.message).toMatch(/hired for the organization and one your own/);
    // A teammate sees only the organization's.
    expect(lookup.find("frontend", run("acme", "bob")).found).toBe(true);
  });

  it("refuses a worker whose kind takes no tasks", () => {
    const { hire, lookup } = registry();
    hire("acme", "clerk", "desk-clerk");
    const answer = lookup.find("clerk", run("acme"));
    expect(answer).toMatchObject({ found: false, reason: "takes-no-tasks" });
    expect(!answer.found && answer.message).toMatch(/"clerk" takes no tasks: its kind "desk-clerk"/);
  });

  it("does not take a flow registered at a name the files never declared for a worker", () => {
    const flows = new Map<string, FlowInstance>([["ops.desk", deskClerk({ id: "ops.desk" })]]);
    const lookup = createWorkerLookup({ instanceAt: (id) => flows.get(id), declared: [] });
    expect(lookup.find("ops.desk", run(ORG)).found).toBe(false);
  });

  it("lets a list's own seat names through the filing check without asking", () => {
    const { lookup } = registry();
    const check = lookup.filingCheck({ [list.id]: ["coder"] });
    expect(check("coder", list.id, run(ORG))).toBeUndefined();
    expect(check("coder", "other.list", run(ORG))).toMatch(/No worker is named "coder"/);
    expect(check("eng.auditor", list.id, run(ORG))).toBeUndefined();
  });

  it("refuses a hand-over to a worker whose kind takes no tasks, or two at once, by name", async () => {
    const { hire, lookup } = registry();
    hire("acme", "clerk", "desk-clerk");
    await expect(
      Promise.resolve().then(() => lookup.flowKind({ assignee: "clerk", taskId: "t1", input: {} }, run("acme")))
    ).rejects.toThrow(/task "t1" could not be handed over: "clerk" takes no tasks/);
    expect(await lookup.flowKind({ assignee: "nobody", taskId: "t2", input: {} }, run("acme"))).toBeUndefined();
  });
});

describe("a task filed for a worker by name, on a real host", () => {
  const mailboxId = "ops.desk";
  const roster: MailboxManifest[] = [
    { id: mailboxId, declared: { members: ["eng.auditor"], boards: ["work"] }, body: "The desk." }
  ];
  const list = mailboxBoard(mailboxId, "work");

  async function host() {
    let lookup: WorkerLookup | undefined;
    const answered: string[] = [];
    const agent = defineAgentWorkerFlow({ taskLists: [list.id] });
    const kinds = { agent } as never;
    const [auditor] = hireWorkforce([{ id: "eng.auditor", declared: {}, body: "You audit." }], { kinds });
    const [mailbox] = mailboxInstances(roster, {
      kinds: {
        mailbox: defineMailboxFlow({
          checkAssignee: (name, listId, ctx) => lookup!.filingCheck()(name, listId, ctx)
        }) as never
      }
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
        flowKind: (task, ctx) => lookup!.flowKind(task, ctx)
      })
    });
    const coordinator = defineFlow({
      kind: "desk-coordinator",
      actions: { drain: { block: board.drain } }
    })({ id: "desk-coordinator" });

    const state = createFlowState({
      flows: { [mailbox!.kind]: mailbox!, [auditor!.id]: auditor!, [coordinator.id]: coordinator },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({
        generators: {
          "agent-answer": mockGenerator({
            name: "agent-answer",
            script: [
              {
                when: (input: unknown) => {
                  const seen = JSON.stringify(input);
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
    lookup = createWorkerLookup({ instanceAt: (id) => runtime.registry.get(id), declared: [auditor!.id] });
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

    const hire = (seatId: string) => {
      const bound = hiredSeatManifest(
        ORG,
        toHiredSeatRow({ seatId, flow: "agent", instructions: "Hired.", owningOrgId: ORG, ownerUserId: null })
      );
      if (!("manifest" in bound)) throw new Error(bound.problem);
      const [seat] = hireWorkforce([bound.manifest], { kinds });
      state.register(seat!, { pin: { orgId: ORG } });
      return seat!;
    };

    return {
      state,
      runtime,
      answered,
      hire,
      fire: (id: string) => state.unregister(id),
      file: (assignee: string, goal: string) =>
        act(mailbox!, mailboxId, "fileTask", { board: "work", goal, assignee }),
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

  it("refuses at filing a name nobody holds, then hands a task to a worker hired after start", async () => {
    const h = await host();
    try {
      const refused = await h.file("frontend", "GOAL-abc123 audit the licenses");
      expect(String(refused.error?.message)).toMatch(/unknown-assignee: No worker is named "frontend"/);
      expect(await h.listed()).toEqual([]);

      const seat = h.hire("frontend");
      const filed = await h.file("frontend", "GOAL-abc123 audit the licenses");
      expect(filed.error).toBeUndefined();
      const taskId = filed.output.taskId as string;

      expect((await h.drain()).error).toBeUndefined();
      await until(async () => (await h.row(taskId))?.status === "completed", "the hire to settle the task");
      const row = (await h.row(taskId))!;
      expect(row.output).toBe("answered");
      expect(h.answered).toEqual(["abc123"]);
      // It ran on the hire's own flow, linked from the row.
      const linked = await h.runtime.stores.session.get(row.run.sessionId);
      expect(linked?.flowId ?? linked?.flowKind).toBe(seat.id);
    } finally {
      await h.state.dispose();
    }
  });

  it("hands a declared worker a task on a list no code wired it to, each task in its own session", async () => {
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
      expect(h.answered.sort()).toEqual(["one1", "two2"]);
    } finally {
      await h.state.dispose();
    }
  });

  it("gives an open task to the worker re-hired under the same name", async () => {
    const h = await host();
    try {
      const first = h.hire("frontend");
      const taskId = (await h.file("frontend", "GOAL-rehired audit")).output.taskId as string;
      h.fire(first.id);
      const second = h.hire("frontend");
      expect((await h.drain()).error).toBeUndefined();
      await until(async () => (await h.row(taskId))?.status === "completed", "the re-hire to settle the task");
      const row = (await h.row(taskId))!;
      const linked = await h.runtime.stores.session.get(row.run.sessionId);
      expect(linked?.flowId).toBe(second.id);
      expect(h.answered).toEqual(["rehired"]);
    } finally {
      await h.state.dispose();
    }
  });

  it("fails a task whose worker was fired after it was filed, naming the worker", async () => {
    const h = await host();
    try {
      const seat = h.hire("frontend");
      const taskId = (await h.file("frontend", "GOAL-gone audit")).output.taskId as string;
      h.fire(seat.id);
      await h.drain();
      const row = (await h.row(taskId))!;
      expect(row.status).toBe("errored");
      expect(row.error).toMatch(/flow-not-found.*assignee "frontend"/);
      expect(h.answered).toEqual([]);
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
