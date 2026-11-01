"use client";

import { CheckIcon, CopyIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Where a coding run's work went: its branch, how many commits it made, and
 * copy buttons for the commands that take a person there.
 *
 * Takes plain props, so the registry depends on no server package. The shape
 * is what `workPlace` in `@flow-state-dev/harness-manager` returns, from a
 * coding task's output or the worktree row a harness session points at:
 * `<WorkPlace place={workPlace(task.output)} />`. A row adds the worktree's
 * name, its state when it is not ready, and whose it is for a session attached
 * to another's worktree. Renders nothing for a run with no branch (`place` null).
 */
export interface WorkPlaceProps {
  place: {
    branch: string;
    /** `null` when the count is unknown: no base was recorded, or git couldn't read it. */
    commits: number | null;
    /** The worktree's descriptive name, when known. */
    name?: string | null;
    /** The worktree's state; anything but `ready` is shown (`removed`, `lost`, ...). */
    state?: string | null;
    /** The session that owns the worktree, when the viewer is attached to it. */
    attachedTo?: string | null;
    commands: { switch: string; cd: string | null; log: string | null };
  } | null;
  className?: string;
}

/** `3 commits`, `1 commit`, or `commits unknown`. */
export function commitsLabel(commits: number | null): string {
  if (commits === null) return "commits unknown";
  return `${commits} ${commits === 1 ? "commit" : "commits"}`;
}

/** The branch's last segments, so a long one still names the run: `…/t-7f3c--code`. */
export function shortBranch(branch: string, keep = 2): string {
  const parts = branch.split("/");
  return parts.length <= keep ? branch : `…/${parts.slice(-keep).join("/")}`;
}

function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing copied; the command is still in the button's title to select by hand.
    }
  };
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <button
      type="button"
      onClick={copy}
      title={command}
      aria-label={`Copy ${command}`}
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono hover:bg-muted"
    >
      <Icon size={11} aria-hidden />
      {label}
    </button>
  );
}

export function WorkPlace({ place, className }: WorkPlaceProps) {
  if (place === null) return null;
  return (
    <span
      data-testid="work-place"
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <GitBranchIcon size={12} aria-hidden />
      {place.name != null && <span className="font-medium text-foreground">{place.name}</span>}
      <span>
        {commitsLabel(place.commits)} on{" "}
        <span className="font-mono text-foreground" title={place.branch}>
          {shortBranch(place.branch)}
        </span>
      </span>
      {place.state != null && place.state !== "ready" && <span className="text-warning">{place.state}</span>}
      {place.attachedTo != null && <span>attached to {place.attachedTo}</span>}
      <CopyCommand label="git switch" command={place.commands.switch} />
      {place.commands.cd !== null && <CopyCommand label="cd" command={place.commands.cd} />}
      {place.commands.log !== null && <CopyCommand label="git log" command={place.commands.log} />}
    </span>
  );
}
