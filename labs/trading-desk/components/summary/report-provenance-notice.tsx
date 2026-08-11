/**
 * ReportProvenanceNotice — the one marker that tells a reader a stored report
 * was produced before some correction to the desk landed (FIX-1063).
 *
 * ONE MARKER, NOT SEVERAL. There is more than one such fix — the data-honesty
 * contract (FIX-1063) and the flat-stance trade-levels labeling (FIX-780) —
 * and each getting its own banner would stack chrome on exactly the reports a
 * reader already has least reason to trust. So this component renders a single
 * notice and carries the REASONS as details. A new reason is one entry in the
 * caller's list, not a second banner.
 *
 * THE SHARED COPY ASSERTS NO CAUSE. The heading and body say only that the
 * report predates a correction; WHICH correction, and what it means for the
 * numbers, lives in the per-reason entries. This is not style — the moment a
 * component takes a list of reasons, its shared copy cannot describe any one
 * reason's cause, because copy that names a cause can serve exactly one entry
 * and makes the list decorative. It also actively misinforms: this file's first
 * version said "figures below may include values that were never measured",
 * which is true of a pre-honesty-contract report and FALSE of a legacy flat
 * report, whose two price levels WERE measured — only the labeling of which is
 * which was lost. A false alarm about good numbers is the mirror image of the
 * defect these notices exist to disclose. Keep the shared copy neutral; put the
 * specifics in the reason.
 *
 * WHY IT EXISTS AT ALL. Old reports cannot be repaired: nothing in a stored
 * record separates a zero the desk measured from a zero it invented when a
 * provider didn't answer, and nothing recovers which of a flat report's two
 * levels was the stop. Any recompute would be a guess. Marking is the only
 * honest option, which makes this notice the entire user-visible half of that
 * decision. Absent stays absent — a report we cannot vouch for says so, rather
 * than looking identical to one we can.
 *
 * It renders NOTHING when there is nothing to disclose, so a current report
 * carries no badge, no "verified" chip, and no chrome. That asymmetry is
 * deliberate: a positive "data verified" stamp would be a status field
 * asserting a check no reader performed, which is the same class of defect
 * this notice exists to disclose.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/**
 * The notice's shared copy — the half that every reason has to share.
 *
 * Exported as constants so the neutrality rule above is ENFORCEABLE rather than
 * advisory: `test/report-provenance-notice.spec.ts` asserts this copy names no
 * cause, which is the check a third consumer would otherwise have to re-derive
 * from the header comment.
 */
export const PROVENANCE_NOTICE_HEADING = "generated before a correction";
export const PROVENANCE_NOTICE_BODY =
  "This report predates one or more corrections to the desk, listed below. " +
  "Re-run the analysis for a report produced under the current rules.";

export type ReportProvenanceNoticeProps = {
  /** The reasons this report is flagged. Empty → nothing renders. */
  reasons: readonly string[];
};

export function ReportProvenanceNotice({
  reasons,
}: ReportProvenanceNoticeProps): ReactElement | null {
  if (reasons.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3",
        "border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10",
      )}
      data-testid="report-provenance-notice"
    >
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-warn)]">
        {PROVENANCE_NOTICE_HEADING}
      </span>
      <p className="text-[11.5px] text-[color:var(--c-fg-muted)]">
        {PROVENANCE_NOTICE_BODY}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11px] text-[color:var(--c-fg-muted)]">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The reason string for a report produced before the data-honesty contract.
 *
 * Exported so the reason list is assembled from named constants rather than
 * literals scattered across call sites. Each reason is SELF-CONTAINED — it
 * names its own correction and what that means for the numbers, because the
 * notice's shared copy deliberately asserts no cause (see the header). Write a
 * new one the same way; do not lean on the body to finish the sentence.
 */
export const PRE_DATA_HONESTY_FIX_REASON =
  "A figure the desk could not obtain may be recorded as zero rather than as " +
  "unavailable, so a number shown below may never have been measured.";
