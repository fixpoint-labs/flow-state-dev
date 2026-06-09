/**
 * Tests for the server-side reactive-block dispatch seam (FIX-751 PR2).
 *
 * These exercise `createScopeResourceRegistry`'s `onResourceChanged` firing
 * through the per-scope reactive dispatcher built in `createExecutionContext`:
 * a `reactTo` binding on a resource/collection runs its block in-session when
 * the bound mutation fires, with the {@link ResourceChange} payload.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler,
  resourceChangeSchema,
} from "@flow-state-dev/core";
import type { ResourceChange } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createExecutionContext, createInMemoryStores } from "../../src";
import { createInternalResponseEmitter } from "../../src/streaming/response-emitter";

const fileSchema = z.object({
  language: z.string(),
  status: z.string().default("draft"),
});

/**
 * Build an execution context whose resources are the given configs, wired to a
 * real response emitter so reactive blocks emit into a capturable stream.
 */
async function createCtx(
  resources: Record<string, ReturnType<typeof defineResource> | ReturnType<typeof defineResourceCollection>>
) {
  const stores = createInMemoryStores();
  const items: OutputItem[] = [];
  const response = createInternalResponseEmitter({ requestId: "req_1", internalSeams: undefined });
  response.subscribeToItems((item) => items.push(item));

  const block = handler({
    name: "noop",
    resources,
    execute: () => "ok",
  });
  const flow = defineFlow({
    kind: "reactive-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();

  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores,
    response,
  });
  return { ctx, items };
}

describe("reactive dispatch: created", () => {
  it("runs the bound block on instance create and emits its item into the stream", async () => {
    const seen: ResourceChange[] = [];
    const onCreate = handler({
      name: "on-create",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange, ctx) => {
        seen.push(change);
        ctx.emit.message([{ type: "output_text", text: `created ${change.key}` }]);
        return "done";
      },
    });

    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { created: onCreate },
    });

    const { ctx, items } = await createCtx({ files });
    await (ctx.resources.files as any).create("readme.md", { language: "markdown" });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("created");
    expect(seen[0]!.key).toBe("readme.md");
    expect(seen[0]!.ref).toBe("files/readme.md");
    expect(seen[0]!.state).toMatchObject({ language: "markdown" });
    expect(seen[0]!.prevState).toBeNull();

    const messages = items.filter((i) => i.type === "message");
    expect(messages.some((m) => JSON.stringify(m).includes("created readme.md"))).toBe(true);
  });
});

describe("reactive dispatch: updated/deleted payloads", () => {
  it("updated carries state and prevState", async () => {
    const seen: ResourceChange[] = [];
    const onUpdate = handler({
      name: "on-update",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { updated: onUpdate },
    });

    const { ctx } = await createCtx({ files });
    const ns = ctx.resources.files as any;
    await ns.create("a.ts", { language: "typescript", status: "draft" });
    await (await ns.get("a.ts")).patchState({ status: "published" });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("updated");
    expect(seen[0]!.state).toMatchObject({ status: "published" });
    expect(seen[0]!.prevState).toMatchObject({ status: "draft" });
    expect(seen[0]!.evicted).toBe(false);
  });

  it("explicit delete carries null state, prevState, evicted false", async () => {
    const seen: ResourceChange[] = [];
    const onDelete = handler({
      name: "on-delete",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { deleted: onDelete },
    });

    const { ctx } = await createCtx({ files });
    const ns = ctx.resources.files as any;
    await ns.create("a.ts", { language: "typescript" });
    await ns.delete("a.ts");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("deleted");
    expect(seen[0]!.state).toBeNull();
    expect(seen[0]!.prevState).toMatchObject({ language: "typescript" });
    expect(seen[0]!.evicted).toBe(false);
  });
});

describe("reactive dispatch: single (non-live) resource", () => {
  it("fires reactTo.updated on patchState of a non-live single", async () => {
    const seen: ResourceChange[] = [];
    const onUpdate = handler({
      name: "on-single-update",
      inputSchema: resourceChangeSchema(z.object({ count: z.number().default(0) })),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const counter = defineResource({
      scope: "session",
      stateSchema: z.object({ count: z.number().default(0) }),
      reactTo: { updated: onUpdate },
    });

    const { ctx } = await createCtx({ counter });
    await (ctx.resources.counter as any).patchState({ count: 5 });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("updated");
    expect(seen[0]!.key).toBe("counter");
    expect(seen[0]!.ref).toBe("counter");
    expect(seen[0]!.state).toMatchObject({ count: 5 });
    expect(seen[0]!.prevState).toMatchObject({ count: 0 });
  });
});

describe("reactive dispatch: eviction", () => {
  it("fires reactTo.deleted with evicted true on capacity eviction", async () => {
    const seen: ResourceChange[] = [];
    const onDelete = handler({
      name: "on-evict",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      maxInstances: 1,
      eviction: "oldest",
      reactTo: { deleted: onDelete },
    });

    const { ctx } = await createCtx({ files });
    const ns = ctx.resources.files as any;
    await ns.create("a.ts", { language: "typescript" });
    await ns.create("b.ts", { language: "javascript" }); // evicts a.ts

    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("deleted");
    expect(seen[0]!.key).toBe("a.ts");
    expect(seen[0]!.evicted).toBe(true);
    expect(seen[0]!.prevState).toMatchObject({ language: "typescript" });
  });

  it("a when:(c)=>!c.evicted binding skips eviction but runs explicit delete", async () => {
    const seen: ResourceChange[] = [];
    const onDelete = handler({
      name: "on-explicit-delete",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      maxInstances: 1,
      eviction: "oldest",
      reactTo: { deleted: { block: onDelete, when: (c) => !c.evicted } },
    });

    const { ctx } = await createCtx({ files });
    const ns = ctx.resources.files as any;
    await ns.create("a.ts", { language: "typescript" });
    await ns.create("b.ts", { language: "javascript" }); // evicts a.ts — skipped
    expect(seen).toHaveLength(0);

    await ns.delete("b.ts"); // explicit — runs
    expect(seen).toHaveLength(1);
    expect(seen[0]!.evicted).toBe(false);
    expect(seen[0]!.key).toBe("b.ts");
  });
});

describe("reactive dispatch: when gate on state", () => {
  it("runs only when the predicate passes", async () => {
    const seen: ResourceChange[] = [];
    const onUpdate = handler({
      name: "on-publish",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { updated: { block: onUpdate, when: (c) => c.state?.status === "published" } },
    });

    const { ctx } = await createCtx({ files });
    const ns = ctx.resources.files as any;
    await ns.create("a.ts", { language: "typescript", status: "draft" });
    const ref = await ns.get("a.ts");
    await ref.patchState({ status: "review" }); // skipped
    expect(seen).toHaveLength(0);
    await ref.patchState({ status: "published" }); // runs
    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toMatchObject({ status: "published" });
  });
});

describe("reactive dispatch: failure propagation", () => {
  it("a throwing reactive block rejects the mutating call", async () => {
    const boom = handler({
      name: "boom",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: () => {
        throw new Error("reactive boom");
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { created: boom },
    });

    const { ctx } = await createCtx({ files });
    await expect((ctx.resources.files as any).create("a.ts", { language: "ts" })).rejects.toThrow(
      "reactive boom"
    );
  });
});

describe("reactive dispatch: reactive-only (no emitter)", () => {
  it("dispatches even with no response emitter present", async () => {
    const seen: ResourceChange[] = [];
    const onCreate = handler({
      name: "on-create-no-emitter",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { created: onCreate },
    });

    // No `response` → no FIX-739 emitter; only reactive dispatch should wire.
    const stores = createInMemoryStores();
    const block = handler({ name: "noop", resources: { files }, execute: () => "ok" });
    const flow = defineFlow({
      kind: "reactive-only",
      actions: { run: { inputSchema: z.string(), block } },
    })();
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_1",
      userId: "user_1",
      stores,
    });

    await (ctx.resources.files as any).create("a.ts", { language: "ts" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe("a.ts");
  });
});

describe("reactive dispatch: input validation", () => {
  it("emits a diagnostic and skips the block when the payload is malformed", async () => {
    let ran = false;
    // The block's inputSchema demands a numeric `count`, but the resource's
    // state schema is a string-shaped file — the payload won't satisfy it.
    const strict = handler({
      name: "strict-reactor",
      inputSchema: resourceChangeSchema(z.object({ count: z.number() })),
      execute: () => {
        ran = true;
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { created: strict },
    });

    const { ctx, items } = await createCtx({ files });
    await (ctx.resources.files as any).create("a.ts", { language: "ts" });

    expect(ran).toBe(false);
    const diagnostics = items.filter(
      (i) => i.type === "error" && (i as any).code === "reactive_input_invalid"
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe("reactive dispatch: non-live single streaming + updateState aliasing", () => {
  const docSchema = z.object({ status: z.string().default("draft") });

  it("a non-live single with reactTo runs the block but emits no resource_change", async () => {
    let ran = false;
    const onUpdate = handler({
      name: "on-single-update",
      execute: () => {
        ran = true;
        return "done";
      },
    });
    // No `client` config → non-live. Before the fix this leaked a resource_change.
    const doc = defineResource({
      scope: "session",
      stateSchema: docSchema,
      reactTo: { updated: onUpdate },
    });

    const { ctx, items } = await createCtx({ doc });
    await (ctx.resources.doc as any).patchState({ status: "published" });

    expect(ran).toBe(true);
    expect(items.some((i) => i.type === "resource_change")).toBe(false);
  });

  it("updateState gives the updater a fresh clone so prevState is not aliased", async () => {
    const seen: ResourceChange[] = [];
    const onUpdate = handler({
      name: "on-single-update2",
      inputSchema: resourceChangeSchema(docSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const doc = defineResource({
      scope: "session",
      stateSchema: docSchema,
      reactTo: { updated: onUpdate },
    });

    const { ctx } = await createCtx({ doc });
    // In-place-mutating updater: mutate the argument and return it. The payload's
    // prevState must still reflect the pre-mutation state, not alias the result.
    await (ctx.resources.doc as any).updateState((s: any) => {
      s.status = "published";
      return s;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toMatchObject({ status: "published" });
    expect(seen[0]!.prevState).toMatchObject({ status: "draft" });
  });
});

describe("reactive dispatch: content-only writes", () => {
  it("does not run an updated binding for a collection instance content write", async () => {
    const seen: ResourceChange[] = [];
    const onUpdate = handler({
      name: "on-update-content",
      inputSchema: resourceChangeSchema(fileSchema),
      execute: (change: ResourceChange) => {
        seen.push(change);
        return "done";
      },
    });
    const files = defineResourceCollection({
      scope: "session",
      pattern: "files/**",
      stateSchema: fileSchema,
      reactTo: { updated: onUpdate },
    });

    const { ctx } = await createCtx({ files });
    const ns = ctx.resources.files as any;
    await ns.create("a.ts", { language: "typescript", status: "draft" });

    // Content-only write carries no state delta — must NOT dispatch the updated
    // reactive block (it would otherwise run with null state/prevState).
    await (await ns.get("a.ts")).writeContent("const x = 1;");
    expect(seen).toHaveLength(0);

    // A real state update still dispatches it (regression guard).
    await (await ns.get("a.ts")).patchState({ status: "published" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toMatchObject({ status: "published" });
  });
});
