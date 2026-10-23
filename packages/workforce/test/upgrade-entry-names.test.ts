/**
 * An upgrade across the entry renames loses nothing (BP-030).
 *
 * A host that ran before the renames stored a user's reply under `run` and a
 * board's pass, and the wake that runs it, under `runTaskBoard`. Neither name
 * is on a worker flow any more, so an unfinished request resumed by the old
 * name, or a wake fired by it, would fail as an unknown action. Run once at
 * host start, `upgradeWorkerEntryNames` rewrites each to the new name, on the
 * worker flows the host registered and nowhere else.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { upgradeWorkerEntryNames } from "../src/workers/upgrade-entry-names";

/** A worker flow's registered copy, as far as the upgrade reads it. */
const workerCopy = (id: string) => ({ id, actions: { respond: {} }, internal: { actions: { dispatch: {} } } });
/** Any other flow, which still has a `run` action of its own. */
const chatCopy = { id: "chat", actions: { run: {} } };

function record(id: string, flowKind: string, actionName: string, status: string) {
  const now = Date.now();
  return {
    orgId: DEFAULT_ORG_ID,
    id,
    flowKind,
    flowId: flowKind,
    actionName,
    userId: "alice",
    sessionId: `${id}-session`,
    status,
    startedAtMs: now,
    state: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    incarnation: `inc-${id}`,
    journal: []
  } as never;
}

describe("upgradeWorkerEntryNames", () => {
  it("resumes a reply stored under `run` or `message`, mid-reply or parked, as `respond`, and a pass as `dispatch`", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("mid-reply", record("mid-reply", "agent", "run", "interrupted"), "any");
    await stores.request.set("parked", record("parked", "em", "message", "suspended"), "any");
    await stores.request.set("pass", record("pass", "agent", "runTaskBoard", "in_progress"), "any");

    const upgraded = await upgradeWorkerEntryNames(stores, [workerCopy("agent"), workerCopy("em"), chatCopy]);

    expect(upgraded.requests).toBe(3);
    expect((await stores.request.get("mid-reply"))?.actionName).toBe("respond");
    expect((await stores.request.get("parked"))?.actionName).toBe("respond");
    expect((await stores.request.get("pass"))?.actionName).toBe("dispatch");
  });

  it("leaves a finished request, and another flow's own `run`, as they were", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("done", record("done", "agent", "run", "completed"), "any");
    await stores.request.set("chat", record("chat", "chat", "run", "suspended"), "any");

    expect((await upgradeWorkerEntryNames(stores, [workerCopy("agent"), chatCopy])).requests).toBe(0);
    expect((await stores.request.get("done"))?.actionName).toBe("run");
    expect((await stores.request.get("chat"))?.actionName).toBe("run");
  });

  it("rewrites a wake waiting to run `runTaskBoard` to `dispatch`, keeping when it falls due", async () => {
    const stores = createInMemoryStores();
    const wakes = stores.wakes!;
    const base = { sessionId: "conv", flowKind: "agent", userId: "alice", orgId: DEFAULT_ORG_ID, dueAt: 5_000, landBy: 6_000 };
    await wakes.owe({ ...base, entry: "runTaskBoard" });
    await wakes.owe({ ...base, sessionId: "chat-session", flowKind: "chat", entry: "runTaskBoard" });

    expect((await upgradeWorkerEntryNames(stores, [workerCopy("agent"), chatCopy])).wakes).toBe(1);
    expect(await wakes.get({ sessionId: "conv", entry: "runTaskBoard" })).toBeNull();
    expect(await wakes.get({ sessionId: "conv", entry: "dispatch" })).toMatchObject({ flowKind: "agent", dueAt: 5_000, landBy: 6_000 });
    // Not a worker flow's: left for its own flow.
    expect(await wakes.get({ sessionId: "chat-session", entry: "runTaskBoard" })).not.toBeNull();
  });

  it("is a no-op the second time, and on stores that keep no wakes", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("mid-reply", record("mid-reply", "agent", "run", "interrupted"), "any");
    await upgradeWorkerEntryNames(stores, [workerCopy("agent")]);
    expect(await upgradeWorkerEntryNames(stores, [workerCopy("agent")])).toEqual({ requests: 0, wakes: 0 });
    expect(await upgradeWorkerEntryNames({ ...stores, wakes: undefined } as never, [workerCopy("agent")])).toEqual({ requests: 0, wakes: 0 });
  });
});
