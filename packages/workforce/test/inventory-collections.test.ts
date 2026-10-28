/**
 * The worker inventory collection — what it promises a reader that is not the
 * writer, and where the boundary around it actually falls.
 *
 * The collection is the floor the live inventory is written onto. Nothing
 * here writes a real row from a real roster; that is the binder's job, and
 * its own checks cover it. What has
 * to be true first is that a row written by one flow is readable by another in
 * the same org, is not readable from a different org, and does not quietly stop
 * being shared when an app flips an unrelated flag.
 *
 * That last one is why every case here uses TWO flows. A collection read back
 * by the flow that wrote it proves nothing about sharing — it is green whether
 * the rows are shared or private, which is the exact shape of a check that
 * cannot fail. The reader flow is a different flow kind throughout.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { z } from "zod";
import { defineWorkerInventoryCollection, workerInventoryRowSchema } from "../src/index";

const ORG = "org_acme";
const OTHER_ORG = "org_other";
const USER = "u_boot";

/**
 * A collection declared exactly as the one under test is, except that it
 * leaves `flowIsolation` unset. It is the live red state for BR-24: under
 * `isolateOrgState: true` its rows go private per flow while the real ones stay
 * shared, in the same process, on the same request.
 */
const inheritsIsolation = defineResourceCollection({
  pattern: "control/inherits/*",
  scope: "org",
  stateSchema: z.object({ id: z.string() })
});

const workers = defineWorkerInventoryCollection();

type Rows = {
  workers: unknown[];
  control: unknown[];
};

const writeBlock = handler({
  name: "inventory-write",
  inputSchema: z.object({ workers: z.array(workerInventoryRowSchema) }),
  outputSchema: z.object({ written: z.number() }),
  resources: { workers, control: inheritsIsolation },
  execute: async (input: any, ctx: any) => {
    for (const row of input.workers) {
      await ctx.resources.workers.upsert(row.id, row);
    }
    await ctx.resources.control.upsert("probe", { id: "probe" });
    return { written: input.workers.length };
  }
});

const readBlock = handler({
  name: "inventory-read",
  inputSchema: z.object({}),
  outputSchema: z.object({
    workers: z.array(z.unknown()),
    control: z.array(z.unknown())
  }),
  resources: { workers, control: inheritsIsolation },
  execute: async (_input: any, ctx: any) => {
    const state = (ref: any): unknown => ref.state;
    return {
      workers: (await ctx.resources.workers.list()).map(state),
      control: (await ctx.resources.control.list()).map(state)
    };
  }
});

/**
 * Rows keyed by their own id, for comparison.
 *
 * `list()` declares no order — it returns the loaded set in insertion order —
 * so comparing positionally would assert something the collection does not
 * promise. Keying by `id` compares identity and every field on the row, and the
 * callers pair it with a length assertion so a duplicated row cannot collapse
 * into a matching map.
 */
function byId(rows: unknown[]): Record<string, unknown> {
  return Object.fromEntries(rows.map((row: any) => [row.id, row]));
}

/** Two flows over one store: only one of them ever writes. */
function twoFlows(options: { isolateOrgState?: boolean } = {}) {
  const writer = defineFlow({
    kind: "inventory-writer",
    ...options,
    actions: { write: { block: writeBlock } }
  })();
  const reader = defineFlow({
    kind: "inventory-reader",
    ...options,
    actions: { read: { block: readBlock } }
  })();
  return { writer, reader, stores: createInMemoryStores() as StoreRegistry };
}

const SEED = {
  workers: [
    { id: "eng.lead", kind: "agent" },
    { id: "eng.analyst", kind: "agent" }
  ]
};

async function write(
  ctx: ReturnType<typeof twoFlows>,
  opts: { orgId?: string; tenantId?: string } = {}
): Promise<void> {
  await runAction({
    flow: ctx.writer,
    actionName: "write",
    input: SEED,
    userId: USER,
    stores: ctx.stores,
    runtimeConfig: {} as never,
    ...opts
  });
}

async function read(
  ctx: ReturnType<typeof twoFlows>,
  opts: { orgId?: string; tenantId?: string } = {}
): Promise<Rows> {
  const result: any = await runAction({
    flow: ctx.reader,
    actionName: "read",
    input: {},
    userId: USER,
    stores: ctx.stores,
    runtimeConfig: {} as never,
    ...opts
  });
  return (result.output ?? result) as Rows;
}

describe("what the collections declare", () => {
  it("pins the storage pattern — a public key, breaking to move", () => {
    expect(workers.pattern).toBe("inventory/workers/*");
  });

  it("declares flowIsolation as an explicit false, not an omission (BR-24)", () => {
    // The distinction this asserts is `false` vs `undefined`, and it is the
    // whole mechanism: `effectiveStorageTuple` only consults the flow's
    // `isolateOrgState` when the entry left `flowIsolation` unset. A check
    // written as `toBeFalsy()` would pass on the omission and prove nothing.
    expect(workers.scope).toBe("org");
    expect(workers.flowIsolation).toBe(false);
    // The control collection is the omission, so the assertion above is known
    // to discriminate rather than merely to hold.
    expect(inheritsIsolation.flowIsolation).toBeUndefined();
  });
});

describe("a flow that did not write the rows", () => {
  it("reads every row back, with the record's own id on it (BR-14, BR-16, BR-21)", async () => {
    const ctx = twoFlows();
    await write(ctx, { orgId: ORG });

    const rows = await read(ctx, { orgId: ORG });

    expect(rows.workers).toHaveLength(2);
    expect(byId(rows.workers)).toEqual({
      "eng.lead": { id: "eng.lead", kind: "agent", door: null, rules: false, hired: null, incarnation: null, name: null, teamName: null },
      "eng.analyst": { id: "eng.analyst", kind: "agent", door: null, rules: false, hired: null, incarnation: null, name: null, teamName: null }
    });
  });

  it("reads nothing at all under a different orgId (BR-15)", async () => {
    const ctx = twoFlows();
    await write(ctx, { orgId: ORG });

    const mine = await read(ctx, { orgId: ORG });
    const theirs = await read(ctx, { orgId: OTHER_ORG });

    // Both halves matter: the empty read is only evidence of a boundary if the
    // same process reads the rows under the org that wrote them.
    expect(mine.workers).toHaveLength(2);
    expect(theirs.workers).toEqual([]);
  });

  it("still sees the rows when the app isolates its org state (BR-24)", async () => {
    const ctx = twoFlows({ isolateOrgState: true });
    await write(ctx, { orgId: ORG });

    const rows = await read(ctx, { orgId: ORG });

    expect(rows.workers).toHaveLength(2);
    expect(Object.keys(byId(rows.workers)).sort()).toEqual(["eng.analyst", "eng.lead"]);
    // The red state, live in the same request: the control collection left
    // `flowIsolation` unset, so under this flag its row went private to the
    // writer's flow and the reader sees none of it. That is what the worker
    // collection would do if it stopped spelling `false`.
    expect(rows.control).toEqual([]);
  });

  it("shares rows between two tenants under one orgId — an org boundary, not a tenant one (BR-15a)", async () => {
    const ctx = twoFlows();
    await write(ctx, { orgId: ORG, tenantId: "tenant_a" });

    const other = await read(ctx, { orgId: ORG, tenantId: "tenant_b" });

    // Characterization, not an endorsement. `resolveOrgStorageKey` keys org
    // state on the bare `orgId` with no tenant component, while
    // `resolveSessionStorageKey` right beside it does namespace by tenant. A
    // multi-tenant host therefore has to keep org ids distinct across tenants.
    // This check fails the day someone makes the org key tenant-aware, which
    // is the point: that change should be deliberate, not discovered.
    expect(other.workers).toHaveLength(2);
    expect(byId(other.workers)).toEqual({
      "eng.lead": { id: "eng.lead", kind: "agent", door: null, rules: false, hired: null, incarnation: null, name: null, teamName: null },
      "eng.analyst": { id: "eng.analyst", kind: "agent", door: null, rules: false, hired: null, incarnation: null, name: null, teamName: null }
    });
  });
});

describe("the row schemas", () => {
  it("drops a key the schema does not declare", () => {
    const parsed = workerInventoryRowSchema.parse({
      id: "eng.lead",
      kind: "agent",
      postCount: 7
    });
    expect(parsed).not.toHaveProperty("postCount");
  });

  it("fills door, rules, hired, incarnation and the display names on a row written before they existed (BP-030)", () => {
    // The tolerance BP-030 asks for, at the schema. Were these required rather
    // than defaulted, the framework's read path would fail the parse and hand
    // back the collection's default — so an older row would lose its `id` too,
    // not merely its new fields.
    expect(workerInventoryRowSchema.parse({ id: "eng.lead", kind: "agent" })).toEqual({
      id: "eng.lead",
      kind: "agent",
      door: null,
      rules: false,
      hired: null,
      incarnation: null,
      name: null,
      teamName: null
    });
  });
});
