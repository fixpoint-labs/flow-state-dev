/**
 * FIX-751 — reactive blocks on resource/collection mutation.
 *
 * End-to-end coverage of the server dispatch seam through `testFlow`:
 * - a reactive block runs in-session when its bound mutation fires, and its
 *   emitted item lands in the same stream, ordered after the mutating block;
 * - a reactive block wrapped in `.work()` inside a sequencer is isolated, so a
 *   failure inside the worker doesn't fail the mutating turn;
 * - a self-mutating reactive block converges under the cascade depth cap, and a
 *   runaway one terminates with a `reactive_cascade_exceeded` diagnostic rather
 *   than hanging or overflowing the stack.
 */
import { describe, expect, it } from "vitest";
import {
  defineFlow,
  defineResourceCollection,
  handler,
  sequencer,
  resourceChangeSchema,
} from "@flow-state-dev/core";
import type { ResourceChange } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const noteSchema = z.object({ text: z.string(), tag: z.string().default("") });

function messageItems(items: { type: string }[]): any[] {
  return items.filter((i) => i.type === "message");
}

describe("FIX-751: reactive blocks", () => {
  it("runs a reactive block in-session and orders its item after the mutating block", async () => {
    const onCreate = handler({
      name: "reactive-note-created",
      inputSchema: resourceChangeSchema(noteSchema),
      execute: (change: ResourceChange, ctx) => {
        ctx.emit.message([{ type: "output_text", text: `reacted:${change.key}` }]);
        return "done";
      },
    });

    const notes = defineResourceCollection({
      scope: "session",
      pattern: "notes/**",
      stateSchema: noteSchema,
      reactTo: { created: onCreate },
    });

    const create = handler({
      name: "create-note",
      inputSchema: z.object({ key: z.string() }),
      resources: { notes },
      execute: async (input: { key: string }, ctx) => {
        ctx.emit.message([{ type: "output_text", text: "mutating" }]);
        await (ctx.resources.notes as any).create(input.key, { text: "hi" });
        return "ok";
      },
    });

    const flow = defineFlow({
      kind: "fix751-inflow",
      actions: { run: { inputSchema: z.object({ key: z.string() }), block: create } },
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: { key: "a" },
      unmockedGeneratorPolicy: "allow",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const texts = messageItems(result.items).map((m) => JSON.stringify(m));
    const mutateIdx = texts.findIndex((t) => t.includes("mutating"));
    const reactIdx = texts.findIndex((t) => t.includes("reacted:a"));
    expect(mutateIdx).toBeGreaterThanOrEqual(0);
    expect(reactIdx).toBeGreaterThan(mutateIdx);
  });

  it("nests the reactive block under the block that triggered the mutation", async () => {
    const onCreate = handler({
      name: "reactive-nested",
      inputSchema: resourceChangeSchema(noteSchema),
      execute: (change: ResourceChange, ctx) => {
        ctx.emit.message([{ type: "output_text", text: `reacted:${change.key}` }]);
        return "done";
      },
    });
    const notes = defineResourceCollection({
      scope: "session",
      pattern: "notes/**",
      stateSchema: noteSchema,
      reactTo: { created: onCreate },
    });

    // The mutation happens inside a sequencer STEP (a nested scope), not the root
    // action block — so the runtime's attribution frame names the step as the
    // trigger and the reactive block parents under it.
    const mutatingStep = handler({
      name: "mutating-step",
      resources: { notes },
      execute: async (_input, ctx) => {
        ctx.emit.message([{ type: "output_text", text: "mutating" }]);
        await (ctx.resources.notes as any).create("a", { text: "hi" });
        return "ok";
      },
    });
    const root = sequencer({ name: "root-seq" }).step(mutatingStep);

    const flow = defineFlow({
      kind: "fix751-nesting",
      actions: { run: { inputSchema: z.string(), block: root } },
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: "go",
      unmockedGeneratorPolicy: "allow",
    });
    expect(result.status).toBe("completed");

    const mutating = result.items.find(
      (i) => i.type === "message" && JSON.stringify(i).includes("mutating")
    ) as any;
    const reacted = result.items.find(
      (i) => i.type === "message" && JSON.stringify(i).includes("reacted:a")
    ) as any;
    expect(mutating?.provenance?.blockInstanceId).toBeTruthy();
    // The reactive block's parent is the step that performed the mutation, not
    // the request root — so DevTool renders it nested under the trigger.
    expect(reacted?.provenance?.parentBlockInstanceId).toBe(
      mutating.provenance.blockInstanceId
    );
  });

  it("isolates a .work()-wrapped reactive failure — the turn still completes", async () => {
    let workerRan = false;
    const failingWorker = handler({
      name: "reactive-worker-boom",
      inputSchema: resourceChangeSchema(noteSchema),
      execute: () => {
        workerRan = true;
        throw new Error("worker boom");
      },
    });
    // The reactive block is a sequencer that dispatches the failing handler as
    // background work. `.work()` isolation means the worker's throw settles in
    // the pool, not on the mutating turn.
    const reactiveSeq = sequencer({
      name: "reactive-seq",
      inputSchema: resourceChangeSchema(noteSchema),
    }).work(failingWorker);

    const notes = defineResourceCollection({
      scope: "session",
      pattern: "notes/**",
      stateSchema: noteSchema,
      reactTo: { created: reactiveSeq },
    });

    const create = handler({
      name: "create-note-work",
      inputSchema: z.object({ key: z.string() }),
      resources: { notes },
      execute: async (input: { key: string }, ctx) => {
        await (ctx.resources.notes as any).create(input.key, { text: "hi" });
        return "ok";
      },
    });

    const flow = defineFlow({
      kind: "fix751-work-isolation",
      actions: { run: { inputSchema: z.object({ key: z.string() }), block: create } },
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: { key: "a" },
      unmockedGeneratorPolicy: "allow",
    });

    // The turn completes despite the worker failing — `.work()` isolation.
    expect(result.status).toBe("completed");
    expect(workerRan).toBe(true);
  });

  it("a self-mutating reactive block converges under the depth cap", async () => {
    let runs = 0;
    // Each update bumps `n` until it reaches 3, then stops mutating. Depth stays
    // well under the cap (8); the cascade terminates by author logic.
    const bumper = handler({
      name: "reactive-bumper",
      inputSchema: resourceChangeSchema(z.object({ n: z.number().default(0) })),
      resources: {
        counters: defineResourceCollection({
          scope: "session",
          pattern: "counters/**",
          stateSchema: z.object({ n: z.number().default(0) }),
        }),
      },
      execute: async (change: ResourceChange, ctx) => {
        runs += 1;
        const n = (change.state?.n as number | undefined) ?? 0;
        if (n < 3) {
          await (ctx.resources.counters as any).upsert(change.key, { n: n + 1 });
        }
        return "ok";
      },
    });

    const counters = defineResourceCollection({
      scope: "session",
      pattern: "counters/**",
      stateSchema: z.object({ n: z.number().default(0) }),
      reactTo: { updated: bumper },
    });

    const kick = handler({
      name: "kick-counter",
      inputSchema: z.unknown(),
      resources: { counters },
      execute: async (_input: unknown, ctx) => {
        await (ctx.resources.counters as any).create("c", { n: 0 });
        await (await (ctx.resources.counters as any).get("c")).patchState({ n: 1 });
        return "ok";
      },
    });

    const flow = defineFlow({
      kind: "fix751-converge",
      actions: { run: { block: kick } },
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "allow",
    });

    expect(result.status).toBe("completed");
    // 1 (n=1) -> 2 (n=2) -> 3 (n=3) then stops. Exactly 3 reactive runs.
    expect(runs).toBe(3);
  });

  it("a runaway self-mutating reactive cascade terminates with a diagnostic", async () => {
    const runaway = handler({
      name: "reactive-runaway",
      inputSchema: resourceChangeSchema(z.object({ n: z.number().default(0) })),
      resources: {
        loops: defineResourceCollection({
          scope: "session",
          pattern: "loops/**",
          stateSchema: z.object({ n: z.number().default(0) }),
        }),
      },
      execute: async (change: ResourceChange, ctx) => {
        const n = (change.state?.n as number | undefined) ?? 0;
        // Never stops mutating — the cascade depth cap must break it.
        await (ctx.resources.loops as any).upsert(change.key, { n: n + 1 });
        return "ok";
      },
    });

    const loops = defineResourceCollection({
      scope: "session",
      pattern: "loops/**",
      stateSchema: z.object({ n: z.number().default(0) }),
      reactTo: { updated: runaway },
    });

    const kick = handler({
      name: "kick-loop",
      inputSchema: z.unknown(),
      resources: { loops },
      execute: async (_input: unknown, ctx) => {
        await (ctx.resources.loops as any).create("l", { n: 0 });
        await (await (ctx.resources.loops as any).get("l")).patchState({ n: 1 });
        return "ok";
      },
    });

    const flow = defineFlow({
      kind: "fix751-runaway",
      actions: { run: { block: kick } },
    })({ id: "test" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "allow",
    });

    // No hang, no stack overflow: the run terminates. A cascade diagnostic
    // surfaces in the stream.
    const diagnostics = result.items.filter(
      (i: any) => i.type === "error" && i.code === "reactive_cascade_exceeded"
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
