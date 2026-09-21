/**
 * The one place a stored roster row becomes a hireable record and back, and
 * the one place an org and a seat id become an address.
 *
 * Everything that turns storage into a seat goes through here so there is a
 * single answer to two questions a reader will otherwise find answered twice:
 * what a row means, and what a runtime-hired seat is called.
 *
 * **Nothing here throws over a bad row, and nothing here repairs one.** A row
 * this version cannot read comes back as a reason. That is not politeness: a
 * stored row was written by a past runtime against code that has since moved,
 * so the boot that finds it must be able to skip it and serve, and a boot that
 * rewrote data it did not understand would destroy the evidence of why it did
 * not. The one thing that DOES throw is a bad org id, because that is this
 * deploy's mistake rather than a past one — see {@link seatAddress}.
 *
 * The import of `validateSegment` reaches into `../loader/` and is safe:
 * `loader/segments.ts` imports nothing at all. The package's root/loader split
 * exists to keep `node:fs` out of anything importing `@flow-state-dev/workforce`,
 * and the naming rule is the one piece of the loader with no filesystem in it.
 * Copying the rule here instead would be the second copy of a rule whose whole
 * value is that every reader agrees on it.
 */

import { validateSegment } from "../loader/segments";
import type { WorkerManifest } from "../manifest";
import { hiredSeatRowSchema, type HiredSeatRow } from "./collections";

/**
 * The address a runtime-hired seat answers on: `<org>.<seatId>`.
 *
 * The org is validated as one address segment, so it carries no `.` — which is
 * what makes the join injective and therefore reversible by
 * {@link splitSeatAddress}. Without it, org `acme` + seat `support.ada` and
 * org `acme.support` + seat `ada` would both spell `acme.support.ada`, and the
 * second hire would silently rebind the first's address.
 *
 * The SEAT id is not segment-validated, and that is deliberate rather than an
 * omission: a seat id is already `"<teamId>.<name>"` and is meant to be
 * dotted. Only the leading segment has to be dot-free for the split to be
 * unambiguous.
 *
 * @throws when the org id is not a legal address segment — empty, over-long,
 * or containing a `.`. Thrown rather than returned because an org id reaches
 * this from the request being served right now, so the caller has someone to
 * tell.
 */
export function seatAddress(orgId: string, seatId: string): string {
  validateSegment(orgId, "Org");
  if (seatId.length === 0) {
    throw new Error("A seat id must not be empty — it is half of the seat's address");
  }
  return `${orgId}.${seatId}`;
}

/**
 * The inverse of {@link seatAddress}: recover the org and the seat id from an
 * address, or `undefined` when the address does not belong to this org.
 *
 * One split at the FIRST dot, which is correct only because the org is a
 * validated segment. Splitting at the last dot, or splitting on every dot,
 * would mangle every ordinary `"<teamId>.<name>"` seat id.
 */
export function splitSeatAddress(orgId: string, address: string): string | undefined {
  const prefix = `${orgId}.`;
  if (!address.startsWith(prefix)) return undefined;
  const seatId = address.slice(prefix.length);
  return seatId.length > 0 ? seatId : undefined;
}

/**
 * The stored envelope for one hire, built from what the hire supplied.
 *
 * `settings` is copied rather than referenced, so a caller that keeps mutating
 * its own object after the hire does not retroactively change what was
 * written. `instructions` normalizes whitespace-only to `null` — whitespace is
 * not instructions, the same rule `hireWorkforce` applies to a file's body,
 * and storing `""` would hand the kind a setting its schema can see.
 */
export function toHiredSeatRow(input: {
  seatId: string;
  flow: string;
  settings?: Record<string, unknown>;
  instructions?: string | null;
}): HiredSeatRow {
  const instructions =
    typeof input.instructions === "string" && input.instructions.trim().length > 0
      ? input.instructions
      : null;
  return {
    seatId: input.seatId,
    flow: input.flow,
    settings: { ...(input.settings ?? {}) },
    instructions,
  };
}

/** What a row could not be read as, when it could not be read. */
export interface RowProblem {
  /** One sentence naming what is wrong, for the boot report. */
  problem: string;
}

/**
 * Parse one stored value into a roster row.
 *
 * @returns the row, or a reason. Never throws, and never writes: a row that
 * fails here is left exactly as it is on disk.
 */
export function parseHiredSeatRow(value: unknown): { row: HiredSeatRow } | RowProblem {
  const parsed = hiredSeatRowSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { problem: `the stored row could not be read — ${issues}` };
  }
  return { row: parsed.data };
}

/**
 * Turn a stored row into the record `hireWorkforce` mints a seat from.
 *
 * The mapping, which is the whole of what a row means:
 *
 *   - `id` is the seat's **address** (`<org>.<seatId>`), because that is the
 *     flow instance id it will be registered under.
 *   - `declared` is `{ flow, ...settings }` — the same shape a `WORKER.md`'s
 *     frontmatter produces, so a hired seat and a file-declared one reach the
 *     hire step through one path rather than two.
 *   - `body` is the instructions, which the hire step turns into the
 *     `instructions` setting exactly as it does for a file's Markdown body.
 *
 * `skills` and `teamInstructions` are deliberately ABSENT rather than empty. On
 * a manifest those two fields distinguish *nobody read any folders for this
 * seat* from *the folders held nothing*, and a runtime hire is the first case:
 * there are no folders. Setting them to `[]` would tell the kind its seat was
 * read and found empty, which is a different and false claim.
 *
 * @returns the record. There is no reason arm here — nothing about `row`
 * itself can make this fail, since a row that reached this function has
 * already been validated by {@link parseHiredSeatRow}. A bad ORG still
 * throws, via {@link seatAddress} — see this file's header for why the two
 * differ.
 */
export function hiredSeatManifest(orgId: string, row: HiredSeatRow): { manifest: WorkerManifest } {
  // `flow` is spread in as a declared key rather than handed over separately,
  // so `hireWorkforce`'s own kind resolution and its own refusals are what
  // decide it. A pre-check here would be a second gatekeeper with a second
  // wording, and the one it duplicates is already the loud one.
  return {
    manifest: {
      id: seatAddress(orgId, row.seatId),
      declared: { flow: row.flow, ...row.settings },
      body: row.instructions ?? "",
    },
  };
}

/**
 * The reverse: recover the stored envelope from a record minted by
 * {@link hiredSeatManifest}.
 *
 * Its reason for existing is the round-trip check, not a production caller —
 * a row that cannot survive being read and written back is a row that will
 * lose a seat's settings on some future reload, and the only way to know is to
 * run it both ways.
 *
 * @returns the row, or a reason when the record does not belong to this org or
 * names no kind.
 */
export function hiredSeatRowFromManifest(
  orgId: string,
  manifest: WorkerManifest
): { row: HiredSeatRow } | RowProblem {
  const seatId = splitSeatAddress(orgId, manifest.id);
  if (seatId === undefined) {
    return { problem: `"${manifest.id}" is not an address in organization "${orgId}"` };
  }
  const { flow, ...settings } = manifest.declared;
  if (typeof flow !== "string" || flow.length === 0) {
    return { problem: `"${manifest.id}" declares no flow kind` };
  }
  return { row: toHiredSeatRow({ seatId, flow, settings, instructions: manifest.body }) };
}
