/**
 * A session's task list reads when its board changes (FIX-2429), not every two
 * seconds all day: the conversation's session topic narrowed to each ledger
 * its `listTasks` read returns, so a reply streaming in the session never wakes
 * it. Wherever push can miss a change, `client.subscribe` reads on its timer,
 * at the list's old pace.
 */
import { describe, expect, it } from "vitest";
import type { Client, SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";
import { createWiredLab, type TaskRow } from "../src/adapter";

function fakeClient() {
  const reads: string[] = [];
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  let status = "in_progress";
  const client = {
    subscribe: (topics: readonly WireTopic[], options: SubscribeOptions) => {
      const entry = { topics, options, closed: false };
      subscriptions.push(entry);
      return { close: () => void (entry.closed = true) };
    },
    sessions: { get: async (id: string) => ({ id, flowKind: "agent" }) },
    flow: (flow: string) => ({
      read: async (action: string) => {
        reads.push(`${flow}.${action}`);
        return { ok: true, tasks: [{ id: "t1", goal: "Fix the typo", status, updatedAt: reads.length }] };
      },
    }),
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
  it("subscribes the session's board and plan ledgers, narrowed, at its old pace for where push can miss a change", async () => {
    const lab = fakeClient();
    const stop = createWiredLab(lab.client).watchTasks("s1", () => {});
    await until(() => lab.subscriptions.length > 0);
    stop();
    expect(lab.subscriptions[0]!.topics).toEqual([
      { scope: "session", id: "s1", resource: "tasks" },
      { scope: "session", id: "s1", resource: "plan" },
    ]);
    expect(lab.subscriptions[0]!.options.pollIntervalMs).toBe(2_000);
    expect(lab.subscriptions[0]!.closed).toBe(true);
  });

  it("reads once on open, again on a board notice, and keeps no timer of its own", async () => {
    const lab = fakeClient();
    let rows: TaskRow[] = [];
    const stop = createWiredLab(lab.client).watchTasks("s1", (next) => (rows = next));
    await until(() => rows.length === 1);
    await new Promise((r) => setTimeout(r, 2_200));
    expect(lab.reads).toEqual(["agent.listTasks_tasks"]);
    lab.settle("completed");
    lab.hear({ topic: { scope: "session", id: "s1", resource: "tasks" }, kind: "board" });
    await until(() => rows[0]?.status === "completed");
    stop();
    expect(lab.reads).toHaveLength(2);
  });
});
