/**
 * POC v2 (throwaway — FIX-939 design, not a shipping test).
 *
 * Extends the store-layer POC to the EXECUTION layer: two real flows, real
 * actions, real `runAction`, and a task dispatched from a coordinator session
 * into a Workstream (a sub-session) running a DIFFERENT flow.
 *
 * Answers three things the store-layer POC could not:
 *   1. can a Workstream run a different flow than its parent?
 *   2. what does a block actually have access to (i.e. how big is the gap
 *      between "record intent" and "dispatch a sibling")?
 *   3. does history isolation hold on the real execution path, not just at the
 *      store query?
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "../src";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

/**
 * A task as the board holds it. It names an `assignee` and a `topic` — never a
 * flow, an action, or a session id. §1 rejects storing a `(flowKind, action)`
 * target because `TaskWorkerRegistry` already says what runs; the executor
 * resolves the worker from the registry by `assignee`.
 */
type WorkstreamTask = {
  boardId: string;
  assignee: string;
  topic: string;
  input: string;
};

/** Stands in for `TaskWorkerRegistry = Record<string, TaskWorker>`. */
const BOARD_ID = "board_delivery";
const registry: Record<string, { actionName: string }> = {
  implementer: { actionName: "execute" }
};

type Workstream = SessionRecord & {
  parentSessionId?: string;
  boardId?: string;
  assignee?: string;
  topic?: string;
};

/** Intent recorded from inside a running request; drained outside it. */
const filed: WorkstreamTask[] = [];
/** What a block could actually see on its ctx, captured at runtime. */
let observedCtxKeys: string[] = [];

const coordinatorFlow = defineFlow({
  kind: "coordinator",
  actions: {
    plan: {
      inputSchema: z.string(),
      block: handler({
        name: "plan",
        execute: (input: unknown, ctx: unknown) => {
          observedCtxKeys = Object.keys(ctx as object).sort();
          // A block can RECORD intent. It cannot dispatch: there is no
          // flow registry and no executor reachable from here.
          filed.push({
            boardId: BOARD_ID,
            assignee: "implementer",
            topic: String(input),
            input: `work for ${String(input)}`
          });
          return `planned ${String(input)}`;
        }
      })
    }
  }
})();

const workerFlow = defineFlow({
  kind: "worker",
  actions: {
    execute: {
      inputSchema: z.string(),
      block: handler({ name: "execute", execute: (input: unknown) => `did: ${String(input)}` })
    }
  }
})();

let seq = 0;

/**
 * Stands in for the capability that does not exist today. Keyed on
 * (parentSessionId, boardId, assignee, topic). `boardId` is required because
 * `assignee` is unique only WITHIN a registry; `flowKind` is not in the key at
 * all — the flow follows from the resolved worker, it does not identify it.
 */
async function dispatchToWorkstream(
  stores: StoreRegistry,
  parentSessionId: string,
  task: WorkstreamTask
): Promise<string> {
  const all = (await stores.session.list({})) as Workstream[];
  const existing = all.find(
    (s) =>
      s.parentSessionId === parentSessionId &&
      s.topic === task.topic &&
      s.boardId === task.boardId &&
      s.assignee === task.assignee
  );

  let workstreamId: string;
  if (existing !== undefined) {
    workstreamId = existing.id;
  } else {
    workstreamId = `ws_${++seq}`;
    const record: Workstream = {
      id: workstreamId,
      flowKind: "worker",
      boardId: task.boardId,
      assignee: task.assignee,
      userId: "u1",
      state: {},
      version: 0,
      createdAt: 1,
      updatedAt: 1,
      journal: [],
      parentSessionId,
      topic: task.topic
    };
    await stores.session.set(workstreamId, record, "any");
  }

  await runAction({
    flow: workerFlow,
    actionName: registry[task.assignee]!.actionName,
    input: task.input,
    userId: "u1",
    sessionId: workstreamId,
    stores,
    runtimeConfig: {}
  });
  return workstreamId;
}

async function historyOf(stores: StoreRegistry, sessionId: string): Promise<string[]> {
  const rs = await stores.request.list({ sessionId, status: "completed", limit: 50 });
  return rs.map((r) => r.actionName).sort();
}

describe("POC v2: Workstream execution across flows", () => {
  it("a Workstream runs a DIFFERENT flow than its parent, with isolated history", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();

    await runAction({
      flow: coordinatorFlow,
      actionName: "plan",
      input: "FIX-981",
      userId: "u1",
      sessionId: "S",
      stores,
      runtimeConfig: {}
    });

    expect(filed).toHaveLength(1);
    const wsId = await dispatchToWorkstream(stores, "S", filed[0]!);

    const ws = (await stores.session.get(wsId)) as Workstream | undefined;
    expect(ws?.flowKind).toBe("worker");
    expect(ws?.parentSessionId).toBe("S");
    expect(ws?.topic).toBe("FIX-981");

    // The coordinator's turn stays in S; the worker's turn stays in the Workstream.
    expect(await historyOf(stores, "S")).toEqual(["plan"]);
    expect(await historyOf(stores, wsId)).toEqual(["execute"]);
  });

  it("a second task on the same topic REUSES the Workstream and accumulates", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();

    await runAction({
      flow: coordinatorFlow, actionName: "plan", input: "FIX-981",
      userId: "u1", sessionId: "S", stores, runtimeConfig: {}
    });
    const first = await dispatchToWorkstream(stores, "S", filed[0]!);
    const second = await dispatchToWorkstream(stores, "S", filed[0]!);

    expect(second).toBe(first);
    expect(await historyOf(stores, first)).toEqual(["execute", "execute"]);
    expect(await historyOf(stores, "S")).toEqual(["plan"]);
  });

  it("separate topics get separate Workstreams", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();
    const a = await dispatchToWorkstream(stores, "S", {
      boardId: BOARD_ID, assignee: "implementer", topic: "FIX-981", input: "a"
    });
    const b = await dispatchToWorkstream(stores, "S", {
      boardId: BOARD_ID, assignee: "implementer", topic: "FIX-982", input: "b"
    });
    expect(a).not.toBe(b);
    expect(await historyOf(stores, a)).toEqual(["execute"]);
    expect(await historyOf(stores, b)).toEqual(["execute"]);
  });

  it("PROBE — what a block can actually reach from ctx", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();
    await runAction({
      flow: coordinatorFlow, actionName: "plan", input: "probe",
      userId: "u1", sessionId: "S", stores, runtimeConfig: {}
    });

    const has = (k: string) => observedCtxKeys.includes(k);
    // eslint-disable-next-line no-console
    console.log(
      `[poc2] ctx keys (${observedCtxKeys.length}): ${observedCtxKeys.join(", ")}\n` +
        `[poc2] stores=${has("stores")} sessionId=${has("sessionId")} ` +
        `flow=${has("flow")} runAction=${has("runAction")} dispatch=${has("dispatch")}`
    );
    expect(observedCtxKeys.length).toBeGreaterThan(0);
  });
});
