import { FolderIcon, TriangleAlertIcon } from "lucide-react";
import type { AppContext } from "../../flows/lab-context.mts";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";
import { HarnessesPill } from "./HarnessesPill";
import { harnessName } from "../lib/harness";
import { cn } from "../lib/utils";

/** A setting's chip: label in the secondary colour, value in mono. */
const CHIP = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 text-xs text-text-2";

/** The last two segments of a path, `flow-state-dev / implementation`; the whole path when it has fewer. */
export function shortFolder(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join(" / ") || path;
}

/** What the folder chip's tooltip says: the whole path, and what a coding worktree of it runs before and after its run. */
export function folderDetail(context: Pick<AppContext, "folder" | "setup" | "checks">): string {
  const lines = [`Working folder: ${context.folder}`, "Every coding task works in a worktree of it."];
  // An older server sends neither: say nothing rather than a wrong "none".
  if (context.setup !== undefined) lines.push(`Worktree setup: ${context.setup ?? "none"}`);
  if (context.checks !== undefined) lines.push(`Run checks: ${context.checks.length === 0 ? "none" : context.checks.join("; ")}`);
  return lines.join("\n");
}

/**
 * What the lab works on and with, over the conversation (FIX-2403): the working
 * folder, the default harness, and which coding harnesses can run
 * here, with Re-check. The folder chip shows the folder's last two segments; its
 * tooltip has the whole path and the setup and checks a coding worktree runs. A
 * default harness that can't run here shows as a warning. A folder whose
 * checkout a coding run would refuse shows that problem as an alert. Every value
 * is the server's, read through the lab's `lab-context` and `harness-readiness` flows.
 */
export function ContextStrip({
  context,
  harnesses,
  onRecheck,
}: {
  context: AppContext | undefined;
  harnesses: HarnessReadinessChipRow[] | undefined;
  onRecheck: () => Promise<unknown>;
}) {
  const defaultRow = context === undefined ? undefined : harnesses?.find((row) => row.harness === context.harness);
  // Only a harness the check answered as not ready warns: an unanswered one may still run.
  const defaultDown = defaultRow !== undefined && !defaultRow.ready && !defaultRow.unanswered;
  return (
    <section aria-label="Working context" className="flex flex-col gap-1.5 border-b border-border bg-bg-subtle px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {context === undefined ? (
          <span className="text-xs text-text-2">Reading the lab's settings…</span>
        ) : (
          <>
            <span className={CHIP} data-testid="context-folder" title={folderDetail(context)}>
              <FolderIcon aria-hidden className="size-3.5 shrink-0 text-text-3" />
              <span className="sr-only">Working folder </span>
              <span className="truncate font-mono text-foreground">{shortFolder(context.folder)}</span>
            </span>
            <span
              className={cn(CHIP, defaultDown && "border-warning-line bg-warning-soft text-warning-text")}
              data-testid="context-harness"
              data-ready={defaultDown ? "false" : undefined}
              title={
                defaultDown
                  ? `${harnessName(context.harness)} is the default harness but can't run here: ${[defaultRow.reason, defaultRow.remedy].filter(Boolean).join(". ")}`
                  : "The harness a coding worker whose file names none runs on"
              }
            >
              {defaultDown ? <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" /> : null}
              Default harness <span className={defaultDown ? "font-medium" : "text-foreground"}>{harnessName(context.harness)}</span>
              {defaultDown ? <span className="sr-only"> (not ready)</span> : null}
            </span>
          </>
        )}
        <HarnessesPill rows={harnesses} recheck={onRecheck} />
      </div>
      {context?.folderProblem == null ? null : (
        <p role="alert" className="text-xs text-danger" data-testid="context-folder-problem">
          Coding tasks will fail here: {context.folderProblem}
        </p>
      )}
    </section>
  );
}
