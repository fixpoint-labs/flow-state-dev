/**
 * A teammate panel's *Pull Requests* tab: the pull requests its tasks' runs
 * opened (`lib/pull-requests`), open ones first, then merged or closed ones.
 * Each row links to the pull request on GitHub (plain text when its link
 * isn't a github.com address), gives its state as its run
 * last saw it, and names its task, which opens in the task popup.
 */
import { GitMergeIcon, GitPullRequestArrowIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon } from "lucide-react";
import { isOpenPullRequest, type TeammatePullRequest } from "../lib/pull-requests";
import { taskPresentation } from "../lib/task-presentation";
import { cn } from "../lib/utils";
import type { Popup } from "./Popups";

/** Each state's icon and colour; an unknown state draws as open. */
const STATES: Record<string, { icon: typeof GitMergeIcon; tone: string }> = {
  open: { icon: GitPullRequestArrowIcon, tone: "text-success-text" },
  draft: { icon: GitPullRequestDraftIcon, tone: "text-text-3" },
  merged: { icon: GitMergeIcon, tone: "text-brand" },
  closed: { icon: GitPullRequestClosedIcon, tone: "text-destructive" },
};

/** The tab's content: `rows` grouped, or the empty line; nothing until the first read settles. */
export function PullRequestsList({ rows, sessionId, onOpen }: { rows: readonly TeammatePullRequest[] | undefined; sessionId: string; onOpen: (popup: Popup) => void }) {
  if (rows === undefined) return null;
  if (rows.length === 0) return <p className="text-xs text-text-3">No pull requests yet.</p>;
  const open = rows.filter(isOpenPullRequest);
  const ended = rows.filter((r) => !isOpenPullRequest(r));
  const group = (label: string, heading: string, list: readonly TeammatePullRequest[]) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-text-3">{heading}</h3>
        <ul aria-label={label} className="flex flex-col gap-2">
          {list.map((pr) => (
            <PullRequestRow key={`${pr.repository ?? ""}#${pr.number}`} pr={pr} onTask={() => onOpen({ kind: "task", sessionId, taskId: pr.task.id })} />
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {group("Open pull requests", "Open", open)}
      {group("Merged or closed pull requests", "Merged or closed", ended)}
    </div>
  );
}

function PullRequestRow({ pr, onTask }: { pr: TeammatePullRequest; onTask: () => void }) {
  const look = STATES[pr.state] ?? STATES.open!;
  const Icon = look.icon;
  const heading = (
    <>
      <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", look.tone)} />
      <span className="min-w-0">
        <span className="font-mono text-text-3">#{pr.number}</span> <span className="line-clamp-2 inline">{pr.title ?? pr.repository ?? "Pull request"}</span>
      </span>
    </>
  );
  return (
    <li data-pull-request={pr.number} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-xs shadow-(--shadow-card)">
      {pr.url === null ? (
        <span className="flex items-start gap-2 text-sm leading-snug font-medium">{heading}</span>
      ) : (
        <a href={pr.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-sm leading-snug font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {heading}
        </a>
      )}
      <span className="flex min-w-0 items-center gap-2 text-text-3">
        <span data-pr-state className={cn("shrink-0", look.tone)}>
          {pr.state}
        </span>
        {pr.repository === null ? null : <span className="min-w-0 truncate font-mono">{pr.repository}</span>}
        {/* The CI badge goes here, once the checks are read. */}
        {pr.attention ? <span className={cn("ml-auto shrink-0 rounded-full px-1.5 py-px", taskPresentation(pr.task).pill)}>waiting on you</span> : null}
      </span>
      <button
        type="button"
        onClick={onTask}
        title="Open its task"
        className="w-fit max-w-full truncate text-left text-text-2 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {pr.task.title}
      </button>
    </li>
  );
}
