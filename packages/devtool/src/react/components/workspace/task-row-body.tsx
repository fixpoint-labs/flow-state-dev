/**
 * The open half of a Tasks-tab row: everything the task carries, in place.
 *
 * A field list for the fields a reader looks for, then every other field the
 * task carries under its own name, and the raw record folded at the bottom,
 * complete and unchanged. Short values sit in a hairline grid; prose and
 * structured values get a full-width line of their own below it. A field the task does not carry is left out rather
 * than shown as an empty slot.
 *
 * Every value wraps or scrolls inside the row. A stack trace or one unbroken
 * token must never widen the pane, which is what made the old floating
 * expander unreadable.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { waitPrompt, type ResolvedTask } from "../../lib/task-collection-state";

type Props = {
  entry: ResolvedTask;
  /** The id the row's toggle names in `aria-controls`. */
  id: string;
  /** Rendered after the field list; the row's actions live here. */
  children?: ReactNode;
};

/** The task fields the list above shows under a label of its own. */
const LISTED_FIELDS = new Set([
  "id",
  "goal",
  "title",
  "context",
  "status",
  "attempts",
  "maxAttempts",
  "assignee",
  "priority",
  "labels",
  "deps",
  "feedback",
  "error",
  "input",
  "output",
  "metadata",
  "revision",
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
  "leaseUntil",
]);

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function listText(list: readonly string[] | undefined): string {
  return list === undefined || list.length === 0 ? "none" : list.join(", ");
}

/** Wrap anywhere: a value may be one unbroken token. */
const WRAP = "whitespace-pre-wrap [overflow-wrap:anywhere]";

export function TaskRowBody({ entry, id, children }: Props) {
  const { task } = entry;
  const fields: Array<[string, ReactNode]> = [];
  const wide: Array<[string, ReactNode]> = [];
  const add = (label: string, value: ReactNode | undefined, present: boolean, isWide = false) => {
    if (present) (isWide ? wide : fields).push([label, value]);
  };

  add("Id", task.id, true);
  add("Goal", <span className="font-fs-sans">{task.goal}</span>, true, true);
  add("Title", <span className="font-fs-sans">{task.title}</span>, task.title !== undefined, true);
  add("Context", <span className="font-fs-sans">{task.context}</span>, task.context !== undefined, true);
  add("Status", task.status, true);
  add(
    "Attempts",
    task.maxAttempts === undefined ? String(task.attempts ?? 0) : `${task.attempts ?? 0} / ${task.maxAttempts}`,
    task.attempts !== undefined || task.maxAttempts !== undefined
  );
  add("Assignee", task.assignee, task.assignee !== undefined);
  add("Priority", String(task.priority), task.priority !== undefined);
  // A carried empty list is shown as such, apart from an absent one.
  add("Labels", listText(task.labels), task.labels !== undefined);
  add("Deps", listText(task.deps), task.deps !== undefined);
  // Keyed on presence and rendered as stored, as the collapsed slot is.
  add("Waiting for", waitPrompt(task), waitPrompt(task) !== undefined, true);
  add("Reason", task.feedback, task.feedback !== undefined, true);
  add("Error", <span className="text-fs-red">{task.error}</span>, task.error !== undefined, true);
  add("Input", <JsonBlock value={task.input} />, task.input !== undefined, true);
  add("Output", <JsonBlock value={task.output} />, task.output !== undefined, true);
  add("Metadata", <JsonBlock value={task.metadata} />, task.metadata !== undefined, true);
  add("Revision", String(task.revision), task.revision !== undefined);
  add("Created", formatTime(task.createdAt), task.createdAt !== undefined);
  add("Updated", formatTime(task.updatedAt), task.updatedAt !== undefined);
  add("Started", formatTime(task.startedAt), task.startedAt !== undefined);
  add("Completed", formatTime(task.completedAt), task.completedAt !== undefined);
  add("Lease until", formatTime(task.leaseUntil), task.leaseUntil !== undefined);
  // Every other field the task carries, under its own name: retry and
  // write-provenance fields, and whatever a later substrate adds.
  for (const [key, value] of Object.entries(task)) {
    if (LISTED_FIELDS.has(key) || value === undefined) continue;
    if (isScalar(value)) add(key, String(value), true);
    else add(key, <JsonBlock value={value} />, true, true);
  }
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
    <div id={id} className="min-w-0 border-t border-fs-ink/12 bg-fs-card">
      {/* The negative margins tuck the last column's and last row's hairlines
          under the clip, so the grid never doubles the card's own border. */}
      <div className="min-w-0 overflow-hidden border-b border-fs-ink/12">
        <dl className="-mb-px -mr-px grid min-w-0 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] font-fs-mono">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0 border-b border-r border-fs-ink/12 px-3 py-2">
              <dt className="text-[10.5px] text-fs-ink4">{label}</dt>
              <dd className={`min-w-0 text-[12.5px] font-medium text-fs-ink ${WRAP}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {wide.length > 0 && (
        <dl className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-2.5">
          {wide.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="pt-0.5 font-fs-mono text-[10px] font-medium uppercase tracking-[.12em] text-fs-ink4">
                {label}
              </dt>
              <dd className={`min-w-0 font-fs-mono text-[12px] text-fs-ink2 ${WRAP}`}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children != null && (
        <div className="min-w-0 border-t border-fs-ink/12 px-3 pb-2.5">{children}</div>
      )}
      <RawJson task={task} />
    </div>
  );
}

/** A structured value, scrolling inside its own box. */
function JsonBlock({ value }: { value: unknown }) {
  return (
    <code className={`block max-h-48 overflow-auto border border-fs-ink/12 bg-fs-paper px-2 py-1.5 font-fs-mono text-[11.5px] leading-[1.55] text-fs-ink2 ${WRAP}`}>
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
    <div className="border-t border-fs-ink/12">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-1 px-3 py-[7px] font-fs-mono text-[11px] lowercase text-fs-ink3 outline-none hover:text-fs-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fs-blue/40"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        Raw JSON
      </button>
      {open && (
        <pre
          data-raw-json
          className={`m-0 max-h-96 overflow-auto px-3 pb-3 font-fs-mono text-[11.5px] leading-[1.55] text-fs-ink2 ${WRAP}`}
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
