import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { commandsRun, runSummaryLine, type BoardTask, type LabAdapter, type SessionStep, type TalkRow, type WorkerRow } from "../adapter";
import type { RecordedWork } from "@flow-state-dev/harness-manager/browser";
import { harnessName } from "../lib/harness";
import { cn } from "../lib/utils";
import type { Look } from "../lib/looks";
import { useWatch } from "../lib/use-watch";
import { Avatar } from "./Avatar";
import { ErrorBody } from "./flow-state/error";
import { MarkdownText } from "./flow-state/message-response";
import { ReviewHold, type ReviewAnswer } from "./flow-state/review-hold";
import { Spend } from "./flow-state/spend";
import { TaskActions, type TaskRerunOption } from "./flow-state/task-actions";
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

/**
 * Who to ask to follow up on an ended task: the worker whose conversation
 * filed it, and how to hand that conversation's composer the words.
 */
export interface FollowUp {
  /** The filer's name, as the button says it. */
  name: string;
  /** Close the popup, open the filer's conversation, and add `text` to its composer, unsent. */
  ask: (text: string) => void;
}

/** What a follow-up puts in the filer's composer: the task by its title, and room for what to do next. */
const followUpText = (task: Pick<BoardTask, "title">) => `Follow up on "${task.title}": `;

/** The open popup, live: it reads what it shows by itself, so it stays current while the work goes on. */
export function PopupView({ adapter, popup, nameOf, lookOf, isCoding, coders, followUp, onClose, onMissing }: {
  adapter: LabAdapter;
  popup: Popup;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  /** The roster's coding workers: a failed or cancelled coding task can be re-run on another's harness. */
  coders: readonly WorkerRow[];
  /** For a task popup, who filed it, to ask for a follow-up once it ended; absent when its conversation isn't on the roster. */
  followUp?: FollowUp;
  onClose: () => void;
  /** A task popup's conversation holds no such task, once its tasks are read: a link to a task that is gone. */
  onMissing?: () => void;
}) {
  return popup.kind === "task" ? (
    // Keyed by conversation: a switch never judges the task against the last conversation's rows.
    <TaskPopup key={popup.sessionId} adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} coders={coders} followUp={followUp} onClose={onClose} onMissing={onMissing} />
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
function TaskPopup({ adapter, popup, nameOf, lookOf, isCoding, coders, followUp, onClose, onMissing }: {
  adapter: LabAdapter;
  popup: Extract<Popup, { kind: "task" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  coders: readonly WorkerRow[];
  followUp?: FollowUp;
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
  // A verdict you gave here stays in the feed, after the steps it was given over.
  // Each is kept with the task and run it was given on: Back can move this popup to another task, and a run's steps can be read again.
  const [given, setGiven] = useState<readonly Decision[]>([]);
  const run = `${task?.id}:${task?.runSessionId}`;
  const decided = (answer: ReviewAnswer) => setGiven((all) => [...all, { id: `decision-${all.length}`, run, after: steps.length, text: decisionLine(answer) }]);
  const decisions = placeDecisions(given.filter((d) => d.run === run), steps.length);
  const waiting = task?.waiting?.kind;
  // What waits on you is held below the feed, which opens on the latest step, so it can't scroll out of view.
  const pinned =
    task && waiting === "review" ? (
      <TaskReview adapter={adapter} sessionId={popup.sessionId} task={task} onAnswered={decided} />
    ) : task && waiting === "question" ? (
      <TaskQuestion adapter={adapter} sessionId={popup.sessionId} task={task} />
    ) : null;
  const status = waiting === "review" ? "Needs review" : waiting === "question" ? "Waiting on you" : task?.status;
  return (
    <SessionPopup label={line} title={title} status={status} onClose={onClose} pinned={pinned}>
      {task === undefined ? null : <TaskActions key={task.id} id={task.id} status={task.boardStatus} actions={actions} steer rerun={rerun} />}
      {/* What a coding task's run changed, what it ran and how long it took, without opening a step. */}
      {task && isCoding(task.to) ? <TaskSummary adapter={adapter} task={task} steps={steps} /> : null}
      {task && task.status !== "running" ? <TaskOutcomeActions task={task} followUp={followUp} /> : null}
      {/* What a coding task's runs spent, in and out apart, with the vendor's charge when it reported one. */}
      {task?.spend && isCoding(task.to) ? (
        <div data-task-spend>
          <Spend spend={task.spend} split className="text-[11px]" />
        </div>
      ) : null}
      {/* Why it failed, as an error. How the run got there is below. */}
      {task?.error ? (
        <section aria-label="Error" role="alert" data-step="error" className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ErrorBody message={task.error} />
        </section>
      ) : null}
      {steps.length === 0 ? <Steps steps={steps} nameOf={nameOf} empty={starting} /> : null}
      {[...decisions, undefined].map((decision, i) => {
        const shown = steps.slice(decisions[i - 1]?.after ?? 0, decision?.after);
        return (
          <Fragment key={decision?.id ?? "latest"}>
            {shown.length === 0 ? null : <Steps steps={shown} nameOf={nameOf} empty="" />}
            {decision === undefined ? null : (
              <p data-step="decision" className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                {decision.text}
              </p>
            )}
          </Fragment>
        );
      })}
      {/* The run's result is its last entry. */}
      {task?.result ? (
        <section aria-label="Result" data-step="result" data-tone={task.status} className={cn("rounded-md border border-dashed px-3 py-2 text-sm", RESULT_TONE[task.status])}>
          <MarkdownText text={task.result} />
        </section>
      ) : task?.status === "done" ? (
        // Done with nothing written is not a plain success: say so, where the result would be.
        <section aria-label="No result" data-step="no-result" className="rounded-md border border-dashed border-warning/60 bg-warning/10 px-3 py-2 text-sm">
          {isCoding(task.to) ? "The coding task" : nameOf(task.to)} finished without writing a result. Its steps below show what it did.
        </section>
      ) : null}
    </SessionPopup>
  );
}

/** The result box's colour, by how the task ended: a failed task's result is never a success's green. */
const RESULT_TONE: Record<BoardTask["status"], string> = {
  done: "border-success/60 bg-success/5",
  running: "border-success/60 bg-success/5",
  failed: "border-destructive/60 bg-destructive/5",
  cancelled: "border-border bg-muted/40",
};

/** How many file chips show before the rest fold into "+N more". */
const CHIPS_SHOWN = 8;

/**
 * What a run's harness recorded touching, read through harness-manager's
 * reader by the run's session and request; read again when the task's status
 * changes, so an ended task shows all of it. `undefined` until read, or when
 * the read fails: the line then goes without files rather than say a wrong count.
 */
export function useRecordedFiles(adapter: LabAdapter, task: BoardTask): RecordedWork["files"] | undefined {
  const { runSessionId: sessionId, runRequestId: requestId, status } = task;
  // Kept with the run it was read for: a retry's new run never shows the last attempt's files.
  const run = sessionId === undefined || requestId === undefined ? undefined : `${sessionId}\n${requestId}`;
  const [read, setRead] = useState<{ run: string; files: RecordedWork["files"] }>();
  useEffect(() => {
    if (run === undefined || sessionId === undefined || requestId === undefined) return;
    let live = true;
    adapter
      .recordedWork({ sessionId, requestId })
      .then((work) => {
        if (live) setRead({ run, files: work.files });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [adapter, run, sessionId, requestId, status]);
  return read !== undefined && read.run === run ? read.files : undefined;
}

/** "Edited 2 files · ran 5 commands", and a chip per file the run recorded, named by its file name. */
function TaskSummary({ adapter, task, steps }: { adapter: LabAdapter; task: BoardTask; steps: readonly SessionStep[] }) {
  const files = useRecordedFiles(adapter, task) ?? null;
  // One per path (a steer or a review's changes record the path again), and only a path an edit landed on:
  // one whose every attempt failed was tried, not edited.
  const rows = [...new Map((files?.rows ?? []).filter((row) => row.applied !== 0).map((row) => [row.path, row])).values()];
  // A retry runs in the same session: only this run's commands.
  const line = runSummaryLine({
    files: files === null ? null : { count: rows.length, truncated: files.truncated },
    commands: commandsRun(steps, task.runRequestId),
  });
  if (line === "") return null;
  const shown = rows.slice(0, CHIPS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <div data-task-summary className="flex flex-col gap-1.5">
      <p data-summary-line className="text-xs text-muted-foreground">
        {line}
      </p>
      {shown.length === 0 ? null : (
        <ul aria-label="Files changed" className="flex flex-wrap gap-1">
          {shown.map(({ path }) => (
            <li key={path} title={path} data-file-chip className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {path.split("/").filter((part) => part !== "").pop() ?? path}
            </li>
          ))}
          {more > 0 ? <li className="px-1 py-0.5 font-mono text-[10px] text-muted-foreground">+{more} more</li> : null}
        </ul>
      )}
    </div>
  );
}

/** Once a task ended: Copy its result (else its error), and ask the worker that filed it to follow up. */
function TaskOutcomeActions({ task, followUp }: { task: BoardTask; followUp?: FollowUp }) {
  const text = task.result ?? task.error;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const reset = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(reset);
  }, [copied]);
  if (text === undefined && followUp === undefined) return null;
  const copy = async () => {
    if (text === undefined || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // A refused clipboard leaves the text to select by hand.
    }
  };
  const button = "rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <div data-outcome-actions className="flex flex-wrap gap-1.5">
      {text === undefined ? null : (
        <button type="button" onClick={() => void copy()} className={button}>
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      {followUp === undefined ? null : (
        <button type="button" onClick={() => followUp.ask(followUpText(task))} className={button}>
          Ask {followUp.name} to follow up
        </button>
      )}
    </div>
  );
}

/** A review verdict given in this popup on one task's run (`run`), placed after the steps it was given over (`after` of them). */
type Decision = { id: string; run: string; after: number; text: string };

/** Each verdict no earlier than the one before it and no later than the steps there are now, so no step is drawn twice. */
const placeDecisions = (decisions: readonly Decision[], count: number): Decision[] => {
  let at = 0;
  return decisions.map((d) => ({ ...d, after: (at = Math.min(count, Math.max(at, d.after))) }));
};

/** "Accepted", or "Asked for changes: …" with the words sent. */
const decisionLine = (answer: ReviewAnswer) => (answer.verdict === "accepted" ? "Accepted" : `Asked for changes: ${answer.words}`);

/** A coding run's review, with the registry's card: its commits and the judge's verdict, and Accept or Ask for changes. */
function TaskReview({ adapter, sessionId, task, onAnswered }: {
  adapter: LabAdapter;
  sessionId: string;
  task: BoardTask;
  /** The answer went through. */
  onAnswered: (answer: ReviewAnswer) => void;
}) {
  const review = useWatch(adapter.watchReview, task.runSessionId);
  return (
    <ReviewHold
      review={review}
      prompt={review === undefined ? task.waiting?.prompt : undefined}
      answer={async (answer) => {
        await adapter.answerTask(sessionId, task.id, answer);
        onAnswered(answer);
      }}
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
