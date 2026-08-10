/**
 * Durable write provenance on a real board (FIX-989) — the goal check.
 *
 * The defect, stated as evidence rather than as a claim: two histories on a
 * task board read **identically** afterwards, and they need opposite responses.
 *
 *   1. My write committed, and then something after the durable write fell
 *      over — the change announcement, a result recorder, the caller's own
 *      continuation. A real post-commit failure somebody has to hear about.
 *   2. My write never landed at all. The lease expired, a reclaim re-queued the
 *      task, and another worker picked it up. Routine.
 *
 * Both leave the task `in_progress` on attempt 2, held by a second worker. This
 * file reproduces both against a durable, session-scoped board across separate
 * executions, asserts that they are indistinguishable to anything reading task
 * state, and then asserts that provenance separates them.
 *
 * ## Why this cannot be a unit test
 *
 * `packages/orchestration/test/collection/write-provenance.test.ts` covers the
 * rule and the stamp against in-memory fakes, which run no schema at all. The
 * durable backing validates every task through `taskEnvelopeSchema` on its way
 * to the store, and a Zod object schema strips keys it does not declare — so a
 * provenance field that is not on `taskSchema` works perfectly against those
 * fakes and vanishes here. Every assertion below reads the **persisted row**
 * through the store, never through a participating execution's collection ref.
 *
 * ## Why separate executions
 *
 * The unit of isolation is the execution: each `runAction` gets its own
 * resource cache, and a durable `TaskCollectionRef` hydrates its task mirror
 * when the collection is resolved. A caller asking "did my write land" after a
 * failure is, by construction, a later reader — often a different execution
 * entirely. Running it as one is what makes the answer's *durability* the thing
 * under test, rather than a value that happened to stay in memory.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, type JsonObject } from "@flow-state-dev/core";
import { createInMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import {
  beginTaskWrite,
  defineTaskCollection,
  didWriteLand,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
  type TaskWriteToken,
} from "@flow-state-dev/orchestration";
import {
  taskBoard,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const COLLECTION_ID = "write-provenance-board";

/** Far enough past any lease that `reclaim` returns an in-flight task to the queue. */
const AFTER_EVERY_LEASE = 9_999_999_999_999;

const taskCollection = defineTaskCollection({
  id: COLLECTION_ID,
  scope: "session",
  stateSchema: z.object({ goal: z.string() }),
});

/**
 * The board exists to register and resolve the durable collection. These tests
 * drive `claim` / `fail` directly rather than through `drain`, because the
 * scenario turns on *when* each write happens relative to another execution's,
 * and the drain offers no seam to choose that.
 */
const board = taskBoard({
  name: COLLECTION_ID,
  collection: taskCollection,
  concurrency: 1,
  workers: handler({
    name: "write-provenance-idle-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input) => ({ ok: input.goal }),
  }) as Parameters<typeof taskBoard>[0]["workers"],
  onIdle: "complete",
});

type Board = TaskCollectionRef<{ goal: string }, unknown>;

/** One execution: a flow with a single handler that runs `body` against the shared board. */
function execution(name: string, body: (tasks: Board) => Promise<unknown>) {
  return defineFlow({
    kind: `write-provenance-${name}`,
    actions: {
      run: {
        block: handler({
          name: `write-provenance-${name}-body`,
          inputSchema: z.unknown(),
          uses: [board.capability],
          execute: async (_input, ctx) => {
            const accessor = (ctx.cap as Record<string, { tasks(): Promise<Board> }>)[
              COLLECTION_ID
            ]!;
            return (await body(await accessor.tasks())) ?? null;
          },
        }),
      },
    },
  })({ id: "default" });
}

/** Launch one execution over the shared stores/session. */
function run(
  stores: StoreRegistry,
  sessionId: string,
  name: string,
  body: (tasks: Board) => Promise<unknown>
) {
  return testFlow({
    flow: execution(name, body),
    action: "run",
    userId: "u",
    input: undefined,
    sessionId,
    stores,
    unmockedGeneratorPolicy: "error",
  });
}

/** The persisted row for a task, read straight from the store. */
async function durableTask(
  stores: StoreRegistry,
  sessionId: string,
  id: string
): Promise<Task<{ goal: string }, unknown> | undefined> {
  const row = await stores.resourceState.get(
    "session",
    sessionId,
    `${COLLECTION_ID}/${id}`
  );
  return row?.state as Task<{ goal: string }, unknown> | undefined;
}

/** A fresh shared board: new stores, new session, seeded with `ids`. */
async function seedBoard(ids: string[]) {
  const stores = createInMemoryStores();
  const sessionId = `write-provenance-${Math.random().toString(36).slice(2)}`;
  const seeded = await run(stores, sessionId, "seed", async (tasks) => {
    await tasks.addTasks(
      ids.map((id) => ({ id, goal: id, input: { goal: id }, maxAttempts: 3 }))
    );
    return "seeded";
  });
  expect(seeded.error).toBeUndefined();
  return { stores, sessionId };
}

describe("durable task board: telling a committed write from one that never landed", () => {
  it("separates the two histories that read identically", async () => {
    // "a" carries history 1 (committed, then the caller fell over).
    // "b" carries history 2 (never landed, reclaimed, taken by someone else).
    const { stores, sessionId } = await seedBoard(["a", "b"]);

    /** Tokens the first-party callers minted, observed from the test. */
    const minted: Record<string, TaskWriteToken> = {};

    // --- history 1 -------------------------------------------------------
    // A worker claims "a", opens a correlated write, commits a soft failure
    // that re-pends the task, and THEN dies. Everything after the durable
    // write is where a post-commit failure lives: the change announcement, a
    // result recorder, this handler's own continuation. Which of them threw
    // does not matter — what matters is that the caller is left with a
    // rejection and no verdict, which is the whole problem.
    const crashed = await run(stores, sessionId, "committer", async (tasks) => {
      const mine = await tasks.claim("worker-1", {
        eligibility: (t) => t.id === "a" && t.status === "pending",
      });
      const write = beginTaskWrite(tasks.get("a"));
      minted.a = write;
      await tasks.fail("a", "worker died", {
        ifAllowed: true,
        claim: ticketForClaim(tasks.collectionId, mine!),
        write,
      });
      throw new Error("the recorder fell over after the write committed");
    });
    expect(crashed.error).toBeDefined();

    // --- history 2 -------------------------------------------------------
    // A worker claims "b" and opens a correlated write, but never gets to make
    // it. Its lease then expires.
    const abandoned = await run(stores, sessionId, "abandoner", async (tasks) => {
      const mine = await tasks.claim("worker-1", {
        eligibility: (t) => t.id === "b" && t.status === "pending",
      });
      minted.b = beginTaskWrite(tasks.get("b"));
      return ticketForClaim(tasks.collectionId, mine!);
    });
    expect(abandoned.error).toBeUndefined();

    const reclaimed = await run(stores, sessionId, "reclaimer", (tasks) =>
      tasks.reclaim(AFTER_EVERY_LEASE)
    );
    expect(reclaimed.output).toBe(1);

    // --- a second worker picks both tasks up -----------------------------
    const next = await run(stores, sessionId, "next-worker", async (tasks) => {
      const first = await tasks.claim("worker-2", { eligibility: (t) => t.status === "pending" });
      const second = await tasks.claim("worker-2", { eligibility: (t) => t.status === "pending" });
      return [first?.id, second?.id].sort();
    });
    expect(next.output).toEqual(["a", "b"]);

    // The abandoned worker's write finally arrives, and is refused — nothing
    // lands. Exercised on the real path rather than assumed, because a decline
    // that quietly stamped provenance would make history 2 read as history 1.
    const late = await run(stores, sessionId, "late-write", (tasks) =>
      tasks.fail("b", "worker died", {
        ifAllowed: true,
        claim: abandoned.output as never,
        write: minted.b,
      })
    );
    expect(late.output).toMatchObject({ outcome: "declined", reason: "lost-claim" });

    // --- the assertions, all against the persisted rows -------------------
    const a = await durableTask(stores, sessionId, "a");
    const b = await durableTask(stores, sessionId, "b");

    // FIRST: the ambiguity is real. Everything a post-hoc classifier reads off
    // task state agrees across the two histories. If this ever fails, the
    // separation below is being measured against a difference that was already
    // visible, and this scenario has stopped proving anything.
    expect({ status: a?.status, attempts: a?.attempts }).toEqual({
      status: b?.status,
      attempts: b?.attempts,
    });
    expect(a?.status).toBe("in_progress");
    expect(a?.attempts).toBe(2);

    // THEN: provenance separates them, off the durable row, from outside every
    // execution that participated. Both arms in one assertion block, so a stub
    // that always answers "landed" fails on "b" and a membership test that
    // treats absence as "did not land" fails on "a".
    expect(didWriteLand(a, minted.a)).toBe(true);
    expect(didWriteLand(b, minted.b)).toBe(false);
  });

  it("carries all four provenance fields through the store, not just in memory", async () => {
    // The strip guard, on the real persist path. `taskEnvelopeSchema` runs over
    // every durable write and Zod drops undeclared keys, so this is the
    // assertion that a field declared in the wrong place cannot pass.
    // `incarnationId` is exactly this bug's shape once already this same PR.
    const { stores, sessionId } = await seedBoard(["a"]);

    const seededIncarnation = (await durableTask(stores, sessionId, "a"))?.incarnationId;
    expect(seededIncarnation).toEqual(expect.any(String));

    const written = await run(stores, sessionId, "writer", async (tasks) => {
      const mine = await tasks.claim("worker-1");
      const write = beginTaskWrite(tasks.get("a"));
      await tasks.complete("a", { done: true }, {
        ifAllowed: true,
        claim: ticketForClaim(tasks.collectionId, mine!),
        write,
      });
      return write;
    });
    expect(written.error).toBeUndefined();
    const token = written.output as TaskWriteToken;

    const row = await durableTask(stores, sessionId, "a");
    expect(row?.status).toBe("completed");
    // addTask (1), claim (2), complete (3) — every committed write bumped it.
    expect(row?.revision).toBe(3);
    expect(row?.writeLog).toEqual([{ id: token.id, revision: 3 }]);
    expect(row?.writeLogTruncated).toBe(false);
    // Stamped once at creation and never touched by any later write.
    expect(row?.incarnationId).toBe(seededIncarnation);
  });

  it("answers cannot-tell for a durable task written before provenance existed", async () => {
    // A row already in the store with none of the four fields — the legacy
    // shape (BP-030). It must read as "cannot tell", never as "your write did
    // not land", which is the answer that would make a recorder swallow a real
    // post-commit failure.
    const { stores, sessionId } = await seedBoard(["a"]);
    const seeded = (await durableTask(stores, sessionId, "a"))!;

    const PROVENANCE = ["revision", "writeLog", "writeLogTruncated", "incarnationId"];
    const legacy = Object.fromEntries(
      Object.entries(seeded).filter(([key]) => !PROVENANCE.includes(key))
    ) as JsonObject;

    // `"any"` because this write is standing in for a row that was persisted
    // by an older build, not racing the board for it.
    const downgraded = await stores.resourceState.set(
      "session",
      sessionId,
      `${COLLECTION_ID}/a`,
      legacy,
      "any"
    );
    expect(downgraded.ok).toBe(true);

    const row = await durableTask(stores, sessionId, "a");
    expect(row?.revision).toBeUndefined();
    expect(didWriteLand(row, beginTaskWrite(row))).toBeUndefined();
  });
});
