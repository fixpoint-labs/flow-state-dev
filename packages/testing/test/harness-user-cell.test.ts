/**
 * The harness seeds user data where the run will read it.
 *
 * Every flow keeps a user's data in their cell in the run's org, plus the
 * flow for flow-isolated data. A seed written anywhere else is invisible to
 * the block under test, which then reads an empty user. Each case seeds
 * through a helper and checks what the run reads, with and without an
 * explicit org.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler,
} from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createTestContext, testFlow } from "../src";
import { userSeedCell } from "../src/internal/user-cell";

describe("createTestContext seeds user data where the run reads it (BR-13)", () => {
  it.each([undefined, "acme"])("seeds user state and a user resource with orgId %j", async (orgId) => {
    const { ctx, stores } = await createTestContext({
      orgId,
      user: { state: { marker: "STATE-M" }, resources: { notes: { marker: "RES-M" } } },
    });
    expect(ctx.user.state).toMatchObject({ marker: "STATE-M" });
    expect(ctx.resources.notes).toMatchObject({ state: { marker: "RES-M" } });
    // The run's org's cell, never the cross-org one.
    const cell = `test-user:~org:${orgId ?? DEFAULT_ORG_ID}`;
    expect((await stores.user.get(cell))?.state).toMatchObject({ marker: "STATE-M" });
    expect(await stores.user.get("test-user")).toBeUndefined();
  });

  it("seeds a flow that isolates user state into its flow-isolated cell", async () => {
    const flow = defineFlow({ kind: "iso-flow", actions: {}, isolateUserState: true })();
    const { ctx } = await createTestContext({ flow, orgId: "acme", user: { state: { marker: "ISO-M" } } });
    expect(ctx.user.state).toMatchObject({ marker: "ISO-M" });
  });
});

const markerSchema = z.object({ marker: z.string().nullable().default(null) });

/** Reads back what the seed put in user state, a shared and an isolated user resource. */
const readBack = handler({
  name: "read-back",
  inputSchema: z.object({}),
  outputSchema: z.object({ state: z.unknown(), shared: z.unknown(), isolated: z.unknown() }),
  userStateSchema: markerSchema,
  resources: {
    shared: defineResource({ scope: "user", stateSchema: markerSchema }),
    isolated: defineResource({ scope: "user", flowIsolation: true, stateSchema: markerSchema }),
  },
  execute: (_input, ctx) => ({
    state: ctx.user.state.marker,
    shared: ctx.resources.shared.state.marker,
    isolated: ctx.resources.isolated.state.marker,
  }),
});

const readFlow = defineFlow({
  kind: "read-flow",
  user: { stateSchema: markerSchema },
  org: { stateSchema: z.object({}).passthrough() },
  actions: { read: readBack },
});

/**
 * Parity with the engine's routing: for each declaration shape, the cell the
 * harness seeds is the cell a real run writes. An alias (`ref`), collection
 * instances whose `flowIsolation` differs from the flow's default, and a
 * nested prefix inside another collection are the cases a lookup by the
 * concrete storage key gets wrong.
 */
describe("userSeedCell agrees with the engine's routing", () => {
  const row = z.object({ v: z.string() });
  const storageKeys = ["plain", "shared", "private", "profile", "notes/a", "notes/deep/b"];

  it.each([false, true])("on a flow with isolateUserState %s", async (isolateUserState) => {
    const resources = {
      plain: defineResource({ scope: "user", stateSchema: row }),
      shared: defineResource({ scope: "user", flowIsolation: false, stateSchema: row }),
      private: defineResource({ scope: "user", flowIsolation: true, stateSchema: row }),
      me: defineResource({ ref: "profile", scope: "user", flowIsolation: !isolateUserState, stateSchema: row }),
      notes: defineResourceCollection({ pattern: "notes/*", scope: "user", flowIsolation: !isolateUserState, stateSchema: row }),
      deep: defineResourceCollection({ pattern: "notes/deep/*", scope: "user", flowIsolation: isolateUserState, stateSchema: row }),
    };
    const write = handler({
      name: "write",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      resources,
      execute: async (_input, ctx) => {
        await ctx.resources.plain.patchState({ v: "x" });
        await ctx.resources.shared.patchState({ v: "x" });
        await ctx.resources.private.patchState({ v: "x" });
        await ctx.resources.me.patchState({ v: "x" });
        await ctx.resources.notes.create("a", { v: "x" });
        await ctx.resources.deep.create("b", { v: "x" });
        return { ok: true };
      },
    });
    const flow = defineFlow({
      kind: "parity",
      isolateUserState,
      resources,
      actions: { write },
    })();
    const stores = createInMemoryStores();
    const result = await testFlow({ flow, action: "write", input: {}, userId: "alice", stores });
    expect(result.error).toBeUndefined();

    for (const key of storageKeys) {
      const cell = userSeedCell(flow, "alice", DEFAULT_ORG_ID, key);
      expect(await stores.resourceState.get("user", cell, key), `${key} at ${cell}`).toBeDefined();
    }
  });
});

describe("testFlow seeds user data where the run reads it (BR-13)", () => {
  it.each([
    ["the default org", undefined],
    ["a seeded org", { state: {} }],
  ] as const)("seeds user state, a shared and a flow-isolated resource in %s", async (_label, org) => {
    const result = await testFlow({
      flow: readFlow(),
      action: "read",
      input: {},
      userId: "alice",
      seed: {
        user: {
          state: { marker: "STATE-M" },
          resources: { shared: { marker: "SHARED-M" }, isolated: { marker: "ISOLATED-M" } },
        },
        ...(org === undefined ? {} : { org }),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ state: "STATE-M", shared: "SHARED-M", isolated: "ISOLATED-M" });
  });
});
