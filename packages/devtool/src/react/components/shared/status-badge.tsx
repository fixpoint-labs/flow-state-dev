import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

// Covers both request statuses and suspension statuses (approved/rejected/
// pending/timed_out/expired/stopped) since the Suspensions view renders the latter
// through the same badge. Unknown values fall back to the neutral style.
export type RequestStatusLabel =
  | "completed" | "in_progress" | "finishing" | "failed" | "incomplete" | "created" | "suspended"
  | "pending" | "approved" | "rejected" | "submitted" | "skipped" | "timed_out" | "expired" | "stopped" | "cancelled";

/**
 * The brand's state vocabulary, by meaning: done (green), live (blue), failed
 * (red), waiting on a person (highlighter), and not-run / idle (dashed ink).
 * Each pairs the badge's label colour with its square glyph.
 */
type StatusTone = { badge: string; glyph: string };

const ok: StatusTone = { badge: "text-fs-green", glyph: "bg-fs-green" };
const active: StatusTone = { badge: "text-fs-blue", glyph: "bg-fs-blue" };
const error: StatusTone = { badge: "text-fs-red", glyph: "bg-fs-red" };
const needsYou: StatusTone = { badge: "bg-fs-hl text-fs-on-hl", glyph: "bg-fs-on-hl" };
const idle: StatusTone = { badge: "text-fs-ink3", glyph: "border border-dashed border-fs-ink3" };

const statusStyles: Record<RequestStatusLabel, StatusTone> = {
  completed: ok,
  in_progress: active,
  finishing: active,
  failed: error,
  incomplete: idle,
  created: idle,
  suspended: needsYou,
  // Suspension lifecycle statuses
  pending: needsYou,
  approved: ok,
  rejected: error,
  submitted: ok,
  skipped: idle,
  timed_out: error,
  expired: idle,
  stopped: idle,
  cancelled: idle,
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = statusStyles[status as RequestStatusLabel] ?? statusStyles.created;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent px-1.5 py-0 text-[10.5px]", tone.badge, className)}
    >
      <span aria-hidden="true" className={cn("size-[7px] shrink-0 box-border", tone.glyph)} />
      {status}
    </Badge>
  );
}
