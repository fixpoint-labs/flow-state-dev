/**
 * The one answer to "does this stored row become a seat, and if not, why?".
 *
 * The boot reload asks it of every row, and `brokenSeats` asks it on request.
 * Two callers, one check: a second detector would drift from the start's own
 * refusals, and then the list a person repairs from would not be the list the
 * start skips.
 *
 * Three reasons, and they are a public surface (the chief of staff and the
 * epic's closure read them by name):
 *
 *   - `unreadable` — the row does not parse, is stamped for another
 *     organization, or cannot be an address. Retiring it is its only repair.
 *   - `kind-gone` — the row names a kind the app no longer carries. Decided
 *     before anything is minted, so a cut kind is never handed to the hire.
 *   - `refused` — the kind is carried, and the hire refuses the row (most
 *     often, settings the kind's schema no longer accepts).
 *
 * The detail is the start's own wording, unchanged: the reload prints it after
 * the organization and row, and `brokenSeats` hands it back as `detail`.
 *
 * Nothing here writes. A row that fails is left exactly as it is on disk.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";
import { readDeclaredFlow } from "../declared-flow";
import { AGENT_KIND } from "../agent-worker-flow";
import { hireWorkforce, missingKindRefusal, resolvableKinds, type HireOptions } from "../hire";
import type { HiredSeatRow } from "./collections";
import { hiredSeatManifestFromStored, parseHiredSeatRow } from "./rows";

/** Why a stored row does not become a seat. Pinned names; see the file header. */
type BrokenSeatReason = "kind-gone" | "refused" | "unreadable";

/** One stored row, checked. */
type HiredSeatRowCheck =
  | { ok: true; row: HiredSeatRow; seat: FlowInstance }
  | {
      ok: false;
      reason: BrokenSeatReason;
      /** The start's own sentence for why the row was skipped. */
      detail: string;
      /** The parsed row, when it parsed. Absent for an `unreadable` row that did not. */
      row?: HiredSeatRow;
    };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Check one stored roster value, read under `orgId`, against the app's kinds.
 *
 * @param orgId The organization whose cell the value was read from.
 * @param stored The stored state, as the store returned it.
 * @param kinds The app's kind map, the same one the reload and the hire take.
 * @returns the seat it mints to, or the reason and detail it does not. Never throws.
 */
export function checkHiredSeatRow(
  orgId: string,
  stored: unknown,
  kinds: HireOptions["kinds"]
): HiredSeatRowCheck {
  // The row is parsed for its fields, and the record is read through the same
  // walk the reload uses (which parses again) so the two can't disagree on
  // which rows count. One small row, read on demand; not worth a second walk.
  const parsed = parseHiredSeatRow(stored);
  if ("problem" in parsed) return { ok: false, reason: "unreadable", detail: parsed.problem };
  const row = parsed.row;
  const record = hiredSeatManifestFromStored(orgId, stored);
  if ("problem" in record) return { ok: false, reason: "unreadable", detail: record.problem, row };

  // The kind, resolved by the rule the hire itself uses, before any mint.
  const declared = readDeclaredFlow(record.manifest.declared, AGENT_KIND);
  if ("kind" in declared && !Object.hasOwn(resolvableKinds(kinds), declared.kind)) {
    return {
      ok: false,
      reason: "kind-gone",
      detail: missingKindRefusal(record.manifest.id, declared.kind, kinds),
      row,
    };
  }

  // One manifest per call: `hireWorkforce` refuses its whole batch over one
  // bad record, so a batch would turn one stale row into no seats at all.
  try {
    // One record in, and a hire that did not throw returns one seat per record.
    const seat = hireWorkforce([record.manifest], { kinds })[0]!;
    return { ok: true, row, seat };
  } catch (error) {
    return {
      ok: false,
      reason: "refused",
      detail: messageOf(error),
      row,
    };
  }
}
