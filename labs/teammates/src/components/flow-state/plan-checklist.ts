/**
 * Pure helpers for the harness plan checklist a coding task shows: how a row's
 * status reads, which step is current, and the line a collapsed checklist names.
 */
import type { PlanStep } from "@flow-state-dev/harness-manager/browser";

export type PlanStatusKind = "pending" | "in_progress" | "completed" | "failed";

/** What the harness's own status word means for the checklist marker. */
export function planStatusKind(status: string | null): PlanStatusKind {
  if (status === null || status.trim() === "") return "pending";
  const norm = status.toLowerCase().replace(/[^a-z]/g, "");
  if (norm === "inprogress" || norm === "running" || norm === "active") return "in_progress";
  if (norm === "completed" || norm === "done" || norm === "complete") return "completed";
  if (norm === "failed" || norm === "cancelled" || norm === "canceled" || norm === "errored" || norm === "error") return "failed";
  if (norm === "pending" || norm === "todo" || norm === "notstarted") return "pending";
  if (norm.includes("fail")) return "failed";
  if (norm.includes("complete") || norm === "applied") return "completed";
  if (norm.includes("progress")) return "in_progress";
  return "pending";
}

const inProgress = (status: string | null) => planStatusKind(status) === "in_progress";

/** The first row in progress, else the first still pending; `-1` when none. */
export function currentPlanIndex(rows: readonly Pick<PlanStep, "status">[]): number {
  const at = rows.findIndex((row) => inProgress(row.status));
  if (at >= 0) return at;
  return rows.findIndex((row) => planStatusKind(row.status) === "pending");
}

/** "Step 2 of 5: Fix the parser", or undefined when there is no current step. */
export function planChecklistSummary(rows: readonly Pick<PlanStep, "title" | "status">[]): string | undefined {
  const at = currentPlanIndex(rows);
  return at < 0 ? undefined : `Step ${at + 1} of ${rows.length}: ${rows[at]!.title}`;
}

/** Short marker label for a row's status kind. */
export function planStatusLabel(kind: PlanStatusKind): string {
  switch (kind) {
    case "in_progress":
      return "In progress";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}