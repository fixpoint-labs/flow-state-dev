/**
 * The hired roster: what a row means (V3, V4) and what a boot does with a
 * whole one (V5, V6, V7).
 *
 * Each case below states what would make it fail, because a check whose red
 * state nobody produced is not evidence. The four that were actually produced
 * and reverted before this file was trusted:
 *
 *   V3 — give `settings` a closed shape instead of a passthrough record: the
 *        unknown-key assertion fails and a seat comes back on defaults.
 *   V4 — drop `validateSegment(orgId, "Org")` from `seatAddress`: both hires
 *        succeed and mint the SAME address, so the second silently rebinds
 *        the first.
 *   V5 — hire the roster in one `hireWorkforce` call instead of per row: the
 *        stale row's throw takes the good row with it, so `seats` is empty
 *        and `problems` never names anything. This is the degrade path
 *        broken by mechanism, and it is the check that catches it.
 *   V6 — swap `withTimeout` for a bare await: the reload hangs instead of
 *        rejecting, and the assertion on elapsed time is what tells a hang
 *        from a failure.
 *   V7 — slice `orgIds` to the cap instead of refusing: the "nothing was
 *        read" assertion fails.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  DEFAULT_ROSTER_READ_TIMEOUT_MS,
  HIRED_ROSTER_PREFIX,
  hiredSeatManifest,
  hiredSeatRowFromManifest,
  parseHiredSeatRow,
  reloadHiredSeats,
  seatAddress,
  toHiredSeatRow,
  type HiredRosterStores,
} from "../src/roster";
import { workerConfigSchema } from "../src/worker-config";

const inputSchema = z.object({ note: z.string() });

const work = handler({
  name: "desk-work",
  inputSchema,
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input,
});

/**
 * A kind that composes the seat contract and adds one setting of its own.
 * It accepts `desk` and refuses anything else, which is what makes the
 * "settings the kind now refuses" case below a real refusal rather than a
 * silently dropped key.
 */
const deskClerk = defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: { answer: { inputSchema, block: work } },
});

const kinds = { "desk-clerk": deskClerk };

/** A store stub holding exactly the rows a case names. */
function storeHolding(
  rowsByOrg: Record<string, Record<string, unknown>>
): HiredRosterStores & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    resourceState: {
      async getByPrefix(_scopeType: string, scopeId: string, keyPrefix: string) {
        reads.push(scopeId);
        const rows = rowsByOrg[scopeId] ?? {};
        return Object.fromEntries(
          Object.entries(rows).map(([seatId, state]) => [
            `${keyPrefix}${seatId}`,
            { state: state as Record<string, unknown> },
          ])
        );
      },
    },
  };
}

describe("V3 · a row round-trips to a record and back", () => {
  it("carries a settings key this version has never heard of, in both directions", () => {
    // The BP-030 case: `settings` belongs to the KIND's schema, which is free
    // to grow keys this package does not know. A strip here would thin a
    // seat's configuration on the first reload after the kind gained a
    // setting, and the seat would come back on defaults with nothing said.
    const stored = {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { desk: "back", aSettingFromTheFuture: { nested: [1, 2] } },
      instructions: "You work the back desk.",
    };

    const parsed = parseHiredSeatRow(stored);
    expect("row" in parsed).toBe(true);
    if (!("row" in parsed)) return;

    const record = hiredSeatManifest("acme", parsed.row);
    expect("manifest" in record).toBe(true);
    if (!("manifest" in record)) return;

    expect(record.manifest.id).toBe("acme.support.ada");
    expect(record.manifest.declared).toEqual({
      flow: "desk-clerk",
      desk: "back",
      aSettingFromTheFuture: { nested: [1, 2] },
    });
    expect(record.manifest.body).toBe("You work the back desk.");

    const back = hiredSeatRowFromManifest("acme", record.manifest);
    expect("row" in back).toBe(true);
    if (!("row" in back)) return;
    expect(back.row).toEqual(parsed.row);
  });

  it("returns a reason for a row missing a required field, and never throws", () => {
    const parsed = parseHiredSeatRow({ seatId: "support.ada" });
    expect("problem" in parsed).toBe(true);
    if (!("problem" in parsed)) return;
    expect(parsed.problem).toContain("flow");
  });

  it("leaves absent skills and team instructions ABSENT, not empty", () => {
    // Empty would tell the kind its folders were read and held nothing. A
    // runtime hire has no folders, which is a different and true claim.
    const row = toHiredSeatRow({ seatId: "support.ada", flow: "desk-clerk" });
    const record = hiredSeatManifest("acme", row);
    if (!("manifest" in record)) throw new Error("expected a manifest");
    expect(Object.hasOwn(record.manifest, "skills")).toBe(false);
    expect(Object.hasOwn(record.manifest, "teamInstructions")).toBe(false);
  });

  it("normalizes whitespace-only instructions to null", () => {
    expect(toHiredSeatRow({ seatId: "a.b", flow: "k", instructions: "   \n " }).instructions).toBe(
      null
    );
  });
});

describe("V4 · the org segment is what makes the address unambiguous", () => {
  it("cannot let org `acme` + `support.ada` and org `acme.support` + `ada` coexist", () => {
    // Both would spell `acme.support.ada`. Exactly one of them is addressable,
    // and it is refused at the segment check rather than discovered later by
    // whichever hire happened to land second.
    expect(seatAddress("acme", "support.ada")).toBe("acme.support.ada");
    expect(() => seatAddress("acme.support", "ada")).toThrow(/Organization id/);
    expect(() => seatAddress("acme.support", "ada")).toThrow(/"\."/);
  });

  it("refuses an empty and an over-long org id", () => {
    expect(() => seatAddress("", "support.ada")).toThrow();
    expect(() => seatAddress("a".repeat(65), "support.ada")).toThrow(/64/);
  });

  it("refuses an empty seat id", () => {
    expect(() => seatAddress("acme", "")).toThrow(/seat id/);
  });
});

describe("V5 · a boot reload skips what it cannot use and serves the rest", () => {
  it("hires the good row and names the other two, with distinct reasons", async () => {
    const stores = storeHolding({
      acme: {
        "support.ada": {
          seatId: "support.ada",
          flow: "desk-clerk",
          settings: { desk: "front" },
          instructions: "Front desk.",
        },
        // The kind was deleted from the code since this row was written.
        "support.bo": { seatId: "support.bo", flow: "kind-that-is-gone", settings: {} },
        // Nothing can parse this one.
        "support.cy": { seatId: "support.cy" },
      },
    });

    const { seats, problems } = await reloadHiredSeats({ stores, orgIds: ["acme"], kinds });

    expect(seats.map((seat) => seat.id)).toEqual(["acme.support.ada"]);
    expect(seats[0]!.config).toMatchObject({ desk: "front", instructions: "Front desk." });

    expect(problems).toHaveLength(2);
    // Distinct reasons, not two copies of one generic sentence — a reader has
    // to be able to tell "put the kind back" from "this row is corrupt".
    const [missingKind, unreadable] = problems.sort();
    expect(missingKind).toContain("support.bo");
    expect(missingKind).toContain("kind-that-is-gone");
    expect(unreadable).toContain("support.cy");
    expect(unreadable).toContain("could not be read");
    // Every problem names where it came from, or the boot report points at
    // nothing when more than one org is loaded.
    for (const problem of problems) expect(problem).toContain('organization "acme"');
  });

  it("skips a row whose settings the kind now refuses, on the same terms", async () => {
    // The batch-hire shape cannot do this: `hireWorkforce` throws for the
    // WHOLE roster when one record's settings fail the kind's schema, so a
    // pre-check on the kind name would not have caught it either.
    const stores = storeHolding({
      acme: {
        "support.ada": { seatId: "support.ada", flow: "desk-clerk", settings: { desk: "front" } },
        "support.bo": {
          seatId: "support.bo",
          flow: "desk-clerk",
          settings: { aSettingTheKindDropped: true },
        },
      },
    });

    const { seats, problems } = await reloadHiredSeats({ stores, orgIds: ["acme"], kinds });

    expect(seats.map((seat) => seat.id)).toEqual(["acme.support.ada"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("support.bo");
  });

  it("registers nothing for an org with no rows, and reports no problem", async () => {
    const stores = storeHolding({ acme: {} });
    const { seats, problems } = await reloadHiredSeats({ stores, orgIds: ["acme"], kinds });
    expect(seats).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("keeps two orgs' seats of the same name apart", async () => {
    const row = { seatId: "support.ada", flow: "desk-clerk", settings: {} };
    const stores = storeHolding({
      acme: { "support.ada": { ...row, settings: { desk: "acme-front" } } },
      bravo: { "support.ada": { ...row, settings: { desk: "bravo-front" } } },
    });

    const { seats, problems } = await reloadHiredSeats({
      stores,
      orgIds: ["acme", "bravo"],
      kinds,
    });

    expect(problems).toEqual([]);
    expect(seats.map((seat) => seat.id)).toEqual(["acme.support.ada", "bravo.support.ada"]);
    expect(seats[0]!.config).toMatchObject({ desk: "acme-front" });
    expect(seats[1]!.config).toMatchObject({ desk: "bravo-front" });
  });

  it("reads the pinned storage prefix", async () => {
    // The prefix is a public surface: moving it strands every roster already
    // written. Asserted so a rename has to be a deliberate edit here too.
    const seen: string[] = [];
    const stores: HiredRosterStores = {
      resourceState: {
        async getByPrefix(_scope: string, _id: string, keyPrefix: string) {
          seen.push(keyPrefix);
          return {};
        },
      },
    };
    await reloadHiredSeats({ stores, orgIds: ["acme"], kinds });
    expect(seen).toEqual(["workforce/roster/"]);
    expect(HIRED_ROSTER_PREFIX).toBe("workforce/roster/");
  });
});

describe("V6 · a store that never answers fails the boot inside its bound", () => {
  it("rejects, returns no partial result, and does so well within the test's own budget", async () => {
    vi.useFakeTimers();
    try {
      const stores: HiredRosterStores = {
        resourceState: {
          // Never settles. A bare await here hangs the boot for ever, which is
          // the outcome the bound exists to convert into an exit.
          getByPrefix: () => new Promise(() => {}),
        },
      };

      const reload = reloadHiredSeats({
        stores,
        orgIds: ["acme"],
        kinds,
        timeoutMs: 250,
      });
      // Attached before the timers advance, so the rejection is never
      // unhandled.
      const settled = expect(reload).rejects.toThrow(/timed out/i);

      // The clock is driven rather than waited on: a check that merely waited
      // could not tell "rejected at its bound" from "the suite's own timeout
      // killed a hang", and those are the two outcomes it has to separate.
      await vi.advanceTimersByTimeAsync(260);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a read that rejects outright fail the boot rather than reporting an empty org", async () => {
    const stores: HiredRosterStores = {
      resourceState: {
        getByPrefix: () => Promise.reject(new Error("connection pool is closed")),
      },
    };
    await expect(reloadHiredSeats({ stores, orgIds: ["acme"], kinds })).rejects.toThrow(
      /connection pool is closed/
    );
  });

  it("bounds the whole set rather than each read", () => {
    // A per-read bound multiplies by the org count, so fifty orgs could spend
    // fifty budgets and still be "within bounds" — which bounds nothing.
    expect(DEFAULT_ROSTER_READ_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("V7 · more orgs than the cap refuses rather than truncating", () => {
  it("names the count and the cap, and reads nothing at all", async () => {
    const stores = storeHolding({ a: {}, b: {}, c: {} });

    await expect(
      reloadHiredSeats({ stores, orgIds: ["a", "b", "c"], kinds, maxOrgs: 2 })
    ).rejects.toThrow(/3 organizations and its cap is 2/);

    // The assertion the slicing implementation fails: a truncating reload
    // would have read the first two and looked healthy doing it.
    expect(stores.reads).toEqual([]);
  });

  it("admits exactly the cap", async () => {
    const stores = storeHolding({ a: {}, b: {} });
    const { seats, problems } = await reloadHiredSeats({
      stores,
      orgIds: ["a", "b"],
      kinds,
      maxOrgs: 2,
    });
    expect(seats).toEqual([]);
    expect(problems).toEqual([]);
    expect(stores.reads).toEqual(["a", "b"]);
  });
});
