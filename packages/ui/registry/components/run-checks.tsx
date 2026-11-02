"use client";

/**
 * A coding run's checks: "Checks 2/2 passed", red when any failed, opening
 * into each command and the end of its output.
 *
 * Takes plain data, so it renders whatever read supplied it: harness-manager
 * puts the results on a run review's stop data (`checks`), on the run record,
 * and on a session turn's record. Each result is a command, how it ended, how
 * long it ran and the last of its output.
 *
 * A red set opens by itself, so the failure is the first thing seen. Draws
 * nothing for `checks: null` or an empty list: no check ran, and "0/0
 * passed" would be a claim.
 */

import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** One check's result. */
export type RunCheck = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  skipped: boolean;
  durationMs: number;
  tail: string;
};

export interface RunChecksProps {
  /** The checks the run's completion check ran, in order, or `null` when none ran. */
  checks: RunCheck[] | null;
  /** Start open. Default: open when any check failed. */
  defaultOpen?: boolean;
  className?: string;
}

/** Whether a check passed: it ran, and exited 0. */
export function runCheckPassed(check: RunCheck): boolean {
  return !check.skipped && !check.timedOut && check.exitCode === 0;
}

/** How a check ended, in a few words. */
function ending(check: RunCheck): string {
  if (check.skipped) return "skipped";
  if (check.timedOut) return "timed out";
  if (check.exitCode === null) return "not run";
  return check.exitCode === 0 ? "passed" : `exit ${check.exitCode}`;
}

const seconds = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

/** One command: whether it passed, how it ended, and its output when opened. */
function CheckRow({ check, defaultOpen }: { check: RunCheck; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const passed = runCheckPassed(check);
  const hasOutput = check.tail.trim() !== "";
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", hasOutput ? "hover:bg-muted/50" : "cursor-default")}
        onClick={hasOutput ? () => setOpen(!open) : undefined}
        aria-expanded={hasOutput ? open : undefined}
        disabled={!hasOutput}
      >
        {passed ? (
          <CheckIcon className="size-3.5 shrink-0 text-success" aria-label="passed" />
        ) : (
          <XIcon className="size-3.5 shrink-0 text-destructive" aria-label="failed" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{check.command}</span>
        <span className={cn("shrink-0 text-xs tabular-nums", passed ? "text-muted-foreground" : "text-destructive")}>
          {ending(check)}
          {check.skipped ? "" : ` · ${seconds(check.durationMs)}`}
        </span>
      </button>
      {open && hasOutput ? (
        <pre className="overflow-x-auto border-t bg-muted/40 px-3 py-2 font-mono text-xs leading-5">{check.tail}</pre>
      ) : null}
    </li>
  );
}

/** "Checks n/m passed", opening into each command and its output. */
export function RunChecks({ checks, defaultOpen, className }: RunChecksProps) {
  const failed = (checks ?? []).filter((check) => !runCheckPassed(check)).length;
  const [open, setOpen] = useState(defaultOpen ?? failed > 0);
  if (checks === null || checks.length === 0) return null;
  const passed = checks.length - failed;
  return (
    <div className={cn("rounded-md border text-sm", failed > 0 && "border-destructive/50", className)} data-state={failed > 0 ? "failed" : "passed"}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className={cn("font-medium", failed > 0 && "text-destructive")}>
          Checks {passed}/{checks.length} passed
        </span>
      </button>
      {open ? (
        <ul className="border-t">
          {checks.map((check, i) => (
            <CheckRow key={`${i}:${check.command}`} check={check} defaultOpen={!runCheckPassed(check)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
