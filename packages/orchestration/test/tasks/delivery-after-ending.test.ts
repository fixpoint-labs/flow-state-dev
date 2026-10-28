/**
 * A settled task's delivery after its write: a failure there never fails the
 * write that committed, but it is said out loud, so an operator can tell a
 * notice left for the filer's next wake from one that went out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockContext } from "@flow-state-dev/core";
import { REQUEST_END_SEAM } from "@flow-state-dev/core/types";
import { createDelivery } from "../../src/tasks/notice/delivery";
import { NOTICE_DUE_MS } from "../../src/tasks/notice/task-notice";
import type { Task } from "../../src/tasks/schema/task";

afterEach(() => vi.restoreAllMocks());

describe("afterEnding", () => {
  it("warns, and still resolves, when delivery fails after the write", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hooks = createDelivery(
      {} as BlockContext,
      {
        legacyFiler: () => {
          throw new Error("filer lookup broke");
        }
      },
      { collectionId: "plans" }
    );
    const row = { id: "t1" } as Task;

    await expect(hooks.afterEnding(row, [row], async () => {})).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[orchestration]"),
      expect.objectContaining({ boardId: "plans", taskId: "t1", error: "filer lookup broke" })
    );
  });
});

describe("whenRequestEnds (FIX-2123)", () => {
  /** A request's context whose request-end seam keeps the hooks it is given, on a host that records what is running. */
  function requestContext() {
    const hooks: Array<(ending: { status: string }) => Promise<unknown> | unknown> = [];
    const owe = vi.fn(async (_spec: { entry: string; dueAt: number; sessionId?: string }) => true);
    const ctx = {
      [REQUEST_END_SEAM]: { add: (hook: (ending: { status: string }) => unknown) => hooks.push(hook) },
      requestHost: { waits: { running: async () => ({}) }, wakes: { owe } }
    } as unknown as BlockContext;
    return { ctx, hooks, owe };
  }

  it("at a park owes the filer's pass one wake and reads no row, since a hook there holds back the request's park record; sends once the request ends", async () => {
    // The pass the wake runs sends what the parked request held (FIX-2149):
    // the person it parked on may take hours.
    const { ctx, hooks, owe } = requestContext();
    const send = vi.fn(async () => {});
    createDelivery(ctx, { passEntry: "runBoard" }, { collectionId: "desk" }).whenRequestEnds!(send);
    expect(hooks).toHaveLength(1);

    const parkedAt = Date.now();
    await hooks[0]!({ status: "suspended" });
    expect(send).not.toHaveBeenCalled();
    expect(owe).toHaveBeenCalledTimes(1);
    const [wake] = owe.mock.calls[0]!;
    // In the request's own session: the filing request's session is its filer's.
    expect(wake).toEqual({ entry: "runBoard", dueAt: expect.any(Number) });
    expect(wake.dueAt - parkedAt).toBeGreaterThanOrEqual(NOTICE_DUE_MS);
    expect(wake.dueAt - parkedAt).toBeLessThan(NOTICE_DUE_MS + 1_000);

    await hooks[0]!({ status: "completed" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(owe).toHaveBeenCalledTimes(1);
  });

  it("owes no wake at a park on a ledger that owes no notices", async () => {
    const { ctx, hooks, owe } = requestContext();
    createDelivery(ctx, { notices: false }, { collectionId: "plans" }).whenRequestEnds!(async () => {});
    await hooks[0]!({ status: "suspended" });
    expect(owe).not.toHaveBeenCalled();
  });

  it("warns, and still lets the park go on, when the park's wake can't be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, hooks, owe } = requestContext();
    owe.mockRejectedValueOnce(new Error("store unavailable"));
    createDelivery(ctx, {}, { collectionId: "desk" }).whenRequestEnds!(async () => {});
    await expect(hooks[0]!({ status: "suspended" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[orchestration]"), expect.objectContaining({ boardId: "desk", error: "store unavailable" }));
  });

  it("registers once per request and board, however often the board is resolved", () => {
    const { ctx, hooks } = requestContext();
    createDelivery(ctx, {}, { collectionId: "desk" }).whenRequestEnds!(async () => {});
    createDelivery(ctx, {}, { collectionId: "desk" }).whenRequestEnds!(async () => {});
    createDelivery(ctx, {}, { collectionId: "other" }).whenRequestEnds!(async () => {});
    expect(hooks).toHaveLength(2);
  });

  it("registers nothing on a host that doesn't record which requests are running", () => {
    const { ctx, hooks } = requestContext();
    (ctx as unknown as { requestHost: unknown }).requestHost = {};
    createDelivery(ctx, {}, { collectionId: "desk" }).whenRequestEnds!(async () => {});
    expect(hooks).toHaveLength(0);
  });
});
