/**
 * Admit the seats a boot reload brought back, and publish what each
 * organization could not get back.
 *
 * The roster panel shows two numbers: the seats that answer, and the seats
 * that were skipped. Skipped seats never became roster rows, so the panel can
 * only get them from something the boot writes. This writes one report row
 * per organization, into that organization's own scope, where the shell's
 * flow declares it readable.
 *
 * A seat can be skipped in two places, and both go into the report:
 *
 * - by the reload, which could not turn a stored row into a seat. Those
 *   arrive in the reload's per-organization slices.
 * - by the registry, which refused a seat the reload did build. Those happen
 *   here, and are filed under the organization the seat was hired for.
 *
 * Every organization the reload covered is written, including the clean ones.
 * A clean organization gets an empty list, so last boot's problems do not stay
 * on screen after they are fixed.
 *
 * A report that cannot be written does not stop the boot, and is not a skipped
 * seat: the seat it describes was admitted and is running, only the panel's
 * picture of it failed to save. It is returned separately, as a
 * `reportErrors` entry for the boot's log, and the remaining organizations
 * are admitted and written as usual.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { HiredRosterReload } from "@flow-state-dev/workforce";

import type { RosterBootReport } from "@/lib/roster-boot-report-schema";
import { ROSTER_BOOT_REPORT_KEY } from "@/lib/workforce-shell";

/** The one store write this needs. Satisfied by the engine's `StoreRegistry`. */
export interface RosterReportStores {
  resourceState: {
    set(
      scopeType: "org",
      scopeId: string,
      resourceKey: string,
      state: RosterBootReport,
      expectedVersion: "any",
    ): Promise<unknown>;
  };
}

export interface AdmitReloadedSeatsOptions {
  reload: HiredRosterReload;
  /** Admit one seat. Throwing refuses that seat and no other. */
  admit: (seat: FlowInstance) => void;
  stores: RosterReportStores;
}

export interface AdmittedSeats {
  /** Ids of the seats that were admitted. */
  seats: string[];
  /**
   * One entry per seat the registry refused, as `<seat id> — <reason>`. Every
   * one of these is a seat that did not come back, so the boot's "N stored
   * seat(s) could not be brought back" count is drawn from this list alone.
   */
  problems: string[];
  /**
   * One entry per organization whose report could not be written, as
   * `organization "<orgId>" — its boot report could not be written: <reason>`.
   * Kept apart from `problems`: the seat itself was admitted, only the
   * panel's picture of it failed to save, so this must never be counted as a
   * skipped seat.
   */
  reportErrors: string[];
}

/**
 * Admit every reloaded seat, one at a time, and write each organization's
 * report.
 *
 * @returns What was admitted and what was refused, across every organization,
 *   for the boot's own log. The reload's own problems are not repeated here.
 */
export async function admitReloadedSeats(
  options: AdmitReloadedSeatsOptions,
): Promise<AdmittedSeats> {
  const admitted: AdmittedSeats = { seats: [], problems: [], reportErrors: [] };

  for (const org of options.reload.byOrg) {
    const problems = [...org.problems];
    for (const seat of org.seats) {
      try {
        options.admit(seat);
        admitted.seats.push(seat.id);
      } catch (error) {
        // One seat the registry refuses is one seat that cannot run, not a
        // reason for the app to fail to start.
        const refusal = `${seat.id} — ${error instanceof Error ? error.message : String(error)}`;
        problems.push(refusal);
        admitted.problems.push(refusal);
      }
    }
    try {
      await options.stores.resourceState.set(
        "org",
        org.orgId,
        ROSTER_BOOT_REPORT_KEY,
        { problems },
        "any",
      );
    } catch (error) {
      admitted.reportErrors.push(
        `organization "${org.orgId}" — its boot report could not be written: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return admitted;
}
