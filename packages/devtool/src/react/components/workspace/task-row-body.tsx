/**
 * The open half of a Tasks-tab row: everything the task carries, in place.
 *
 * A field list for the fields a reader looks for, and the raw record folded
 * at the bottom as the complete backstop — a field the list does not know
 * about is still one click away, unchanged. A field the task does not carry
 * is left out rather than shown as an empty slot.
 *
 * Every value wraps or scrolls inside the row. A stack trace or one unbroken
 * token must never widen the pane, which is what made the old floating
 * expander unreadable.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { ResolvedTask } from "../../lib/task-collection-state";

type Props = {
  entry: ResolvedTask;
  /** The id the row's toggle names in `aria-controls`. */
  id: string;
  /** Rendered after the field list; the row's actions live here. */
  children?: ReactNode;
};

/** Wrap anywhere: a value may be one unbroken token. */
const WRAP = "whitespace-pre-wrap [overflow-wrap:anywhere]";

export function TaskRowBody({ entry, id, children }: Props) {
  const { task } = entry;
  const fields: Array<[string, ReactNode]> = [];
  const add = (label: string, value: ReactNode | undefined, present: boolean) => {
    if (present) fields.push([label, value]);
  };

  add("Id", <span className="font-mono">{task.id}</span>, true);
  add("Goal", task.goal, true);
  add("Title", task.title, task.title !== undefined);
  add("Context", task.context, task.context !== undefined);
  add("Status", task.status, true);
  add(
    "Attempts",
    task.maxAttempts === undefined ? String(task.attempts ?? 0) : `${task.attempts ?? 0} / ${task.maxAttempts}`,
    task.attempts !== undefined || task.maxAttempts !== undefined
  );
  add("Assignee", task.assignee, task.assignee !== undefined);
  add("Priority", String(task.priority), task.priority !== undefined);
  add("Labels", task.labels?.join(", "), task.labels !== undefined && task.labels.length > 0);
  add("Deps", task.deps?.join(", "), task.deps !== undefined && task.deps.length > 0);
  // Keyed on presence and rendered as stored, as the collapsed slot is.
  add("Reason", task.feedback, task.feedback !== undefined);
  add("Error", task.error, task.error !== undefined);
  add("Input", <JsonBlock value={task.input} />, task.input !== undefined);
  add("Output", <JsonBlock value={task.output} />, task.output !== undefined);
  add("Metadata", <JsonBlock value={task.metadata} />, task.metadata !== undefined);
  add("Revision", String(task.revision), task.revision !== undefined);
  add("Created", formatTime(task.createdAt), task.createdAt !== undefined);
  add("Updated", formatTime(task.updatedAt), task.updatedAt !== undefined);
  add("Started", formatTime(task.startedAt), task.startedAt !== undefined);
  add("Completed", formatTime(task.completedAt), task.completedAt !== undefined);
  add("Lease until", formatTime(task.leaseUntil), task.leaseUntil !== undefined);
  add(
    "Latest change",
    [
      entry.kind ?? "—",
      entry.prevStatus !== undefined ? ` (was ${entry.prevStatus})` : "",
      entry.changeCount > 1 ? ` ×${entry.changeCount}` : "",
    ].join(""),
    true
  );

  return (
    <div id={id} className="min-w-0 border-t border-slate-800/60 bg-slate-950/40 px-3 py-2">
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className={`min-w-0 text-slate-200 ${WRAP}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {children}
      <RawJson task={task} />
    </div>
  );
}

/** A structured value, scrolling inside its own box. */
function JsonBlock({ value }: { value: unknown }) {
  return (
    <code className={`block max-h-48 overflow-auto rounded bg-slate-950 px-1.5 py-1 font-mono text-[11px] text-slate-300 ${WRAP}`}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </code>
  );
}

/**
 * The whole record, folded. Mounted only when opened, so a board of open rows
 * does not re-serialize every task on each streamed change.
 */
function RawJson({ task }: { task: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        Raw JSON
      </button>
      {open && (
        <pre
          data-raw-json
          className={`mt-1 max-h-96 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-slate-300 ${WRAP}`}
        >
          {JSON.stringify(task, null, 2)}
        </pre>
      )}
    </div>
  );
}

function formatTime(ms: number | undefined): string {
  if (ms === undefined) return "";
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? String(ms) : date.toISOString();
}
