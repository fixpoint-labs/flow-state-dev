/**
 * `admitReloadedSeats` on its failure path: a report that cannot be written
 * is a line in the boot's log, not a boot that stops.
 *
 * Red state: await the write unguarded, and the first organization's store
 * error rejects the whole call, so the second organization's seats are never
 * admitted.
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { HiredRosterReload } from "@flow-state-dev/workforce";

import { admitReloadedSeats } from "../lib/roster-reload-report";

const seat = (id: string) => ({ id }) as FlowInstance;

describe("admitReloadedSeats", () => {
  it("keeps admitting when one organization's report cannot be written, and says so", async () => {
    const reload: HiredRosterReload = {
      seats: [seat("acme.support.ada"), seat("beta.support.ada")],
      problems: [],
      byOrg: [
        { orgId: "acme", seats: [seat("acme.support.ada")], problems: [] },
        { orgId: "beta", seats: [seat("beta.support.ada")], problems: [] },
      ],
    };
    const admitted: string[] = [];
    const written: string[] = [];

    const result = await admitReloadedSeats({
      reload,
      admit: (instance) => {
        admitted.push(instance.id);
      },
      stores: {
        resourceState: {
          set: async (_scope, orgId) => {
            if (orgId === "acme") throw new Error("connection reset");
            written.push(orgId);
          },
        },
      },
    });

    expect(admitted).toEqual(["acme.support.ada", "beta.support.ada"]);
    expect(written).toEqual(["beta"]);
    expect(result.seats).toEqual(["acme.support.ada", "beta.support.ada"]);
    // Both seats were admitted; a report-write failure is not a skipped seat.
    expect(result.problems).toHaveLength(0);
    expect(result.reportErrors).toHaveLength(1);
    expect(result.reportErrors[0]).toContain('organization "acme"');
    expect(result.reportErrors[0]).toContain("connection reset");
  });

  it("counts a report-write failure separately from skipped seats, with every seat admitted", async () => {
    const reload: HiredRosterReload = {
      seats: [seat("acme.support.ada")],
      problems: [],
      byOrg: [{ orgId: "acme", seats: [seat("acme.support.ada")], problems: [] }],
    };
    const admitted: string[] = [];

    const result = await admitReloadedSeats({
      reload,
      admit: (instance) => {
        admitted.push(instance.id);
      },
      stores: {
        resourceState: {
          set: async () => {
            throw new Error("connection reset");
          },
        },
      },
    });

    expect(admitted).toEqual(["acme.support.ada"]);
    expect(result.seats).toEqual(["acme.support.ada"]);
    // A report the boot could not write is not a seat the boot could not
    // bring back — the seat is running, only the panel's picture of it isn't.
    expect(result.problems).toHaveLength(0);
    expect(result.reportErrors).toHaveLength(1);
    expect(result.reportErrors[0]).toContain('organization "acme"');
    expect(result.reportErrors[0]).toContain("connection reset");
  });
});
