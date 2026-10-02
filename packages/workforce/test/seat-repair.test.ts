/**
 * Repairing a stored seat that no longer starts: `brokenSeats`, retire through
 * `fire`, and `rehire`, run as actions over a real runtime and graded on what
 * the store holds afterwards, not on what a block returned.
 *
 * The app under test carried `desk-clerk` when its seats were hired and has
 * since cut it; `desk` is still carried, and its settings now require a
 * `queue`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, FlowIdentityConflictError, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  createSeatHireBlocks,
  HIRED_ROSTER_PRIVATE_RESOURCE,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
} from "../src/seat-hire-blocks";
import type { SeatHireCapabilityOptions } from "../src/seat-hire-blocks";
import { defineHiredRosterCollection, defineHiredRosterPrivateCollection } from "../src/roster/collections";
import { defineSeatInventoryCollection } from "../src/inventory/collections";
import { reloadHiredSeats } from "../src/roster/reload";
import { encodeUserSegment, toHiredSeatRow } from "../src/roster/rows";
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

/** The kinds the app carries now. `desk-clerk` is gone. */
const kinds = { desk };

function liveRegistry() {
  const held = new Map<string, FlowInstance>();
  return {
    held,
    // Refuses a taken address the way the engine's registry does.
    register: (seat: FlowInstance) => {
      const existing = held.get(seat.id);
      if (existing !== undefined) {
        throw new FlowIdentityConflictError({ reason: "duplicate-id", kind: seat.kind, id: seat.id, existingKind: existing.kind });
      }
      held.set(seat.id, seat);
    },
    unregister: (id: string) => held.delete(id),
    kindAt: (id: string) => held.get(id)?.kind,
  };
}

async function harness(over: Partial<SeatHireCapabilityOptions> = {}, mount: { userOwned?: boolean } = {}) {
  const live = liveRegistry();
  const blocks = createSeatHireBlocks({
    kinds,
    register: live.register,
    unregister: live.unregister,
    kindAt: live.kindAt,
    ...over,
  });
  const ops = defineFlow({
    kind: "ops",
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
      ...(mount.userOwned ? { [HIRED_ROSTER_PRIVATE_RESOURCE]: defineHiredRosterPrivateCollection() } : {}),
    },
    actions: {
      hire: { block: blocks.hire },
      fire: { block: blocks.fire },
      brokenSeats: { block: blocks.brokenSeats },
      rehire: { block: blocks.rehire },
    },
  } as never)();
  const state = createFlowState({ flows: { ops: ops as never }, stores: { default: { primary: inMemoryStores() } } });
  const runtime = await state.getRuntime();
  const stores = runtime.stores;
  let n = 0;

  const run = async (action: string, input: unknown, orgId = "acme", userId = "u1") => {
    n += 1;
    const result = (await runAction({
      flow: ops,
      actionName: action,
      input,
      userId,
      orgId,
      sessionId: `s-${n}`,
      stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: any; error?: { message: string } };
    return result;
  };

  const seed = async (key: string, state: Record<string, unknown>, orgId = "acme") => {
    await stores.resourceState.set("org", orgId, `${ROSTER}${key}`, state as never, "any" as never);
  };
  /** `hired` as the row says it; omitted, the row predates the field. */
  const seedInventory = async (address: string, kind: string, orgId = "acme", hired?: boolean) => {
    const state = { id: address, kind, door: "run", ...(hired === undefined ? {} : { hired }) };
    await stores.resourceState.set("org", orgId, `${SEATS}${address}`, state as never, "any" as never);
  };
  const rows = async (prefix: string, orgId = "acme") =>
    Object.fromEntries(
      Object.entries(await stores.resourceState.getByPrefix("org", orgId, prefix)).map(([key, value]) => [
        key.slice(prefix.length),
        (value as { state: Record<string, unknown> }).state,
      ]),
    );
  const versions = async (prefix: string, orgId = "acme") =>
    Object.fromEntries(
      Object.entries(await stores.resourceState.getByPrefix("org", orgId, prefix)).map(([key, value]) => [
        key,
        (value as { version: number }).version,
      ]),
    );
  const reload = (orgIds = ["acme"]) => reloadHiredSeats({ stores, orgIds, kinds });

  /** Every org row as it stands: what a process that died now leaves on disk. */
  const snapshot = async (orgId = "acme") =>
    Object.fromEntries(
      Object.entries(await stores.resourceState.getByPrefix("org", orgId, "")).map(([key, value]) => [
        key,
        (value as { state: Record<string, unknown> }).state,
      ]),
    );
  /** Load a dead process's rows, then boot: register every seat the start serves. */
  const restartFrom = async (rows: Record<string, Record<string, unknown>>, orgId = "acme") => {
    for (const [key, state] of Object.entries(rows)) {
      await stores.resourceState.set("org", orgId, key, state as never, "any" as never);
    }
    const started = await reload([orgId]);
    for (const seat of started.seats) live.register(seat);
    return started;
  };
  /** Make the next write of a seat inventory row reject, as a store that is briefly down would. */
  const failNextInventoryWrite = () => {
    const set = stores.resourceState.set.bind(stores.resourceState);
    const spy = vi.spyOn(stores.resourceState, "set").mockImplementation(async (...args) => {
      if (String(args[2]).startsWith(SEATS)) {
        spy.mockRestore();
        throw new Error("the store is unavailable");
      }
      return set(...args);
    });
  };

  return { live, run, seed, seedInventory, rows, versions, reload, snapshot, restartFrom, failNextInventoryWrite, stores };
}

afterEach(() => vi.restoreAllMocks());

const row = (over: Parameters<typeof toHiredSeatRow>[0]) =>
  toHiredSeatRow({ owningOrgId: "acme", ...over }) as unknown as Record<string, unknown>;

/** Three stored seats after `desk-clerk` was cut, one healthy, and their inventory rows. */
async function cutKindStore(h: Awaited<ReturnType<typeof harness>>) {
  await h.seed("support.joe", row({ seatId: "support.joe", flow: "desk-clerk", instructions: "Answer the desk." }));
  await h.seed("support.lin", row({ seatId: "support.lin", flow: "desk" }));
  await h.seed("support.ada", row({ seatId: "support.ada", flow: "desk", settings: { queue: "billing" } }));
  await h.seed("support.bad", { seatId: "support.bad" });
  for (const [seatId, kind] of [["support.joe", "desk-clerk"], ["support.lin", "desk"], ["support.ada", "desk"]] as const) {
    await h.seedInventory(`acme.${seatId}`, kind);
  }
}

/**
 * Re-hire `support.joe` in a process that dies right after the roster write
 * (registration throws), and return the store as that process left it:
 * captured after the write and before the write-back a dead process never runs.
 */
async function diedAfterRehireWrite(input: Record<string, unknown>) {
  let dead: Record<string, Record<string, unknown>> | undefined;
  const first = await harness({
    register: () => {
      throw new Error("process died");
    },
  });
  await cutKindStore(first);
  const realSet = first.stores.resourceState.set.bind(first.stores.resourceState);
  let writes = 0;
  vi.spyOn(first.stores.resourceState, "set").mockImplementation(async (...args) => {
    const result = await realSet(...args);
    if (String(args[2]) === `${ROSTER}support.joe` && ++writes === 1) dead = await first.snapshot();
    return result;
  });
  expect((await first.run("rehire", input)).error?.message).toMatch(/process died/);
  vi.restoreAllMocks();
  return dead!;
}

describe("brokenSeats", () => {
  it("BR-1 to BR-4 · lists each stored seat the start skips, with its reason; not the one that starts", async () => {
    const h = await harness();
    await cutKindStore(h);
    const listed = await h.run("brokenSeats", {});
    expect(listed.error).toBeUndefined();
    const out = listed.output as Array<Record<string, unknown>>;
    expect(out.map((entry) => [entry.seatId, entry.reason, entry.kind])).toEqual([
      ["support.bad", "unreadable", null],
      ["support.joe", "kind-gone", "desk-clerk"],
      ["support.lin", "refused", "desk"],
    ]);
    expect(out[0]!.key).toBe("workforce/roster/support.bad");
    expect(String(out[1]!.detail)).toContain('Kinds passed: "agent", "desk"');
    expect(String(out[2]!.detail)).toMatch(/queue/);
  });

  it("BR-5 · names the same rows with the same detail as the start, over the same rows", async () => {
    const h = await harness();
    await cutKindStore(h);
    const listed = (await h.run("brokenSeats", {})).output as Array<{ key: string; detail: string }>;
    const started = await h.reload();
    expect(new Set(listed.map((entry) => `organization "acme", row "${entry.key}" — ${entry.detail}`))).toEqual(
      new Set(started.problems),
    );
    expect(started.seats.map((seat) => seat.id)).toEqual(["acme.support.ada"]);
  });

  it("BR-6 · reads the principal's organization only; an org in the body changes nothing", async () => {
    const h = await harness();
    await cutKindStore(h);
    await h.seed("ops.kim", toHiredSeatRow({ seatId: "ops.kim", flow: "desk-clerk", owningOrgId: "globex" }) as never, "globex");
    const asAcme = (await h.run("brokenSeats", { orgId: "globex" })).output as Array<{ seatId: string }>;
    expect(asAcme.map((entry) => entry.seatId)).not.toContain("ops.kim");
    const asGlobex = (await h.run("brokenSeats", {}, "globex")).output as Array<{ seatId: string }>;
    expect(asGlobex.map((entry) => entry.seatId)).toEqual(["ops.kim"]);
  });

  it("BR-7 · writes nothing", async () => {
    const h = await harness();
    await cutKindStore(h);
    const before = { roster: await h.versions(ROSTER), seats: await h.versions(SEATS) };
    await h.run("brokenSeats", {});
    expect({ roster: await h.versions(ROSTER), seats: await h.versions(SEATS) }).toEqual(before);
  });
});

describe("retire is fire", () => {
  it("BR-8 · a listed seat is retired: roster row then inventory row, nothing released, the next start names nothing for it", async () => {
    const h = await harness();
    await cutKindStore(h);
    const fired = await h.run("fire", { seatId: "support.joe" });
    expect(fired.error).toBeUndefined();
    expect(fired.output).toEqual({ seatId: "support.joe", address: "acme.support.joe", released: false });
    expect(Object.keys(await h.rows(ROSTER))).not.toContain("support.joe");
    expect(Object.keys(await h.rows(SEATS))).not.toContain("acme.support.joe");
    expect((await h.reload()).problems.join("\n")).not.toContain("support.joe");
  });

  it("BR-9 · a working hired seat: roster row, address released, inventory row", async () => {
    const h = await harness();
    const hired = await h.run("hire", { seatId: "support.ada", flow: "desk", settings: { queue: "q" } });
    expect(hired.error).toBeUndefined();
    expect(Object.keys(await h.rows(SEATS))).toEqual(["acme.support.ada"]);
    const fired = await h.run("fire", { seatId: "support.ada" });
    expect(fired.output).toEqual({ seatId: "support.ada", address: "acme.support.ada", released: true });
    expect(h.live.held.has("acme.support.ada")).toBe(false);
    expect(await h.rows(ROSTER)).toEqual({});
    expect(await h.rows(SEATS)).toEqual({});
  });

  it("BR-10 · a crash between the two deletes: the next fire removes the leftover row and says it was already gone", async () => {
    let crash = true;
    const h = await harness({
      unregister: () => {
        if (crash) throw new Error("process died between the deletes");
        return false;
      },
    });
    await h.run("hire", { seatId: "support.ada", flow: "desk", settings: { queue: "q" } });
    const first = await h.run("fire", { seatId: "support.ada" });
    expect(first.error?.message).toMatch(/process died/);
    expect(await h.rows(ROSTER)).toEqual({});
    expect(Object.keys(await h.rows(SEATS))).toEqual(["acme.support.ada"]);

    crash = false;
    h.live.held.clear(); // the restart: nothing holds the address
    const second = await h.run("fire", { seatId: "support.ada" });
    expect(second.error).toBeUndefined();
    expect(second.output).toEqual({ seatId: "support.ada", address: "acme.support.ada", released: false, alreadyGone: true });
    expect(await h.rows(SEATS)).toEqual({});
  });

  it("BR-10 · a leftover row at an address something holds is not removed; the declared-seat refusal stands", async () => {
    const h = await harness();
    await h.seedInventory("acme.lead", "desk");
    h.live.held.set("acme.lead", { id: "acme.lead", kind: "desk" } as FlowInstance);
    const fired = await h.run("fire", { seatId: "lead" });
    expect(fired.error?.message).toMatch(/worker file|folder/);
    expect(Object.keys(await h.rows(SEATS))).toEqual(["acme.lead"]);
  });

  it("BR-11 · with no `kindAt`, a declared worker's inventory row at the fired address is left alone and the fire refused", async () => {
    // Org `acme`, declared worker `acme.lead`: `fire({ seatId: "lead" })`
    // computes the same address. Without `kindAt` nothing says it is held, so
    // only the row's own origin keeps fire off it.
    const h = await harness({ kindAt: undefined });
    await h.seedInventory("acme.lead", "desk", "acme", false);
    await h.seedInventory("acme.old", "desk"); // written before rows said where they came from
    for (const seatId of ["lead", "old"]) {
      const fired = await h.run("fire", { seatId });
      expect(fired.error?.message).toMatch(new RegExp(`hired no seat "${seatId}"`));
    }
    expect(Object.keys(await h.rows(SEATS)).sort()).toEqual(["acme.lead", "acme.old"]);
  });

  it("BR-11 · a seat this org never hired is refused, as today", async () => {
    const h = await harness();
    const fired = await h.run("fire", { seatId: "support.nobody" });
    expect(fired.error?.message).toMatch(/hired no seat "support.nobody"/);
  });

  it("BR-12 · an unreadable row is deleted by its key, and nothing else is touched", async () => {
    const h = await harness();
    await cutKindStore(h);
    const seatsBefore = await h.rows(SEATS);
    const fired = await h.run("fire", { seatId: "support.bad" });
    expect(fired.output).toEqual({ seatId: "support.bad", address: null, released: false });
    expect(Object.keys(await h.rows(ROSTER)).sort()).toEqual(["support.ada", "support.joe", "support.lin"]);
    expect(await h.rows(SEATS)).toEqual(seatsBefore);
  });
});

describe("a user-owned seat whose kind was cut", () => {
  const OWNED = `~${encodeUserSegment("u1")}/research`;
  const ownedRow = (flow: string) => row({ seatId: "research", flow, ownerUserId: "u1", instructions: "Read." });

  it("the start and brokenSeats name it alike for its owner; another member's list leaves it out", async () => {
    const h = await harness({}, { userOwned: true });
    await cutKindStore(h);
    await h.seed(OWNED, ownedRow("desk-clerk"));
    const listed = (await h.run("brokenSeats", {})).output as Array<{ seatId: string; key: string; detail: string }>;
    const started = await h.reload();
    expect(listed.find((entry) => entry.key === `${ROSTER}${OWNED}`)).toMatchObject({ seatId: "research" });
    expect(new Set(listed.map((entry) => `organization "acme", row "${entry.key}" — ${entry.detail}`))).toEqual(
      new Set(started.problems),
    );
    // The user-owned roster serves a row only to its member.
    const others = (await h.run("brokenSeats", {}, "acme", "u2")).output as Array<{ key: string }>;
    expect(others.map((entry) => entry.key)).not.toContain(`${ROSTER}${OWNED}`);
  });

  it("rehire keeps it user-owned at its address, and the next start serves it", async () => {
    const h = await harness({}, { userOwned: true });
    await h.seed(OWNED, ownedRow("desk-clerk"));
    const rehired = await h.run("rehire", { seatId: "research", flow: "desk", settings: { queue: "q" } });
    expect(rehired.error).toBeUndefined();
    expect(rehired.output).toEqual({ seatId: "research", address: "acme.~u1.research" });
    expect(h.live.kindAt("acme.~u1.research")).toBe("desk");
    expect((await h.rows(ROSTER))[OWNED]).toMatchObject({ flow: "desk", ownerUserId: "u1", instructions: "Read." });
    expect((await h.rows(SEATS))["acme.~u1.research"]).toMatchObject({ kind: "desk", hired: true });
    const started = await h.reload();
    expect(started.problems).toEqual([]);
    expect(started.seats.map((seat) => seat.id)).toEqual(["acme.~u1.research"]);
  });

  it("fire dies after its user-owned roster row is gone: the retry keeps it the caller's and removes the leftover inventory row", async () => {
    let crash = true;
    const h = await harness(
      {
        unregister: () => {
          if (crash) throw new Error("process died between the deletes");
          return false;
        },
      },
      { userOwned: true },
    );
    await h.seed(OWNED, ownedRow("desk-clerk"));
    await h.run("rehire", { seatId: "research", flow: "desk", settings: { queue: "q" } });
    expect((await h.rows(SEATS))["acme.~u1.research"]).toMatchObject({ hired: true });

    const first = await h.run("fire", { seatId: "research" });
    expect(first.error?.message).toMatch(/process died/);
    expect(await h.rows(ROSTER)).toEqual({});
    expect(Object.keys(await h.rows(SEATS))).toEqual(["acme.~u1.research"]);

    crash = false;
    h.live.held.clear(); // the restart: nothing holds the address
    const second = await h.run("fire", { seatId: "research" });
    expect(second.error).toBeUndefined();
    expect(second.output).toEqual({ seatId: "research", address: "acme.~u1.research", released: false, alreadyGone: true });
    expect(await h.rows(SEATS)).toEqual({});
  });

  it("the same retry when an org-wide seat shares the seat id: the caller's leftover goes, and the org seat is untouched", async () => {
    let crash = true;
    const h = await harness(
      {
        unregister: (id: string) => {
          if (crash) throw new Error("process died between the deletes");
          return h.live.held.delete(id);
        },
      },
      { userOwned: true },
    );
    await h.seed(OWNED, ownedRow("desk-clerk"));
    await h.run("rehire", { seatId: "research", flow: "desk", settings: { queue: "q" } });
    crash = false;
    const org = await h.run("hire", { seatId: "research", flow: "desk", settings: { queue: "org" } });
    expect(org.error).toBeUndefined();
    crash = true;

    const first = await h.run("fire", { seatId: "research" });
    expect(first.error?.message).toMatch(/process died/);
    expect(Object.keys(await h.rows(ROSTER))).toEqual(["research"]);

    crash = false;
    h.live.held.delete("acme.~u1.research"); // the restart: the user-owned seat is not served
    const second = await h.run("fire", { seatId: "research" });
    expect(second.error).toBeUndefined();
    expect(second.output).toEqual({ seatId: "research", address: "acme.~u1.research", released: false, alreadyGone: true });
    expect(Object.keys(await h.rows(ROSTER))).toEqual(["research"]);
    expect(Object.keys(await h.rows(SEATS))).toEqual(["acme.research"]);
    expect(h.live.held.has("acme.research")).toBe(true);
  });

  it("fire retires it: its row goes, and the next start names nothing", async () => {
    const h = await harness({}, { userOwned: true });
    await h.seed(OWNED, ownedRow("desk-clerk"));
    const fired = await h.run("fire", { seatId: "research" });
    expect(fired.error).toBeUndefined();
    expect(fired.output).toEqual({ seatId: "research", address: "acme.~u1.research", released: false });
    expect(await h.rows(ROSTER)).toEqual({});
    expect((await h.reload()).problems).toEqual([]);
  });
});

describe("rehire", () => {
  it("BR-14 · a kind-gone seat keeps its id and address on the named kind; instructions carry, settings are the new kind's", async () => {
    const h = await harness();
    await cutKindStore(h);
    const rehired = await h.run("rehire", { seatId: "support.joe", flow: "desk", settings: { queue: "front" } });
    expect(rehired.error).toBeUndefined();
    expect(rehired.output).toEqual({ seatId: "support.joe", address: "acme.support.joe" });
    expect(h.live.kindAt("acme.support.joe")).toBe("desk");
    expect((await h.rows(ROSTER))["support.joe"]).toMatchObject({
      seatId: "support.joe",
      flow: "desk",
      settings: { queue: "front" },
      instructions: "Answer the desk.",
    });
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk" });
    const started = await h.reload();
    expect(started.seats.map((seat) => [seat.id, seat.kind])).toContainEqual(["acme.support.joe", "desk"]);
  });

  it("BR-14 · a refused seat is re-hired with settings the kind accepts, and new instructions replace the old", async () => {
    const h = await harness();
    await cutKindStore(h);
    const rehired = await h.run("rehire", { seatId: "support.lin", flow: "desk", settings: { queue: "q" }, instructions: "New." });
    expect(rehired.error).toBeUndefined();
    expect((await h.rows(ROSTER))["support.lin"]).toMatchObject({ flow: "desk", instructions: "New." });
  });

  it("BR-15 · a kind not carried, outside allowKinds, or refusing the settings is refused before anything is written", async () => {
    const h = await harness({ allowKinds: ["desk"] });
    await cutKindStore(h);
    const before = await h.versions(ROSTER);
    const cases = [
      [{ seatId: "support.joe", flow: "desk-clerk" }, /may not re-hire onto kind "desk-clerk"/],
      [{ seatId: "support.joe", flow: "agent" }, /may not re-hire onto kind "agent"/],
      [{ seatId: "support.joe", flow: "desk" }, /queue/],
    ] as const;
    for (const [input, refusal] of cases) {
      const result = await h.run("rehire", input);
      expect(result.error?.message).toMatch(refusal);
    }
    const unallowed = await harness();
    await cutKindStore(unallowed);
    expect((await unallowed.run("rehire", { seatId: "support.joe", flow: "desk-clerk" })).error?.message).toMatch(
      /carries no flow kind "desk-clerk"/,
    );
    expect(await h.versions(ROSTER)).toEqual(before);
    expect(((await h.run("brokenSeats", {})).output as Array<{ seatId: string }>).map((e) => e.seatId)).toContain("support.joe");
  });

  it("BR-16 · registration fails after the write: the old row is written back, the seat stays listed, the error is named", async () => {
    const h = await harness({
      register: () => {
        throw new Error("the registry refused the address");
      },
    });
    await cutKindStore(h);
    const before = (await h.rows(ROSTER))["support.joe"];
    const result = await h.run("rehire", { seatId: "support.joe", flow: "desk", settings: { queue: "q" } });
    expect(result.error?.message).toMatch(/registry refused/);
    expect((await h.rows(ROSTER))["support.joe"]).toEqual(before);
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk-clerk" });
    const listed = (await h.run("brokenSeats", {})).output as Array<{ seatId: string; reason: string }>;
    expect(listed).toContainEqual(expect.objectContaining({ seatId: "support.joe", reason: "kind-gone" }));
  });

  it("BR-17 · the process dies after the write and before registration: the next start serves the seat on its new kind", async () => {
    let atDeath: ReturnType<typeof reloadHiredSeats> | undefined;
    const h = await harness({
      register: () => {
        // What a fresh process would read had this one died here.
        atDeath = h.reload();
        throw new Error("process died");
      },
    });
    await cutKindStore(h);
    await h.run("rehire", { seatId: "support.joe", flow: "desk", settings: { queue: "q" } });
    const started = await atDeath!;
    expect(started.seats.map((seat) => [seat.id, seat.kind])).toContainEqual(["acme.support.joe", "desk"]);
    expect(started.problems.join("\n")).not.toContain("support.joe");
  });

  it("BR-17 · the process dies after the write: the same re-hire run after the restart finishes the inventory row and clears the pending repair", async () => {
    const input = { seatId: "support.joe", flow: "desk", settings: { queue: "q" } };
    const dead = await diedAfterRehireWrite(input);
    expect(dead[`${ROSTER}support.joe`]).toMatchObject({ flow: "desk", pendingRepair: expect.any(String) });

    const h = await harness();
    const started = await h.restartFrom(dead);
    expect(started.seats.map((seat) => [seat.id, seat.kind])).toContainEqual(["acme.support.joe", "desk"]);
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk-clerk" });

    const again = await h.run("rehire", input);
    expect(again.error).toBeUndefined();
    expect(again.output).toEqual({ seatId: "support.joe", address: "acme.support.joe" });
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk", hired: true });
    expect((await h.rows(ROSTER))["support.joe"]).toMatchObject({ flow: "desk", settings: { queue: "q" }, pendingRepair: null });
    // Finished: the same call now meets a working seat with nothing pending.
    expect((await h.run("rehire", input)).error?.message).toMatch(/still starts/);
  });

  it("an unfinished repair finishes with no `kindAt`: the seat the restart registered counts as registered", async () => {
    const input = { seatId: "support.joe", flow: "desk", settings: { queue: "q" } };
    const dead = await diedAfterRehireWrite(input);
    const h = await harness({ kindAt: undefined });
    await h.restartFrom(dead);
    const again = await h.run("rehire", input);
    expect(again.error).toBeUndefined();
    expect(h.live.held.get("acme.support.joe")?.kind).toBe("desk");
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk", hired: true });
    expect((await h.rows(ROSTER))["support.joe"]).toMatchObject({ pendingRepair: null });
  });

  it("fire lands after an unfinished repair's retry loaded its row: the retry neither registers nor publishes it", async () => {
    const input = { seatId: "support.joe", flow: "desk", settings: { queue: "q" } };
    const dead = await diedAfterRehireWrite(input);
    const h = await harness();
    await h.restartFrom(dead);

    // The retry loads the roster when it starts; run `fire` to completion
    // right after, so the retry works from a row the store no longer holds.
    const realLoad = h.stores.resourceState.getByPrefix.bind(h.stores.resourceState);
    let fired: Promise<{ error?: unknown }> | undefined;
    vi.spyOn(h.stores.resourceState, "getByPrefix").mockImplementation(async (...args) => {
      const loaded = await realLoad(...args);
      if (fired === undefined && String(args[2]).startsWith(ROSTER)) {
        fired = Promise.resolve({});
        fired = h.run("fire", { seatId: "support.joe" }) as Promise<{ error?: unknown }>;
        expect((await fired).error).toBeUndefined();
      }
      return loaded;
    });
    const again = await h.run("rehire", input);
    vi.restoreAllMocks();
    expect(fired).toBeDefined();
    expect(h.live.held.has("acme.support.joe")).toBe(false);
    expect(again.error?.message).toMatch(/fired/);
    expect(await h.rows(ROSTER)).not.toHaveProperty("support.joe");
    expect(await h.rows(SEATS)).not.toHaveProperty("acme.support.joe");
  });

  it("fire lands during the retry's first check of its row: what the retry registered is taken back", async () => {
    const input = { seatId: "support.joe", flow: "desk", settings: { queue: "q" } };
    const dead = await diedAfterRehireWrite(input);
    const h = await harness();
    await h.restartFrom(dead);

    // Run `fire` to completion during the retry's first store read of the row,
    // which then answers with the row as it was: the retry registers, and its
    // next check finds the row gone.
    const realGet = h.stores.resourceState.get.bind(h.stores.resourceState);
    let fired: Promise<unknown> | undefined;
    vi.spyOn(h.stores.resourceState, "get").mockImplementation(async (...args) => {
      const result = await realGet(...args);
      if (fired === undefined && String(args[2]) === `${ROSTER}support.joe`) {
        fired = Promise.resolve(); // the fire's own reads pass through
        fired = h.run("fire", { seatId: "support.joe" });
        expect(((await fired) as { error?: unknown }).error).toBeUndefined();
      }
      return result;
    });
    const again = await h.run("rehire", input);
    vi.restoreAllMocks();
    expect(fired).toBeDefined();
    expect(again.error?.message).toMatch(/fired/);
    expect(h.live.held.has("acme.support.joe")).toBe(false);
    expect(await h.rows(ROSTER)).not.toHaveProperty("support.joe");
    expect(await h.rows(SEATS)).not.toHaveProperty("acme.support.joe");
  });

  it("the inventory write fails after the seat is re-hired: the error says so, and the same re-hire run again finishes it", async () => {
    const h = await harness();
    await cutKindStore(h);
    const input = { seatId: "support.joe", flow: "desk", settings: { queue: "q" } };
    h.failNextInventoryWrite();
    const first = await h.run("rehire", input);
    expect(first.error?.message).toMatch(/is serving, but its inventory row could not be written.*store is unavailable.*same re-hire again/s);
    expect(h.live.kindAt("acme.support.joe")).toBe("desk");
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk-clerk" });

    const again = await h.run("rehire", input);
    expect(again.error).toBeUndefined();
    expect((await h.rows(SEATS))["acme.support.joe"]).toMatchObject({ kind: "desk", hired: true });
    // A different re-hire of the now-working seat is still refused (BR-18).
    expect((await h.run("rehire", { ...input, settings: { queue: "other" } })).error?.message).toMatch(/still starts/);
  });

  it("fire lands just before an unfinished repair's retry writes the inventory row: the retry takes it back, leaving no seat and no inventory row", async () => {
    const input = { seatId: "support.joe", flow: "desk", settings: { queue: "q" } };
    const dead = await diedAfterRehireWrite(input);
    const h = await harness();
    await h.restartFrom(dead);

    // Run `fire` to completion when the retry is about to write the seat's
    // inventory row, then let that write land.
    const realSet = h.stores.resourceState.set.bind(h.stores.resourceState);
    let fired: Promise<{ error?: unknown }> | undefined;
    vi.spyOn(h.stores.resourceState, "set").mockImplementation(async (...args) => {
      if (fired === undefined && String(args[2]) === `${SEATS}acme.support.joe`) {
        fired = Promise.resolve({});
        fired = h.run("fire", { seatId: "support.joe" }) as Promise<{ error?: unknown }>;
        expect((await fired).error).toBeUndefined();
      }
      return realSet(...args);
    });
    const again = await h.run("rehire", input);
    vi.restoreAllMocks();
    expect(fired).toBeDefined();
    expect(again.error?.message).toMatch(/fired/);
    expect(h.live.held.has("acme.support.joe")).toBe(false);
    expect(await h.rows(ROSTER)).not.toHaveProperty("support.joe");
    expect(await h.rows(SEATS)).not.toHaveProperty("acme.support.joe");
  });

  it("BR-18 · a working seat re-hired with its own kind and settings is refused, on a row from before repairs were marked", async () => {
    const h = await harness();
    // No `pendingRepair` key at all: a row written before the field (BP-030).
    await h.seed("support.ada", {
      seatId: "support.ada",
      flow: "desk",
      settings: { queue: "billing" },
      instructions: null,
      owningOrgId: "acme",
      ownerUserId: null,
    });
    const before = await h.versions(ROSTER);
    const result = await h.run("rehire", { seatId: "support.ada", flow: "desk", settings: { queue: "billing" } });
    expect(result.error?.message).toMatch(/still starts/);
    expect(await h.versions(ROSTER)).toEqual(before);
    expect(h.live.held.has("acme.support.ada")).toBe(false);
    expect(await h.rows(SEATS)).toEqual({});
  });

  it("BR-18 · a seat that would start, and an unreadable row, are refused", async () => {
    const h = await harness();
    await cutKindStore(h);
    const working = await h.run("rehire", { seatId: "support.ada", flow: "desk", settings: { queue: "x" } });
    expect(working.error?.message).toMatch(/still starts.*fire it and hire it again/);
    const unreadable = await h.run("rehire", { seatId: "support.bad", flow: "desk", settings: { queue: "x" } });
    expect(unreadable.error?.message).toMatch(/can't be read.*Fire it to retire it/);
  });

  it("BR-19 · two repairs of one seat at once: one lands, the other is refused naming the seat", async () => {
    const h = await harness();
    await cutKindStore(h);
    const [a, b] = await Promise.all([
      h.run("rehire", { seatId: "support.joe", flow: "desk", settings: { queue: "a" } }),
      h.run("rehire", { seatId: "support.joe", flow: "desk", settings: { queue: "b" } }),
    ]);
    const errors = [a, b].filter((result) => result.error !== undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error!.message).toMatch(/acme\.support\.joe/);
    const landed = a.error === undefined ? "a" : "b";
    expect((await h.rows(ROSTER))["support.joe"]).toMatchObject({ settings: { queue: landed } });
  });

  it("BR-19 · a re-hire racing a retire never resurrects the row", async () => {
    const h = await harness();
    await cutKindStore(h);
    await Promise.all([
      h.run("rehire", { seatId: "support.joe", flow: "desk", settings: { queue: "a" } }),
      h.run("fire", { seatId: "support.joe" }),
    ]);
    const roster = await h.rows(ROSTER);
    const seats = await h.rows(SEATS);
    // Whichever landed second, the seat is either retired or re-hired, never half of each.
    if (roster["support.joe"] === undefined) {
      expect(h.live.held.has("acme.support.joe")).toBe(false);
    } else {
      expect(roster["support.joe"]).toMatchObject({ flow: "desk" });
      expect(seats["acme.support.joe"]).toMatchObject({ kind: "desk" });
    }
  });
});

describe("a broken org seat and the caller's own seat under one id", () => {
  const OWNED = `~${encodeUserSegment("u1")}/research`;

  it("brokenSeats names whose row it is, and rehire with that owner repairs the org row, leaving the caller's alone", async () => {
    const h = await harness({}, { userOwned: true });
    await h.seed("research", row({ seatId: "research", flow: "desk-clerk" }));
    await h.seed(OWNED, row({ seatId: "research", flow: "desk", settings: { queue: "mine" }, ownerUserId: "u1" }));
    const mine = (await h.rows(ROSTER))[OWNED];

    const listed = (await h.run("brokenSeats", {})).output as Array<{ seatId: string; owner: string }>;
    expect(listed).toEqual([expect.objectContaining({ seatId: "research", owner: "organization" })]);

    // Without the owner, the caller's own healthy row is the one found.
    expect((await h.run("rehire", { seatId: "research", flow: "desk", settings: { queue: "q" } })).error?.message).toMatch(
      /still starts/
    );

    const rehired = await h.run("rehire", { seatId: "research", flow: "desk", settings: { queue: "q" }, owner: "organization" });
    expect(rehired.error).toBeUndefined();
    expect(rehired.output).toEqual({ seatId: "research", address: "acme.research" });
    expect((await h.rows(ROSTER))["research"]).toMatchObject({ flow: "desk", ownerUserId: null });
    expect((await h.rows(ROSTER))[OWNED]).toEqual(mine);
  });

  it("brokenSeats calls the caller's own broken row theirs, and rehire with owner \"me\" reaches it", async () => {
    const h = await harness({}, { userOwned: true });
    await h.seed(OWNED, row({ seatId: "research", flow: "desk-clerk", ownerUserId: "u1" }));
    const listed = (await h.run("brokenSeats", {})).output as Array<{ seatId: string; owner: string }>;
    expect(listed).toEqual([expect.objectContaining({ seatId: "research", owner: "me" })]);
    const rehired = await h.run("rehire", { seatId: "research", flow: "desk", settings: { queue: "q" }, owner: "me" });
    expect(rehired.output).toEqual({ seatId: "research", address: "acme.~u1.research" });
  });
});
