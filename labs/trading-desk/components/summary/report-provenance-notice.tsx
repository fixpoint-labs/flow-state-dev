/**
 * ReportProvenanceNotice — the one marker that tells a reader a stored report
 * was produced before a data-honesty fix landed (FIX-1063).
 *
 * ONE MARKER, NOT SEVERAL. There will be more than one such fix over time — a
 * later one is expected to mark reports predating a trade-levels correction —
 * and each getting its own banner would stack chrome on exactly the reports a
 * reader already has least reason to trust. So this component renders a single
 * notice and carries the REASONS as details. A new reason is one entry in the
 * caller's list, not a second banner.
 *
 * WHY IT EXISTS AT ALL. Old reports cannot be repaired: nothing in a stored
 * record separates a zero the desk measured from a zero it invented when a
 * provider didn't answer, so any recompute would be a guess. Marking is the
 * only honest option, which makes this notice the entire user-visible half of
 * that decision. Absent stays absent — a report we cannot vouch for says so,
 * rather than looking identical to one we can.
 *
 * It renders NOTHING when there is nothing to disclose, so a current report
 * carries no badge, no "verified" chip, and no chrome. That asymmetry is
 * deliberate: a positive "data verified" stamp would be a status field
 * asserting a check no reader performed, which is the same class of defect
 * this notice exists to disclose.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

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
        generated before a data-honesty fix
      </span>
      <p className="text-[11.5px] text-[color:var(--c-fg-muted)]">
        This report predates a correction to how the desk records data it could
        not obtain. Figures below may include values that were never measured.
        Re-run the analysis for a report produced under the current rules.
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11px] text-[color:var(--c-fg-muted)]">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

/** The reason string for a report produced before the data-honesty contract.
 *  Exported so the reason list is assembled from named constants rather than
 *  literals scattered across call sites. */
export const PRE_DATA_HONESTY_FIX_REASON =
  "A figure the desk could not obtain may be recorded as zero rather than as unavailable.";
