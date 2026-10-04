/**
 * `getOrCreateTaskCollection({ backing: "state" })` — where tasks are stored,
 * and what an untyped caller sending a removed backing gets.
 *
 * The default slots are the part that must not move: stored tasks already live
 * there. A passed ref keeps them at `tasks`; the request keeps each board at its
 * own `collectionId`, so two boards in one request never see each other. If
 * either default changed, a running app would read an empty board over tasks it
 * had already written.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { getOrCreateTaskCollection } from "../../src/tasks";
import { createFakeSequencerState } from "../helpers";

describe("getOrCreateTaskCollection — backing: \"state\" default slots", () => {
  it("keeps tasks at `tasks` on a passed ref, and at each collectionId on the request", async () => {
    const passed = createFakeSequencerState<Record<string, unknown>>({ tasks: {} });

    const block = handler({
      name: "default-slots",
      inputSchema: z.unknown(),
      outputSchema: z.record(z.string(), z.unknown()),
      execute: async (_input, ctx) => {
        const onRef = await getOrCreateTaskCollection({
          ctx,
          backing: "state",
          state: passed,
          collectionId: "on-ref",
        });
        const alpha = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: "alpha" });
        const beta = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: "beta" });

        await onRef.addTask({ goal: "ref task" });
        await alpha.addTask({ goal: "alpha task" });
        await beta.addTask({ goal: "beta task" });

        return {
          alphaSees: alpha.list().map((t) => t.goal),
          betaSees: beta.list().map((t) => t.goal),
          requestState: ctx.request.state as Record<string, unknown>,
        };
      },
    });

    const result = await testBlock(block, { input: undefined });
    expect(result.error).toBeNull();
    const out = result.output as {
      alphaSees: string[];
      betaSees: string[];
      requestState: Record<string, Record<string, { goal: string }>>;
    };

    // Passed ref → `tasks` on that ref, and nothing of it on the request.
    const refTasks = Object.values(passed.state.tasks as Record<string, { goal: string }>);
    expect(refTasks.map((t) => t.goal)).toEqual(["ref task"]);
    expect(out.requestState).not.toHaveProperty("tasks");
    expect(out.requestState).not.toHaveProperty("on-ref");

    // No ref → the request, one slot per collectionId.
    expect(Object.values(out.requestState.alpha).map((t) => t.goal)).toEqual(["alpha task"]);
    expect(Object.values(out.requestState.beta).map((t) => t.goal)).toEqual(["beta task"]);
    expect(out.alphaSees).toEqual(["alpha task"]);
    expect(out.betaSees).toEqual(["beta task"]);
  });

  it("honours an explicit stateKey with or without a ref", async () => {
    const passed = createFakeSequencerState<Record<string, unknown>>({ custom: {} });

    const block = handler({
      name: "explicit-key",
      inputSchema: z.unknown(),
      outputSchema: z.record(z.string(), z.unknown()),
      execute: async (_input, ctx) => {
        const onRef = await getOrCreateTaskCollection({
          ctx,
          backing: "state",
          state: passed,
          stateKey: "custom",
          collectionId: "ignored-for-slot",
        });
        const onRequest = await getOrCreateTaskCollection({
          ctx,
          backing: "state",
          stateKey: "shared-slot",
          collectionId: "also-ignored",
        });
        await onRef.addTask({ goal: "ref" });
        await onRequest.addTask({ goal: "request" });
        return { requestState: ctx.request.state as Record<string, unknown> };
      },
    });

    const result = await testBlock(block, { input: undefined });
    expect(result.error).toBeNull();
    const { requestState } = result.output as { requestState: Record<string, unknown> };
    expect(Object.keys(passed.state.custom as object)).toHaveLength(1);
    expect(Object.keys(requestState["shared-slot"] as object)).toHaveLength(1);
    expect(requestState).not.toHaveProperty("also-ignored");
  });
});

describe("getOrCreateTaskCollection — removed backings (untyped callers)", () => {
  // A ctx whose storage handles throw on any touch: the rejection must come
  // first, before `ctx.request`, `ctx.session` or a state ref is read.
  const untouchable = new Proxy(
    {},
    {
      get() {
        throw new Error("storage touched before the backing was validated");
      },
    },
  );

  it("names backing: \"state\" and the `state` field for a sequencer caller", async () => {
    await expect(
      getOrCreateTaskCollection({
        ctx: untouchable,
        backing: "sequencer",
        sequencer: untouchable,
        collectionId: "old",
      } as never),
    ).rejects.toThrow(
      'backing "sequencer" was removed. Write backing: "state" and pass the ref as `state` (was `sequencer`). Valid backings: "state", "resource".',
    );
  });

  it("names backing: \"state\" with no `state` for a request caller", async () => {
    await expect(
      getOrCreateTaskCollection({
        ctx: untouchable,
        backing: "request",
        collectionId: "old",
      } as never),
    ).rejects.toThrow(
      'backing "request" was removed. Write backing: "state" with no `state` field to keep tasks on the request. Valid backings: "state", "resource".',
    );
  });

  it("refuses an explicit empty `state` rather than moving the board onto the request", async () => {
    await expect(
      getOrCreateTaskCollection({
        ctx: untouchable,
        backing: "state",
        state: undefined,
        collectionId: "empty-ref",
      } as never),
    ).rejects.toThrow("`state` was passed but is undefined");
  });
});
