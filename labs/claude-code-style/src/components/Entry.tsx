import type { ThreadEntry } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import { cn } from "../lib/utils";

/**
 * One entry of a thread. Your lines sit in a box on the right; the main
 * session's text is plain; a tool call is one mono line; a background result
 * is a card at the point the main session took it, and so is a thread in
 * threads mode (`ThreadCard`, which the main thread draws).
 */
export function Entry({ entry }: { entry: ThreadEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1">
          <div className="max-w-[80%] border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap" data-entry="user">
            {entry.text}
            {entry.queued ? <span className="mt-1 block text-xs text-muted-foreground">queued · runs when this turn ends</span> : null}
          </div>
          {entry.sentToThread ? <span className="text-xs text-muted-foreground">↳ Sent to a thread</span> : null}
        </div>
      );
    case "assistant":
      return (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" data-entry="assistant">
          {entry.text}
        </p>
      );
    case "tool":
      return (
        <div className="font-mono text-xs text-muted-foreground" data-entry="tool">
          ▸ {entry.name} · {entry.summary}
        </div>
      );
    case "result": {
      const status = TASK_STATUS[entry.status];
      return (
        <section
          aria-label={`Background result: ${entry.title}`}
          data-entry="result"
          data-during-turn={entry.duringTurn ? "true" : "false"}
          className={cn("border px-3 py-2", entry.status === "completed" ? "border-success bg-success/10" : "border-border bg-card")}
        >
          <div className={cn("font-mono text-[10px] tracking-widest uppercase", status.tone)}>
            Background result · {entry.title} · {status.label}
          </div>
          <p className="mt-1 text-sm">{entry.summary}</p>
          {entry.duringTurn ? <p className="mt-0.5 text-xs text-muted-foreground">arrived while this turn was running</p> : null}
        </section>
      );
    }
    case "thread":
      // The main thread draws a thread card from its task row; elsewhere it is the call it was.
      return (
        <div className="font-mono text-xs text-muted-foreground" data-entry="tool">
          ▸ createTask · {entry.taskId}
        </div>
      );
    case "interrupted":
      return (
        <div className="text-xs text-muted-foreground" data-entry="interrupted">
          Interrupted. Background tasks keep running.
        </div>
      );
  }
}
