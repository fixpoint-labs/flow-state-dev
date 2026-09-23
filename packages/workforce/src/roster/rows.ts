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
 * deploy's mistake rather than a past one — see {@link seatAddress}. A reader
 * walking stored rows calls {@link hiredSeatManifestFromStored}, which turns
 * that throw into a reason too.
 *
 * The import of `validateSegment` reaches into `../loader/` and is safe:
 * `loader/segments.ts` imports nothing at all. The package's root/loader split
 * exists to keep `node:fs` out of anything importing `@flow-state-dev/workforce`,
 * and the naming rule is the one piece of the loader with no filesystem in it.
 * Copying the rule here instead would be the second copy of a rule whose whole
 * value is that every reader agrees on it.
 */

import { encodeUserSegment, type InstanceOwnerPin } from "@flow-state-dev/core/types";
import { validateSegment } from "../loader/segments";
import type { WorkerManifest } from "../manifest";
import { hiredSeatRowSchema, type HiredSeatRow } from "./collections";

export { encodeUserSegment };

/**
 * The address a runtime-hired seat answers on.
 *
 * Org-visible: `<org>.<seatId>`. User-owned: `<org>.~<user>.<seatId>`, with
 * the user escaped. `ownerUserId` comes from the hire row. Nothing here
 * reads a pin out of an address that was already built.
 *
 * The org is validated as one address segment, so it carries no `.` — which
 * is what makes the join injective and therefore reversible by
 * {@link splitSeatAddress}. The seat id stays dotted on purpose
 * (`"<teamId>.<name>"`). Only the leading segment has to be dot-free.
 *
 * @throws when the org id is not a legal address segment, the seat id is
 * empty, or the seat id starts with `~` (that marker is the user-owned form).
 */
export function seatAddress(
  orgId: string,
  seatId: string,
  ownerUserId?: string | null,
): string {
  validateSegment(orgId, "Org");
  if (seatId.length === 0) {
    throw new Error("A seat id must not be empty — it is half of the seat's address");
  }
  if (seatId.startsWith("~")) {
    throw new Error(
      `seat id "${seatId}" starts with "~", which marks a user-owned seat's address`,
    );
  }
  if (ownerUserId != null && ownerUserId.length > 0) {
    return `${orgId}.~${encodeUserSegment(ownerUserId)}.${seatId}`;
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
/**
 * The seat id inside an address this org owns, or `undefined`.
 *
 * One split at the first dot, which is correct only because the org is a
 * validated segment. A user-owned address is `<org>.~<user>.<seatId>`; the
 * user segment is skipped and is not returned as an owner. The pin stays on
 * the hire row.
 */
export function splitSeatAddress(orgId: string, address: string): string | undefined {
  const prefix = `${orgId}.`;
  if (!address.startsWith(prefix)) return undefined;
  const rest = address.slice(prefix.length);
  if (rest.startsWith("~")) {
    const dot = rest.indexOf(".");
    if (dot <= 1 || dot === rest.length - 1) return undefined;
    const seatId = rest.slice(dot + 1);
    return seatId.length > 0 ? seatId : undefined;
  }
  return rest.length > 0 ? rest : undefined;
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
  /**
   * The organization the row is written for. `null` — the default — is a
   * legacy row; a reload binds the cell it was read from.
   */
  owningOrgId?: string | null;
  /**
   * The user the hire belongs to, or `null` when every member of the owning
   * org may see it. A user-owned row is stored under a nested key.
   */
  ownerUserId?: string | null;
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
    owningOrgId: input.owningOrgId ?? null,
    ownerUserId: input.ownerUserId ?? null,
  };
}

/**
 * The storage key for one row, relative to `workforce/roster/`.
 *
 * Org-visible rows stay one segment (`eng.lead`), which the browser
 * collection lists. User-owned rows nest under `~<escaped user>/seat`, which
 * that collection does not match. The user is escaped with the same encoding
 * as the address, so a `/` in the id cannot extend another user's prefix.
 * The address is not this key.
 */
export function hiredRosterStorageKey(row: {
  seatId: string;
  ownerUserId?: string | null;
}): string {
  if (row.ownerUserId != null && row.ownerUserId.length > 0) {
    return `~${encodeUserSegment(row.ownerUserId)}/${row.seatId}`;
  }
  return row.seatId;
}

/** The pin a row registers under. `userId` is omitted when the row is org-visible. */
export function hiredSeatOwnerPin(orgId: string, row: HiredSeatRow): InstanceOwnerPin {
  const pin: InstanceOwnerPin = { orgId };
  if (row.ownerUserId != null && row.ownerUserId.length > 0) pin.userId = row.ownerUserId;
  return pin;
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
 *   - `declared` is `{ ...settings, flow }` — the same shape a `WORKER.md`'s
 *     frontmatter produces, so a hired seat and a file-declared one reach the
 *     hire step through one path rather than two. The column wins over a
 *     same-named settings key; see the note in the body for why the order is
 *     load-bearing.
 *   - `body` is the instructions, which the hire step turns into the
 *     `instructions` setting exactly as it does for a file's Markdown body.
 *
 * `skills` and `teamInstructions` are deliberately ABSENT rather than empty. On
 * a manifest those two fields distinguish *nobody read any folders for this
 * seat* from *the folders held nothing*, and a runtime hire is the first case:
 * there are no folders. Setting them to `[]` would tell the kind its seat was
 * read and found empty, which is a different and false claim.
 *
 * @returns the record, or a reason when the row's owning organization is
 * not `orgId`. A row that predates the stamp binds `orgId` — the cell it
 * was read from — rather than refusing. A bad ORG still throws, via
 * {@link seatAddress}; a caller walking stored rows reads through
 * {@link hiredSeatManifestFromStored}, which turns that throw into one row's
 * reason, so one unaddressable row is one skip.
 */
export function hiredSeatManifest(
  orgId: string,
  row: HiredSeatRow
): { manifest: WorkerManifest } | RowProblem {
  if (row.owningOrgId != null && row.owningOrgId !== orgId) {
    return {
      problem:
        `the row is owned by organization "${row.owningOrgId}" and cannot be registered under "${orgId}"`,
    };
  }
  const owningOrgId = row.owningOrgId ?? orgId;
  // `flow` is spread in as a declared key rather than handed over separately,
  // so `hireWorkforce`'s own kind resolution and its own refusals are what
  // decide it. A pre-check here would be a second gatekeeper with a second
  // wording, and the one it duplicates is already the loud one.
  //
  // It goes in LAST, and that order is load-bearing. `settings` is a
  // passthrough bag (see `collections.ts`), so a row can store its own
  // `settings.flow`; spread the other way round it would overwrite the row's
  // authoritative `flow` column, and nothing downstream would object —
  // `settingsOf` strips `flow` as reserved before the kind ever validates the
  // bag. The seat would mint and register as the bag's kind while the row
  // said the column's kind forever, and the row is the only thing read again.
  // What `hireWorkforce` decides is unchanged; what it decides FROM can no
  // longer be shadowed by the row's own settings.
  return {
    manifest: {
      id: seatAddress(owningOrgId, row.seatId, row.ownerUserId),
      declared: { ...row.settings, flow: row.flow },
      body: row.instructions ?? "",
      ownerPin: hiredSeatOwnerPin(owningOrgId, row),
    },
  };
}

/**
 * A stored value, read under `orgId`, as the record a seat is minted from —
 * or the one reason it cannot be.
 *
 * The per-row walk every reader of stored rows needs: parse, apply the
 * owning-org fence, and build the address. The address throws when the org or
 * the seat id cannot be one (a row under `DEFAULT_ORG_ID`, a seat id starting
 * with `~`); here that throw is one row's reason, so a caller walking a roster
 * skips it and keeps the rest. `reloadHiredSeats` and the seats manifest
 * source both read through this, so they agree on which rows count.
 *
 * @returns the record, or a reason. Never throws.
 */
export function hiredSeatManifestFromStored(
  orgId: string,
  stored: unknown
): { manifest: WorkerManifest } | RowProblem {
  const parsed = parseHiredSeatRow(stored);
  if ("problem" in parsed) return parsed;
  try {
    return hiredSeatManifest(orgId, parsed.row);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
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
  const pin = manifest.ownerPin;
  if (pin === undefined || pin.orgId !== orgId) {
    return {
      problem:
        pin === undefined
          ? `"${manifest.id}" declares no owning organization`
          : `"${manifest.id}" is owned by organization "${pin.orgId}", not "${orgId}"`,
    };
  }
  return {
    row: toHiredSeatRow({
      seatId,
      flow,
      settings,
      instructions: manifest.body,
      owningOrgId: pin.orgId,
      ownerUserId: pin.userId ?? null,
    }),
  };
}
