/**
 * A settled task's delivery after its write: a failure there never fails the
 * write that committed, but it is said out loud, so an operator can tell a
 * notice left for the filer's next wake from one that went out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockContext } from "@flow-state-dev/core";
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
