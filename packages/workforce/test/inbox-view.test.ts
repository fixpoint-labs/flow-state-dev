/**
 * The roster flow's `inbox` view: what waits on one user across their
 * sessions, and every board row, answered once on the server.
 *
 * Why it matters: Shift Manager's Inbox, its count, the Tasks board, the
 * shift summary and a task's asks all read this one answer, so a count and
 * its list never disagree. The view must hear every row a board writes, from
 * whichever session writes it, or a screen misses a task that now waits on
 * the user; and it must not hear a turn or a streamed reply, or every reply
 * re-runs every open Inbox.
 *
 * Real engine; the caller is a verified user. Reads the view's answer and what
 * it says it hears, then the notices the writes publish.
 */
import { describe, expect, it } from "vitest";
import { hearsNotice, type ViewHearing } from "@flow-state-dev/contracts/types/view-hearing";
import type { WireNotice } from "@flow-state-dev/contracts/types/push-delivery";
import { defineFlow, handler } from "@flow-state-dev/core";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";
import { encodeUserSegment, type FlowInstance } from "@flow-state-dev/core/types";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { bootBoardHost, messageOf, ORG, type BoardHost } from "./conversation-board-harness";
import { ROSTER_FLOW } from "../src/workers/keys";

const INBOX = "inbox";

/** The inbox view as `userId` gets it through the HTTP view route: its answer and what it hears. */
async function inboxOf(h: BoardHost, userId: string, input: { done?: boolean } = {}) {
  const path = [ROSTER_FLOW, "views", INBOX];
  const res = await (await h.router()).POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ userId, input })
    }),
    { params: { path } }
  );
  const body = (await res.json()) as { output: { items: any[]; tasks: any[] }; hears: ViewHearing[]; error?: unknown };
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
}

/**
 * Every notice published from now on, as a watcher's wire sees it: a user
 * topic names no id (the caller's own), a session topic names its session.
 */
async function capture(h: BoardHost, userId: string) {
  const bus = (await h.state.getRuntime()).stores.bus!;
  const publish = bus.publish.bind(bus);
  const published: WireNotice[] = [];
  bus.publish = (notice) => {
    const topic = notice.topic as { scope: string; id: string; resource?: string };
    const resource = topic.resource === undefined ? {} : { resource: topic.resource };
    if (topic.scope === "user" && topic.id === userId) published.push({ ...notice, topic: { scope: "user", ...resource } } as WireNotice);
    if (topic.scope === "session") published.push({ ...notice, topic: { scope: "session", id: topic.id, ...resource } } as WireNotice);
    return publish(notice);
  };
  return published;
}

/** A flow whose sessions take any state: a worker flow when the inventory names it, else no worker's. */
const plainFlow = (flowName: string) =>
  defineFlow({
    kind: flowName,
    session: { stateSchema: z.object({ workerId: z.string().readonly().optional() }) },
    actions: { respond: { block: handler({ name: `${flowName}-respond`, inputSchema: z.object({}), execute: () => ({}) }) } }
  })() as unknown as FlowInstance;

const quiet = mockGenerator({ script: [{ when: () => true, then: { text: "" } }] });

describe("the inbox view hears every board row written", () => {
  it("re-runs on a hold a task's run writes on its row from the task's own session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = bootBoardHost({ agentAnswer: quiet, holds: new Map([["g", gate]]) });
    try {
      const lead = await h.conversation("alice", "lead");
      const filed = await h.act("alice", lead, "createTask_tasks", { goal: "pick a region [hold:g][ask:Which region?]", assignee: "eng.tasker" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      // The run is in its own session, waiting at the gate: the row exists and holds nothing yet.
      for (let at = 0; at < 200 && (await h.rows("alice"))[0]?.run == null; at += 1) await new Promise((r) => setTimeout(r, 10));
      const [running] = await h.rows("alice");
      expect(running?.holds ?? []).toEqual([]);
      const before = await inboxOf(h, "alice");
      expect(before.output.tasks.map((task) => [task.id, task.holds.length])).toEqual([[running!.id, 0]]);
      const published = await capture(h, "alice");
      release();
      await h.settled();
      const [task] = await h.rows("alice");
      expect(task?.holds?.length, "the task's run held its row on a question").toBe(1);
      expect(task!.run!.sessionId).not.toBe(lead);
      // The hold's write came from the task's session, after the view answered:
      // the view's hearing must cover the ledger notice that write published
      // on the user topic, not only a turn's notice on the board holder's session.
      const ledgerWrites = published.filter((notice) => notice.kind === "resource" && notice.topic.scope === "user" && notice.topic.resource === "tasks");
      expect(ledgerWrites).not.toEqual([]);
      expect(ledgerWrites.filter((notice) => hearsNotice(before.hears, notice))).toEqual(ledgerWrites);
      // And the view, run again, answers the row with its hold.
      const after = await inboxOf(h, "alice");
      expect(after.output.tasks.map((task) => [task.id, task.holds.length])).toEqual([[task!.id, 1]]);
    } finally {
      release();
      await h.dispose();
    }
  });
});

/**
 * A pending ask for `userId` in a run of `flowKind`, written as the engine
 * writes one: its request, then its suspension, through the host's stores.
 */
async function seedSuspension(h: BoardHost, stop: { id: string; flowKind: string; userId?: string; sessionId?: string; expiresAt?: number; createdAt?: number }) {
  const stores = (await h.state.getRuntime()).stores;
  const userId = stop.userId ?? "alice";
  const at = stop.createdAt ?? Date.now() - 1_000;
  await stores.request.set(
    stop.id,
    {
      id: stop.id,
      state: {},
      version: 0,
      createdAt: at,
      updatedAt: at,
      flowKind: stop.flowKind,
      flowId: stop.flowKind,
      actionName: "respond",
      userId,
      orgId: ORG,
      ...(stop.sessionId !== undefined ? { sessionId: stop.sessionId } : {}),
      source: stop.sessionId === undefined ? "system" : "http",
      status: "suspended",
      startedAtMs: at
    } as never,
    "absent"
  );
  await stores.suspensions.set({
    suspensionId: `s_${stop.id}`,
    requestId: stop.id,
    flowKind: stop.flowKind,
    flowId: stop.flowKind,
    actionName: "respond",
    userId,
    ...(stop.sessionId !== undefined ? { sessionId: stop.sessionId } : {}),
    reason: "user_approval",
    message: `May I, ${stop.id}?`,
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: at,
    ...(stop.expiresAt !== undefined ? { expiresAt: stop.expiresAt } : {})
  } as never);
}

/** The org's worker inventory, as a Lab's boot writes it: each worker's id and the worker flow it runs on. */
async function seedInventory(h: BoardHost, workers: Array<{ id: string; kind: string }>) {
  const store = (await h.state.getRuntime()).stores.resourceState;
  for (const worker of workers) {
    await store.set("org", ORG, `inventory/workers/${worker.id}`, { ...worker, door: "respond", doorTakesTask: false, name: null, teamName: null, rules: false, hired: false, incarnation: null } as never, "any" as never);
  }
}

/** The board host's workers as its inventory registers them. */
const INVENTORY = [
  { id: "otto", kind: "agent" },
  { id: "lead", kind: "coordinator" },
  { id: "eng.tasker", kind: "tasker" }
];

/** Each listed item as `[its id, its first hold's worker, its session]`. */
const listed = (items: any[]) => items.map((item) => [item.id, item.holds[0].detail?.workerId ?? null, item.holds[0].source.sessionId ?? null]);

describe("which asks the inbox view lists, and whose they are", () => {
  it("lists a suspension in a worker's session as that worker's, an unnamed one on a worker flow as nobody's, and none elsewhere", async () => {
    const h = bootBoardHost({ agentAnswer: quiet, plainFlows: { desk: plainFlow("desk"), other: plainFlow("other") } });
    try {
      await seedInventory(h, [...INVENTORY, { id: "eng.desk", kind: "desk" }]);
      const made = async (flow: string, state: Record<string, unknown>) => {
        const created = await h.create("alice", flow, { state });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        return created.body.session!.id;
      };
      const otto = await made("agent", { workerId: "otto" });
      const unnamed = await made("desk", {});
      // A worker the inventory doesn't register, on a worker flow; and a flow no worker runs on.
      const stranger = await made("desk", { workerId: "ghost" });
      const other = await made("other", {});
      await seedSuspension(h, { id: "r_otto", flowKind: "agent", sessionId: otto, createdAt: Date.now() - 3_000 });
      await seedSuspension(h, { id: "r_unnamed", flowKind: "desk", sessionId: unnamed, createdAt: Date.now() - 2_000 });
      await seedSuspension(h, { id: "r_stranger", flowKind: "desk", sessionId: stranger });
      await seedSuspension(h, { id: "r_other", flowKind: "other", sessionId: other });
      const { output } = await inboxOf(h, "alice");
      expect(listed(output.items)).toEqual([
        ["s_r_otto", "otto", otto],
        ["s_r_unnamed", null, unnamed]
      ]);
    } finally {
      await h.dispose();
    }
  });

  it("lists a suspension from a worker run with no conversation once, from no worker, answerable through its flow, its deadline as its due", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      const due = Date.now() + 60_000;
      await seedSuspension(h, { id: "r_alone", flowKind: "agent", expiresAt: due });
      const { output } = await inboxOf(h, "alice");
      expect(listed(output.items)).toEqual([["s_r_alone", null, null]]);
      expect(output.items[0]).toMatchObject({ task: null, answerable: true, holds: [{ due, source: { kind: "suspension", flowId: "agent", requestId: "r_alone" } }] });
    } finally {
      await h.dispose();
    }
  });

  it("lists a suspension in a one-off session as one with no conversation: from no worker, with nothing to reply into", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      // A server run, a webhook delivery or a per-fire schedule fire runs in a one-off session,
      // born before its record like any other; nobody converses in it, so no worker and no reply.
      const once = (await h.create("alice", "agent", { sessionId: oneOffSessionId(), state: { workerId: "otto" } })).body.session!.id;
      await seedSuspension(h, { id: "r_once", flowKind: "agent", sessionId: once });
      const { output } = await inboxOf(h, "alice");
      expect(listed(output.items)).toEqual([["s_r_once", null, null]]);
    } finally {
      await h.dispose();
    }
  });

  it("lists no ask of another user's, none past its deadline, and none in a session that is gone", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      const bobs = (await h.create("bob", "agent", { state: { workerId: "otto" } })).body.session!.id;
      await seedSuspension(h, { id: "r_bob", flowKind: "agent", userId: "bob", sessionId: bobs });
      await seedSuspension(h, { id: "r_bob_alone", flowKind: "agent", userId: "bob" });
      await seedSuspension(h, { id: "r_expired", flowKind: "agent", expiresAt: Date.now() - 1 });
      await seedSuspension(h, { id: "r_gone", flowKind: "agent", sessionId: "sess_never_made" });
      expect((await inboxOf(h, "alice")).output.items).toEqual([]);
      expect(listed((await inboxOf(h, "bob")).output.items).map(([id]) => id).sort()).toEqual(["s_r_bob", "s_r_bob_alone"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the inbox view's boards", () => {
  it("answers each conversation's rows under its board owner's label, and groups a task run's ask under its row", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      const lead = await h.conversation("alice", "lead");
      const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Later", assignee: "eng.tasker", held: true });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const taskId = (filed.output as { taskId: string }).taskId;
      const { output } = await inboxOf(h, "alice");
      expect(output.tasks.map((task) => [task.id, task.owner, task.boardRef, task.status])).toEqual([[taskId, "@lead", `${lead}.tasks`, "held"]]);
      // The task's run stops for the user, in its own session: the stop lists under the task, not on its own.
      const [stored] = await h.rows("alice");
      const run = { sessionId: lead, requestId: "r_run", attempt: 1 };
      const { partition: _partition, ...task } = stored!;
      await h.writeRow("alice", decodeURIComponent(stored!.partition), { ...task, status: "in_progress", run } as never);
      await seedSuspension(h, { id: "r_run", flowKind: "coordinator", sessionId: lead });
      const again = (await inboxOf(h, "alice")).output;
      expect(again.items.map((item) => [item.id, item.task?.taskId ?? null, item.holds.map((hold: any) => hold.id)])).toEqual([[`task:${lead}.tasks:${taskId}`, taskId, ["s_r_run"]]]);
      expect(again.items[0].holds[0].detail).toMatchObject({ workerId: "lead", sessionId: lead, message: "May I, r_run?" });
    } finally {
      await h.dispose();
    }
  });

  it("drops the rows of a conversation that is gone", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      const lead = await h.conversation("alice", "lead");
      expect((await h.act("alice", lead, "createTask_tasks", { goal: "Later", assignee: "eng.tasker", held: true })).error).toBeUndefined();
      expect((await inboxOf(h, "alice")).output.tasks).toHaveLength(1);
      await (await h.state.getRuntime()).stores.session.delete(lead);
      expect((await inboxOf(h, "alice")).output.tasks).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("answers no task of another user's, and none filed under another organization, even on the caller's own conversation", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      // Bob's task, on bob's own conversation.
      const bobs = await h.conversation("bob", "lead");
      const filed = await h.act("bob", bobs, "createTask_tasks", { goal: "Bob's brief", assignee: "eng.tasker", held: true });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const [bobTask] = await h.rows("bob");
      // A task in alice's cell for another organization, filed on alice's own live conversation:
      // only a read of the wrong cell could answer it, since its conversation and partition are hers.
      const lead = await h.conversation("alice", "lead");
      const partition = encodeUserSegment(await h.filingOf("alice", lead));
      const { partition: _bobPartition, ...plant } = bobTask!;
      const store = (await h.state.getRuntime()).stores.resourceState;
      await store.set("user", `alice:~org:globex`, `tasks/${partition}/t_globex`, { ...plant, id: "t_globex", goal: "Globex's brief" } as never, "any" as never);

      expect((await inboxOf(h, "alice")).output.tasks).toEqual([]);
      expect((await inboxOf(h, "bob")).output.tasks.map((task) => task.id)).toEqual([bobTask!.id]);
      // Control: the same plant in alice's own cell is answered, so the empty list above is the cell, not the plant.
      await store.set("user", `alice:~org:${ORG}`, `tasks/${partition}/t_globex`, { ...plant, id: "t_globex", goal: "Globex's brief" } as never, "any" as never);
      expect((await inboxOf(h, "alice")).output.tasks.map((task) => task.id)).toEqual(["t_globex"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("what the inbox view reads per run", () => {
  it("reads no session for a conversation that holds only finished tasks, and answers them only when asked for done ones", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      const lead = await h.conversation("alice", "lead");
      const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Shipped", assignee: "eng.tasker", held: true });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const [stored] = await h.rows("alice");
      const { partition, ...task } = stored!;
      await h.writeRow("alice", decodeURIComponent(partition), { ...task, status: "completed" } as never);

      const sessions = (await h.state.getRuntime()).stores.session;
      const get = sessions.get.bind(sessions);
      const reads: string[] = [];
      sessions.get = (async (key: string, ...rest: unknown[]) => {
        reads.push(key);
        return (get as (...args: unknown[]) => unknown)(key, ...rest);
      }) as typeof sessions.get;

      expect((await inboxOf(h, "alice")).output.tasks).toEqual([]);
      expect(reads.filter((key) => key.includes(lead)), "a finished task's conversation was read for a view that drops it").toEqual([]);
      const done = (await inboxOf(h, "alice", { done: true })).output.tasks;
      expect(done.map((t) => [t.id, t.status])).toEqual([[task.id, "completed"]]);
      expect(reads.filter((key) => key.includes(lead)).length, "asked for done ones, its board's owner is read").toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });
});

describe("what the inbox view hears", () => {
  it("never a turn on the user topic, and never a streamed reply", async () => {
    const h = bootBoardHost({ agentAnswer: quiet });
    try {
      await seedInventory(h, INVENTORY);
      const lead = await h.conversation("alice", "lead");
      expect((await h.act("alice", lead, "createTask_tasks", { goal: "Later", assignee: "eng.tasker", held: true })).error).toBeUndefined();
      const otto = (await h.create("alice", "agent", { state: { workerId: "otto" } })).body.session!.id;
      await seedSuspension(h, { id: "r_otto", flowKind: "agent", sessionId: otto });
      const { hears, output } = await inboxOf(h, "alice");
      expect(output.items).toHaveLength(1);
      const user = hears.filter((hearing) => hearing.topic.scope === "user");
      expect(user.flatMap((hearing) => hearing.kinds)).not.toContain("run");
      expect(hears.flatMap((hearing) => hearing.kinds)).not.toContain("items");
      // A session it read is heard on that session's topic alone, for what names its worker, flow and lineage.
      // Its identity is heard on `state`, not `run` (FIX-2725 D1, amended by FIX-2773).
      expect(hears.filter((hearing) => hearing.topic.scope === "session").map((hearing) => hearing.kinds)).toEqual([["state"], ["state"]]);
    } finally {
      await h.dispose();
    }
  });
});
