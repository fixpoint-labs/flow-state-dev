/**
 * The pull-request recorder: one per request, live, stopped by the request.
 *
 * What a reader relies on: a row is written when its call settles, not when
 * the run ends; calls made before the recorder started are read too (the step
 * after a generator); two blocks that start it share one listener, so a
 * repeated call is one write path; it stops only when the request ends and
 * waits for its last write; and a store that fails never fails the run.
 *
 * Driven through a hand-built context with an item stream and a request-end
 * seam: the engine's own are exercised in the harness packages and Kitchen
 * Sink.
 */
import { describe, expect, it } from "vitest";
import type { RuntimeItem } from "../src/items/internal";
import { pullRequestRecorder, pullRequestWritesSettled, recordPullRequests } from "../src/helpers/pull-request-recorder";
import { REQUEST_END_SEAM, type RequestEndHook } from "../src/types/request-end";
import { OBSERVED_PULL_REQUESTS, writePullRequests } from "../src/types/pull-requests";
import type { BlockContext } from "../src/types/block";

function memoryCollection(fail = false, delayMs = 0) {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async getOptional(key: string) {
      const state = rows.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      if (fail) throw new Error("store unavailable");
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      rows.set(key, { ...rows.get(key), ...update });
    },
  };
}

/** A request: its item stream, its end hooks, its notes. */
function request(options: { fail?: boolean; seam?: boolean; declared?: boolean; delayMs?: number } = {}) {
  const items: RuntimeItem[] = [];
  const listeners = new Set<(item: RuntimeItem, kind: "added" | "updated" | "done") => void>();
  const hooks: RequestEndHook[] = [];
  const notes: string[] = [];
  const collection = memoryCollection(options.fail, options.delayMs);
  const response = {
    emit: () => undefined,
    getItems: () => items,
    getItemCount: () => items.length,
    subscribeToItems(listener: (item: RuntimeItem, kind: "added" | "updated" | "done") => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const ctx = () =>
    ({
      request: { identity: { id: "req_1" } },
      response,
      resources: options.declared === false ? {} : { [OBSERVED_PULL_REQUESTS]: collection },
      emit: { status: (message: string) => notes.push(message) },
      ...(options.seam === false ? {} : { [REQUEST_END_SEAM]: { add: (hook: RequestEndHook) => hooks.push(hook) } }),
    }) as unknown as BlockContext;
  const settle = (number: number, command = "gh pr create --fill", id = `item_${number}_${items.length}`) => {
    const item = {
      id,
      type: "tool_output",
      status: "completed",
      output: { stdout: `https://github.com/acme/app/pull/${number}\n` },
      toolCall: { name: "bash", arguments: JSON.stringify({ command }) },
    } as unknown as RuntimeItem;
    items.push(item);
    for (const listener of [...listeners]) listener(item, "done");
  };
  const end = async () => {
    for (const hook of hooks) await hook({ status: "completed", spend: { byModel: {}, harnessRuns: [] } });
  };
  return { ctx, settle, end, collection, listeners, hooks, notes, response };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("recordPullRequests", () => {
  it("writes a row as its call settles, while the request still runs", async () => {
    const r = request();
    recordPullRequests(r.ctx());
    r.settle(88);
    await flush();
    expect([...r.collection.rows.keys()]).toEqual(["github.com/acme/app/88"]);
    expect(r.collection.rows.get("github.com/acme/app/88")).toMatchObject({ requestId: "req_1", source: "tool" });
  });

  it("reads the calls the request made before it started", async () => {
    const r = request();
    r.settle(1);
    recordPullRequests(r.ctx());
    r.settle(2);
    await r.end();
    expect([...r.collection.rows.keys()].sort()).toEqual(["github.com/acme/app/1", "github.com/acme/app/2"]);
  });

  it("starts once per request: a second block shares the first one's listener", () => {
    const r = request();
    recordPullRequests(r.ctx());
    recordPullRequests(r.ctx());
    expect(r.listeners.size).toBe(1);
    expect(r.hooks).toHaveLength(1);
  });

  it("does not count a view, and keeps one row when the link is printed again", async () => {
    const r = request();
    recordPullRequests(r.ctx());
    r.settle(88);
    r.settle(88);
    r.settle(12, "gh pr view 12");
    await r.end();
    expect([...r.collection.rows.keys()]).toEqual(["github.com/acme/app/88"]);
  });

  it("stops when the request ends, after its last write", async () => {
    const r = request();
    recordPullRequests(r.ctx());
    r.settle(5);
    await r.end();
    expect(r.collection.rows.size).toBe(1);
    expect(r.listeners.size).toBe(0);
  });

  it("notes a failed write and does not throw", async () => {
    const r = request({ fail: true });
    recordPullRequests(r.ctx());
    r.settle(5);
    await r.end();
    expect(r.notes).toEqual(["A pull request was not recorded: store unavailable"]);
  });

  it("records nothing, and says why, without the collection or the request-end seam", () => {
    const undeclared = request({ declared: false });
    recordPullRequests(undeclared.ctx());
    const seamless = request({ seam: false });
    recordPullRequests(seamless.ctx());
    expect(undeclared.listeners.size + seamless.listeners.size).toBe(0);
    expect(undeclared.notes[0]).toMatch(/collection is not registered/);
    expect(seamless.notes[0]).toMatch(/no request-end seam/);
  });
});

describe("pullRequestRecorder", () => {
  it("declares the collection and starts the request's recorder", async () => {
    const block = pullRequestRecorder();
    expect(Object.keys(block.declaredResources ?? {})).toContain(OBSERVED_PULL_REQUESTS);
    const r = request();
    r.settle(9);
    await block.config.execute?.(undefined, r.ctx() as never);
    await r.end();
    expect([...r.collection.rows.keys()]).toEqual(["github.com/acme/app/9"]);
  });
});

describe("pullRequestWritesSettled", () => {
  it("lets a turn-end writer wait for the recorder's write in flight, so the turn's create call keeps its row", async () => {
    // A slow store: the recorder's write is still running when the turn-end check writes.
    const r = request({ delayMs: 30 });
    recordPullRequests(r.ctx());
    r.settle(7);
    await pullRequestWritesSettled(r.response);
    await writePullRequests(
      r.collection,
      [{ host: "github.com", owner: "acme", name: "app", number: 7, url: "https://github.com/acme/app/pull/7" }],
      { source: "branch", requestId: "req_2" },
    );
    expect(r.collection.rows.get("github.com/acme/app/7")).toMatchObject({ source: "tool", requestId: "req_1" });
  });

  it("resolves at once for a request with no recorder", async () => {
    await expect(pullRequestWritesSettled({})).resolves.toBeUndefined();
    await expect(pullRequestWritesSettled(undefined)).resolves.toBeUndefined();
  });
});
