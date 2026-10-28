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
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  resolveRequestIncarnation,
  runAction
} from "@flow-state-dev/engine";
import { upgradeWorkerEntryNames as upgradeWith, type EntryNameFlow } from "../src/workers/upgrade-entry-names";

type Stores = Parameters<typeof upgradeWith>[0];
/** The upgrade as a host calls it, fenced on the engine's own incarnation rule. */
const upgradeWorkerEntryNames = (stores: Stores, flows: readonly EntryNameFlow[]) =>
  upgradeWith(stores, flows, { incarnationOf: resolveRequestIncarnation });

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
    expect(await upgradeWorkerEntryNames(stores, [workerCopy("agent")])).toEqual({ requests: 0, wakes: 0, leftover: 0 });
    expect(await upgradeWorkerEntryNames({ ...stores, wakes: undefined } as never, [workerCopy("agent")])).toEqual({ requests: 0, wakes: 0, leftover: 0 });
  });

  it("rewrites a worker flow's old name only where the flow no longer declares it: its own `run` is left alone", async () => {
    const stores = createInMemoryStores();
    // A worker flow with its `respond` door and an action of its own named `run`.
    const both = { id: "desk", actions: { respond: {}, run: {} } };
    await stores.request.set("own-run", record("own-run", "desk", "run", "suspended"), "any");
    expect((await upgradeWorkerEntryNames(stores, [both])).requests).toBe(0);
    expect((await stores.request.get("own-run"))?.actionName).toBe("run");
  });

  it("counts only the writes that applied: a record that is no longer the one read is not rewritten", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("mid-reply", record("mid-reply", "agent", "run", "interrupted"), "any");
    // The store fences on the incarnation: one that doesn't match writes nothing.
    const result = await upgradeWith(stores, [workerCopy("agent")], { incarnationOf: () => "inc-someone-else" });
    expect(result.requests).toBe(0);
    expect((await stores.request.get("mid-reply"))?.actionName).toBe("run");
  });

  it("renames a running request's live-registry entry with its record", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("live", record("live", "agent", "run", "in_progress"), "any");
    const now = Date.now();
    await stores.activeRequests.register({
      requestId: "live",
      flowKind: "agent",
      flowId: "agent",
      actionName: "run",
      userId: "alice",
      source: "http",
      startedAt: now,
      lastHeartbeatAt: now
    });
    await upgradeWorkerEntryNames(stores, [workerCopy("agent")]);
    expect((await stores.activeRequests.get("live"))?.actionName).toBe("respond");
  });

  it("leaves a live-registry entry alone when its record wasn't rewritten, or when it is gone by the write", async () => {
    const stores = createInMemoryStores();
    const now = Date.now();
    const entry = (requestId: string) => ({
      requestId,
      flowKind: "agent",
      flowId: "agent",
      actionName: "run",
      userId: "alice",
      source: "http",
      startedAt: now,
      lastHeartbeatAt: now
    });
    // A finished record: not rewritten, so its entry isn't either.
    await stores.request.set("done", record("done", "agent", "run", "completed"), "any");
    await stores.activeRequests.register(entry("done"));
    // A rewritten record whose entry the sweep deregisters after the listing.
    await stores.request.set("swept", record("swept", "agent", "run", "interrupted"), "any");
    await stores.activeRequests.register(entry("swept"));
    const sweeping = {
      ...stores,
      activeRequests: {
        listAll: stores.activeRequests.listAll.bind(stores.activeRequests),
        get: async (requestId: string) => {
          if (requestId === "swept") await stores.activeRequests.deregister("swept");
          return stores.activeRequests.get(requestId);
        },
        register: stores.activeRequests.register.bind(stores.activeRequests)
      }
    };
    expect((await upgradeWorkerEntryNames(sweeping as never, [workerCopy("agent")])).requests).toBe(1);
    expect((await stores.activeRequests.get("done"))?.actionName).toBe("run");
    expect(await stores.activeRequests.get("swept")).toBeUndefined();
  });

  it("counts and warns of a wake that keeps changing through every attempt to move it", async () => {
    const stores = createInMemoryStores();
    const wakes = stores.wakes!;
    const base = { sessionId: "busy", flowKind: "agent", userId: "alice", orgId: DEFAULT_ORG_ID, dueAt: 5_000, landBy: 6_000 };
    await wakes.owe({ ...base, entry: "runTaskBoard" });
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => void warned.push(line);
    try {
      const busy = {
        ...stores,
        wakes: {
          listDue: wakes.listDue.bind(wakes),
          get: wakes.get.bind(wakes),
          owe: wakes.owe.bind(wakes),
          clear: async () => false
        }
      };
      expect(await upgradeWorkerEntryNames(busy as never, [workerCopy("agent")])).toMatchObject({ wakes: 0, leftover: 1 });
    } finally {
      console.warn = warn;
    }
    expect(warned.join("\n")).toMatch(/"runTaskBoard" in session "busy"/);
  });

  it("moves a wake bumped while it is moved, so nothing is left under the old name", async () => {
    const stores = createInMemoryStores();
    const wakes = stores.wakes!;
    const base = { sessionId: "conv", flowKind: "agent", userId: "alice", orgId: DEFAULT_ORG_ID, dueAt: 5_000, landBy: 6_000 };
    await wakes.owe({ ...base, entry: "runTaskBoard" });
    // A writer owes the old wake again between the read and the clear, once.
    let bumped = false;
    const racing = {
      ...stores,
      wakes: {
        ...wakes,
        listDue: wakes.listDue.bind(wakes),
        get: wakes.get.bind(wakes),
        owe: wakes.owe.bind(wakes),
        clear: async (key: Parameters<typeof wakes.clear>[0], version: number) => {
          if (!bumped) {
            bumped = true;
            await wakes.owe({ ...base, entry: "runTaskBoard", dueAt: 4_000 });
          }
          return wakes.clear(key, version);
        }
      }
    };
    expect((await upgradeWorkerEntryNames(racing as never, [workerCopy("agent")])).wakes).toBe(1);
    expect(await wakes.get({ sessionId: "conv", entry: "runTaskBoard" })).toBeNull();
    expect(await wakes.get({ sessionId: "conv", entry: "dispatch" })).toMatchObject({ dueAt: 4_000 });
  });
});

describe("a reply an older host parked under `run`", () => {
  /** A worker's door that asks before it answers, and the stores it parks in. */
  async function parked() {
    const ask = handler({
      name: "upgrade-ask",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.unknown(),
      execute: async (input, ctx) => ({ asked: input.message, decision: await ctx.suspend!({ reason: "user_approval", message: "Go?" }) })
    });
    const answer = handler({ name: "upgrade-answer", inputSchema: z.any(), outputSchema: z.string(), execute: async () => "answered" });
    const flow = defineFlow({
      kind: "desk",
      actions: {
        respond: {
          inputSchema: z.object({ message: z.string() }),
          block: sequencer({ name: "upgrade-reply", durable: true }).step(ask).step(answer)
        }
      }
    })();
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider };
    const first = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "respond",
      input: { message: "ship it?" },
      userId: "alice",
      sessionId: "s1",
      stores,
      runtimeConfig
    } as never);
    const id = first.requestId!;
    const record = (await stores.request.get(id))!;
    // As an older host left it: the same parked reply, under the door's old name.
    await stores.request.setFieldsIfStatus(id, { actionName: "run" }, ["suspended"], Date.now(), resolveRequestIncarnation(record));
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: {} });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const resume = async () =>
      (
        await continueRequest({
          requestId: id,
          stores,
          flowRegistry: registry,
          resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: {} },
          runtimeConfig
        } as never)
      ).finished;
    return { flow, stores, id, resume };
  }

  it("fails to resume without the upgrade: no worker flow has `run` any more", async () => {
    const { resume } = await parked();
    await expect(resume()).rejects.toThrow(/run/);
  });

  it("resumes as `respond` after the upgrade, and completes", async () => {
    const { flow, stores, id, resume } = await parked();
    expect((await upgradeWorkerEntryNames(stores, [flow as never])).requests).toBe(1);
    const resumed = await resume();
    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toBe("answered");
    expect(await stores.request.get(id)).toMatchObject({ actionName: "respond", status: "completed" });
  });
});
