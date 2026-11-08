/**
 * What a running task's working line reads, wired: the tool call its run
 * session shows still running, and the plan its harness recorded, read with
 * harness-manager's `readRecordedWork` for the task's own run request. A
 * finished call is no longer "now", and a run that records no plan has none.
 */
import { describe, expect, it } from "vitest";
import type { Client, WireNotice } from "@flow-state-dev/client";
import { createLabAdapter, type WorkingNow } from "../src/adapter";

const tool = (id: string, status: string, command: string) => ({
  id,
  requestId: "req_run",
  type: "tool_output",
  status,
  ts: 1,
  itemIndex: 0,
  blockName: "Bash",
  output: null,
  toolCall: { callId: id, name: "Bash", arguments: JSON.stringify({ command }), generatorBlock: "claude-code" },
});

/**
 * A run session holding `items`, and recording a plan when `plan` is given.
 * Its run request's own stream sends `live`, as each item is added.
 */
function clientWith(items: unknown[], plan?: { title: string; status: string }[], live: unknown[] = [], dropAfter?: number) {
  const listed: string[] = [];
  const streamed: string[] = [];
  const heard: Array<(notice: WireNotice | null) => void> = [];
  const client = {
    subscribe: (_topics: unknown, options: { onChange: (notice: WireNotice | null) => void }) => {
      heard.push(options.onChange);
      return { close() {} };
    },
    flow: (flow: string) => ({
      request: (requestId: string) => ({
        // Each event carries its sequence number; a connection resumes after the one it asks for.
        // With `dropAfter`, the first connection sends that many items, then fails.
        stream: (callbacks: {
          startingAfter?: number;
          onEvent?: (event: { sequence_number: number }) => void;
          onItemAdded?: (event: { item: unknown }) => void;
          onError?: (error: Error) => void;
        }) => {
          const first = streamed.length === 0;
          streamed.push(`${flow}/${requestId}${callbacks.startingAfter === undefined ? "" : `@${callbacks.startingAfter}`}`);
          const after = callbacks.startingAfter ?? 0;
          const end = first && dropAfter !== undefined ? dropAfter : live.length;
          queueMicrotask(() => {
            live.slice(after, end).forEach((item, i) => {
              callbacks.onEvent?.({ sequence_number: after + i + 1 });
              callbacks.onItemAdded?.({ item });
            });
            if (end < live.length) callbacks.onError?.(new TypeError("network connection lost"));
          });
          return { close() {} };
        },
      }),
    }),
    sessions: {
      get: async (id: string) => ({ id, flowKind: "coder" }),
      state: async () => ({ at: 1, sessionCreatedAt: 1, items, pagination: { hasMore: false, nextOffset: items.length } }),
      stream: () => ({ close() {} }),
    },
    resources: {
      getResourceManifest: async () => ({
        resources:
          plan === undefined
            ? []
            : [
                { kind: "collection", pattern: "observed-plan/**", ref: "plan", client: { state: { read: true } } },
                { kind: "collection", pattern: "observed-plan-list/**", ref: "markers", client: { state: { read: true } } },
              ],
      }),
      listCollectionResources: async (_session: string, ref: string, options: { topicPrefix: string }) => {
        listed.push(`${ref}:${options.topicPrefix}`);
        if (ref !== "plan") return { items: [], nextCursor: null };
        return { items: (plan ?? []).map((row, i) => ({ topic: `${options.topicPrefix}inv/${i}`, clientData: row })), nextCursor: null };
      },
    },
  } as unknown as Client;
  /** A notice on the run session, as push delivers it. */
  const notify = (notice: WireNotice) => act(() => heard.forEach((hear) => hear(notice)));
  return { client, listed, streamed, notify, setPlan: (rows: { title: string; status: string }[]) => (plan = rows) };
}

/** Lets the reads a notice started settle. */
const act = async (fire: () => void) => {
  fire();
  await new Promise((r) => setTimeout(r, 20));
};

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe("a running task's working line, as the adapter reads it", () => {
  it("reads the call still running and the plan recorded for the task's own run request", async () => {
    const { client, listed } = clientWith([tool("t1", "completed", "ls"), tool("t2", "in_progress", "pnpm test")], [
      { title: "Fix the ordering", status: "completed" },
      { title: "Add regression test", status: "in_progress" },
    ]);
    let now: WorkingNow = {};
    const stop = createLabAdapter(client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => (now = next));
    await until(() => now.inFlight !== undefined && now.plan !== undefined);
    stop();
    expect(now.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    expect(now.plan).toEqual([
      { title: "Fix the ordering", status: "completed" },
      { title: "Add regression test", status: "in_progress" },
    ]);
    expect(listed.some((read) => read.startsWith("plan:") && read.includes("req_run"))).toBe(true);
  });

  it("never names a call an earlier, crashed request left half-done in the same session", async () => {
    // A reused run session: `req_old` crashed mid-call and left its call `in_progress` for good.
    const crashed = { ...tool("t0", "in_progress", "rm -rf build"), requestId: "req_old" };
    const { client } = clientWith([crashed, tool("t1", "completed", "ls")]);
    const seen: WorkingNow[] = [];
    const stop = createLabAdapter(client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => seen.push(next));
    await until(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(seen.some((now) => now.inFlight !== undefined)).toBe(false);
  });

  it("names a call that started after the view opened, which only the run request's own stream sends", async () => {
    // The session stream sends an item once it is finished: stored is the finished `ls` only.
    const lab = clientWith([tool("t1", "completed", "ls")], undefined, [tool("t1", "completed", "ls"), tool("t2", "in_progress", "pnpm test")]);
    let now: WorkingNow = {};
    const stop = createLabAdapter(lab.client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => (now = next));
    await until(() => now.inFlight !== undefined);
    stop();
    expect(now.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    expect(lab.streamed).toEqual(["coder/req_run"]);
  });

  it("reconnects a dropped request stream and resumes it, so a call that starts after the drop still shows", async () => {
    const lab = clientWith([tool("t1", "completed", "ls")], undefined, [tool("t1", "completed", "ls"), tool("t2", "in_progress", "pnpm test")], 1);
    let now: WorkingNow = {};
    const stop = createLabAdapter(lab.client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => (now = next));
    await until(() => now.inFlight !== undefined);
    stop();
    expect(now.inFlight).toEqual({ tool: "Bash", args: { command: "pnpm test" } });
    // The second connection resumes after what the first one heard, rather than replaying it.
    expect(lab.streamed).toEqual(["coder/req_run", "coder/req_run@1"]);
  });

  it("has nothing in flight once the feed holds the call's finished copy, whatever the request stream last said", async () => {
    const lab = clientWith([tool("t2", "completed", "pnpm test")], undefined, [tool("t2", "in_progress", "pnpm test")]);
    const seen: WorkingNow[] = [];
    const stop = createLabAdapter(lab.client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => seen.push(next));
    await until(() => lab.streamed.length > 0 && seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(seen.at(-1)?.inFlight).toBeUndefined();
  });

  it("reads the plan again when the harness writes it, and not on the run's other notices", async () => {
    const lab = clientWith([tool("t1", "in_progress", "pnpm test")], [{ title: "Fix the ordering", status: "in_progress" }]);
    let now: WorkingNow = {};
    const stop = createLabAdapter(lab.client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => (now = next));
    await until(() => now.plan !== undefined);
    lab.setPlan([
      { title: "Fix the ordering", status: "completed" },
      { title: "Add regression test", status: "in_progress" },
    ]);
    // A streamed chunk, or a write to another recorded collection, is not the plan: no read.
    await lab.notify({ topic: { scope: "session", id: "dsx_run" }, kind: "items" });
    await lab.notify({ topic: { scope: "session", id: "dsx_run", resource: "observed-file-ops/req_run/inv/src/a.ts" }, kind: "resource" });
    expect(now.plan?.map((row) => row.title)).toEqual(["Fix the ordering"]);
    // A write to the plan reads it again, and the line moves to the new step.
    await lab.notify({ topic: { scope: "session", id: "dsx_run", resource: "observed-plan/conversation/c1/2" }, kind: "resource" });
    await until(() => now.plan?.length === 2);
    expect(now.plan?.at(-1)).toEqual({ title: "Add regression test", status: "in_progress" });
    stop();
  });

  it("has nothing in flight once every call finished, and no plan from a run that records none", async () => {
    const { client } = clientWith([tool("t1", "completed", "ls")]);
    const seen: WorkingNow[] = [];
    const stop = createLabAdapter(client).watchWorking({ sessionId: "dsx_run", requestId: "req_run" }, (next) => seen.push(next));
    await until(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(seen.at(-1)).toEqual({});
  });
});
