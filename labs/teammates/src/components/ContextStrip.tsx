import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { Fragment, useState, type ReactNode } from "react";
import type { AppContext } from "../../flows/lab-context.mts";
import { HARNESS_DOT, harnessName, harnessState } from "../lib/harness";
import { cn } from "../lib/utils";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";
import { HarnessesPill } from "./HarnessesPill";

/** A borderless control on the settings line. */
const ITEM = "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** The last two segments of a path, `flow-state-dev / implementation`; the whole path when it has fewer. */
function shortFolder(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join(" / ") || path;
}

/** A model as the line names it: its last segment, `claude-opus-5-5` for `anthropic/claude-opus-5-5`. */
const shortModel = (model: string) => model.slice(model.lastIndexOf("/") + 1) || model;

/** What the folder's tooltip says: the whole path, and what a coding worktree of it runs before and after its run. */
function folderDetail(context: Pick<AppContext, "folder" | "setup" | "checks">): string {
  const lines = [`Working folder: ${context.folder}`, "Every coding task works in a worktree of it."];
  // An older server sends neither: say nothing rather than a wrong "none".
  if (context.setup !== undefined) lines.push(`Worktree setup: ${context.setup ?? "none"}`);
  if (context.checks !== undefined) lines.push(`Run checks: ${context.checks.length === 0 ? "none" : context.checks.join("; ")}`);
  return lines.join("\n");
}

// FIX-2403
/**
 * The header's settings line, under the teammate's description: borderless
 * items between small dots, with no bar or divider of their own. The working
 * folder (its last two segments; the tooltip has the whole path and the setup
 * and checks a coding worktree runs), the teammate's model, and its default
 * coding harness, which shows a red dot and a small **Sign in →** when it
 * can't run here. On the right, one *N of M harnesses* control opens each
 * harness's status, its remedy, and Re-check; **Sign in →** opens the same.
 * A folder whose checkout a coding run would refuse shows that problem as an
 * alert. Every value is the server's, read through the lab's `lab-context`
 * and `harness-readiness` flows; the model and harness are the teammate's
 * own when it sets them (Edit), else the lab's.
 */
export function ContextStrip({
  context,
  harnesses,
  onRecheck,
  model,
  harness,
}: {
  context: AppContext | undefined;
  harnesses: HarnessReadinessChipRow[] | undefined;
  onRecheck: () => Promise<unknown>;
  /** The teammate's model. */
  model?: string;
  /** The teammate's default coding harness. */
  harness?: string;
}) {
  const [open, setOpen] = useState(false);
  const entry = harness === undefined ? undefined : harnesses?.find((r) => r.harness === harness);
  const blocked = entry !== undefined && harnessState(entry) === "not-ready";
  const items: ReactNode[] = [
    context === undefined ? (
      <span key="reading" className="px-1.5 text-xs text-text-2">
        Reading the lab's settings…
      </span>
    ) : (
      <span key="folder" className={cn(ITEM, "hover:bg-transparent")} data-testid="context-folder" title={folderDetail(context)}>
        <FolderIcon aria-hidden className="size-3.5 shrink-0 text-text-3" />
        <span className="sr-only">Working folder </span>
        <span className="truncate font-mono">{shortFolder(context.folder)}</span>
      </span>
    ),
    model === undefined ? null : (
      <span key="model" className={cn(ITEM, "hover:bg-transparent")} data-testid="context-model" title={`Model: ${model}`}>
        <span className="sr-only">Model </span>
        <span className="truncate font-mono">{shortModel(model)}</span>
      </span>
    ),
    harness === undefined ? null : (
      <span key="harness" className="inline-flex items-center gap-1" data-testid="context-harness">
        <span className={cn(ITEM, "hover:bg-transparent")} title={`Coding tasks start on ${entry?.label ?? harnessName(harness)} unless a line names another`}>
          <span className="sr-only">Default coding harness </span>
          {blocked ? <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", HARNESS_DOT["not-ready"])} /> : null}
          <span className="truncate">{entry?.label ?? harnessName(harness)}</span>
          {blocked ? <span className="sr-only">, can't run here</span> : null}
        </span>
        {blocked ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center rounded-full bg-attention px-1.5 text-xs leading-[18px] font-semibold text-attention-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
            Sign in →
          </button>
        ) : null}
      </span>
    ),
  ].filter((item) => item !== null);
  const ready = harnesses?.filter((r) => r.ready).length;
  return (
    <section aria-label="Working context" className="flex flex-col gap-1">
      <div className="-ml-1.5 flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i === 0 ? null : <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-text-3" />}
            {item}
          </Fragment>
        ))}
        <span aria-hidden className="flex-1" />
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger className={ITEM} data-testid="context-harnesses">
            {harnesses === undefined ? "Checking harnesses…" : `${ready} of ${harnesses.length} harnesses`}
            <ChevronDownIcon aria-hidden className="size-3.5" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={6}
              aria-label="Coding harnesses on this machine"
              className="z-40 w-72 rounded-lg border border-border bg-card p-1.5 text-foreground shadow-(--shadow-card)"
            >
              <HarnessesPill rows={harnesses} recheck={onRecheck} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {context?.folderProblem == null ? null : (
        <p role="alert" className="text-xs text-danger" data-testid="context-folder-problem">
          Coding tasks will fail here: {context.folderProblem}
        </p>
      )}
    </section>
  );
}
