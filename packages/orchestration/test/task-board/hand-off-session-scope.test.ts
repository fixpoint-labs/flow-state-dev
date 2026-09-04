/**
 * FIX-1068: a hand-off board may be session-scoped once, and only once, its
 * ledger resolves to the lineage root.
 *
 * The refusal this narrows exists because a handed-off worker runs in its own
 * session: an ordinary session-scoped ledger resolves against the running
 * session, so the child addresses an empty collection, the start gate reads
 * the missing row as a stale claim, and the board reclaims and redispatches
 * until the abandonment cap errors it. `sharedToWorkstream` removes exactly
 * that: parent and child resolve one ledger, at the lineage address.
 *
 * Reachable is all it makes the ledger. The hand-off lease bound (FIX-1070)
 * applies to a lineage-rooted board exactly as it does to a user- or org-scoped
 * one, and nothing here claims otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { SessionRecord, StoreRegistry } from "@flow-state-dev/engine";
import { defineTaskCollection } from "../../src/tasks";
import { taskBoard } from "../../src/task-board";
import type { TaskWorker } from "../../src/tasks";

const BOARD_ID = "session-scoped-hand-off";

function boardFor(collection: ReturnType<typeof defineTaskCollection>) {
  return taskBoard({
    name: "briefs",
    boardId: BOARD_ID,
    collection,
    workers: {
      brief: dispatcher({
        name: "brief-seat",
        type: "task",
        target: "brief",
        session: "per-task"
      }) as unknown as TaskWorker
    }
  });
}

describe("FIX-1068: session-scoped hand-off boards", () => {
  // This flow's worker is a handler, so it declares no model intents — and
  // `createModelResolver` refuses a `FSDEV_DEFAULT_MODEL` override that can have
  // no effect. That guard is right; it just makes the test depend on whoever's
  // shell it runs in, so pin the variable rather than inherit it.
  const priorDefaultModel = process.env.FSDEV_DEFAULT_MODEL;
  beforeAll(() => {
    delete process.env.FSDEV_DEFAULT_MODEL;
  });
  afterAll(() => {
    if (priorDefaultModel !== undefined) process.env.FSDEV_DEFAULT_MODEL = priorDefaultModel;
  });

  it("still refuses a session-scoped ledger that does not reach the child session", () => {
    // The loop is real for this one: the child would resolve its own empty
    // ledger and never find the row.
    const unshared = defineTaskCollection({
      id: "briefs",
      scope: "session",
      stateSchema: z.object({ request: z.string() })
    });

    expect(() => boardFor(unshared)).toThrow(/session-scoped/);
  });

  it("permits a session-scoped ledger that resolves to the lineage root", () => {
    const shared = defineTaskCollection({
      id: "briefs",
      scope: "session",
      sharedToWorkstream: true,
      stateSchema: z.object({ request: z.string() })
    });

    expect(() => boardFor(shared)).not.toThrow();
  });

  it("files a row a child session can actually resolve", async () => {
    // Construction not throwing proves nothing about reachability. What the
    // refusal is really about is whether the CHILD can find the row, so this
    // reads the ledger from a second session — one stamped the way a hand-off
    // dispatch stamps a child session — and expects the parent's row.
    const shared = defineTaskCollection({
      id: "briefs",
      scope: "session",
      sharedToWorkstream: true,
      stateSchema: z.object({ request: z.string() })
    });
    const board = boardFor(shared);

    const fileTask = handler({
      name: "file-task",
      inputSchema: z.object({ request: z.string() }),
      uses: [board.capability],
      execute: async (input, ctx) => {
        await ctx.cap.briefs.addTask({
          goal: input.request,
          assignee: "brief",
          input: { request: input.request }
        });
      }
    });

    const flow = defineFlow({
      kind: "session-detached-flow",
      actions: {
        run: {
          inputSchema: z.object({ request: z.string() }),
          block: sequencer({
            name: "file-only",
            inputSchema: z.object({ request: z.string() })
          }).tap(fileTask)
        }
      }
    })();

    const stores: StoreRegistry = createInMemoryStores();
    const ts = 1_700_000_000_000;
    const base = {
      flowKind: flow.kind,
      userId: "u_1",
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      journal: []
    };
    // Both records carry the SAME minted lineage — which is exactly the state
    // a hand-off dispatch writes (it copies the parent's id onto the child,
    // pinned by request-host-lineage-root.test.ts). Seeding it here keeps this
    // test on its own subject: given a correctly stamped child session, does
    // the board's ledger actually resolve across the two sessions.
    const LINEAGE = "lin_shared";
    await stores.session.set(
      "s_parent",
      { ...base, id: "s_parent", lineageId: LINEAGE } as SessionRecord,
      "any"
    );
    // The child a hand-off dispatch would create: same flow kind, parented to
    // the conversation, and carrying its lineage root.
    await stores.session.set(
      "ws_child",
      {
        ...base,
        id: "ws_child",
        parentSessionId: "s_parent",
        lineageId: LINEAGE
      } as SessionRecord,
      "any"
    );

    // Filed through the real action path, so the board capability is installed
    // the way it is at runtime rather than reached for off the root context.
    const filed = await runAction({
      flow,
      actionName: "run",
      input: { request: "summarize the locking tradeoffs" },
      userId: "u_1",
      sessionId: "s_parent",
      stores,
      runtimeConfig: {}
    });
    expect(filed.error).toBeUndefined();

    // THE ASSERTION THE REFUSAL IS ABOUT: the child session resolves the same
    // ledger and finds the row it would be dispatched for. Unshared, this list
    // is empty and the start gate reads that as a stale claim.
    const childCtx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_child",
      sessionId: "ws_child",
      userId: "u_1",
      stores
    });
    const seen = await (
      childCtx.resources.briefs as unknown as {
        list(): Promise<Array<{ state: { goal: string } }>>;
      }
    ).list();
    expect(seen.map((t) => t.state.goal)).toEqual(["summarize the locking tradeoffs"]);

    // And it is not sitting at either session's own key, which is what made it
    // reachable across the lineage rather than private to the parent.
    for (const sessionId of ["s_parent", "ws_child"]) {
      const own = await stores.resourceState.getByPrefix("session", sessionId, "briefs/");
      expect(Object.keys(own)).toHaveLength(0);
    }
  });
});
