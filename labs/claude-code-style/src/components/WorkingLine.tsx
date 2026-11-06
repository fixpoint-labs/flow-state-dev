import { useNow } from "../lib/use-watch";
import { durationText } from "./flow-state/spend";

/**
 * Three dots that rise in turn: something is happening. They are the lab's one
 * sign of work in progress, in the thread and at the end of a task's feed. The
 * motion is in `styles.css` and stops under *reduce motion*.
 */
export function WorkingDots() {
  return (
    <span aria-hidden className="working-dots flex shrink-0 items-center gap-1">
      <span className="size-1.5 rounded-full bg-info" />
      <span className="size-1.5 rounded-full bg-info" />
      <span className="size-1.5 rounded-full bg-info" />
    </span>
  );
}

/** "Running git status", with the command in mono: a command is code, and it can run to a line of its own. */
function Said({ text }: { text: string }) {
  const command = /^Running ([\s\S]+)$/.exec(text);
  if (command === null) return <>{text}</>;
  return (
    <>
      Running <span className="font-mono text-xs">{command[1]!.replace(/\s+/g, " ")}</span>
    </>
  );
}

/**
 * The live line at the end of a running task's feed: the dots, what the task
 * is doing now on one line (cut at the edge, whole on hover), and how long it
 * has been running, always on the right and never wrapped. The time shows
 * from the first second.
 *
 * @param message What it is doing now; "Working..." when nothing says.
 * @param since When the run started, in ms; no time shows without it.
 */
export function WorkingLine({ message, since }: { message?: string; since?: number }) {
  const now = useNow(since !== undefined);
  const said = message !== undefined && message.length > 0 ? message : "Working...";
  const ran = since === undefined ? 0 : Math.max(0, now - since);
  return (
    <div data-testid="streaming-indicator" role="status" className="flex items-center gap-3 py-1 text-sm text-muted-foreground">
      <WorkingDots />
      <span className="min-w-0 flex-1 truncate" title={said}>
        <Said text={said} />
      </span>
      {ran >= 1000 ? (
        <span data-testid="run-timer" className="shrink-0 text-xs whitespace-nowrap tabular-nums">
          {durationText(ran)}
        </span>
      ) : null}
    </div>
  );
}
