/**
 * A run's commits as a vertical timeline, newest first: a thin rail with a dot
 * per commit, each with its subject (wrapped), its short sha (copies the full
 * one), how long ago it was made (the exact time on hover) and its author when
 * that isn't the run's own. The one commits list of the review body and the
 * running "Changes so far".
 *
 * Merges of the base into the branch are noise here: a run of consecutive
 * ones folds into one muted entry ("3 merges from main") on a hollow dot,
 * which opens to list them. A conventional-commit prefix (`fix(scope):`)
 * becomes a small type chip, so the subject reads as what it says.
 *
 * Takes harness-manager's commit log when the read carried one; an older
 * read's bare subjects draw the same rail without sha, time or author, a
 * merge found by its subject.
 */
import { useState } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { cn } from "../lib/utils";

/** One commit, as harness-manager's commit log reads it. */
export interface TimelineCommit {
  sha?: string;
  subject: string;
  author?: string;
  /** When it was authored, ISO 8601. */
  at?: string;
  merge?: boolean;
}

/** A merge by its subject, for a read that carried subjects alone. */
const MERGE_SUBJECT = /^Merge (branch|remote-tracking branch|pull request) /;

/** Where a merge came from: "main", "origin/main", or a branch. */
function mergeSource(subject: string): string | null {
  const match = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject);
  return match ? match[1]!.replace(/^origin\//, "") : null;
}

const TYPES = new Set(["feat", "fix", "test", "docs", "chore", "refactor", "perf", "build", "ci", "style", "revert"]);

/** A conventional-commit subject's type and scope, and the rest; `null` type when it isn't one. */
export function conventional(subject: string): { type: string | null; scope: string | null; text: string } {
  const match = /^(\w+)(?:\(([^)]*)\))?!?:\s+(.+)$/.exec(subject);
  if (match === null || !TYPES.has(match[1]!.toLowerCase())) return { type: null, scope: null, text: subject };
  return { type: match[1]!.toLowerCase(), scope: match[2] ?? null, text: match[3]! };
}

/** The timeline's entries: each commit, and each run of consecutive merges as one group. Exported for its test. */
export function timelineEntries(commits: readonly TimelineCommit[]): Array<{ kind: "commit"; commit: TimelineCommit } | { kind: "merges"; commits: TimelineCommit[] }> {
  const entries: Array<{ kind: "commit"; commit: TimelineCommit } | { kind: "merges"; commits: TimelineCommit[] }> = [];
  for (const commit of commits) {
    const merge = commit.merge ?? MERGE_SUBJECT.test(commit.subject);
    const last = entries.at(-1);
    if (merge && last?.kind === "merges") last.commits.push(commit);
    else if (merge) entries.push({ kind: "merges", commits: [commit] });
    else entries.push({ kind: "commit", commit });
  }
  return entries;
}

/** "3 merges from main", or "2 merges" when they came from more than one place. */
function mergesLabel(commits: readonly TimelineCommit[]): string {
  const sources = new Set(commits.map((commit) => mergeSource(commit.subject)));
  const from = sources.size === 1 && !sources.has(null) ? ` from ${[...sources][0]}` : "";
  return `${commits.length === 1 ? "1 merge" : `${commits.length} merges`}${from}`;
}

/** How long ago, coarsely: "just now", "4m ago", "3h ago", "2d ago". */
export function ago(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The author most of the commits name: the run's own identity, whose name the timeline leaves off. */
function runAuthor(commits: readonly TimelineCommit[]): string | null {
  const counts = new Map<string, number>();
  for (const commit of commits) if (commit.author) counts.set(commit.author, (counts.get(commit.author) ?? 0) + 1);
  let best: string | null = null;
  for (const [author, n] of counts) if (best === null || n > counts.get(best)!) best = author;
  return best;
}

/** The short sha, a button that copies the full one. */
function Sha({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(sha).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the commit's sha"
      aria-label={copied ? `Copied ${sha.slice(0, 7)}` : `Copy ${sha.slice(0, 7)}`}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {sha.slice(0, 7)}
      {copied ? <CheckIcon aria-hidden className="size-3" /> : <CopyIcon aria-hidden className="size-3 opacity-60" />}
    </button>
  );
}

/** A commit's line under its subject: sha, time, author. */
function Meta({ commit, own, now }: { commit: TimelineCommit; own: string | null; now: number }) {
  const parts = [
    commit.sha ? <Sha key="sha" sha={commit.sha} /> : null,
    commit.at ? (
      <time key="at" dateTime={commit.at} title={new Date(commit.at).toLocaleString()}>
        {ago(commit.at, now)}
      </time>
    ) : null,
    commit.author && commit.author !== own ? <span key="by">by {commit.author}</span> : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-3">{parts}</div>;
}

/** A rail dot: filled for a commit, hollow for merges. */
function Dot({ hollow }: { hollow?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-[7px] -left-[18px] size-[9px] rounded-full border-2",
        hollow ? "border-text-3 bg-card" : "border-card bg-text-2 ring-1 ring-text-3/40",
      )}
    />
  );
}

/** One commit: its type chip and subject, and its meta line. */
function CommitEntry({ commit, own, now }: { commit: TimelineCommit; own: string | null; now: number }) {
  const { type, scope, text } = conventional(commit.subject);
  return (
    <li data-commit className="relative flex flex-col gap-0.5">
      <Dot />
      <div className="text-sm leading-snug text-foreground [overflow-wrap:anywhere]">
        {type !== null ? (
          <span data-commit-type className="mr-1.5 inline-block rounded border border-border px-1 py-px align-[1px] font-mono text-xs leading-none text-text-3">
            {type}
            {scope !== null ? <span className="text-text-3/70">·{scope}</span> : null}
          </span>
        ) : null}
        {text}
      </div>
      <Meta commit={commit} own={own} now={now} />
    </li>
  );
}

/** A run of merges: one muted entry on a hollow dot, opening to each. */
function MergeGroup({ commits, own, now }: { commits: TimelineCommit[]; own: string | null; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-merges className="relative flex flex-col gap-1">
      <Dot hollow />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1 self-start text-xs text-text-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRightIcon aria-hidden className={cn("size-3 transition-transform", open && "rotate-90")} />
        {mergesLabel(commits)}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5 pl-4">
          {commits.map((commit, i) => (
            <li key={commit.sha ?? i} className="flex flex-col gap-0.5 text-xs text-text-3 [overflow-wrap:anywhere]">
              <span>{commit.subject}</span>
              <Meta commit={commit} own={own} now={now} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A run's commits, newest first, as a timeline. `now` is for the test; default the clock. */
export function CommitTimeline({ commits, now = Date.now() }: { commits: readonly TimelineCommit[]; now?: number }) {
  const own = runAuthor(commits);
  return (
    <ol data-commit-timeline className="relative ml-[22px] flex flex-col gap-3 border-l border-border py-0.5 pl-[13px] [&>li]:-ml-px">
      {timelineEntries(commits).map((entry, i) =>
        entry.kind === "commit" ? (
          <CommitEntry key={entry.commit.sha ?? `c${i}`} commit={entry.commit} own={own} now={now} />
        ) : (
          <MergeGroup key={`m${i}`} commits={entry.commits} own={own} now={now} />
        ),
      )}
    </ol>
  );
}
