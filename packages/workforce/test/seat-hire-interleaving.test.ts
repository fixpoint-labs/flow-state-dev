/**
 * Hire, fire and rehire, interleaved at every store call.
 *
 * One operation (the primary) runs while a store wrapper stops it before each
 * of its store calls in turn; at the chosen stops a competing operation (a
 * fire, a replacement hire) runs to completion, then the primary carries on.
 * Every combination of stops is run. Whatever the order, the end state has to
 * agree with itself: the roster row, the seat registered at the address and
 * the seat's inventory row all carry the same incarnation, or are absent, and
 * a declared seat's row is never touched.
 *
 * One state is allowed by name, because no read the engine offers a block
 * can rule it out: a fire whose two collection snapshots were taken on either
 * side of a hire's publish deletes that hire's roster row and seat but can't
 * see its inventory row. What is left is an inventory row whose roster row is
 * gone and whose seat isn't registered. That is accepted only if the team list
 * leaves it out and the next fire of the seat removes it; anything else fails.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, FlowIdentityConflictError, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createSeatHireBlocks, HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } from "../src/seat-hire-blocks";
import type { SeatHireCapabilityOptions } from "../src/seat-hire-blocks";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { defineSeatInventoryCollection } from "../src/inventory/collections";
import { INVENTORY_REGISTER_SEATS, inventoryWriterActions } from "../src/mailbox/mailbox-flow";
import { incarnationOf } from "../src/roster/incarnation";
import { listedSeatRows } from "../src/inventory/listed-seats";
import { toHiredSeatRow } from "../src/roster/rows";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";

const ROSTER = "workforce/roster/";
const SEATS = "inventory/seats/";

const noop = handler({
  name: "noop",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: () => ({}),
});

const desk = defineFlow({
  kind: "desk",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ queue: z.string() }),
  actions: { ...workerDoor, run: { inputSchema: z.object({}), block: noop } },
});

type Rows = (prefix: string) => Promise<Record<string, Record<string, unknown>>>;
/**
 * `input` may be read from the world just before the operation runs (a boot
 * carries the roster as it read it), and never during an interleaving.
 */
type Op = {
  action: "hire" | "fire" | "rehire" | "boot";
  input: Record<string, unknown> | ((rows: Rows) => Promise<Record<string, unknown>>);
  label: string;
};
type Outcome = { label: string; error?: string };

/**
 * One app, one store, a live registry, and a store wrapper that can stop the
 * primary. `lazyInventory` loads the seat inventory on first read instead of
 * at action start, so a read of it is a store call a competitor can precede.
 */
async function world(options: { lazyInventory?: boolean } = {}) {
  const held = new Map<string, FlowInstance>();
  const blocks = createSeatHireBlocks({
    workerFlows: { desk },
    register: (seat: FlowInstance) => {
      const existing = held.get(seat.id);
      if (existing !== undefined) {
        throw new FlowIdentityConflictError({ reason: "duplicate-id", kind: seat.kind, id: seat.id, existingKind: existing.kind });
      }
      held.set(seat.id, seat);
    },
    unregister: (id: string) => held.delete(id),
    kindAt: (id: string) => held.get(id)?.kind,
    instanceAt: (id: string) => held.get(id),
  } as SeatHireCapabilityOptions);
  const ops = defineFlow({
    kind: "ops",
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: options.lazyInventory
        ? { ...defineSeatInventoryCollection(), prefetchMode: "lazy" }
        : defineSeatInventoryCollection(),
    },
    actions: {
      hire: { block: blocks.hire },
      fire: { block: blocks.fire },
      rehire: { block: blocks.rehire },
    },
  } as never)();
  // The inventory write `openInventory` runs at boot, with the seats the boot
  // read, on the mailbox kind that carries it.
  const booter = defineFlow({
    kind: "booter",
    actions: { boot: inventoryWriterActions("booter")[INVENTORY_REGISTER_SEATS] },
  } as never)();
  const state = createFlowState({ flows: { ops: ops as never }, stores: { default: { primary: inMemoryStores() } } });
  const runtime = await state.getRuntime();
  const stores = runtime.stores;

  // The stop: before each store call the primary makes, run whatever is due.
  let primaryRunning = false;
  let inCompetitor = false;
  let calls = 0;
  let due: Array<{ at: number; run: () => Promise<void> }> = [];
  const store = stores.resourceState as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of ["get", "set", "delete", "getAll", "getByPrefix"]) {
    const real = store[name]!.bind(store);
    store[name] = async (...args: unknown[]) => {
      if (primaryRunning && !inCompetitor) {
        while (due.length > 0 && due[0]!.at <= calls) {
          const next = due.shift()!;
          inCompetitor = true;
          try {
            await next.run();
          } finally {
            inCompetitor = false;
          }
        }
        calls += 1;
      }
      return real(...args);
    };
  }

  let n = 0;
  const run = async (op: Op): Promise<Outcome> => {
    n += 1;
    const result = (await runAction({
      flow: op.action === "boot" ? booter : ops,
      actionName: op.action,
      input: typeof op.input === "function" ? await op.input(rows) : op.input,
      userId: "u1",
      orgId: "acme",
      sessionId: `s-${n}`,
      stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { error?: { message: string } };
    return { label: op.label, error: result.error?.message };
  };

  /**
   * Run `primary`, running `competitors[i]` before the primary's store call
   * number `stops[i]` (a stop past its last call runs after it finishes).
   * Returns every outcome and how many store calls the primary made.
   */
  const interleave = async (primary: Op, competitors: Op[], stops: number[]) => {
    const outcomes: Outcome[] = [];
    due = competitors.map((op, i) => ({ at: stops[i]!, run: async () => void outcomes.push(await run(op)) }));
    const resolved: Op = typeof primary.input === "function" ? { ...primary, input: await primary.input(rows) } : primary;
    calls = 0;
    primaryRunning = true;
    const own = await run(resolved).finally(() => {
      primaryRunning = false;
    });
    for (const rest of due.splice(0)) await rest.run();
    return { outcomes: [own, ...outcomes], calls };
  };

  async function rows(prefix: string): Promise<Record<string, Record<string, unknown>>> {
    return Object.fromEntries(
      Object.entries(await stores.resourceState.getByPrefix("org", "acme", prefix)).map(([key, value]) => [
        key.slice(prefix.length),
        (value as { state: Record<string, unknown> }).state,
      ]),
    );
  }
  const seed = (key: string, value: Record<string, unknown>) =>
    stores.resourceState.set("org", "acme", key, value as never, "any" as never);

  return { held, run, interleave, rows, seed };
}

type World = Awaited<ReturnType<typeof world>>;

/**
 * The end state agrees with itself at `seatId`'s address: a registered seat
 * was minted from the roster row there, a hired inventory row carries that
 * row's incarnation, a roster row with an incarnation is served and listed,
 * and `untouched` rows are exactly as seeded.
 */
async function expectConsistent(
  w: World,
  seatId: string,
  untouched: Record<string, Record<string, unknown>>,
  story: string
): Promise<boolean> {
  const address = `acme.${seatId}`;
  const roster = (await w.rows(ROSTER))[seatId];
  const inventory = (await w.rows(SEATS))[address];
  const live = w.held.get(address);
  const rowIncarnation = (roster?.incarnation ?? null) as string | null;
  const facts = JSON.stringify({ roster, inventory, live: live === undefined ? null : { kind: live.kind, incarnation: incarnationOf(live) } });

  if (live !== undefined) {
    expect(roster, `${story}: a seat is registered with no roster row — ${facts}`).toBeDefined();
    expect(incarnationOf(live), `${story}: the registered seat is another incarnation's — ${facts}`).toBe(rowIncarnation);
  }
  if (inventory !== undefined && typeof inventory.incarnation === "string" && roster === undefined && live === undefined) {
    // The named window: hidden from the team list, and the next fire removes it.
    expect(listedSeatRows("acme", [inventory as { id: string; hired: boolean }], []), `${story}: a stale row is listed — ${facts}`).toEqual([]);
    expect((await w.run({ action: "fire", input: { seatId }, label: "next fire" })).error, `${story}: the next fire failed — ${facts}`).toBeUndefined();
    expect((await w.rows(SEATS))[address], `${story}: the next fire left the stale row — ${facts}`).toBeUndefined();
    return true;
  }
  if (inventory !== undefined && typeof inventory.incarnation === "string") {
    expect(rowIncarnation, `${story}: the inventory row is another incarnation's — ${facts}`).toBe(inventory.incarnation);
  }
  if (rowIncarnation !== null) {
    expect(live, `${story}: a roster row's seat isn't registered — ${facts}`).toBeDefined();
    expect(inventory?.incarnation, `${story}: a roster row's seat has no inventory row — ${facts}`).toBe(rowIncarnation);
  }
  for (const [key, value] of Object.entries(untouched)) {
    const now = key.startsWith(SEATS) ? (await w.rows(SEATS))[key.slice(SEATS.length)] : (await w.rows(ROSTER))[key.slice(ROSTER.length)];
    if (now !== undefined) expect(now, `${story}: ${key} was written over — ${facts}`).toEqual(value);
  }
  return false;
}

/** Every way to place `count` competitors, in order, before the primary's calls 0..calls. */
function placements(count: number, calls: number): number[][] {
  if (count === 0) return [[]];
  const out: number[][] = [];
  const place = (from: number, left: number, acc: number[]) => {
    if (left === 0) return void out.push(acc);
    for (let at = from; at <= calls; at += 1) place(at, left - 1, [...acc, at]);
  };
  place(0, count, []);
  return out;
}

/**
 * Run one scenario at every placement of its competitors and check each end
 * state. `setup` seeds a fresh world; the primary's call count comes from a
 * run with no competitors.
 */
async function everyInterleaving(
  scenario: string,
  setup: (w: World) => Promise<Record<string, Record<string, unknown>>>,
  primary: Op,
  competitors: Op[],
  seatId: string,
  options: { lazyInventory?: boolean } = {}
) {
  const dry = await world(options);
  await setup(dry);
  const { calls } = await dry.interleave(primary, [], []);
  expect(calls).toBeGreaterThan(0);
  const runs = placements(competitors.length, calls);
  const windows: string[] = [];
  for (const stops of runs) {
    const w = await world(options);
    const untouched = await setup(w);
    const { outcomes } = await w.interleave(primary, competitors, stops);
    const story = `${scenario}, stops ${JSON.stringify(stops)}: ${outcomes.map((o) => `${o.label} ${o.error === undefined ? "ok" : `refused (${o.error.slice(0, 60)})`}`).join("; ")}`;
    if (await expectConsistent(w, seatId, untouched, story)) windows.push(story);
  }
  return { runs: runs.length, windows };
}

const hireAda = (queue: string, label: string): Op => ({ action: "hire", input: { seatId: "support.ada", flow: "desk", settings: { queue } }, label });
const fireAda: Op = { action: "fire", input: { seatId: "support.ada" }, label: "fire" };

describe("hire, fire and rehire interleaved at every store call", () => {
  it("a hire, with a fire and then a replacement hire landing at any two of its store calls", async () => {
    const { runs, windows } = await everyInterleaving("hire | fire, replacement hire", async () => ({}), hireAda("first", "hire"), [fireAda, hireAda("second", "replacement")], "support.ada");
    expect(runs).toBeGreaterThan(10);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
  }, 120_000);

  it("a fire, with a replacement hire landing at any of its store calls", async () => {
    const { runs, windows } = await everyInterleaving(
      "fire | replacement hire",
      async (w) => {
        expect((await w.run(hireAda("first", "setup"))).error).toBeUndefined();
        return {};
      },
      fireAda,
      [hireAda("second", "replacement")],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(3);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
  }, 120_000);

  it("a re-hire of a seat whose kind was cut, with a fire and then a replacement hire landing at any two of its store calls", async () => {
    const { runs, windows } = await everyInterleaving(
      "rehire | fire, replacement hire",
      async (w) => {
        await w.seed(`${ROSTER}support.joe`, toHiredSeatRow({ seatId: "support.joe", flow: "desk-clerk", owningOrgId: "acme" }) as never);
        await w.seed(`${SEATS}acme.support.joe`, { id: "acme.support.joe", kind: "desk-clerk", door: "run", hired: true, incarnation: null });
        return {};
      },
      { action: "rehire", input: { seatId: "support.joe", flow: "desk", settings: { queue: "q" } }, label: "rehire" },
      [
        { action: "fire", input: { seatId: "support.joe" }, label: "fire" },
        { action: "hire", input: { seatId: "support.joe", flow: "desk", settings: { queue: "second" } }, label: "replacement" },
      ],
      "support.joe"
    );
    expect(runs).toBeGreaterThan(10);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
  }, 120_000);

  it("a fire's retry with no roster row left (only its leftover inventory row), with a replacement hire landing at any of its store calls", async () => {
    // What a fire that stopped between its two deletes leaves: no roster row,
    // nothing registered, and the old hire's inventory row.
    const { runs, windows } = await everyInterleaving(
      "fire retry | replacement hire",
      async (w) => {
        await w.seed(`${SEATS}acme.support.ada`, { id: "acme.support.ada", kind: "desk", door: "run", hired: true, incarnation: "i-fired" });
        return {};
      },
      fireAda,
      [hireAda("second", "replacement")],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(2);
    // The leftover path itself never reaches the named window; only the
    // placement where the replacement finishes before fire reads anything,
    // so fire takes the roster path, can.
    expect(windows.every((story) => story.includes("stops [0]"))).toBe(true);
  }, 120_000);

  it("the same, with the inventory read when fire first asks for it rather than at action start", async () => {
    // The read is then a store call after fire saw no roster row, so a
    // replacement hire can finish in between and its row be the one read.
    const { runs, windows } = await everyInterleaving(
      "fire retry (lazy inventory) | replacement hire",
      async (w) => {
        await w.seed(`${SEATS}acme.support.ada`, { id: "acme.support.ada", kind: "desk", door: "run", hired: true, incarnation: "i-fired" });
        return {};
      },
      fireAda,
      [hireAda("second", "replacement")],
      "support.ada",
      { lazyInventory: true }
    );
    expect(runs).toBeGreaterThan(2);
    expect(windows.every((story) => story.includes("stops [0]"))).toBe(true);
  }, 120_000);

  it("fire of a row from before incarnations, with a declared seat's row at the same address: the declared row is never touched", async () => {
    // A team named like the organization declares `acme.support.ada`; a
    // roster row from before incarnations names the same address.
    const declared = { id: "acme.support.ada", kind: "desk", door: "run", hired: false, incarnation: null };
    const { runs, windows } = await everyInterleaving(
      "fire (legacy row) | replacement hire",
      async (w) => {
        await w.seed(`${ROSTER}support.ada`, toHiredSeatRow({ seatId: "support.ada", flow: "desk", settings: { queue: "q" }, owningOrgId: "acme" }) as never);
        await w.seed(`${SEATS}acme.support.ada`, declared);
        return { [`${SEATS}acme.support.ada`]: declared };
      },
      fireAda,
      [hireAda("second", "replacement")],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(3);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
    // And on its own: fire removes the roster row and leaves the declared row.
    const w = await world();
    await w.seed(`${ROSTER}support.ada`, toHiredSeatRow({ seatId: "support.ada", flow: "desk", settings: { queue: "q" }, owningOrgId: "acme" }) as never);
    await w.seed(`${SEATS}acme.support.ada`, declared);
    expect((await w.run(fireAda)).error).toBeUndefined();
    expect(await w.rows(ROSTER)).toEqual({});
    expect((await w.rows(SEATS))["acme.support.ada"]).toEqual(declared);
  }, 120_000);

  it("a boot carrying the roster it read before a fire and a replacement hire, with those landing at any two of its store calls", async () => {
    // Another process booted and read the roster while the first hire was
    // current; the fire and the replacement hire land around its inventory
    // write. The replacement's row must survive the boot's stale one.
    const { runs, windows } = await everyInterleaving(
      "boot (stale roster) | fire, replacement hire",
      async (w) => {
        expect((await w.run(hireAda("first", "setup"))).error).toBeUndefined();
        return {};
      },
      {
        action: "boot",
        input: async (rows) => ({
          seats: [{ id: "acme.support.ada", kind: "desk", door: "run", hired: true, incarnation: (await rows(ROSTER))["support.ada"]!.incarnation }],
        }),
        label: "boot",
      },
      [fireAda, hireAda("second", "replacement")],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(2);
    // The named window is never reached here: a row the fire removed after
    // the boot read it is not written back.
    expect(windows).toEqual([]);
  }, 120_000);

  it("a boot carrying a declared seat at an address, with a runtime hire of that address landing at any of its store calls", async () => {
    // A rolling deploy: the old process read a declaration the new one has
    // dropped, and the new one hired the same address. The boot's declared
    // row must not replace the hire's.
    const { runs, windows } = await everyInterleaving(
      "boot (stale declared row) | hire",
      async () => ({}),
      {
        action: "boot",
        input: { seats: [{ id: "acme.support.ada", kind: "desk", door: "run", hired: false, incarnation: null }] },
        label: "boot",
      },
      [hireAda("first", "hire")],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(1);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
  }, 120_000);

  it("a hire, with a boot carrying a stale declared seat at its address landing at any of its store calls", async () => {
    // The other side of the same race: the boot read no row and creates its
    // declared one while the hire is between its checks and its publish. The
    // hire can't write over a declared row, so it has to take back what it
    // did, not stay serving with no row of its own.
    const declared = { id: "acme.support.ada", kind: "desk", door: "run", hired: false, incarnation: null };
    const { runs, windows } = await everyInterleaving(
      "hire | boot (stale declared row)",
      async () => ({}),
      hireAda("first", "hire"),
      [{ action: "boot", input: { seats: [declared] }, label: "boot" }],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(2);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
  }, 120_000);

  it("a re-hire, with a boot carrying a stale declared seat at its address landing at any of its store calls", async () => {
    // The seat's old inventory row is gone (a pre-field fire left none), so
    // the boot reads no row and creates its declared one mid re-hire.
    const declared = { id: "acme.support.joe", kind: "desk", door: "run", hired: false, incarnation: null };
    const legacy = toHiredSeatRow({ seatId: "support.joe", flow: "desk-clerk", owningOrgId: "acme" });
    const { runs, windows } = await everyInterleaving(
      "rehire | boot (stale declared row)",
      async (w) => {
        await w.seed(`${ROSTER}support.joe`, legacy as never);
        return {};
      },
      { action: "rehire", input: { seatId: "support.joe", flow: "desk", settings: { queue: "q" } }, label: "rehire" },
      [{ action: "boot", input: { seats: [declared] }, label: "boot" }],
      "support.joe"
    );
    expect(runs).toBeGreaterThan(2);
    // The named window is never reached here: every end state is fully consistent.
    expect(windows).toEqual([]);
  }, 120_000);
});

/**
 * Two crashes in a row leave a hired seat's address with an inventory row
 * from a hire the roster no longer has: a fire of A stopped after deleting
 * A's roster row and before deleting A's inventory row, then the replacement
 * hire B stopped after writing its roster row and before publishing its
 * inventory row. Every boot after that reloads B. Its row has to land, or B
 * is never listed (the team list wants the roster's incarnation on the
 * inventory row) however many times the app restarts.
 */
describe("a boot over the row a fire left behind", () => {
  const staleA = { id: "acme.support.ada", kind: "desk", door: "run", hired: true, incarnation: "i-A" };
  const rosterRow = (incarnation: string) =>
    toHiredSeatRow({ seatId: "support.ada", flow: "desk", settings: { queue: "q" }, owningOrgId: "acme", incarnation });
  const boot = (incarnation: string, label = "boot"): Op => ({
    action: "boot",
    input: { seats: [{ id: "acme.support.ada", kind: "desk", door: "run", hired: true, incarnation }] },
    label,
  });

  it("replaces it with the hire the roster holds, so that hire is listed", async () => {
    const w = await world();
    await w.seed(`${ROSTER}support.ada`, rosterRow("i-B") as never);
    await w.seed(`${SEATS}acme.support.ada`, staleA);

    for (const label of ["first boot", "second boot"]) {
      expect((await w.run(boot("i-B", label))).error).toBeUndefined();
      const row = (await w.rows(SEATS))["acme.support.ada"];
      expect(row, label).toMatchObject({ hired: true, incarnation: "i-B" });
      expect(
        listedSeatRows("acme", [row as { id: string; hired: boolean; incarnation: string }], [{ seatId: "support.ada", incarnation: "i-B" }]),
        label
      ).toHaveLength(1);
    }
  });

  it("leaves it to a later hire: a boot carrying a hire the roster no longer holds writes nothing", async () => {
    // The roster has moved on to C, which has not published yet. A boot that
    // read B before that must not put B's row there.
    const w = await world();
    await w.seed(`${ROSTER}support.ada`, rosterRow("i-C") as never);
    await w.seed(`${SEATS}acme.support.ada`, staleA);

    expect((await w.run(boot("i-B"))).error).toBeUndefined();
    expect((await w.rows(SEATS))["acme.support.ada"]).toEqual(staleA);
  });

  it("never replaces a newer hire's published row", async () => {
    const w = await world();
    const published = { ...staleA, incarnation: "i-C" };
    await w.seed(`${ROSTER}support.ada`, rosterRow("i-C") as never);
    await w.seed(`${SEATS}acme.support.ada`, published);

    expect((await w.run(boot("i-B"))).error).toBeUndefined();
    expect((await w.rows(SEATS))["acme.support.ada"]).toEqual(published);
  });

  it("with a fire and a replacement hire landing at any two of its store calls", async () => {
    const { runs, windows } = await everyInterleaving(
      "boot (roster's hire, stale row) | fire, replacement hire",
      async (w) => {
        expect((await w.run(hireAda("first", "setup"))).error).toBeUndefined();
        // Then the two crashes: the first hire's inventory row is replaced by
        // a fired hire's leftover, which is what the boot finds.
        await w.seed(`${SEATS}acme.support.ada`, staleA);
        return {};
      },
      {
        action: "boot",
        input: async (rows) => ({
          seats: [{ id: "acme.support.ada", kind: "desk", door: "run", hired: true, incarnation: (await rows(ROSTER))["support.ada"]!.incarnation }],
        }),
        label: "boot",
      },
      [fireAda, hireAda("second", "replacement")],
      "support.ada"
    );
    expect(runs).toBeGreaterThan(2);
    expect(windows).toEqual([]);
  }, 120_000);
});

