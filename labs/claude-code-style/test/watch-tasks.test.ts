// FIX-2623.
/**
 * A session's task list reads when its board changes, not every two
 * seconds all day: on the topics the board's task-list view names in its
 * answer, and none the lab names itself. Wherever push can miss a change,
 * `client.subscribe` reads on its timer, at the list's old pace.
 */
import { describe, expect, it } from "vitest";
import type { Client, SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";
import { createWiredLab, type LabTask } from "../src/adapter";
import { liveOver } from "./live-over";

function fakeClient() {
  const reads: string[] = [];
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  let status = "in_progress";
  const client = {
    get live() {
      return liveOver(this as never);
    },
    subscribe: (topics: readonly WireTopic[], options: SubscribeOptions) => {
      const entry = { topics, options, closed: false };
      subscriptions.push(entry);
      return { close: () => void (entry.closed = true) };
    },
    sessions: { get: async (id: string) => ({ id, flowKind: "agent" }) },
    view: async (ref: { flow: string; view: string }, _input: unknown, options: { sessionId: string }) => {
      reads.push(`${ref.flow}.${ref.view}`);
      return { value: [{ id: "t1", goal: "Fix the typo", status, updatedAt: reads.length }], topics: [{ scope: "session", id: options.sessionId }], keys: ["t1"] };
    },
  } as unknown as Client;
  const hear = (notice: WireNotice | null) => {
    for (const s of subscriptions) if (!s.closed) s.options.onChange(notice);
  };
  return { client, reads, subscriptions, hear, settle: (next: string) => void (status = next) };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!check()) throw new Error("condition never held");
};

describe("watchTasks", () => {
  it("names no topic: it hears the topics the board view's answer named, at its old pace for where push can miss a change", async () => {
    const lab = fakeClient();
    const stop = createWiredLab(lab.client).watchTasks("s1", () => {});
    await until(() => lab.subscriptions.some((s) => s.topics.length > 0));
    stop();
    const board = lab.subscriptions.find((s) => s.topics.length > 0)!;
    expect(board.topics).toEqual([{ scope: "session", id: "s1" }]);
    expect(board.options.pollIntervalMs).toBe(2_000);
    expect(board.closed).toBe(true);
  });

  it("reads on open, again on a board notice, and keeps no timer of its own", async () => {
    const lab = fakeClient();
    let rows: LabTask[] = [];
    const stop = createWiredLab(lab.client).watchTasks("s1", (next) => (rows = next));
    await until(() => rows.length === 1);
    await new Promise((r) => setTimeout(r, 2_200));
    // Once, and once more once it hears the topics the answer named.
    expect(lab.reads).toEqual(["agent.listTasks_tasks", "agent.listTasks_tasks"]);
    lab.settle("completed");
    lab.hear({ topic: { scope: "session", id: "s1", resource: "tasks" }, kind: "board" });
    await until(() => rows[0]?.status === "completed");
    stop();
    expect(lab.reads).toHaveLength(3);
  });
});
