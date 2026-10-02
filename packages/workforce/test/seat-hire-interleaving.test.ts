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
import { incarnationOf } from "../src/roster/incarnation";
import { toHiredSeatRow } from "../src/roster/rows";
import { workerConfigSchema } from "../src/worker-config";

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
  actions: { run: { inputSchema: z.object({}), block: noop } },
});

type Op = { action: "hire" | "fire" | "rehire"; input: Record<string, unknown>; label: string };
type Outcome = { label: string; error?: string };

/** One app, one store, a live registry, and a store wrapper that can stop the primary. */
async function world() {
  const held = new Map<string, FlowInstance>();
  const blocks = createSeatHireBlocks({
    kinds: { desk },
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
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    actions: { hire: { block: blocks.hire }, fire: { block: blocks.fire }, rehire: { block: blocks.rehire } },
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
      flow: ops,
      actionName: op.action,
      input: op.input,
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
    calls = 0;
    primaryRunning = true;
    const own = await run(primary).finally(() => {
      primaryRunning = false;
    });
    for (const rest of due.splice(0)) await rest.run();
    return { outcomes: [own, ...outcomes], calls };
  };

  const rows = async (prefix: string) =>
    Object.fromEntries(
      Object.entries(await stores.resourceState.getByPrefix("org", "acme", prefix)).map(([key, value]) => [
        key.slice(prefix.length),
        (value as { state: Record<string, unknown> }).state,
      ]),
    );
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
async function expectConsistent(w: World, seatId: string, untouched: Record<string, Record<string, unknown>>, story: string) {
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
  seatId: string
) {
  const dry = await world();
  await setup(dry);
  const { calls } = await dry.interleave(primary, [], []);
  expect(calls).toBeGreaterThan(0);
  const runs = placements(competitors.length, calls);
  for (const stops of runs) {
    const w = await world();
    const untouched = await setup(w);
    const { outcomes } = await w.interleave(primary, competitors, stops);
    const story = `${scenario}, stops ${JSON.stringify(stops)}: ${outcomes.map((o) => `${o.label} ${o.error === undefined ? "ok" : `refused (${o.error.slice(0, 60)})`}`).join("; ")}`;
    await expectConsistent(w, seatId, untouched, story);
  }
  return runs.length;
}

const hireAda = (queue: string, label: string): Op => ({ action: "hire", input: { seatId: "support.ada", flow: "desk", settings: { queue } }, label });
const fireAda: Op = { action: "fire", input: { seatId: "support.ada" }, label: "fire" };

describe("hire, fire and rehire interleaved at every store call", () => {
  it("a hire, with a fire and then a replacement hire landing at any two of its store calls", async () => {
    const runs = await everyInterleaving("hire | fire, replacement hire", async () => ({}), hireAda("first", "hire"), [fireAda, hireAda("second", "replacement")], "support.ada");
    expect(runs).toBeGreaterThan(10);
  }, 120_000);

  it("a fire, with a replacement hire landing at any of its store calls", async () => {
    const runs = await everyInterleaving(
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
  }, 120_000);

  it("a re-hire of a seat whose kind was cut, with a fire and then a replacement hire landing at any two of its store calls", async () => {
    const runs = await everyInterleaving(
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
  }, 120_000);

  it("fire of a row from before incarnations, with a declared seat's row at the same address: the declared row is never touched", async () => {
    // A team named like the organization declares `acme.support.ada`; a
    // roster row from before incarnations names the same address.
    const declared = { id: "acme.support.ada", kind: "desk", door: "run", hired: false, incarnation: null };
    const runs = await everyInterleaving(
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
    // And on its own: fire removes the roster row and leaves the declared row.
    const w = await world();
    await w.seed(`${ROSTER}support.ada`, toHiredSeatRow({ seatId: "support.ada", flow: "desk", settings: { queue: "q" }, owningOrgId: "acme" }) as never);
    await w.seed(`${SEATS}acme.support.ada`, declared);
    expect((await w.run(fireAda)).error).toBeUndefined();
    expect(await w.rows(ROSTER)).toEqual({});
    expect((await w.rows(SEATS))["acme.support.ada"]).toEqual(declared);
  }, 120_000);
});
