/**
 * The one interpretation of a stored record's organization (FIX-1442).
 *
 * Organization identity is required on everything the framework writes, but a
 * store that predates the requirement holds rows with no organization at all.
 * Those rows are not a shape to repair on read: a missing field contains no
 * evidence of who owned it, and the two ways a runtime could guess — attribute
 * it to the caller who happened to ask, or to the development default — are
 * both "hand somebody another organization's history".
 *
 * So the rule is the one the flow-instance cutover already established in
 * `record-owner.ts`, applied to the second axis: **decode is permissive,
 * admission is strict.** A legacy row still loads, still lists in a diagnostic,
 * and is never rewritten — but it is refused everywhere it would be served,
 * executed, dispatched or swept, with the same `migration-required` answer an
 * unattributable `flowId` gets. The operator attributes it offline (see
 * `apps/docs/docs/persistence/overview.md`) and it comes back.
 *
 * Nothing here trims, defaults or rewrites an organization id. An id is opaque:
 * what the trusted source supplied is what is stored and what is compared.
 */
import { isValidOrgId } from "@flow-state-dev/core";

/** The organization fact every admitted record carries. */
export type OrgAttributedRecord = {
  /** `null` and `undefined` both mean "written before organization was required" (BP-030). */
  orgId?: string | null;
};

/**
 * Raised when a stored record cannot be admitted because nobody ever recorded
 * which organization it belongs to.
 *
 * Deliberately its own error rather than a generic failure: an operator reading
 * a log needs to tell "this data needs attributing" apart from "this caller was
 * refused", because only one of them is fixed by a migration. The record is
 * preserved untouched in every case.
 */
export class UnattributedOrgError extends Error {
  /** Stable discriminator shared with the route layer's 409 body. */
  readonly reason = "migration-required" as const;
  readonly seam: string;

  constructor(seam: string) {
    super(
      `This record was stored before an organization was required, so ${seam} cannot ` +
        `serve it: the runtime will not guess which organization it belongs to. ` +
        `Attribute it offline with the upgrade recipe in the persistence guide, then retry. ` +
        `The record is preserved unchanged.`
    );
    this.name = "UnattributedOrgError";
    this.seam = seam;
  }
}

/**
 * Whether this record carries a usable organization.
 *
 * The predicate every list, sweep and index scan filters on, so an
 * unattributed row is omitted rather than refused where refusing would stop a
 * whole listing for one bad row (BR-14).
 */
export function isOrgAttributed(record: OrgAttributedRecord | undefined): boolean {
  return record !== undefined && isValidOrgId(record.orgId);
}

/**
 * The record's organization, or a refusal.
 *
 * The admission gate every *addressed* path calls — resume, retry, continue,
 * recovery, dispatch — where there is exactly one record in question and
 * silently skipping it would look like success.
 */
export function requireAttributedOrg(
  record: OrgAttributedRecord,
  seam: string
): string {
  if (!isValidOrgId(record.orgId)) throw new UnattributedOrgError(seam);
  return record.orgId;
}
