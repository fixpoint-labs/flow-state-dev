/**
 * A task's subscriptions end with its failure or cancel, not its completion
 * (FIX-2534, epic ER-7 as amended by #4675).
 *
 * Why these matter: a coding task ends just after it opens its PR, so a
 * subscription that ended with every ending would drop every later review,
 * the epic's first promise. A task that failed or was cancelled has nobody
 * left to act on a review, so its session stops hearing them.
 */
import { describe, expect, it } from "vitest";
import { messageOf } from "./conversation-board-harness";
import { bootSubscriptionsHost, event, readCheck, type SubscriptionsHost } from "./subscriptions-harness";

const PR = "github:acme/api#412";

/** Wait until the one request still running is the held one: everything else, the cancel's notice included, finished. */
async function onlyHeldRunning(host: SubscriptionsHost) {
  const running = (r: { status: string; finalizedAtMs?: number | null }) =>
    r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
  let quiet = 0;
  for (let i = 0; i < 500 && quiet < 3; i += 1) {
    const all = await (await host.state.getRuntime()).stores.request.list({});
    quiet = all.filter(running).length === 1 ? quiet + 1 : 0;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(quiet).toBe(3);
}

/** File a task to the follower from a lead conversation, and wait for it to end. */
async function fileAndSettle(host: SubscriptionsHost, goal: string) {
  const conv = await host.conversation("alice", "lead");
  const filed = await host.act("alice", conv, "createTask_tasks", { goal, assignee: "eng.follower" });
  expect(filed.error, messageOf(filed.error)).toBeUndefined();
  await host.settled();
}

describe("a task's subscriptions", () => {
  it("keep hearing the PR after the task completed", async () => {
    const host = bootSubscriptionsHost();
    try {
      await fileAndSettle(host, `open the PR [subscribe:${PR}]`);
      const [row] = await host.subscriptionRows("alice");
      expect(row).toMatchObject({ thread: PR, enabled: true });
      expect(row!.taskId).toEqual(expect.any(String));
      await host.route(event({ text: "a review after the run" }));
      expect(await host.heard(row!.sessionId)).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("end when the task failed, and its session hears nothing more", async () => {
    const host = bootSubscriptionsHost();
    try {
      await fileAndSettle(host, `open the PR [subscribe:${PR}] [fail]`);
      const rows = await host.subscriptionRows("alice");
      expect(rows.map((row) => [row.enabled, row.endedReason])).toEqual([[false, "task_errored"]]);
      await host.route(event({ text: "a review nobody will act on" }));
      expect(await host.heard(rows[0]!.sessionId)).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("end when the task was cancelled while it worked, and its session hears nothing more", async () => {
    let open!: () => void;
    const host = bootSubscriptionsHost({ hold: new Promise<void>((resolve) => (open = resolve)) });
    try {
      const conv = await host.conversation("alice", "lead");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: `open the PR [subscribe:${PR}] [hold]`, assignee: "eng.follower" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      for (let i = 0; i < 500 && (await host.subscriptionRows("alice")).length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      const [row] = await host.subscriptionRows("alice");
      expect(row).toMatchObject({ enabled: true, taskId: expect.any(String) });
      const cancelled = await host.act("alice", conv, "updateTask_tasks", { id: row!.taskId, status: "cancelled" });
      expect(cancelled.error, messageOf(cancelled.error)).toBeUndefined();
      open();
      await host.settled();
      expect((await host.subscriptionRows("alice")).map((r) => [r.enabled, r.endedReason])).toEqual([[false, "task_cancelled"]]);
      await host.route(event({ text: "a review after the cancel" }));
      expect(await host.heard(row!.sessionId)).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  // FIX-2788.
  it("end when the task was cancelled while its subscribe still waited on the read check", async () => {
    // A subscribe in flight when the cancel's sweep runs: the sweep finds no subscription yet, and
    // the write that lands after it must not leave a cancelled task's session hearing its PR.
    let release!: () => void;
    let reached!: () => void;
    const atReadCheck = new Promise<void>((resolve) => (reached = resolve));
    readCheck.held = new Promise<void>((resolve) => (release = resolve));
    readCheck.reached = reached;
    const host = bootSubscriptionsHost();
    try {
      const conv = await host.conversation("alice", "lead");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: `open the PR [subscribe:${PR}]`, assignee: "eng.follower" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      await atReadCheck;
      expect(await host.subscriptionRows("alice")).toEqual([]);
      const taskId = (await host.rows("alice")).find((row) => row.goal.includes("[subscribe:"))?.id;
      expect(taskId).toEqual(expect.any(String));
      const cancelled = await host.act("alice", conv, "updateTask_tasks", { id: taskId, status: "cancelled" });
      expect(cancelled.error, messageOf(cancelled.error)).toBeUndefined();
      // The cancel's notice, and its sweep, run to the end while the subscribe still waits: one request is left running.
      await onlyHeldRunning(host);
      release();
      await host.settled();
      const rows = await host.subscriptionRows("alice");
      expect(rows.map((r) => [r.taskId, r.enabled, r.endedReason])).toEqual([[taskId, false, "task_cancelled"]]);
      await host.route(event({ text: "a review after the cancel" }));
      expect(await host.heard(rows[0]!.sessionId)).toEqual([]);
    } finally {
      release();
      delete readCheck.held;
      delete readCheck.reached;
      await host.dispose();
    }
  });
});
