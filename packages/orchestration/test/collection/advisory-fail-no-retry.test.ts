/**
 * `advisoryFail` judges a throw against where the write was headed. A
 * `noRetry` fail is headed for `errored` whatever attempts are left, so a
 * store that commits it and then throws has failed after the commit: that is
 * reported to the caller, never contained as somebody else's settlement.
 *
 * Predicting the retry route instead (`pending`) would read the committed
 * `errored` row as a row someone else ended, and swallow the failure.
 */
import { expect, it } from "vitest";
import { createStateBackedTaskCollection, ticketForClaim, type TaskCollectionRef } from "../../src/tasks";
import { advisoryFail } from "../../src/tasks/collection/advisory-write-back";
import { createFakeSequencerState } from "../helpers";

it("a noRetry fail that commits and then throws reaches the caller", async () => {
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const inner = createStateBackedTaskCollection({ collectionId: "tasks", state });
  await inner.addTask({ id: "t", goal: "work", maxAttempts: 3 });
  const claim = ticketForClaim("tasks", (await inner.claim("w"))!);
  const commitsThenThrows = {
    ...inner,
    fail: async (...args: Parameters<TaskCollectionRef["fail"]>) => {
      await inner.fail(...args);
      throw new Error("onChange rejected after the commit");
    },
  } as TaskCollectionRef;

  await expect(
    advisoryFail(commitsThenThrows, "t", "refused", { ifAllowed: true, claim, noRetry: true }),
  ).rejects.toThrow("onChange rejected after the commit");
  expect(inner.get("t")?.status).toBe("errored");
});
