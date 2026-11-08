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
import { bootSubscriptionsHost, event, type SubscriptionsHost } from "./subscriptions-harness";

const PR = "github:acme/api#412";

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
});
