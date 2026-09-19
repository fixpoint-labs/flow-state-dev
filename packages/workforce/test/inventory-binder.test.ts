/**
 * The live inventory's two writers, on the real path: `openInventory` for the
 * seat rows, and each channel for its own.
 *
 * `inventory-collections.test.ts` covers the floor these rows land on — org
 * boundary, cross-flow sharing, key shape. This file covers who writes them and
 * what they say, so every case here goes through a registered flow, a real
 * session opened by `openChannels`, and a real action run.
 *
 * **Every assertion is paired with a control that would break it.** A row that
 * exists is only evidence of a writer if the same roster, in the same process,
 * produces no row when the writer is absent — so the off-state case runs the
 * identical roster with the flag down, the custom-kind case runs a third kind
 * that omits the registration, and the staleness case runs a roster that names
 * different members from the ones the session holds. The reader is a flow that
 * is not a channel and declares its own collection instances, so nothing here
 * is green merely because the writer read back its own objects.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  CHANNEL_KIND,
  INVENTORY_REGISTER_CHANNEL,
  channelInstances,
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  inventoryWriterActions,
  membershipPrefix,
  openChannels,
  openInventory,
  type ChannelManifest,
  type InventoryBinding,
  type InventorySeat
} from "../src/index";
import { channelSessionStateSchema } from "../src/index";

const USER_ID = "u_boot";
const ORG_ID = "org_acme";
const OTHER_ORG = "org_other";

/** The kind a hand-rolled channel runs on when a case needs a second one. */
const BRIEFING_KIND = "briefing";
/** A hand-rolled kind that deliberately does NOT carry the inventory writer. */
const SILENT_KIND = "silent";

function record(id: string, declared: Record<string, unknown> = {}): ChannelManifest {
  return { id, declared: { members: ["eng.lead", "eng.coder"], ...declared }, body: "Charter." };
}

/**
 * The reader: a flow that is **not** a channel, declaring its own instances of
 * the three collections.
 *
 * Its own instances on purpose. A collection is addressed by its pattern and
 * scope, and if that were not true this reader would come back empty — so
 * calling the factories again here is what turns "the rows are shared" from a
 * claim into a measurement.
 */
const seatsCollection = defineSeatInventoryCollection();
const channelsCollection = defineChannelInventoryCollection();
const membershipsCollection = defineMembershipIndexCollection();

const readInventory = handler({
  name: "read-inventory",
  inputSchema: z.object({ membershipsOf: z.string().optional() }),
  outputSchema: z.object({
    seats: z.array(z.unknown()),
    channels: z.array(z.unknown()),
    memberships: z.array(z.unknown())
  }),
  resources: {
    seats: seatsCollection,
    channels: channelsCollection,
    memberships: membershipsCollection
  },
  execute: async (input: any, ctx: any) => {
    const state = (ref: any): unknown => ref.state;
    const memberships =
      input.membershipsOf === undefined
        ? await ctx.resources.memberships.list()
        : await ctx.resources.memberships.list(membershipPrefix(input.membershipsOf));
    return {
      seats: (await ctx.resources.seats.list()).map(state),
      channels: (await ctx.resources.channels.list()).map(state),
      memberships: memberships.map(state)
    };
  }
});

const readerFlow = defineFlow({
  kind: "inventory-reader",
  actions: { read: { block: readInventory } }
} as never);

/** A hand-rolled channel kind, carrying the writer the way it carries the singleton contract. */
function briefingKind() {
  const flow = defineFlow({
    kind: BRIEFING_KIND,
    cardinality: "singleton",
    session: { stateSchema: channelSessionStateSchema },
    actions: { ...inventoryWriterActions(BRIEFING_KIND) }
  } as never);
  return Object.assign(() => (flow as any)(), { kind: BRIEFING_KIND });
}

/**
 * The control kind: identical to {@link briefingKind} but for the one line that
 * carries the registration.
 *
 * Its channel opens, holds members and behaves like any other — it simply has
 * nowhere for the binder's run to land. That is what makes "the row is there"
 * an assertion about the writer rather than about the roster.
 */
function silentKind() {
  const noop = handler({
    name: "silent-noop",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true })
  });
  const flow = defineFlow({
    kind: SILENT_KIND,
    cardinality: "singleton",
    session: { stateSchema: channelSessionStateSchema },
    actions: { ping: { block: noop } }
  } as never);
  return Object.assign(() => (flow as any)(), { kind: SILENT_KIND });
}

type HostOptions = {
  /** Turn the writer on for the built-in kind. */
  inventory?: boolean;
  /** Extra channel kinds, by kind name. */
  kinds?: Record<string, any>;
  /** Channels `openChannels` opens. Defaults to the whole roster. */
  open?: ChannelManifest[];
  /** Shared storage, so a second boot reads what the first wrote. */
  adapter?: unknown;
};

/**
 * Register the roster's kinds plus the reader, open the channels, and hand back
 * the doors a case needs.
 *
 * `openInventory` is NOT called here. Several cases need it run alone, with a
 * roster the channels were not opened from, so the binder stays the case's to
 * invoke.
 */
async function host(roster: ChannelManifest[], options: HostOptions = {}) {
  const instances = channelInstances(roster, {
    ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
    ...(options.inventory === undefined ? {} : { inventory: options.inventory })
  });
  const byKind: Record<string, any> = Object.fromEntries(
    instances.map((instance) => [instance.kind, instance])
  );
  const reader = (readerFlow as any)();
  const state = createFlowState({
    flows: { ...byKind, [reader.kind]: reader },
    stores: { default: { primary: options.adapter ?? inMemoryStores() } }
  } as never);
  const runtime = await state.getRuntime();

  await openChannels(options.open ?? roster, {
    client: sessionApi(runtime.stores),
    userId: USER_ID,
    orgId: ORG_ID
  });

  /**
   * The binder's action door, over this process's own runtime.
   *
   * It REJECTS on a failed run, which is the contract `openInventory`'s
   * `run` states: the engine hands a refusal back as `{ error }` rather than
   * throwing, and a door that passed that through as an ordinary value would
   * report every channel registered while writing nothing.
   */
  const run = async (request: {
    action: string;
    input: unknown;
    userId: string;
    orgId: string;
    flowKind: string;
    sessionId: string;
  }): Promise<unknown> => {
    const flow = byKind[request.flowKind];
    if (flow === undefined) {
      throw new Error(`no flow registered under kind "${request.flowKind}"`);
    }
    const result: any = await runAction({
      flow,
      actionName: request.action,
      input: request.input,
      userId: request.userId,
      orgId: request.orgId,
      sessionId: request.sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never);
    if (result?.error !== undefined) {
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }
    return result;
  };

  return {
    runtime,
    run,
    /** Read the inventory back through a flow that is not a channel. */
    read: async (opts: { orgId?: string; membershipsOf?: string } = {}) => {
      const { membershipsOf, ...rest } = opts;
      const result: any = await runAction({
        flow: reader,
        actionName: "read",
        input: membershipsOf === undefined ? {} : { membershipsOf },
        userId: USER_ID,
        orgId: ORG_ID,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
        ...rest
      } as never);
      return (result.output ?? result) as {
        seats: any[];
        channels: any[];
        memberships: any[];
      };
    },
    /** Every inventory key physically present in an org's storage. */
    keys: async (orgId: string = ORG_ID) =>
      Object.keys(
        await runtime.stores.resourceState.getByPrefix("org", orgId, "inventory/")
      ).sort(),
    /** One stored row, straight out of org storage — never through the reader. */
    row: async (key: string) =>
      (await runtime.stores.resourceState.get("org", ORG_ID, key))?.state as
        | Record<string, unknown>
        | undefined,
    act: async (sessionId: string, actionName: string, input: unknown) => {
      try {
        return (await runAction({
          flow: byKind[CHANNEL_KIND],
          actionName,
          input,
          userId: USER_ID,
          orgId: ORG_ID,
          sessionId,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        } as never)) as { output?: unknown; error?: unknown };
      } catch (error) {
        return { error };
      }
    },
    dispose: () => state.dispose()
  };
}

/** `openChannels`'s session API over one runtime's stores. */
function sessionApi(stores: any) {
  return {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      orgId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }): Promise<unknown> => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: options.orgId,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        } as never,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = await stores.session.get(sessionId);
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        orgId: (found as { orgId?: string } | undefined)?.orgId,
        state: found?.state as Record<string, unknown> | undefined
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
}

const SEATS: InventorySeat[] = [
  { id: "eng.lead", kind: "agent" },
  { id: "eng.coder", kind: "coder" }
];

/** The usual call: seats through the built-in kind, channels through their own. */
function bind(
  lab: Awaited<ReturnType<typeof host>>,
  options: {
    seats?: InventorySeat[];
    channels?: ChannelManifest[];
    orgId?: string | undefined;
    seatWriterKind?: string;
  } = {}
): Promise<InventoryBinding> {
  return openInventory(
    { seats: options.seats ?? SEATS, channels: options.channels ?? [] },
    {
      run: lab.run as never,
      userId: USER_ID,
      orgId: "orgId" in options ? options.orgId : ORG_ID,
      seatWriter: { flowKind: options.seatWriterKind ?? CHANNEL_KIND }
    }
  );
}

describe("what one boot writes", () => {
  it("gives every seat and every open channel a row, read back from a flow that is not a channel (BR-8, BR-14, BR-21)", async () => {
    const roster = [record("eng.standup"), record("eng.retro", { members: ["eng.lead"] })];
    const lab = await host(roster, { inventory: true });
    try {
      const result = await bind(lab, { channels: roster });
      expect(result.problems).toEqual([]);
      expect(result).toMatchObject({ seats: 2, channels: 2 });

      const rows = await lab.read();

      expect(rows.seats.map((row) => row.id).sort()).toEqual(["eng.coder", "eng.lead"]);
      expect(rows.seats.find((row) => row.id === "eng.coder")).toEqual({
        id: "eng.coder",
        kind: "coder"
      });

      const channels = Object.fromEntries(rows.channels.map((row) => [row.id, row]));
      expect(Object.keys(channels).sort()).toEqual(["eng.retro", "eng.standup"]);
      expect(channels["eng.standup"]).toMatchObject({
        id: "eng.standup",
        kind: CHANNEL_KIND,
        members: ["eng.lead", "eng.coder"]
      });
      expect(channels["eng.retro"].members).toEqual(["eng.lead"]);
      // `openedAt` is written, not left at the schema's null default — the
      // assertion is on it being a real timestamp, because a `null` here would
      // still satisfy a `toHaveProperty` check.
      expect(Date.parse(channels["eng.standup"].openedAt)).not.toBeNaN();
    } finally {
      await lab.dispose();
    }
  });

  it("puts the rows under the pinned storage keys (BR-16)", async () => {
    const roster = [record("eng.standup", { members: ["eng.lead"] })];
    const lab = await host(roster, { inventory: true });
    try {
      await bind(lab, { channels: roster, seats: [{ id: "eng.lead", kind: "agent" }] });

      // Read out of storage rather than through the collection, because what is
      // being pinned is the key an already-persisted org would have to keep.
      expect(await lab.keys()).toEqual([
        "inventory/channels/eng.standup",
        "inventory/members/eng.lead/eng.standup",
        "inventory/seats/eng.lead"
      ]);
      expect(await lab.row("inventory/seats/eng.lead")).toEqual({
        id: "eng.lead",
        kind: "agent"
      });
    } finally {
      await lab.dispose();
    }
  });

  it("writes the membership index from the same read as the channel row, so the two agree (BR-17, BR-20)", async () => {
    const roster = [
      record("eng.standup", { members: ["eng.lead", "eng.coder"] }),
      record("eng.retro", { members: ["eng.lead"] }),
      record("eng.allhands", { members: ["eng.leadership"] })
    ];
    const lab = await host(roster, { inventory: true });
    try {
      await bind(lab, {
        channels: roster,
        seats: [...SEATS, { id: "eng.leadership", kind: "agent" }]
      });

      const mine = await lab.read({ membershipsOf: "eng.lead" });
      expect(mine.memberships.map((row) => row.channelId).sort()).toEqual([
        "eng.retro",
        "eng.standup"
      ]);
      // "eng.leadership" is in the roster precisely so a prefix read without the
      // segment boundary would drag its channel in here.
      expect(mine.memberships.map((row) => row.channelId)).not.toContain("eng.allhands");

      // The index is a projection, so it must say exactly what the rows say. A
      // check on the index alone would pass against an index written from some
      // other source entirely.
      const all = await lab.read();
      const fromRows = all.channels
        .filter((row) => (row.members as string[]).includes("eng.lead"))
        .map((row) => row.id)
        .sort();
      expect(fromRows).toEqual(mine.memberships.map((row) => row.channelId).sort());
    } finally {
      await lab.dispose();
    }
  });
});

describe("what the binder refuses to carry", () => {
  it("writes the members the open channel holds, never the ones the roster names (BR-10, BR-10a)", async () => {
    // Opened with one roster, registered from another. Running `openInventory`
    // ALONE is what makes this conclusive: with a whole boot in between,
    // `openChannels` would be a second candidate writer of the row's members and
    // a red result would not say which of the two carried them.
    const opened = [record("eng.standup", { members: ["eng.lead", "eng.coder"] })];
    const lab = await host(opened, { inventory: true });
    try {
      const edited = [record("eng.standup", { members: ["ops.oncall", "ops.sre"] })];
      await bind(lab, { channels: edited, seats: [] });

      const rows = await lab.read();
      // The red state is this row holding ["ops.oncall", "ops.sre"] — exactly
      // what a binder that copied the roster's `members:` forward would write.
      expect(rows.channels).toHaveLength(1);
      expect(rows.channels[0].members).toEqual(["eng.lead", "eng.coder"]);

      // And the index follows the row, not the roster, for the same reason.
      expect(await lab.keys()).toEqual([
        "inventory/channels/eng.standup",
        "inventory/members/eng.coder/eng.standup",
        "inventory/members/eng.lead/eng.standup"
      ]);
    } finally {
      await lab.dispose();
    }
  });

  it("refuses a run with no org rather than writing where nothing can read (BR-11)", async () => {
    const roster = [record("eng.standup")];
    const lab = await host(roster, { inventory: true });
    try {
      await expect(bind(lab, { channels: roster, orgId: undefined })).rejects.toThrow(
        /no `orgId`/
      );

      // The red state is a binder that carried on: it would report success and
      // leave an inventory every flow reads back empty. Both halves are checked
      // — nothing under any org, and the same call under an org does write.
      expect(await lab.keys()).toEqual([]);
      expect(await lab.keys(OTHER_ORG)).toEqual([]);

      await bind(lab, { channels: roster });
      expect((await lab.keys()).length).toBeGreaterThan(0);
    } finally {
      await lab.dispose();
    }
  });

  it("refuses seats with no seatWriter, naming what to pass", async () => {
    const lab = await host([], { inventory: true });
    try {
      await expect(
        openInventory(
          { seats: SEATS, channels: [] },
          { run: lab.run as never, userId: USER_ID, orgId: ORG_ID }
        )
      ).rejects.toThrow(/seatWriter/);
      expect(await lab.keys()).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });
});

describe("running it twice", () => {
  it("is a no-op over an unchanged roster, and keeps the rows a shrunken one drops (BR-9, BR-23)", async () => {
    const adapter = inMemoryStores();
    const roster = [record("eng.standup"), record("eng.retro", { members: ["eng.lead"] })];

    const first = await host(roster, { inventory: true, adapter });
    let openedAt: string;
    try {
      await bind(first, { channels: roster });
      const keys = await first.keys();
      expect(keys).toContain("inventory/channels/eng.retro");
      openedAt = (await first.row("inventory/channels/eng.standup"))!.openedAt as string;

      // Second run, same process, same roster: the red state is rows doubling.
      await bind(first, { channels: roster });
      expect(await first.keys()).toEqual(keys);
    } finally {
      await first.dispose();
    }

    // A second boot over the SAME storage, from a roster that lost a channel and
    // a seat. Nothing is reconciled: a binder that dropped what its roster no
    // longer names would take a live channel's row with it.
    const shrunk = [record("eng.standup")];
    const second = await host(shrunk, { inventory: true, adapter });
    try {
      const result = await bind(second, {
        channels: shrunk,
        seats: [{ id: "eng.lead", kind: "agent" }]
      });
      expect(result.problems).toEqual([]);

      const rows = await second.read();
      expect(rows.channels.map((row) => row.id).sort()).toEqual(["eng.retro", "eng.standup"]);
      expect(rows.seats.map((row) => row.id).sort()).toEqual(["eng.coder", "eng.lead"]);
      // The channel that was open before this boot keeps the moment it opened,
      // rather than being restamped by a binder that has no idea when that was.
      expect((await second.row("inventory/channels/eng.standup"))!.openedAt).toBe(openedAt);
    } finally {
      await second.dispose();
    }
  });
});

describe("an app that never turns the inventory on", () => {
  it("declares nothing and writes nothing, and its channels behave as they did (BR-13)", async () => {
    const roster = [record("eng.standup")];

    // The control and the case are the same roster and the same code, one flag
    // apart. Without it, there is no action to run, so the binder reports the
    // channel by name and no row exists anywhere.
    const off = await host(roster);
    try {
      const result = await bind(off, { channels: roster });
      expect(result.channels).toBe(0);
      expect(result.problems).toHaveLength(2);
      expect(result.problems.join("\n")).toContain("eng.standup");
      expect(await off.keys()).toEqual([]);

      // And the channel is otherwise exactly a channel: a post lands, a read
      // comes back, nothing about it changed.
      const posted = await off.act("eng.standup", "post", { body: "morning" });
      expect(posted.error).toBeUndefined();
      const read: any = await off.act("eng.standup", "read", {});
      expect(read.error).toBeUndefined();
      expect((read.output as any).members).toEqual(["eng.lead", "eng.coder"]);
      expect((read.output as any).transcript).toHaveLength(1);
    } finally {
      await off.dispose();
    }

    const on = await host(roster, { inventory: true });
    try {
      const result = await bind(on, { channels: roster });
      expect(result.problems).toEqual([]);
      expect(await on.keys()).not.toEqual([]);
    } finally {
      await on.dispose();
    }
  });
});

describe("a custom channel kind", () => {
  it("gets rows like the built-in's, and one that cannot register is named (BR-22, BR-12)", async () => {
    const roster = [
      record("eng.standup"),
      record("eng.brief", { flow: BRIEFING_KIND, members: ["eng.lead"] }),
      record("eng.quiet", { flow: SILENT_KIND, members: ["eng.coder"] })
    ];
    const lab = await host(roster, {
      inventory: true,
      kinds: { [BRIEFING_KIND]: briefingKind(), [SILENT_KIND]: silentKind() }
    });
    try {
      const result = await bind(lab, { channels: roster });

      const rows = await lab.read();
      const byId = Object.fromEntries(rows.channels.map((row) => [row.id, row]));

      // The built-in and the hand-rolled kind are both there, each carrying the
      // kind that minted it. A write behind a `kind === "channel"` test would
      // leave `eng.brief` out while every other assertion here still passed.
      expect(byId["eng.standup"].kind).toBe(CHANNEL_KIND);
      expect(byId["eng.brief"]).toMatchObject({
        id: "eng.brief",
        kind: BRIEFING_KIND,
        members: ["eng.lead"]
      });

      // The kind that carries no registration is a NAMED failure, not a silent
      // gap — and the two that could register still did.
      expect(byId["eng.quiet"]).toBeUndefined();
      expect(result.channels).toBe(2);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("eng.quiet");
      expect(result.problems[0]).toContain("could not register");
    } finally {
      await lab.dispose();
    }
  });
});

describe("a channel nobody opened", () => {
  it("is named rather than registered, and the open ones still are (BR-12)", async () => {
    const roster = [record("eng.standup"), record("eng.ghost")];
    // Opened without `eng.ghost`, so its session has no channel in it.
    const lab = await host(roster, { inventory: true, open: [record("eng.standup")] });
    try {
      const result = await bind(lab, { channels: roster });

      expect(result.channels).toBe(1);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("eng.ghost");
      expect(result.problems[0]).toContain("not an open channel");

      const rows = await lab.read();
      expect(rows.channels.map((row) => row.id)).toEqual(["eng.standup"]);
    } finally {
      await lab.dispose();
    }
  });
});

describe("the registration action itself", () => {
  it("takes no input at all, so nothing a caller supplies reaches the row", async () => {
    const roster = [record("eng.standup")];
    const lab = await host(roster, { inventory: true });
    try {
      const refused = await lab.act("eng.standup", INVENTORY_REGISTER_CHANNEL, {
        members: ["ops.intruder"]
      });
      // The schema is closed, so a caller cannot even name the field. This is
      // the fence: there is no shape of input through which somebody else's
      // membership could be published under this channel's id.
      expect(refused.error).toBeDefined();
      expect(await lab.keys()).toEqual([]);

      const accepted = await lab.act("eng.standup", INVENTORY_REGISTER_CHANNEL, {});
      expect(accepted.error).toBeUndefined();
      expect((await lab.row("inventory/channels/eng.standup"))!.members).toEqual([
        "eng.lead",
        "eng.coder"
      ]);
    } finally {
      await lab.dispose();
    }
  });

  it("leaves nothing written when a member id cannot become a membership key, on every attempt", async () => {
    // "bad/id" can never pass `membershipKey`'s one-path-segment rule, so this
    // is not a flaky write — it fails the same way on every boot until the
    // member id itself is fixed.
    const roster = [record("eng.standup", { members: ["eng.lead", "bad/id"] })];
    const lab = await host(roster, { inventory: true, open: roster });
    try {
      const first = await lab.act("eng.standup", INVENTORY_REGISTER_CHANNEL, {});
      expect(first.error).toBeDefined();
      // A channel row with no matching membership row would disagree with the
      // index for as long as the process runs, since nothing here retries or
      // prunes. So a permanently-failing member must leave nothing behind,
      // not a channel row committed ahead of the membership it names.
      expect(await lab.keys()).toEqual([]);

      const second = await lab.act("eng.standup", INVENTORY_REGISTER_CHANNEL, {});
      expect(second.error).toBeDefined();
      expect(await lab.keys()).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });
});
