/**
 * A conversation whose worker was fired, owed a notice (FIX-2849).
 *
 * Why it matters: every turn of the conversation is refused at its start, so
 * its board's pass, the only thing that clears its wake, never runs. Left so,
 * the wake fired every 30 s forever and each refused request stayed
 * `in_progress`, which the stale sweep turned into another wake. A refused
 * session is terminal: its wake fires at most once, is then cleared, and no
 * request of it is left open.
 */
import { describe, expect, it } from "vitest";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
};

const file = async (host: BoardHost, userId: string, conv: string, input: Record<string, unknown>) => {
  const result = await host.act(userId, conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string };
};

describe("a fired worker's conversation, owed a notice", () => {
  it("fires its wake at most once, then the wake is cleared, and leaves no request in_progress", async () => {
    const host = bootBoardHost({ durable: true });
    try {
      await host.state.getRouter();
      const hired = await host.hire("alice", {
        id: "my.desk",
        flow: "coordinator",
        settings: { delegates: ["eng.tasker"], routing: "best-fit", fallback: "eng.tasker" }
      });
      expect(hired.error, messageOf(hired.error)).toBeUndefined();
      const conv = await host.conversation("alice", "my.desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "orphaned [slow:150]", assignee: "eng.tasker" });
      for (let i = 0; i < 100 && host.runs.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      const firedAt = Date.now();
      expect((await host.fire("alice", "my.desk")).error).toBeUndefined();
      expect(await until(async () => (await host.row("alice", filing, filed.taskId!))?.status === "completed")).toBe(true);

      const { stores } = await host.state.getRuntime();
      const wakeOf = () => stores.wakes!.get({ sessionId: conv, entry: "dispatch" });
      // The ending owed the conversation's pass a wake, due shortly; it fires, is refused, and is cleared.
      expect(await until(async () => (await wakeOf()) === null, 8_000)).toBe(true);
      await host.settled();

      const requests = await host.requestsOf(conv);
      // The wake's fires since the worker was fired: one, refused.
      const fires = requests.filter((request) => request.actionName === "dispatch" && request.createdAt >= firedAt);
      expect(fires.map((request) => request.status)).toEqual(["failed"]);
      expect(requests.filter((request) => request.status === "in_progress")).toEqual([]);
      expect(await wakeOf()).toBeNull();
      // The task ended after the firing: its notice is settled, not left owed for a pass that never runs.
      const row = await host.row("alice", filing, filed.taskId!);
      expect(row?.metadata?.["noticeOwed:1:completed"]).toBeNull();
      expect(row?.metadata?.["noticeUndeliverable:1:completed"]).toMatchObject({ detail: "its worker was fired" });
    } finally {
      await host.dispose();
    }
  }, 20_000);
});
