/**
 * A settled task's delivery after its write: a failure there never fails the
 * write that committed, but it is said out loud, so an operator can tell a
 * notice left for the filer's next wake from one that went out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockContext } from "@flow-state-dev/core";
import { REQUEST_END_SEAM } from "@flow-state-dev/core/types";
import { createDelivery } from "../../src/tasks/notice/delivery";
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
    const ctx = {
      [REQUEST_END_SEAM]: { add: (hook: (ending: { status: string }) => unknown) => hooks.push(hook) },
      requestHost: { waits: { running: async () => ({}) } }
    } as unknown as BlockContext;
    return { ctx, hooks };
  }

  it("runs nothing at a park, where a hook would hold back the request's park record, and sends once the request ends", async () => {
    const { ctx, hooks } = requestContext();
    const send = vi.fn(async () => {});
    createDelivery(ctx, {}, { collectionId: "desk" }).whenRequestEnds!(send);
    expect(hooks).toHaveLength(1);

    await hooks[0]!({ status: "suspended" });
    expect(send).not.toHaveBeenCalled();
    await hooks[0]!({ status: "completed" });
    expect(send).toHaveBeenCalledTimes(1);
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
