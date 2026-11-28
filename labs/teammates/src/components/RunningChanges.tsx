/**
 * What a coding run has changed so far, while it works: one quiet collapsed
 * row ("5 files changed (+117 −9) · 2 commits") that opens to the review's own
 * Files list and commits (`RunChanges`, `Fold`, `CommitTimeline`), so the work can
 * be read before the run stops for review.
 *
 * Read live from the run's checkout through harness-manager's run changes
 * view, working tree included (`uncommitted`): a harness edits files well
 * before it commits them. Read when the popup opens, every 30 seconds while
 * folded and every 5 while open, and again on opening. A file opens to its
 * working-tree diff.
 *
 * A run with a checkout and nothing changed yet says "No changes yet", so the
 * row doesn't appear out of nowhere mid-run. Before there is a checkout (still
 * provisioning, or cleaned up), or when the view can't answer, it draws
 * nothing: "no changes" would be a claim nobody read.
 *
 * The popup owns `open`, so it outlives this row's re-renders and carries
 * over to the review's Files list when the run stops for review.
 */
import { useMemo } from "react";
import { useView } from "@flow-state-dev/react";
import { CODER_FLOW, runChangesViewRef, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { ChevronRightIcon } from "lucide-react";
import { useAppClient } from "../app";
import { runPatchReader } from "../lib/run-patch";
import { cn } from "../lib/utils";
import { RunChanges } from "./flow-state/run-changes";
import { CommitTimeline } from "./CommitTimeline";
import { Fold } from "./TaskReview";

const OPEN_POLL_MS = 5_000;
const FOLDED_POLL_MS = 30_000;

export function RunningChanges({ task, open, onOpenChange }: { task: CodingBoardTask; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { client } = useAppClient();
  const sessionId = task.run?.sessionId;
  const readable = sessionId !== undefined && task.runFlow === CODER_FLOW;
  const read = useView(
    runChangesViewRef(),
    { taskId: task.id, uncommitted: true },
    { client, sessionId, pollIntervalMs: open ? OPEN_POLL_MS : FOLDED_POLL_MS, enabled: readable },
  );
  const loadPatch = useMemo(() => runPatchReader(client, task, { uncommitted: true }), [client, task.id, sessionId, task.runFlow]);
  const answer = read.value;
  if (!readable || answer?.diff == null || !answer.diff.verified) return null;
  const { diff } = answer;
  const commits = answer.commits?.verified ? answer.commits : null;
  const commitCount = commits?.count ?? 0;
  if (diff.fileCount === 0 && commitCount === 0) {
    return <p data-running-changes className="px-1 text-xs text-text-3">No changes yet</p>;
  }
  const toggle = () => {
    if (!open) read.refresh();
    onOpenChange(!open);
  };
  return (
    <section data-running-changes aria-label="Changes so far" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs text-text-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span>Changes so far:</span>
        <span>
          {diff.fileCount === 1 ? "1 file changed" : `${diff.fileCount} files changed`}{" "}
          <span className="tabular-nums">
            (<span className="text-success">+{diff.added}</span> <span className="text-destructive">−{diff.removed}</span>)
          </span>
          {commitCount > 0 ? ` · ${commitCount === 1 ? "1 commit" : `${commitCount} commits`}` : ""}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2">
          <RunChanges
            files={diff.files}
            fileCount={diff.fileCount}
            added={diff.added}
            removed={diff.removed}
            {...(loadPatch ? { loadPatch } : {})}
            defaultOpen
            className="rounded-lg border-border bg-card [&>button]:px-3.5 [&>button]:py-2.5"
          />
          {commits !== null && commits.subjects.length > 0 ? (
            <Fold data-running-commits label={commitCount === 1 ? "1 commit" : `${commitCount} commits`}>
              <CommitTimeline commits={commits.log ?? commits.subjects.map((subject) => ({ subject }))} />
            </Fold>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
