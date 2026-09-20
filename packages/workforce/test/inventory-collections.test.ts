/**
 * The three inventory collections — what they promise a reader that is not the
 * writer, and where the boundary around them actually falls.
 *
 * The collections are the floor the live inventory is written onto. Nothing
 * here writes a real row from a real channel or a real roster; that is the
 * binder's and the channel kind's job, and their own checks cover it. What has
 * to be true first is that a row written by one flow is readable by another in
 * the same org, is not readable from a different org, and does not quietly stop
 * being shared when an app flips an unrelated flag.
 *
 * That last one is why every case here uses TWO flows. A collection read back
 * by the flow that wrote it proves nothing about sharing — it is green whether
 * the rows are shared or private, which is the exact shape of a check that
 * cannot fail. The reader flow is a different kind throughout.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  channelInventoryRowSchema,
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipKey,
  membershipPrefix,
  seatInventoryRowSchema
} from "../src/index";

const ORG = "org_acme";
const OTHER_ORG = "org_other";
const USER = "u_boot";

/**
 * A collection declared exactly as the three under test are, except that it
 * leaves `flowIsolation` unset. It is the live red state for BR-24: under
 * `isolateOrgState: true` its rows go private per flow while the real ones stay
 * shared, in the same process, on the same request.
 */
const inheritsIsolation = defineResourceCollection({
  pattern: "control/inherits/*",
  scope: "org",
  stateSchema: z.object({ id: z.string() })
});

const seats = defineSeatInventoryCollection();
const channels = defineChannelInventoryCollection();
const memberships = defineMembershipIndexCollection();

type Rows = {
  seats: unknown[];
  channels: unknown[];
  memberships: unknown[];
  control: unknown[];
};

const writeBlock = handler({
  name: "inventory-write",
  inputSchema: z.object({
    seats: z.array(seatInventoryRowSchema),
    channels: z.array(channelInventoryRowSchema.partial().and(z.object({ id: z.string() }))),
    memberships: z.array(z.tuple([z.string(), z.string()]))
  }),
  outputSchema: z.object({ written: z.number() }),
  resources: { seats, channels, memberships, control: inheritsIsolation },
  execute: async (input: any, ctx: any) => {
    for (const row of input.seats) {
      await ctx.resources.seats.upsert(row.id, row);
    }
    for (const row of input.channels) {
      await ctx.resources.channels.upsert(row.id, row);
    }
    for (const [seatId, channelId] of input.memberships) {
      await ctx.resources.memberships.upsert(membershipKey(seatId, channelId), {
        seatId,
        channelId
      });
    }
    await ctx.resources.control.upsert("probe", { id: "probe" });
    return {
      written: input.seats.length + input.channels.length + input.memberships.length
    };
  }
});

const readBlock = handler({
  name: "inventory-read",
  inputSchema: z.object({ membershipsOf: z.string().optional() }),
  outputSchema: z.object({
    seats: z.array(z.unknown()),
    channels: z.array(z.unknown()),
    memberships: z.array(z.unknown()),
    control: z.array(z.unknown())
  }),
  resources: { seats, channels, memberships, control: inheritsIsolation },
  execute: async (input: any, ctx: any) => {
    const state = (ref: any): unknown => ref.state;
    const membershipRefs =
      input.membershipsOf === undefined
        ? await ctx.resources.memberships.list()
        : await ctx.resources.memberships.list(membershipPrefix(input.membershipsOf));
    return {
      seats: (await ctx.resources.seats.list()).map(state),
      channels: (await ctx.resources.channels.list()).map(state),
      memberships: membershipRefs.map(state),
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
  seats: [
    { id: "eng.lead", kind: "agent" },
    { id: "eng.analyst", kind: "agent" }
  ],
  channels: [
    { id: "eng.standup", kind: "channel", members: ["eng.lead", "eng.analyst"], openedAt: "2026-09-19T00:00:00.000Z" }
  ],
  memberships: [
    ["eng.lead", "eng.standup"],
    ["eng.lead", "eng.retro"],
    ["eng.leadership", "eng.allhands"]
  ] as Array<[string, string]>
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
  opts: { orgId?: string; tenantId?: string; membershipsOf?: string } = {}
): Promise<Rows> {
  const { membershipsOf, ...rest } = opts;
  const result: any = await runAction({
    flow: ctx.reader,
    actionName: "read",
    input: membershipsOf === undefined ? {} : { membershipsOf },
    userId: USER,
    stores: ctx.stores,
    runtimeConfig: {} as never,
    ...rest
  });
  return (result.output ?? result) as Rows;
}

describe("what the collections declare", () => {
  it("pins the three storage patterns — public keys, breaking to move", () => {
    expect(seats.pattern).toBe("inventory/seats/*");
    expect(channels.pattern).toBe("inventory/channels/*");
    expect(memberships.pattern).toBe("inventory/members/**");
  });

  it("declares flowIsolation as an explicit false, not an omission (BR-24)", () => {
    // The distinction this asserts is `false` vs `undefined`, and it is the
    // whole mechanism: `effectiveStorageTuple` only consults the flow's
    // `isolateOrgState` when the entry left `flowIsolation` unset. A check
    // written as `toBeFalsy()` would pass on the omission and prove nothing.
    for (const collection of [seats, channels, memberships]) {
      expect(collection.scope).toBe("org");
      expect(collection.flowIsolation).toBe(false);
    }
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

    expect(rows.seats).toHaveLength(2);
    expect(byId(rows.seats)).toEqual({
      "eng.lead": { id: "eng.lead", kind: "agent" },
      "eng.analyst": { id: "eng.analyst", kind: "agent" }
    });
    expect(rows.channels).toEqual([
      {
        id: "eng.standup",
        kind: "channel",
        members: ["eng.lead", "eng.analyst"],
        openedAt: "2026-09-19T00:00:00.000Z"
      }
    ]);
    // The third collection is asserted here too. The seed writes to all three,
    // so without this a membership upsert could fail outright and the seat and
    // channel assertions above would still pass — the case would be green about
    // two thirds of what it claims to read back.
    expect(rows.memberships).toHaveLength(3);
    expect(
      (rows.memberships as Array<{ seatId: string; channelId: string }>).map(
        (row) => `${row.seatId}/${row.channelId}`
      )
    ).toEqual(
      expect.arrayContaining([
        "eng.lead/eng.standup",
        "eng.lead/eng.retro",
        "eng.leadership/eng.allhands"
      ])
    );
  });

  it("reads nothing at all under a different orgId (BR-15)", async () => {
    const ctx = twoFlows();
    await write(ctx, { orgId: ORG });

    const mine = await read(ctx, { orgId: ORG });
    const theirs = await read(ctx, { orgId: OTHER_ORG });

    // Both halves matter: the empty read is only evidence of a boundary if the
    // same process reads the rows under the org that wrote them.
    expect(mine.seats).toHaveLength(2);
    expect(theirs.seats).toEqual([]);
    expect(theirs.channels).toEqual([]);
    expect(theirs.memberships).toEqual([]);
  });

  it("still sees the rows when the app isolates its org state (BR-24)", async () => {
    const ctx = twoFlows({ isolateOrgState: true });
    await write(ctx, { orgId: ORG });

    const rows = await read(ctx, { orgId: ORG });

    expect(rows.seats).toHaveLength(2);
    expect(Object.keys(byId(rows.seats)).sort()).toEqual(["eng.analyst", "eng.lead"]);
    expect(rows.channels.map((row: any) => row.id)).toEqual(["eng.standup"]);
    // The red state, live in the same request: the control collection left
    // `flowIsolation` unset, so under this flag its row went private to the
    // writer's flow and the reader sees none of it. That is what these three
    // collections would do if they stopped spelling `false`.
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
    expect(other.seats).toHaveLength(2);
    expect(byId(other.seats)).toEqual({
      "eng.lead": { id: "eng.lead", kind: "agent" },
      "eng.analyst": { id: "eng.analyst", kind: "agent" }
    });
  });
});

describe("the membership index", () => {
  it("lists one seat's channels and stops at the segment boundary (BR-17)", async () => {
    const ctx = twoFlows();
    await write(ctx, { orgId: ORG });

    const rows = await read(ctx, { orgId: ORG, membershipsOf: "eng.lead" });

    // "eng.leadership" is seeded precisely so a prefix match without the
    // trailing slash would drag it in. Asserting the channel ids rather than a
    // count is what makes that visible when it breaks.
    expect(rows.memberships).toEqual([
      { seatId: "eng.lead", channelId: "eng.standup" },
      { seatId: "eng.lead", channelId: "eng.retro" }
    ]);
  });

  it("keeps the seat id as one whole path segment", () => {
    expect(membershipKey("eng.lead", "eng.standup")).toBe("eng.lead/eng.standup");
    expect(membershipPrefix("eng.lead")).toBe("eng.lead/");
  });

  it("refuses an id that would file the row under another seat", () => {
    // A slash here is not a malformed key — it is a well-formed key under the
    // wrong seat, which reads back as that seat's membership and which nothing
    // downstream could notice.
    expect(() => membershipKey("eng/lead", "eng.standup")).toThrow(/path separator/);
    expect(() => membershipKey("eng.lead", "a/b")).toThrow(/path separator/);
    expect(() => membershipPrefix("eng\\lead")).toThrow(/path separator/);
    expect(() => membershipKey("", "eng.standup")).toThrow(/must not be empty/);
    expect(() => membershipKey("..", "eng.standup")).toThrow(/must not be/);
  });
});

describe("the row schemas", () => {
  it("drops a key the schema does not declare", () => {
    const parsed = channelInventoryRowSchema.parse({
      id: "eng.standup",
      kind: "channel",
      members: [],
      openedAt: null,
      postCount: 7
    });
    expect(parsed).not.toHaveProperty("postCount");
  });

  it("fills members and openedAt on a row written before they existed (BP-030)", () => {
    // The tolerance BP-030 asks for, at the schema. Were these required rather
    // than defaulted, the framework's read path would fail the parse and hand
    // back the collection's default — so an older row would lose its `id` too,
    // not merely its new fields.
    expect(seatInventoryRowSchema.parse({ id: "eng.lead", kind: "agent" })).toEqual({
      id: "eng.lead",
      kind: "agent"
    });
    expect(channelInventoryRowSchema.parse({ id: "eng.standup", kind: "channel" })).toEqual({
      id: "eng.standup",
      kind: "channel",
      members: [],
      openedAt: null
    });
  });
});
