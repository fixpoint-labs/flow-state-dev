/**
 * The live inventory's two writers, on the real path: `openInventory` for the
 * seat rows, and each mailbox for its own.
 *
 * `inventory-collections.test.ts` covers the floor these rows land on — org
 * boundary, cross-flow sharing, key shape. This file covers who writes them and
 * what they say, so every case here goes through a registered flow, a real
 * session opened by `openMailboxes`, and a real action run.
 *
 * **Every assertion is paired with a control that would break it.** A row that
 * exists is only evidence of a writer if the same roster, in the same process,
 * produces no row when the writer is absent — so the off-state case runs the
 * identical roster with the flag down, the custom-kind case runs a third kind
 * that omits the registration, and the staleness case runs a roster that names
 * different members from the ones the session holds. The reader is a flow that
 * is not a mailbox and declares its own collection instances, so nothing here
 * is green merely because the writer read back its own objects.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  MAILBOX_KIND,
  INVENTORY_REGISTER_MAILBOX,
  INVENTORY_REGISTER_SEATS,
  INVENTORY_SEAT_WRITER_SESSION,
  mailboxInstances,
  defineMailboxInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  inventoryWriterActions,
  membershipPrefix,
  openMailboxes,
  openInventory,
  type MailboxManifest,
  type InventoryBinding,
  type InventorySeat
} from "../src/index";
import { workforceManifestSources } from "../src/manifest-sources";
import { defineProjectsCollection } from "../src/projects/collections";
import { forgetOrgTalkTemplate, forgetTalkTemplate } from "../src/projects/talk-template";
import { mailboxesessionStateSchema } from "../src/index";

const USER_ID = "u_boot";
const ORG_ID = DEFAULT_ORG_ID;
const OTHER_ORG = "org_other";

/** The kind a hand-rolled mailbox runs on when a case needs a second one. */
const BRIEFING_KIND = "briefing";
/** A hand-rolled kind that deliberately does NOT carry the inventory writer. */
const SILENT_KIND = "silent";

function record(id: string, declared: Record<string, unknown> = {}): MailboxManifest {
  return { id, declared: { members: ["eng.lead", "eng.coder"], ...declared }, body: "Charter." };
}

/**
 * The reader: a flow that is **not** a mailbox, declaring its own instances of
 * the three collections.
 *
 * Its own instances on purpose. A collection is addressed by its pattern and
 * scope, and if that were not true this reader would come back empty — so
 * calling the factories again here is what turns "the rows are shared" from a
 * claim into a measurement.
 */
const seatsCollection = defineSeatInventoryCollection();
const mailboxesCollection = defineMailboxInventoryCollection();
const membershipsCollection = defineMembershipIndexCollection();

const readInventory = handler({
  name: "read-inventory",
  inputSchema: z.object({ membershipsOf: z.string().optional() }),
  outputSchema: z.object({
    seats: z.array(z.unknown()),
    mailboxes: z.array(z.unknown()),
    memberships: z.array(z.unknown())
  }),
  resources: {
    seats: seatsCollection,
    mailboxes: mailboxesCollection,
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
      mailboxes: (await ctx.resources.mailboxes.list()).map(state),
      memberships: memberships.map(state)
    };
  }
});

/** The mailboxes the discovery door advertises for a roster, read from the org's mailbox rows. */
const discoverMailboxes = handler({
  name: "discover-mailboxes",
  inputSchema: z.object({ mailboxes: z.array(z.unknown()) }),
  outputSchema: z.object({ ids: z.array(z.string()) }),
  resources: { mailboxes: mailboxesCollection },
  execute: async (input: any, ctx: any) => {
    const [source] = workforceManifestSources({
      roster: { workers: [], mailboxes: input.mailboxes },
      inventory: { mailboxes: "mailboxes" }
    });
    return { ids: (await source!.entries(ctx)).map((entry) => entry.id) };
  }
});

const readerFlow = defineFlow({
  kind: "inventory-reader",
  actions: { read: { block: readInventory }, discover: { block: discoverMailboxes } }
} as never);

/** A hand-rolled mailbox kind, carrying the writer the way it carries the singleton contract. */
function briefingKind() {
  const flow = defineFlow({
    kind: BRIEFING_KIND,
    cardinality: "singleton",
    session: { stateSchema: mailboxesessionStateSchema },
    actions: { ...inventoryWriterActions(BRIEFING_KIND) }
  } as never);
  return Object.assign(() => (flow as any)(), { kind: BRIEFING_KIND });
}

/**
 * The control kind: identical to {@link briefingKind} but for the one line that
 * carries the registration.
 *
 * Its mailbox opens, holds members and behaves like any other — it simply has
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
    session: { stateSchema: mailboxesessionStateSchema },
    actions: { ping: { block: noop } }
  } as never);
  return Object.assign(() => (flow as any)(), { kind: SILENT_KIND });
}

type HostOptions = {
  /** Turn the writer on for the built-in kind. */
  inventory?: boolean;
  /** Extra mailbox kinds, by kind name. */
  kinds?: Record<string, any>;
  /** Mailboxes `openMailboxes` opens. Defaults to the whole roster. */
  open?: MailboxManifest[];
  /** Shared storage, so a second boot reads what the first wrote. */
  adapter?: unknown;
  /** The org's resource map, for a roster carrying a project talk template. */
  resources?: Record<string, unknown>;
};

/**
 * Register the roster's kinds plus the reader, open the mailboxes, and hand back
 * the doors a case needs.
 *
 * `openInventory` is NOT called here. Several cases need it run alone, with a
 * roster the mailboxes were not opened from, so the binder stays the case's to
 * invoke.
 */
async function host(roster: MailboxManifest[], options: HostOptions = {}) {
  const instances = mailboxInstances(roster, {
    ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
    ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
    ...(options.resources === undefined ? {} : { resources: options.resources })
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

  await openMailboxes(options.open ?? roster, {
    client: sessionApi(runtime.stores),
    userId: USER_ID
  });

  /**
   * The binder's action door, over this process's own runtime.
   *
   * It REJECTS on a failed run, which is the contract `openInventory`'s
   * `run` states: the engine hands a refusal back as `{ error }` rather than
   * throwing, and a door that passed that through as an ordinary value would
   * report every mailbox registered while writing nothing.
   */
  const run = async (request: {
    action: string;
    input: unknown;
    userId: string;
    orgId: string;
    flowKind: string;
    sessionId: string;
    source?: string;
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
      source: request.source,
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
    /** Read the inventory back through a flow that is not a mailbox. */
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
        mailboxes: any[];
        memberships: any[];
      };
    },
    /** The mailbox ids discovery advertises for a roster. */
    discover: async (mailboxes: MailboxManifest[]) => {
      const result: any = await runAction({
        flow: reader,
        actionName: "discover",
        input: { mailboxes },
        userId: USER_ID,
        orgId: ORG_ID,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never);
      if (result?.error !== undefined) throw result.error;
      return ((result.output ?? result) as { ids: string[] }).ids;
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
          flow: byKind[MAILBOX_KIND],
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

/** `openMailboxes`'s session API over one runtime's stores. */
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
          // `openMailboxes` no longer names an org (FIX-1442). This stand-in for
          // the session route binds what the real route binds when no resolver
          // is configured, so the rows land where the reader looks.
          orgId: options.orgId ?? DEFAULT_ORG_ID,
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
  { id: "eng.lead", kind: "agent", actions: {} },
  { id: "eng.coder", kind: "coder", actions: {} }
];

/** The usual call: seats through the built-in kind, mailboxes through their own. */
function bind(
  lab: Awaited<ReturnType<typeof host>>,
  options: {
    seats?: InventorySeat[];
    mailboxes?: MailboxManifest[];
    orgId?: string | undefined;
    seatWriterKind?: string;
  } = {}
): Promise<InventoryBinding> {
  return openInventory(
    { seats: options.seats ?? SEATS, mailboxes: options.mailboxes ?? [] },
    {
      run: lab.run as never,
      userId: USER_ID,
      orgId: "orgId" in options ? options.orgId : ORG_ID,
      seatWriter: { flowKind: options.seatWriterKind ?? MAILBOX_KIND }
    }
  );
}

describe("what one boot writes", () => {
  it("counts only the seat rows that landed: a row the boot may not replace is left and not counted", async () => {
    // Another process hired `eng.lead`'s address after this boot read its
    // roster: the boot's row for it is left, and the binding says one seat.
    const lab = await host([record("eng.standup")], { inventory: true });
    try {
      const hired ={ id: "eng.lead", kind: "agent", door: "userMessage", hired: true, incarnation: "i-live" };
      await lab.runtime.stores.resourceState.set("org", ORG_ID, "inventory/seats/eng.lead", hired as never, "any" as never);
      const result = await bind(lab);
      expect(result.problems).toEqual([]);
      expect(result.seats).toBe(1);
      expect((await lab.read()).seats.find((row) => row.id === "eng.lead")).toEqual(hired);
    } finally {
      await lab.dispose();
    }
  });

  it("gives every seat and every open mailbox a row, read back from a flow that is not a mailbox (BR-8, BR-14, BR-21)", async () => {
    const roster = [record("eng.standup"), record("eng.retro", { members: ["eng.lead"] })];
    const lab = await host(roster, { inventory: true });
    try {
      const result = await bind(lab, { mailboxes: roster });
      expect(result.problems).toEqual([]);
      expect(result).toMatchObject({ seats: 2, mailboxes: 2 });

      const rows = await lab.read();

      expect(rows.seats.map((row) => row.id).sort()).toEqual(["eng.coder", "eng.lead"]);
      // A seat whose actions declare no door is registered with none.
      expect(rows.seats.find((row) => row.id === "eng.coder")).toEqual({
        id: "eng.coder",
        kind: "coder",
        door: null,
        hired: null,
        incarnation: null
      });

      const mailboxes = Object.fromEntries(rows.mailboxes.map((row) => [row.id, row]));
      expect(Object.keys(mailboxes).sort()).toEqual(["eng.retro", "eng.standup"]);
      expect(mailboxes["eng.standup"]).toMatchObject({
        id: "eng.standup",
        kind: MAILBOX_KIND,
        members: ["eng.lead", "eng.coder"]
      });
      expect(mailboxes["eng.retro"].members).toEqual(["eng.lead"]);
      // `openedAt` is written, not left at the schema's null default — the
      // assertion is on it being a real timestamp, because a `null` here would
      // still satisfy a `toHaveProperty` check.
      expect(Date.parse(mailboxes["eng.standup"].openedAt)).not.toBeNaN();
    } finally {
      await lab.dispose();
    }
  });

  it("puts the rows under the pinned storage keys (BR-16)", async () => {
    const roster = [record("eng.standup", { members: ["eng.lead"] })];
    const lab = await host(roster, { inventory: true });
    try {
      await bind(lab, { mailboxes: roster, seats: [{ id: "eng.lead", kind: "agent", actions: {} }] });

      // Read out of storage rather than through the collection, because what is
      // being pinned is the key an already-persisted org would have to keep.
      expect(await lab.keys()).toEqual([
        "inventory/mailboxes/eng.standup",
        "inventory/members/eng.lead/eng.standup",
        "inventory/seats/eng.lead"
      ]);
      expect(await lab.row("inventory/seats/eng.lead")).toEqual({
        id: "eng.lead",
        kind: "agent",
        door: null,
        hired: null,
        incarnation: null
      });
    } finally {
      await lab.dispose();
    }
  });

  it("writes the membership index from the same read as the mailbox row, so the two agree (BR-17, BR-20)", async () => {
    const roster = [
      record("eng.standup", { members: ["eng.lead", "eng.coder"] }),
      record("eng.retro", { members: ["eng.lead"] }),
      record("eng.allhands", { members: ["eng.leadership"] })
    ];
    const lab = await host(roster, { inventory: true });
    try {
      await bind(lab, {
        mailboxes: roster,
        seats: [...SEATS, { id: "eng.leadership", kind: "agent", actions: {} }]
      });

      const mine = await lab.read({ membershipsOf: "eng.lead" });
      expect(mine.memberships.map((row) => row.mailboxId).sort()).toEqual([
        "eng.retro",
        "eng.standup"
      ]);
      // "eng.leadership" is in the roster precisely so a prefix read without the
      // segment boundary would drag its mailbox in here.
      expect(mine.memberships.map((row) => row.mailboxId)).not.toContain("eng.allhands");

      // The index is a projection, so it must say exactly what the rows say. A
      // check on the index alone would pass against an index written from some
      // other source entirely.
      const all = await lab.read();
      const fromRows = all.mailboxes
        .filter((row) => (row.members as string[]).includes("eng.lead"))
        .map((row) => row.id)
        .sort();
      expect(fromRows).toEqual(mine.memberships.map((row) => row.mailboxId).sort());
    } finally {
      await lab.dispose();
    }
  });
});

describe("what the binder refuses to carry", () => {
  it("writes the members the open mailbox holds, never the ones the roster names (BR-10, BR-10a)", async () => {
    // Opened with one roster, registered from another. Running `openInventory`
    // ALONE is what makes this conclusive: with a whole boot in between,
    // `openMailboxes` would be a second candidate writer of the row's members and
    // a red result would not say which of the two carried them.
    const opened = [record("eng.standup", { members: ["eng.lead", "eng.coder"] })];
    const lab = await host(opened, { inventory: true });
    try {
      const edited = [record("eng.standup", { members: ["ops.oncall", "ops.sre"] })];
      await bind(lab, { mailboxes: edited, seats: [] });

      const rows = await lab.read();
      // The red state is this row holding ["ops.oncall", "ops.sre"] — exactly
      // what a binder that copied the roster's `members:` forward would write.
      expect(rows.mailboxes).toHaveLength(1);
      expect(rows.mailboxes[0].members).toEqual(["eng.lead", "eng.coder"]);

      // And the index follows the row, not the roster, for the same reason.
      expect(await lab.keys()).toEqual([
        "inventory/mailboxes/eng.standup",
        "inventory/members/eng.coder/eng.standup",
        "inventory/members/eng.lead/eng.standup"
      ]);
    } finally {
      await lab.dispose();
    }
  });

  it("refuses a run that names no org, rather than guessing one (BR-4)", async () => {
    // An app that authenticates has a verified org and is expected to pass it.
    // Silently substituting the development default writes that app's whole
    // inventory into a namespace none of its sessions read back, and the only
    // symptom is an inventory that reads empty everywhere — which points at
    // nothing. The refusal names the wiring mistake at boot instead.
    const roster = [record("eng.standup")];
    const lab = await host(roster, { inventory: true });
    try {
      await expect(bind(lab, { mailboxes: roster, orgId: undefined })).rejects.toThrow(/orgId/);
      expect(await lab.keys()).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });

  it("accepts the development default when a caller names it deliberately (D3)", async () => {
    // The refusal above is about an ABSENT org, not about this value. A
    // development app with no resolver binds its sessions to the framework
    // default, and naming it here is how its inventory lands where those
    // sessions read it — so the explicit choice goes through, and still lands
    // in exactly one organization.
    const roster = [record("eng.standup")];
    const lab = await host(roster, { inventory: true });
    try {
      await bind(lab, { mailboxes: roster, orgId: DEFAULT_ORG_ID });

      expect((await lab.keys(DEFAULT_ORG_ID)).length).toBeGreaterThan(0);
      expect(await lab.keys(OTHER_ORG)).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });

  it("refuses seats with no seatWriter, naming what to pass", async () => {
    const lab = await host([], { inventory: true });
    try {
      await expect(
        openInventory(
          { seats: SEATS, mailboxes: [] },
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
      await bind(first, { mailboxes: roster });
      const keys = await first.keys();
      expect(keys).toContain("inventory/mailboxes/eng.retro");
      openedAt = (await first.row("inventory/mailboxes/eng.standup"))!.openedAt as string;

      // Second run, same process, same roster: the red state is rows doubling.
      await bind(first, { mailboxes: roster });
      expect(await first.keys()).toEqual(keys);
    } finally {
      await first.dispose();
    }

    // A second boot over the SAME storage, from a roster that lost a mailbox and
    // a seat. Nothing is reconciled: a binder that dropped what its roster no
    // longer names would take a live mailbox's row with it.
    const shrunk = [record("eng.standup")];
    const second = await host(shrunk, { inventory: true, adapter });
    try {
      const result = await bind(second, {
        mailboxes: shrunk,
        seats: [{ id: "eng.lead", kind: "agent", actions: {} }]
      });
      expect(result.problems).toEqual([]);

      const rows = await second.read();
      expect(rows.mailboxes.map((row) => row.id).sort()).toEqual(["eng.retro", "eng.standup"]);
      expect(rows.seats.map((row) => row.id).sort()).toEqual(["eng.coder", "eng.lead"]);
      // The mailbox that was open before this boot keeps the moment it opened,
      // rather than being restamped by a binder that has no idea when that was.
      expect((await second.row("inventory/mailboxes/eng.standup"))!.openedAt).toBe(openedAt);
    } finally {
      await second.dispose();
    }
  });
});

describe("a mailbox that becomes a project talk template", () => {
  it("is retired from the mailbox inventory at the next boot over the same storage, and discovery stops advertising it", async () => {
    const adapter = inMemoryStores();
    const before = [record("eng.room"), record("eng.standup")];
    const first = await host(before, { inventory: true, adapter });
    try {
      expect((await bind(first, { mailboxes: before })).problems).toEqual([]);
      expect(await first.keys()).toContain("inventory/mailboxes/eng.room");
      expect(await first.discover(before)).toEqual(["eng.room", "eng.standup"]);
    } finally {
      await first.dispose();
    }

    // Restarted over the same storage, with `eng.room` now a project talk template.
    const after = [record("eng.room", { mintFor: "projects" }), record("eng.standup")];
    const second = await host([record("eng.standup")], { inventory: true, adapter });
    try {
      // The reader alone: before this boot's binder runs, the stale row is still stored and not advertised.
      expect(await second.discover(after)).toEqual(["eng.standup"]);

      expect((await bind(second, { mailboxes: after })).problems).toEqual([]);
      // The store: the template's mailbox row and its membership rows are gone; the mailbox's stay.
      const keys = await second.keys();
      expect(keys.filter((key) => key.endsWith("/eng.room"))).toEqual([]);
      expect(keys).toContain("inventory/mailboxes/eng.standup");
      expect(keys).toContain("inventory/members/eng.lead/eng.standup");
      expect(await second.discover(after)).toEqual(["eng.standup"]);
    } finally {
      await second.dispose();
    }
  });
});

describe("a mailbox's session after its MAILBOX.md becomes a template", () => {
  it("refuses post and read at the next boot, though the session survives in the store", async () => {
    const adapter = inMemoryStores();
    const before = [record("eng.room")];
    const first = await host(before, { inventory: true, adapter });
    try {
      expect((await first.act("eng.room", "post", { body: "still a mailbox" })).error).toBeUndefined();
    } finally {
      await first.dispose();
    }

    const projects = defineProjectsCollection();
    try {
      const after = [record("eng.room", { mintFor: "projects", members: [] })];
      const second = await host(after, { inventory: true, adapter, resources: { projects }, open: [] });
      expect((await bind(second, { mailboxes: after, seats: [] })).problems).toEqual([]);
      try {
        const posted = await second.act("eng.room", "post", { body: "no longer a mailbox" });
        expect(String(posted.error)).toMatch(/mailbox-is-a-template/);
        const read = await second.act("eng.room", "read", {});
        expect(String(read.error)).toMatch(/mailbox-is-a-template/);
        // Nor can the surviving session put its mailbox row back.
        const registered = await second.act("eng.room", "registerMailboxInInventory", {});
        expect(String(registered.error)).toMatch(/mailbox-is-a-template/);
        expect((await second.keys()).filter((key) => key.endsWith("/eng.room"))).toEqual([]);
      } finally {
        await second.dispose();
      }
    } finally {
      forgetOrgTalkTemplate(projects);
      forgetTalkTemplate(projects);
    }
  });
});

describe("retiring a template's old mailbox row", () => {
  /** A first boot registers `eng.room` as a mailbox; returns the shared adapter. */
  async function registeredRoom() {
    const adapter = inMemoryStores();
    const before = [record("eng.room"), record("eng.standup")];
    const first = await host(before, { inventory: true, adapter });
    try {
      expect((await bind(first, { mailboxes: before })).problems).toEqual([]);
    } finally {
      await first.dispose();
    }
    return adapter;
  }
  const after = [record("eng.room", { mintFor: "projects" }), record("eng.standup")];

  it("removes a membership row the mailbox row does not list", async () => {
    const adapter = await registeredRoom();
    const second = await host([record("eng.standup")], { inventory: true, adapter });
    try {
      // A membership row an earlier registration left that the mailbox row no longer names.
      await second.runtime.stores.resourceState.set(
        "org",
        ORG_ID,
        "inventory/members/eng.ghost/eng.room",
        { seatId: "eng.ghost", mailboxId: "eng.room" } as never,
        "any"
      );
      expect(await second.keys()).toContain("inventory/members/eng.ghost/eng.room");
      expect((await bind(second, { mailboxes: after })).problems).toEqual([]);
      const keys = await second.keys();
      expect(keys.filter((key) => key.endsWith("/eng.room"))).toEqual([]);
      expect(keys).toContain("inventory/members/eng.lead/eng.standup");
    } finally {
      await second.dispose();
    }
  });

  it("removes the membership rows of an id whose mailbox row is already gone", async () => {
    const adapter = await registeredRoom();
    const second = await host([record("eng.standup")], { inventory: true, adapter });
    try {
      await second.runtime.stores.resourceState.delete("org", ORG_ID, "inventory/mailboxes/eng.room", "any");
      const left = (await second.keys()).filter((key) => key.endsWith("/eng.room"));
      expect(left).toEqual(["inventory/members/eng.coder/eng.room", "inventory/members/eng.lead/eng.room"]);
      expect((await bind(second, { mailboxes: after })).problems).toEqual([]);
      expect((await second.keys()).filter((key) => key.endsWith("/eng.room"))).toEqual([]);
    } finally {
      await second.dispose();
    }
  });

  it("keeps the mailbox row until every membership row is gone, so a failed run is finished by the next", async () => {
    const base = inMemoryStores() as any;
    // One membership delete fails, once.
    let failNext = true;
    let wrapped: any;
    const adapter = {
      capabilities: base.capabilities,
      resolve: async () => {
        if (wrapped !== undefined) return wrapped;
        const registry = await base.resolve();
        const resourceState = new Proxy(registry.resourceState, {
          get(target, key) {
            const value = Reflect.get(target, key);
            if (key !== "delete") return typeof value === "function" ? value.bind(target) : value;
            return async (...args: any[]) => {
              if (failNext && String(args[2]).endsWith("members/eng.coder/eng.room")) {
                failNext = false;
                throw new Error("the membership delete failed");
              }
              return value.apply(target, args);
            };
          }
        });
        wrapped = new Proxy(registry, {
          get: (target, key) => (key === "resourceState" ? resourceState : Reflect.get(target, key))
        });
        return wrapped;
      }
    };
    const before = [record("eng.room")];
    const first = await host(before, { inventory: true, adapter });
    try {
      expect((await bind(first, { mailboxes: before })).problems).toEqual([]);
    } finally {
      await first.dispose();
    }

    const after = [record("eng.room", { mintFor: "projects" })];
    const second = await host([record("eng.other")], { inventory: true, adapter, open: [] });
    try {
      const failed = await bind(second, { mailboxes: after, seats: [] });
      expect(failed.problems).toEqual([expect.stringMatching(/could not be retired .*membership delete failed/)]);
      // The mailbox row, which names the members, outlives the failure.
      expect(await second.keys()).toContain("inventory/mailboxes/eng.room");

      // The next run finishes it: no mailbox row, no membership row.
      expect((await bind(second, { mailboxes: after, seats: [] })).problems).toEqual([]);
      expect((await second.keys()).filter((key) => key.endsWith("/eng.room"))).toEqual([]);
    } finally {
      await second.dispose();
    }
  });
});

describe("an app that never turns the inventory on", () => {
  it("declares nothing and writes nothing, and its mailboxes behave as they did (BR-13)", async () => {
    const roster = [record("eng.standup")];

    // The control and the case are the same roster and the same code, one flag
    // apart. Without it, there is no action to run, so the binder reports the
    // mailbox by name and no row exists anywhere.
    const off = await host(roster);
    try {
      const result = await bind(off, { mailboxes: roster });
      expect(result.mailboxes).toBe(0);
      expect(result.problems).toHaveLength(2);
      expect(result.problems.join("\n")).toContain("eng.standup");
      expect(await off.keys()).toEqual([]);

      // And the mailbox is otherwise exactly a mailbox: a post lands, a read
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
      const result = await bind(on, { mailboxes: roster });
      expect(result.problems).toEqual([]);
      expect(await on.keys()).not.toEqual([]);
    } finally {
      await on.dispose();
    }
  });
});

describe("a custom mailbox kind", () => {
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
      const result = await bind(lab, { mailboxes: roster });

      const rows = await lab.read();
      const byId = Object.fromEntries(rows.mailboxes.map((row) => [row.id, row]));

      // The built-in and the hand-rolled kind are both there, each carrying the
      // kind that minted it. A write behind a `kind === "mailbox"` test would
      // leave `eng.brief` out while every other assertion here still passed.
      expect(byId["eng.standup"].kind).toBe(MAILBOX_KIND);
      expect(byId["eng.brief"]).toMatchObject({
        id: "eng.brief",
        kind: BRIEFING_KIND,
        members: ["eng.lead"]
      });

      // The kind that carries no registration is a NAMED failure, not a silent
      // gap — and the two that could register still did.
      expect(byId["eng.quiet"]).toBeUndefined();
      expect(result.mailboxes).toBe(2);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("eng.quiet");
      expect(result.problems[0]).toContain("could not register");
    } finally {
      await lab.dispose();
    }
  });
});

describe("a mailbox nobody opened", () => {
  it("is named rather than registered, and the open ones still are (BR-12)", async () => {
    const roster = [record("eng.standup"), record("eng.ghost")];
    // Opened without `eng.ghost`, so its session has no mailbox in it.
    const lab = await host(roster, { inventory: true, open: [record("eng.standup")] });
    try {
      const result = await bind(lab, { mailboxes: roster });

      expect(result.mailboxes).toBe(1);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("eng.ghost");
      expect(result.problems[0]).toContain("not an open mailbox");

      const rows = await lab.read();
      expect(rows.mailboxes.map((row) => row.id)).toEqual(["eng.standup"]);
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
      const refused = await lab.act("eng.standup", INVENTORY_REGISTER_MAILBOX, {
        members: ["ops.intruder"]
      });
      // The schema is closed, so a caller cannot even name the field. This is
      // the fence: there is no shape of input through which somebody else's
      // membership could be published under this mailbox's id.
      expect(refused.error).toBeDefined();
      expect(await lab.keys()).toEqual([]);

      const accepted = await lab.act("eng.standup", INVENTORY_REGISTER_MAILBOX, {});
      expect(accepted.error).toBeUndefined();
      expect((await lab.row("inventory/mailboxes/eng.standup"))!.members).toEqual([
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
      const first = await lab.act("eng.standup", INVENTORY_REGISTER_MAILBOX, {});
      expect(first.error).toBeDefined();
      // A mailbox row with no matching membership row would disagree with the
      // index for as long as the process runs, since nothing here retries or
      // prunes. So a permanently-failing member must leave nothing behind,
      // not a mailbox row committed ahead of the membership it names.
      expect(await lab.keys()).toEqual([]);

      const second = await lab.act("eng.standup", INVENTORY_REGISTER_MAILBOX, {});
      expect(second.error).toBeDefined();
      expect(await lab.keys()).toEqual([]);
    } finally {
      await lab.dispose();
    }
  });

  it("registerSeatsInInventory cannot be reached through the public door", async () => {
    const roster = [record("eng.standup")];
    const lab = await host(roster, { inventory: true, open: roster });
    try {
      // `lab.act` dispatches exactly the way a caller-addressed HTTP/MCP
      // request would — no `source`, which resolves as `"http"` (public).
      // Unlike `registerMailbox`, this action's whole input is the row data,
      // so a public hit on it would let a caller write any seat it chose.
      const attempt = await lab.act(INVENTORY_SEAT_WRITER_SESSION, INVENTORY_REGISTER_SEATS, {
        seats: [{ id: "attacker.fake", kind: "agent", actions: {} }]
      });
      expect(attempt.error).toBeDefined();
      expect(String((attempt.error as Error).message)).toContain(
        `does not define action "${INVENTORY_REGISTER_SEATS}"`
      );
      expect(await lab.row("inventory/seats/attacker.fake")).toBeUndefined();
    } finally {
      await lab.dispose();
    }
  });
});
