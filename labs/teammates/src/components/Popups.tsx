import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardTask, LabAdapter, TalkRow, WorkerRow, WorkingNow } from "../adapter";
import { harnessName } from "../lib/harness";
import type { Look } from "../lib/looks";
import { useWatch } from "../lib/use-watch";
import { Avatar } from "./Avatar";
import { ErrorBody } from "./flow-state/error";
import { MarkdownText } from "./flow-state/message-response";
import { ReviewHold } from "./flow-state/review-hold";
import { Spend } from "./flow-state/spend";
import { StreamingIndicator } from "./flow-state/streaming-indicator";
import { TaskActions, type TaskRerunOption } from "./flow-state/task-actions";
import { workingStatus } from "./flow-state/working-status";
import { SessionPopup, Steps } from "./SessionPopup";

/** What a popup shows: a task one conversation filed, or one message a worker sent. */
export type Popup =
  | { kind: "task"; sessionId: string; taskId: string }
  | { kind: "message"; from: string; to: string; messageId: string; text: string };

/** "Draft the PM role" as it reads after "Asked writer to". */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A task's line, the same in the thread and on the popup: a coding task, or what was asked of whom. */
export function taskLine(task: { title: string; to: string }, coding: boolean, nameOf: (id: string) => string): string {
  return coding ? `Coding task: ${task.title}` : `Asked ${nameOf(task.to)} to ${lowerFirst(task.title)}`;
}

/** What a coding task runs on, as its line names it: the harness, and the model when its run reported one. */
export function runsOn(task: { harness?: string; model?: string }): string | undefined {
  if (task.harness === undefined) return undefined;
  return task.model === undefined ? task.harness : `${task.harness} · ${task.model}`;
}

/** A coding task line's accessible name: its line, and what it runs on. */
export const taskLabel = (line: string, task: { harness?: string; model?: string }) => {
  const on = runsOn(task);
  return on === undefined ? line : `${line}, on ${on}`;
};

/**
 * The coding workers a coding task can be re-run on: each one whose
 * `harness:` differs from the harness of the worker the task was filed for.
 * A task that isn't a coding task, or whose worker's harness isn't known, has none.
 */
function rerunTargets(task: Pick<BoardTask, "to">, coders: readonly WorkerRow[]): WorkerRow[] {
  const own = coders.find((w) => w.id === task.to)?.harness;
  if (own === undefined) return [];
  return coders.filter((w) => w.takesTasks && w.harness !== undefined && w.harness !== own);
}

/** How a sent message stands. */
export type AnswerState = "working" | "replied" | "no answer";

/**
 * How a message stands, from the message log: `replied` by a reply message
 * (one a waited send took as its result is in the log too); `no answer` when
 * the reply is the framework's "no answer"; `working` until then.
 */
export const answerIn = (talk: readonly TalkRow[], messageId: string): AnswerState => {
  const reply = talk.find((row) => row.inReplyTo === messageId);
  if (reply !== undefined) return reply.noAnswer === true ? "no answer" : "replied";
  return "working";
};

/** The open popup, live: it reads what it shows by itself, so it stays current while the work goes on. */
export function PopupView({ adapter, popup, nameOf, lookOf, isCoding, coders, onClose, onMissing }: {
  adapter: LabAdapter;
  popup: Popup;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  /** The roster's coding workers: a failed or cancelled coding task can be re-run on another's harness. */
  coders: readonly WorkerRow[];
  onClose: () => void;
  /** A task popup's conversation holds no such task, once its tasks are read: a link to a task that is gone. */
  onMissing?: () => void;
}) {
  return popup.kind === "task" ? (
    // Keyed by conversation: a switch never judges the task against the last conversation's rows.
    <TaskPopup key={popup.sessionId} adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} coders={coders} onClose={onClose} onMissing={onMissing} />
  ) : (
    <MessagePopup adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} onClose={onClose} />
  );
}

/**
 * A task's run session and its result (or, done with none written, a line
 * saying so), with its action row: Cancel and Steer
 * while it is open (the popup has no composer, so Steer is its own box),
 * Release while held, Retry and a Re-run per other harness once it failed or
 * was cancelled. The board decides each; the row shows its words.
 */
function TaskPopup({ adapter, popup, nameOf, lookOf, isCoding, coders, onClose, onMissing }: {
  adapter: LabAdapter;
  popup: Extract<Popup, { kind: "task" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  coders: readonly WorkerRow[];
  onClose: () => void;
  onMissing?: () => void;
}) {
  const actions = useMemo(() => adapter.taskActions(popup.sessionId), [adapter, popup.sessionId]);
  const tasks = useWatch(adapter.watchTasks, popup.sessionId);
  const task = tasks?.find((t) => t.id === popup.taskId);
  const missing = tasks !== undefined && task === undefined;
  useEffect(() => {
    if (missing) onMissing?.();
  }, [missing, onMissing]);
  const steps = useWatch(adapter.watchRun, task?.runSessionId) ?? [];
  const line = task ? taskLine(task, isCoding(task.to), nameOf) : "Task";
  // A teammate's task carries its look; a coding task is nobody's.
  const on = task ? runsOn(task) : undefined;
  const title =
    task && !isCoding(task.to) ? (
      <Titled look={lookOf(task.to)} line={line} />
    ) : (
      <span className="flex items-center gap-2">
        {line}
        {on === undefined ? null : <RunsOn on={on} />}
      </span>
    );
  // A coding task says what it starts on from the moment it is filed, before its run reports anything.
  const starting = task?.harness !== undefined && isCoding(task.to) ? `Starting on ${task.harness}…` : task?.runSessionId ? "Starting…" : "Not started yet.";
  // A coding task's re-runs, one per other harness on the roster.
  const rerun: TaskRerunOption[] =
    task === undefined || !isCoding(task.to)
      ? []
      : rerunTargets(task, coders).map((worker) => ({ label: harnessName(worker.harness!), run: () => actions.rerun(task, worker.id) }));
  return (
    <SessionPopup label={line} title={title} status={task?.status} onClose={onClose}>
      {task === undefined ? null : <TaskActions key={task.id} id={task.id} status={task.boardStatus} actions={actions} steer rerun={rerun} />}
      {/* What a coding task's runs spent, in and out apart, with the vendor's charge when it reported one. */}
      {task?.spend && isCoding(task.to) ? (
        <div data-task-spend>
          <Spend spend={task.spend} split className="text-[11px]" />
        </div>
      ) : null}
      {/* Why it failed, as an error; the result leads otherwise. How the run got there is below. */}
      {task?.error ? (
        <section aria-label="Error" role="alert" data-step="error" className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ErrorBody message={task.error} />
        </section>
      ) : null}
      {task?.waiting?.kind === "review" ? <TaskReview adapter={adapter} sessionId={popup.sessionId} task={task} /> : null}
      {task?.waiting?.kind === "question" ? <TaskQuestion adapter={adapter} sessionId={popup.sessionId} task={task} /> : null}
      {task?.result ? (
        <section aria-label="Result" data-step="result" className="rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-2 text-sm">
          <MarkdownText text={task.result} />
        </section>
      ) : task?.status === "done" ? (
        // Done with nothing written is not a plain success: say so, where the result would be.
        <section aria-label="No result" data-step="no-result" className="rounded-md border border-dashed border-warning/60 bg-warning/10 px-3 py-2 text-sm">
          {isCoding(task.to) ? "The coding task" : nameOf(task.to)} finished without writing a result. Its steps below show what it did.
        </section>
      ) : null}
      <Steps steps={steps} nameOf={nameOf} empty={starting} />
      {/* Until its first step, the line above says it is starting; a task waiting on you isn't working. */}
      {task?.status === "running" && task.waiting === undefined && task.runSessionId !== undefined && steps.length > 0 ? (
        <WorkingLine adapter={adapter} task={task} runSessionId={task.runSessionId} />
      ) : null}
    </SessionPopup>
  );
}

/**
 * The live line at the end of a running task's feed: the most specific thing
 * it is doing now (the tool call in flight, the plan step in progress, its
 * last note), else "Working...", with how long it has been running.
 */
function WorkingLine({ adapter, task, runSessionId }: { adapter: LabAdapter; task: BoardTask; runSessionId: string }) {
  const requestId = task.runRequestId;
  const watch = useCallback<(sessionId: string, onChange: (now: WorkingNow) => void) => () => void>(
    (sessionId, onChange) => adapter.watchWorking({ sessionId, ...(requestId === undefined ? {} : { requestId }) }, onChange),
    [adapter, requestId],
  );
  const now = useWatch(watch, runSessionId);
  return <StreamingIndicator message={workingStatus({ ...now, note: task.note })} since={task.startedAt} />;
}

/** A coding run's review, with the registry's card: its commits and the judge's verdict, and Accept or Ask for changes. */
function TaskReview({ adapter, sessionId, task }: { adapter: LabAdapter; sessionId: string; task: BoardTask }) {
  const review = useWatch(adapter.watchReview, task.runSessionId);
  return (
    <ReviewHold
      review={review}
      prompt={review === undefined ? task.waiting?.prompt : undefined}
      answer={(answer) => adapter.answerTask(sessionId, task.id, answer)}
      unanswerable={task.waiting?.unanswerable ?? null}
    />
  );
}

/** A question the task's run asked you, with a box for your answer; the run goes on with it. */
function TaskQuestion({ adapter, sessionId, task }: { adapter: LabAdapter; sessionId: string; task: BoardTask }) {
  const [words, setWords] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unanswerable = task.waiting?.unanswerable ?? null;
  const send = async () => {
    const text = words.trim();
    if (text === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      await adapter.answerTask(sessionId, task.id, { text });
      setWords("");
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-label="Waiting on you" data-step="question" className="rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
      <div className="font-semibold">Waiting on you</div>
      {task.waiting?.prompt ? <MarkdownText className="mt-0.5" text={task.waiting.prompt} /> : null}
      {unanswerable !== null ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{unanswerable}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          <textarea
            aria-label="Your answer"
            value={words}
            rows={2}
            disabled={pending}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            className="w-full rounded-md border border-border bg-background p-2 text-xs"
          />
          <div>
            <button
              type="button"
              disabled={pending || words.trim() === ""}
              onClick={() => void send()}
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Answer
            </button>
          </div>
          {error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** One message: what was sent, what the worker that read it did, and its reply. */
function MessagePopup({ adapter, popup, nameOf, lookOf, onClose }: {
  adapter: LabAdapter;
  popup: Extract<Popup, { kind: "message" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  onClose: () => void;
}) {
  const watch = useCallback<typeof adapter.watchRun>((messageId, onChange) => adapter.watchExchange(popup.to, messageId, onChange), [adapter, popup.to]);
  const steps = useWatch(watch, popup.messageId) ?? [];
  const talk = useWatch(adapter.watchTalk, popup.to) ?? [];
  const to = nameOf(popup.to);
  const line = `Messaged ${to}`;
  return (
    <SessionPopup label={line} title={<Titled look={lookOf(popup.to)} line={line} />} status={answerIn(talk, popup.messageId)} onClose={onClose}>
      <p className="font-mono text-xs text-muted-foreground">
        {nameOf(popup.from)} → {to}
      </p>
      <Steps steps={steps} nameOf={nameOf} empty={`${popup.text}\n\n${to} hasn't read it yet.`} />
    </SessionPopup>
  );
}

/** A popup's title with the teammate's icon in front. */
function Titled({ look, line }: { look: Look; line: string }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar look={look} size="sm" />
      {line}
    </span>
  );
}

/** What a coding task runs on, as a small tag after its line. */
export function RunsOn({ on }: { on: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground" data-harness>
      {on}
    </span>
  );
}
