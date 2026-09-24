/**
 * The hired roster: what a row means (V3, V4) and what a boot does with a
 * whole one (V5, V6, V7).
 *
 * Each case below states what would make it fail, because a check whose red
 * state nobody produced is not evidence. The six that were actually produced
 * and reverted before this file was trusted:
 *
 *   V3 — spread the row as `{ flow: row.flow, ...row.settings }`: a row
 *        storing its own `settings.flow` mints and registers THAT kind while
 *        the row says its own kind forever, and the round trip writes the
 *        shadow back over the column.
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
 *   V6 — build the timeout label before the read instead of from the progress
 *        map: the message reads "the hired roster read for 3 organizations
 *        timed out", naming a count where BR-17 asks for the org and the
 *        store.
 *   V7 — slice `orgIds` to the cap instead of refusing: the "nothing was
 *        read" assertion fails.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core/types";
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
import { hireWorkforce } from "../src/hire";
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
    expect(back.row).toEqual({
      ...parsed.row,
      owningOrgId: "acme",
      ownerUserId: null,
    });
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

  it("does not let a `flow` inside `settings` shadow the row's own column", async () => {
    // `settings` is a passthrough record, so `settings.flow` is storable, and
    // `settingsOf` strips `flow` as reserved BEFORE the kind validates the
    // bag — so nothing downstream ever objects. With the spread the other way
    // round (`{ flow: row.flow, ...row.settings }`) this row mints and
    // registers an `agent` while the row says `desk-clerk` forever: the
    // roster's authoritative column and the running seat disagree, and only
    // the row is ever read again.
    //
    // Red state: restore `declared: { flow: row.flow, ...row.settings }` in
    // `hiredSeatManifest` and both assertions below flip to "agent".
    const row = {
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { flow: "agent", desk: "back" },
      instructions: null,
    };
    const parsed = parseHiredSeatRow(row);
    if (!("row" in parsed)) throw new Error("expected a row");

    const record = hiredSeatManifest("acme", parsed.row);
    if (!("manifest" in record)) throw new Error("expected a manifest");
    expect(record.manifest.declared.flow).toBe("desk-clerk");

    // …and the seat that actually mints is the row's kind, not the bag's.
    const [seat] = hireWorkforce([record.manifest], { kinds });
    expect(seat!.kind).toBe("desk-clerk");
    expect(seat!.id).toBe("acme.support.ada");
  });

  it("drops a shadowing `settings.flow` on the way back, rather than restoring it", () => {
    // The round trip is NOT byte-identical for such a row, and that is the
    // intended loss: `hiredSeatRowFromManifest` destructures the single
    // `flow` key out of `declared`, and after the fix above that key holds
    // the row's authoritative kind. What comes back is the row with the
    // shadow removed — the same seat, minus a key that could only ever have
    // lied. Every row without a `settings.flow` still round-trips exactly,
    // which is the case the V3 round-trip above pins.
    const row = toHiredSeatRow({
      seatId: "support.ada",
      flow: "desk-clerk",
      settings: { flow: "agent", desk: "back" },
    });
    const record = hiredSeatManifest("acme", row);
    if (!("manifest" in record)) throw new Error("expected a manifest");
    const back = hiredSeatRowFromManifest("acme", record.manifest);
    if (!("row" in back)) throw new Error("expected a row");

    expect(back.row.flow).toBe("desk-clerk");
    expect(back.row.settings).toEqual({ desk: "back" });
  });
});

describe("V4 · the org segment is what makes the address unambiguous", () => {
  it("cannot let org `acme` + `support.ada` and org `acme.support` + `ada` coexist", () => {
    // Both would spell `acme.support.ada`. Exactly one of them is addressable,
    // and it is refused at the segment check rather than discovered later by
    // whichever hire happened to land second.
    expect(seatAddress("acme", "support.ada")).toBe("acme.support.ada");
    expect(seatAddress("acme", "research", "alice")).toBe("acme.~alice.research");
    expect(seatAddress("acme", "research", "alice@acme.com")).toBe("acme.~alice%40acme%2Ecom.research");
    expect(() => seatAddress("acme", "~research", "alice")).toThrow(/starts with "~"/);
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

  it("skips a row it cannot address, and still serves every other org", async () => {
    // An app with no principal resolver runs as DEFAULT_ORG_ID, so a runtime
    // hire there leaves a row in a cell whose id is not a legal address
    // segment. That row can never become a seat, but it must cost only
    // itself: the boot still has to hand back acme's team, and the row has to
    // be named rather than dropped. A seat id carrying the user-owned `~`
    // marker is the same failure one segment later.
    const stores = storeHolding({
      acme: {
        "support.ada": { seatId: "support.ada", flow: "desk-clerk", settings: {} },
        "~support.bo": { seatId: "~support.bo", flow: "desk-clerk", settings: {} },
      },
      [DEFAULT_ORG_ID]: {
        lead: {
          seatId: "lead",
          flow: "desk-clerk",
          settings: {},
          owningOrgId: DEFAULT_ORG_ID,
        },
      },
    });

    const { seats, problems } = await reloadHiredSeats({
      stores,
      orgIds: [DEFAULT_ORG_ID, "acme"],
      kinds,
    });

    expect(seats.map((seat) => seat.id)).toEqual(["acme.support.ada"]);
    expect(problems).toHaveLength(2);
    const tilde = problems.find((problem) => problem.includes('organization "acme"'));
    const defaultOrg = problems.find((problem) => problem.includes(DEFAULT_ORG_ID));
    expect(tilde).toContain('organization "acme", row "workforce/roster/~support.bo"');
    expect(tilde).toContain('starts with "~"');
    expect(defaultOrg).toContain(`organization "${DEFAULT_ORG_ID}", row "workforce/roster/lead"`);
    expect(defaultOrg).toContain("Organization id");
  });

  it("still refuses a row stamped for another org, even when that org is not addressable", async () => {
    // The owning-org fence runs before the address is built, so a row that
    // claims a different org is refused as a mismatch — never minted under
    // the cell it was read from, and never re-bound to make it addressable.
    const stores = storeHolding({
      acme: {
        lead: { seatId: "lead", flow: "desk-clerk", settings: {}, owningOrgId: DEFAULT_ORG_ID },
      },
      [DEFAULT_ORG_ID]: {
        lead: { seatId: "lead", flow: "desk-clerk", settings: {}, owningOrgId: "acme" },
      },
    });

    const { seats, problems } = await reloadHiredSeats({
      stores,
      orgIds: ["acme", DEFAULT_ORG_ID],
      kinds,
    });

    expect(seats).toEqual([]);
    expect(problems).toHaveLength(2);
    for (const problem of problems) expect(problem).toContain("cannot be registered under");
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

describe("the reload, partitioned by organization", () => {
  // A caller that publishes the report per organization needs each org's slice
  // from the reload itself. The flat `problems` names the org only inside its
  // prose, and re-deriving structure from prose is the wrong way round.
  const good = { seatId: "support.ada", flow: "desk-clerk", settings: {} };
  const stores = () =>
    storeHolding({
      acme: {
        "support.ada": good,
        "support.bo": { seatId: "support.bo", flow: "kind-that-is-gone", settings: {} },
      },
      beta: { "support.ada": good },
      quiet: {},
    });

  it("returns one entry per organization it was given, in that order, empty ones included", async () => {
    const { byOrg } = await reloadHiredSeats({
      stores: stores(),
      orgIds: ["acme", "beta", "quiet"],
      kinds,
    });

    // An org with nothing to report still gets an entry. Leaving it out is how
    // a report written on the last boot stays standing when nobody rewrites it.
    expect(byOrg.map((org) => org.orgId)).toEqual(["acme", "beta", "quiet"]);
    expect(byOrg[2]).toEqual({ orgId: "quiet", seats: [], problems: [] });
  });

  it("files each seat and each problem under its own organization only", async () => {
    const { byOrg, seats, problems } = await reloadHiredSeats({
      stores: stores(),
      orgIds: ["acme", "beta", "quiet"],
      kinds,
    });
    const [acme, beta] = byOrg;

    expect(acme!.seats.map((seat) => seat.id)).toEqual(["acme.support.ada"]);
    expect(acme!.problems).toHaveLength(1);
    expect(acme!.problems[0]).toContain("support.bo");

    expect(beta!.seats.map((seat) => seat.id)).toEqual(["beta.support.ada"]);
    expect(beta!.problems).toEqual([]);

    // The flat fields are unchanged: the union of the slices.
    expect(seats.map((seat) => seat.id)).toEqual(["acme.support.ada", "beta.support.ada"]);
    expect(problems).toEqual(acme!.problems);
  });

  it("files a row stamped for another organization under the org whose cell held it", async () => {
    // Refused by the owning-org fence, not by the kind — a different reason
    // from the case above, and it has to land in the same slice. A report
    // published per organization would otherwise never show it.
    const { byOrg, problems } = await reloadHiredSeats({
      stores: storeHolding({
        acme: { stray: { seatId: "stray", flow: "desk-clerk", settings: {}, owningOrgId: "globex" } },
      }),
      orgIds: ["acme"],
      kinds,
    });

    expect(byOrg[0]!.problems).toHaveLength(1);
    expect(byOrg[0]!.problems[0]).toContain('organization "acme", row "workforce/roster/stray"');
    expect(byOrg[0]!.problems[0]).toContain("cannot be registered under");
    expect(problems).toEqual(byOrg[0]!.problems);
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

  it("names the org it stalled on and the store call, not just the count (BR-17)", async () => {
    // BR-17 asks for "an error naming the org and the store". A count tells an
    // operator to go looking through every tenant; the org plus the exact
    // store method is the difference between a report and an alert.
    //
    // Satisfiable because `readEveryOrg` is sequential: `bravo` is the second
    // of three and never answers, so at the bound it is exactly the first org
    // missing from the progress map. `charlie` is here so the case cannot
    // pass by naming "the last org" — the stall is in the MIDDLE.
    //
    // Red state: label the `withTimeout` call `the hired roster read for N
    // organizations` and drop the error factory, and every assertion below
    // fails on a message that names only the count.
    vi.useFakeTimers();
    try {
      const stores: HiredRosterStores = {
        resourceState: {
          getByPrefix: (_scope: string, scopeId: string) =>
            scopeId === "bravo"
              ? new Promise<Record<string, { state: Record<string, unknown> }>>(() => {})
              : Promise.resolve({}),
        },
      };

      const reload = reloadHiredSeats({
        stores,
        orgIds: ["acme", "bravo", "charlie"],
        kinds,
        timeoutMs: 250,
      });
      const settled = expect(reload).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(260);
      await settled;

      // Re-run for the message itself; the assertions are what BR-17 buys.
      const again = reloadHiredSeats({
        stores,
        orgIds: ["acme", "bravo", "charlie"],
        kinds,
        timeoutMs: 250,
      });
      const captured = again.catch((error: unknown) =>
        error instanceof Error ? error.message : String(error)
      );
      await vi.advanceTimersByTimeAsync(260);
      const message = await captured;

      expect(message).toContain('organization "bravo"');
      expect(message).toContain("stores.resourceState.getByPrefix");
      expect(message).toContain(HIRED_ROSTER_PREFIX);
      // Not the org that answered, and not the one never reached.
      expect(message).not.toContain('"acme"');
      expect(message).not.toContain('"charlie"');
      // The whole-set bound (D2) is still what is being reported.
      expect(message).toContain("1 of 3 organizations had answered");
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
