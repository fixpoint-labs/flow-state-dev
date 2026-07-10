import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineExternalResourceCollection, defineFlow, handler } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import type { ExternalResourceCollectionRef, ExternalResourceContext } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "../src";

// An in-process "app store" standing in for a SQL table / API — the source of
// truth the external collection reads through to. Never copied into FSD storage.
const positionSchema = z.object({
  ticker: z.string().default(""),
  shares: z.number().default(0),
});

type Position = z.infer<typeof positionSchema>;

function makePositions(opts: {
  read: (args: { key: string; ctx: ExternalResourceContext }) => Promise<Position | null>;
  contentTemplate?: ReturnType<typeof parseResourceTemplate>;
  client?: Record<string, unknown>;
}) {
  return defineExternalResourceCollection({
    pattern: "positions/*",
    scope: "user",
    stateSchema: positionSchema,
    read: opts.read,
    search: async () => ({ hits: [] }),
    ...(opts.contentTemplate ? { contentTemplate: opts.contentTemplate } : {}),
    ...(opts.client ? { client: opts.client as never } : {}),
  });
}

async function createCtx(coll: ReturnType<typeof makePositions>) {
  const stores = createInMemoryStores();
  const block = handler({ name: "noop", resources: { portfolio: coll }, execute: () => "ok" });
  const flow = defineFlow({
    kind: "ext-test",
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
  return { ctx, stores };
}

function portfolio(ctx: any): ExternalResourceCollectionRef<Position> {
  return ctx.resources.portfolio as ExternalResourceCollectionRef<Position>;
}

describe("external resource collection — read redirect", () => {
  it("get(key) resolves through the read hook (not the store)", async () => {
    const read = vi.fn(async ({ key }: { key: string }) =>
      key === "AAPL" ? { ticker: "AAPL", shares: 10 } : null
    );
    const { ctx } = await createCtx(makePositions({ read }));

    const ref = await portfolio(ctx).get("AAPL");
    expect(ref.state).toEqual({ ticker: "AAPL", shares: 10 });
    // Canonical pattern-normalized path + uri.
    expect(ref.path).toBe("positions/AAPL");
    expect(ref.uri).toBe("user/positions/AAPL");
    expect(read).toHaveBeenCalledWith({ key: "AAPL", ctx: expect.any(Object) });
  });

  it("getOptional returns undefined when read returns null", async () => {
    const { ctx } = await createCtx(makePositions({ read: async () => null }));
    expect(await portfolio(ctx).getOptional("MSFT")).toBeUndefined();
  });

  it("get throws not-found when read returns null", async () => {
    const { ctx } = await createCtx(makePositions({ read: async () => null }));
    await expect(portfolio(ctx).get("MSFT")).rejects.toThrow(/not found/i);
  });

  it("throws when read returns a record failing stateSchema", async () => {
    const read = async () => ({ ticker: "AAPL", shares: "lots" } as unknown as Position);
    const { ctx } = await createCtx(makePositions({ read }));
    await expect(portfolio(ctx).get("AAPL")).rejects.toThrow(/stateSchema/i);
  });

  it("single-flights concurrent reads of the same key (one read call)", async () => {
    const read = vi.fn(async () => ({ ticker: "AAPL", shares: 1 }));
    const { ctx } = await createCtx(makePositions({ read }));

    const [a, b] = await Promise.all([
      portfolio(ctx).get("AAPL"),
      portfolio(ctx).get("AAPL"),
    ]);
    expect(a.state).toEqual(b.state);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("renders content from the template against hook state", async () => {
    const template = parseResourceTemplate(`<system>{{ state.ticker }}: {{ state.shares }} shares</system>`);
    const { ctx } = await createCtx(
      makePositions({ read: async () => ({ ticker: "AAPL", shares: 10 }), contentTemplate: template })
    );
    const ref = await portfolio(ctx).get("AAPL");
    expect(await ref.readContent()).toBe("AAPL: 10 shares");
  });

  it("hands read a trusted, server-derived context (userId/scope, never caller input)", async () => {
    let seen: ExternalResourceContext | undefined;
    const read = vi.fn(async ({ key, ctx }: { key: string; ctx: ExternalResourceContext }) => {
      seen = ctx;
      return key === "AAPL" ? { ticker: "AAPL", shares: 3 } : null;
    });
    const { ctx } = await createCtx(makePositions({ read }));
    await portfolio(ctx).get("AAPL");
    expect(seen?.userId).toBe("user_1");
    expect(seen?.scope).toBe("user");
    expect(seen?.scopeId).toBe("user_1");
    expect(seen?.flowKind).toBe("ext-test");
  });

  it("exposes no mutators on the ref (read-only at runtime)", async () => {
    const { ctx } = await createCtx(makePositions({ read: async () => ({ ticker: "AAPL", shares: 1 }) }));
    const ref = portfolio(ctx) as unknown as Record<string, unknown>;
    expect(ref.create).toBeUndefined();
    expect(ref.upsert).toBeUndefined();
    expect(ref.delete).toBeUndefined();
    expect(ref.external).toBe(true);
  });
});
