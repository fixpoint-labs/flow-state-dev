/**
 * The first row of every mode's rail: the way back to the picker, and the
 * mode's name. Switching modes goes through the picker, so this is the only
 * link between them.
 */
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** The rail's header row for the mode named `label`. */
export function ModeRailHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-2" data-testid="mode-rail-header">
      <Link
        href="/"
        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label="Back to the modes"
        title="Back to the modes"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Modes
      </Link>
      <span className="truncate text-sm font-medium" data-testid="mode-name">
        {label}
      </span>
    </div>
  );
}
