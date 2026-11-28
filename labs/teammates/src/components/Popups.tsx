import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GitPullRequestArrowIcon, SquareTerminalIcon } from "lucide-react";
import { conversationLines, useSessionFeed, type ItemLine } from "@flow-state-dev/react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import type { RosterEntry, WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import {
  useAppClient,
  usePullRequestLinks,
  useRecordedFiles,
  useTaskActions,
  useTaskDetail,
  useTaskWork,
} from "../app";
import { harnessName } from "../lib/harness";
import { runPatchReader } from "../lib/run-patch";
import { settingOf, takesTasks } from "../lib/roster";
import { waitsFor, waitsOnPullRequest, holdOf, attemptDurationMs, attemptStartedAt, elapsedText, harnessOf, modelOf, taskStatus, workerOf } from "../lib/task";
import { useNow } from "../lib/use-watch";
import { exchangeOf, useTalk } from "../lib/talk";
import { taskPresentation } from "../lib/task-presentation";
import { cn } from "../lib/utils";
import type { Look } from "../lib/looks";
import { Avatar } from "./Avatar";
import { ErrorBody } from "./flow-state/error";
import { MarkdownText } from "./flow-state/message-response";
import { LandedOutcome, type ReviewAnswer } from "./flow-state/review-hold";
import { Spend } from "./flow-state/spend";
import { StreamingIndicator } from "./flow-state/streaming-indicator";
import { TaskActions, type TaskRerunOption } from "./flow-state/task-actions";
import { workingStatus } from "./flow-state/working-status";
import { SessionOverlay } from "./flow-state/session-overlay";
import { RunningChanges } from "./RunningChanges";
import { Steps } from "./Steps";
import { Fold, ReviewBody, ReviewFooter, RunAnswer, RunMeta, SteerCompose } from "./TaskReview";
import { runsOn, taskLine } from "./TaskCard";
import { PlanChecklist } from "./PlanChecklist";
import { teammatesRenderers } from "./lines";
import { stepOf } from "./flow-state/conversation-lines";
import { durationText, tokenTotal } from "./flow-state/spend";
import { knownToolVerbs } from "./flow-state/tool-grouping";

/** What a popup shows: a task one conversation filed, or one message a worker sent. */
export type Popup =
  | { kind: "task"; sessionId: string; taskId: string }
  | { kind: "message"; from: string; to: string; messageId: string; text: string };

/** A failed or cancelled task's reason, its first line only; the popup has the whole. */
export function reasonLine(task: Pick<CodingBoardTask, "error">): string | undefined {
  const line = task.error?.split("\n").find((l) => l.trim() !== "")?.trim();
  return line === "" ? undefined : line;
}


/**
 * The coding workers a coding task can be re-run on: each one whose
 * `harness:` differs from the harness of the worker the task was filed for.
 * A task that isn't a coding task, or whose worker's harness isn't known, has none.
 */
function rerunTargets(task: Pick<CodingBoardTask, "assignee">, coders: readonly RosterEntry[]): { id: string; harness: string }[] {
  const own = coders.find((w) => w.id === workerOf(task));
  const ownHarness = own === undefined ? undefined : settingOf(own, "harness");
  if (ownHarness === undefined) return [];
  return coders.flatMap((w) => {
    const harness = settingOf(w, "harness");
    return takesTasks(w) && harness !== undefined && harness !== ownHarness ? [{ id: w.id, harness }] : [];
  });
}

/** The line a task waiting on its pull request offers, while nothing tells it of a merge. */
export const PULL_REQUEST_HINT = "Merged? Say so here and I'll check.";

/** The quick replies under the box while a run waits on its pull request: each sends as typed. */
const PULL_REQUEST_REPLIES = ["It's merged", "Address review comments"] as const;

/** A tool the registry's words call running a command: each harness's shell tool. */
const isCommand = (tool: string) => knownToolVerbs(tool)?.singular === "ran a command";

/**
 * How many shell commands a run's lines ran, done or failed; one still running
 * isn't counted. Known by the tool's name in the registry's vocabulary. Given
 * the run's request, only that request's calls count: a retry runs in the
 * same session.
 */
export function commandsRun(lines: readonly ItemLine[], requestId?: string): number {
  return lines
    .flatMap((line) => (line.kind === "steps" ? line.items : []))
    .filter((item): item is ToolOutputItem => item.type === "tool_output")
    .map((call) => stepOf(call))
    .filter((step) => isCommand(step.tool) && step.state !== "running" && (requestId === undefined || step.requestId === requestId)).length;
}

/** What a coding task's popup says the run did: the files it recorded, its commands, and how long it took. */
export interface RunSummary {
  /** The files the run's harness recorded touching; `null` when the harness records none (Codex and Cursor today). */
  files: { count: number; truncated: boolean } | null;
  commands: number;
  /** Only once the task ended. */
  durationMs?: number;
}

/**
 * "Edited 2 files · ran 5 commands · 2m 14s", with what the run didn't do
 * left out, and no file part for a harness that records none (never "0
 * files"). Empty when there is nothing to say.
 */
export function runSummaryLine({ files, commands, durationMs }: RunSummary): string {
  const n = files?.count ?? 0;
  const parts = [
    n === 0 ? null : `edited ${n}${files?.truncated ? "+" : ""} file${n === 1 && !files?.truncated ? "" : "s"}`,
    commands === 0 ? null : `ran ${commands} command${commands === 1 ? "" : "s"}`,
    durationMs === undefined ? null : durationText(durationMs),
  ].filter((p): p is string => p !== null);
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** How a sent message stands. */
export type AnswerStatus = "working" | "replied" | "no answer";

/**
 * How a message stands, from the message log: `replied` by a reply message
 * (one a waited send took as its result is in the log too); `no answer` when
 * the reply is the framework's "no answer"; `working` until then.
 */
export const answerIn = (talk: readonly WorkerMessageResourceState[], messageId: string): AnswerStatus => {
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
  start: (text: string) => void;
}

/** What a follow-up puts in the filer's composer: the task by its title, and room for what to do next. */
const followUpText = (task: CodingBoardTask) => `Follow up on "${task.title}": `;

/** The open popup, live: it reads what it shows by itself, so it stays current while the work goes on. */
export function PopupView({ popup, nameOf, lookOf, isCoding, coders, followUp, onClose, onMissing }: {
  popup: Popup;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  /** The roster's coding workers: a failed or cancelled coding task can be re-run on another's harness. */
  coders: readonly RosterEntry[];
  /** For a task popup, who filed it, to ask for a follow-up once it ended; absent when its conversation isn't on the roster. */
  followUp?: FollowUp;
  onClose: () => void;
  /** A task popup's conversation holds no such task, once its tasks are read: a link to a task that is gone. */
  onMissing?: () => void;
}) {
  return popup.kind === "task" ? (
    // Keyed by conversation: a switch never judges the task against the last conversation's rows.
    <TaskPopup key={popup.sessionId} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} coders={coders} followUp={followUp} onClose={onClose} onMissing={onMissing} />
  ) : (
    <MessagePopup popup={popup} nameOf={nameOf} lookOf={lookOf} onClose={onClose} />
  );
}

/**
 * A task's run session and its result (or, done with none written, a line
 * saying so), with its action row: Cancel while it is open, Release while
 * held, Retry and a Re-run per other harness once it failed or was
 * cancelled. The board decides each; the row shows its words.
 *
 * Its foot holds one compose box: while the task is open it steers it; while
 * a coding run waits for your review it is the review's note, beside Request
 * changes and the ways to land the work (`ReviewFooter`), and the review
 * itself leads the body (`ReviewBody`), the run's steps folded under it.
 */
function TaskPopup({ popup, nameOf, lookOf, isCoding, coders, followUp, onClose, onMissing }: {
  popup: Extract<Popup, { kind: "task" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  coders: readonly RosterEntry[];
  followUp?: FollowUp;
  onClose: () => void;
  onMissing?: () => void;
}) {
  const actions = useTaskActions(popup.sessionId);
  // The popup's own read of the board: every row, and this task's with its answer.
  const detail = useTaskDetail(popup.sessionId, popup.taskId);
  const tasks = detail.value;
  const task = tasks?.find((t) => t.id === popup.taskId);
  const missing = tasks !== undefined && task === undefined;
  useEffect(() => {
    if (missing) onMissing?.();
  }, [missing, onMissing]);
  const work = useTaskWork(task);
  const { client } = useAppClient();
  // A changed file's diff, read when the review's Files list opens it; one reader per run.
  const loadPatch = useMemo(() => runPatchReader(client, task), [client, task?.id, task?.run?.sessionId, task?.runFlow]);
  // "Changes so far" open while the run works, kept here so it survives re-renders and opens the review's Files list.
  const [changesOpen, setChangesOpen] = useState(false);
  const steps = work.lines;
  const to = task === undefined ? "" : workerOf(task);
  const coding = task !== undefined && isCoding(to);
  const line = task ? taskLine({ title: task.title, to }, coding, nameOf) : "Task";
  // A teammate's task carries its look; a coding task is nobody's.
  const harness = task === undefined ? undefined : harnessOf(task);
  const on = task === undefined ? undefined : runsOn({ harness, model: modelOf(task) });
  // A coding task's tile already says it is one, so its title is the task's own; the dialog's name keeps the whole line.
  const title = task && !coding ? <Titled look={lookOf(to)} line={line} /> : (task?.title ?? line);
  // A coding task says what it starts on from the moment it is filed, before its run reports anything.
  // Until its own read answers, nothing is known of it: loading, or a read that failed, never "Not started yet."
  const starting =
    tasks === undefined
      ? detail.stale
        ? "This task couldn't be loaded."
        : "Loading…"
      : harness !== undefined && coding
        ? `Starting on ${harness}…`
        : task?.run?.sessionId
          ? "Starting…"
          : "Not started yet.";
  // A coding task's re-runs, one per other harness on the roster.
  const rerun: TaskRerunOption[] =
    task === undefined || !coding ? [] : rerunTargets(task, coders).map((worker) => ({ label: harnessName(worker.harness), run: () => actions.rerun(task, worker.id) }));
  // A verdict you gave here stays in the feed, after the steps it was given over.
  // Each is kept with the task and run it was given on: Back can move this popup to another task, and a run's steps can be read again.
  const [given, setGiven] = useState<readonly Decision[]>([]);
  const run = `${task?.id}:${task?.run?.sessionId}`;
  const decided = (answer: ReviewAnswer) => setGiven((all) => [...all, { id: `decision-${all.length}`, run, after: steps.length, text: decisionLine(answer) }]);
  const decisions = placeDecisions(given.filter((d) => d.run === run), steps.length);
  const waiting = task === undefined ? undefined : waitsFor(task);
  const status = task === undefined ? undefined : taskStatus(task);
  // What waits on you is held below the feed, which opens on the latest step, so it can't scroll out of view.
  const pinned = task && waiting === "question" ? <QuestionPopup task={task} answer={actions.answer} /> : null;
  const pullRequestOpen = task !== undefined && waitsOnPullRequest(task);
  // The task's pull requests, each with its address once its run session's record is read: the meta line links them.
  // While its run waits on one (PR open, in the status), the compose at the foot wakes it to check for a merge.
  const prNumbers = (task?.pullRequests ?? []).flatMap((n) => (n === null ? [] : [n]));
  // No pull request, no read of the run session's record.
  const prLinks = usePullRequestLinks(prNumbers.length === 0 ? undefined : task?.run?.sessionId, prNumbers.join(","));
  const pullRequests = prNumbers.map((n) => ({ number: n, ...(prLinks.has(n) ? { url: prLinks.get(n)! } : {}) }));
  const answer = task?.detail?.answer ?? undefined;
  // The compose box's words, kept per task: Back can move the popup to another, and a send that ends after
  // the move clears only its own task's words.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const words = drafts[popup.taskId] ?? "";
  const setWords = (text: string) => setDrafts((all) => ({ ...all, [popup.taskId]: text }));
  // A coding run's review leads the body; one it can't read leaves the foot with the hold's prompt.
  const review = task && waiting === "review" ? work.review : undefined;
  const total = tokenTotal(task?.spend);
  const spent = total === undefined ? undefined : `${total} tokens`;
  // The current attempt's time, including waits; the live line counts only its reply.
  const now = useNow(undefined, status === "running");
  const started = task === undefined ? undefined : attemptStartedAt(task);
  const totalMs = status === "running" && started !== undefined ? now - started : undefined;
  // The header's status, read once: its words, and the pill's tone and mark.
  const badge: { label: ReactNode; tone: "neutral" | "info" | "success"; icon?: ReactNode } =
    // What waits on you is the highlighter's pill (`styles.css` reads `data-needs-you`); everything else keeps the overlay's tones.
    waiting === "review"
      ? { label: <span data-needs-you>Needs your review</span>, tone: "info" }
      : waiting === "question"
        ? { label: <span data-needs-you>Waiting on you</span>, tone: "info" }
        : pullRequestOpen
          ? { label: "PR open", tone: "success", icon: <GitPullRequestArrowIcon aria-hidden /> }
          : { label: status, tone: "neutral" };
  const hold = task === undefined ? undefined : holdOf(task);
  const footer =
    task && waiting === "review" ? (
      <ReviewFooter
        key={task.id}
        review={review}
        {...(review === undefined && hold?.ask.prompt ? { prompt: hold.ask.prompt } : {})}
        words={words}
        setWords={setWords}
        answer={async (verdict) => {
          // The board can reach a newer round before the run's feed draws it: a verdict then would approve work
          // nobody on this screen has seen. With no review read, the hold's own prompt shows, so it is the round.
          if (review !== undefined && work.reviewStop !== hold?.id) throw new Error("This task has a newer review than the one shown. Look it over before you answer.");
          await actions.answer(task, verdict);
          decided(verdict);
        }}
        unanswerable={hold?.unanswerable ?? null}
        holdId={hold?.id ?? null}
      />
    ) : pinned !== null ? (
      pinned
    ) : task && OPEN.has(task.status) ? (
      <SteerCompose
        key={task.id}
        words={words}
        setWords={setWords}
        steer={(message) => actions.steer(task.id, message)}
        placeholder={pullRequestOpen ? PULL_REQUEST_HINT : undefined}
        quickReplies={pullRequestOpen ? PULL_REQUEST_REPLIES : undefined}
      />
    ) : null;
  const feed = (
    <>
      {/* What a coding task's run changed, what it ran and how long it took, without opening a step. */}
      {task && coding ? <TaskSummary task={task} steps={steps} /> : null}
      {task && coding && work.plan !== undefined && work.plan !== null ? (
        <PlanChecklist plan={work.plan} running={status === "running"} />
      ) : null}
      {task && status !== "running" ? <TaskOutcomeActions task={task} followUp={followUp} /> : null}
      {/* What a coding task's runs spent, in and out apart, with the vendor's charge when it reported one. */}
      {task?.spend && coding ? (
        <div data-task-spend>
          <Spend spend={task.spend} split className="text-xs" />
        </div>
      ) : null}
      {/* Why it failed, or the reason it was cancelled with, as an error. How the run got there is below. */}
      {task?.error ? (
        <section aria-label="Error" role="alert" data-step="error" className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-(--redbg) px-3 py-2 text-sm text-destructive">
          <ErrorBody message={task.error} />
        </section>
      ) : null}
      {steps.length === 0 ? <Steps lines={steps} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} empty={starting} /> : null}
      {/* What a coding run started on, from its task, once it has reported a line. */}
      {coding && harness !== undefined && steps.length > 0 ? (
        <div data-step="harness" className="font-mono text-xs text-muted-foreground">
          Started on {harness}
        </div>
      ) : null}
      {[...decisions, undefined].map((decision, i) => {
        const shown = steps.slice(decisions[i - 1]?.after ?? 0, decision?.after);
        return (
          <Fragment key={decision?.id ?? "latest"}>
            {shown.length === 0 ? null : <Steps lines={shown} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} empty="" />}
            {decision === undefined ? null : (
              <p data-step="decision" className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                {decision.text}
              </p>
            )}
          </Fragment>
        );
      })}
      {/* The run's result is its last entry. */}
      {task && (answer || task.landed) ? (
        // The left edge takes the task's colour from the lab's one reader of it; the words keep the body colour.
        // The region is already named Result, so its visible heading is hidden from the accessibility tree.
        <section
          aria-label="Result"
          data-step="result"
          data-tone={taskPresentation(task).word}
          className={cn("flex flex-col gap-3 rounded-lg border border-l-2 border-border border-l-current bg-card px-4 py-4 shadow-(--shadow-card)", taskPresentation(task).tone)}
        >
          <h3 aria-hidden className="font-mono text-xs font-medium tracking-[0.08em] text-text-3 uppercase">
            Result
          </h3>
          <div data-result-answer className="flex flex-col gap-3 text-foreground">
            {answer ? <RunAnswer answer={answer} report={coding} /> : null}
            {task.detail?.answerCut ? <p className="text-xs text-text-3">The answer is longer than this; only its first 20,000 characters show.</p> : null}
            {task.landed == null ? null : <LandedOutcome landed={task.landed} />}
          </div>
        </section>
      ) : task && status === "done" ? (
        // Done with nothing written is not a plain success: say so, where the result would be.
        <section aria-label="No result" data-step="no-result" className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          {coding ? "The coding task" : nameOf(to)} finished without writing a result. Its steps below show what it did.
        </section>
      ) : null}
      {/* The live line ends the feed while it runs: until its first step, the line above says it is starting; a task waiting on you isn't working. */}
      {task && status === "running" && holdOf(task) === undefined && !pullRequestOpen && task.run?.sessionId !== undefined && steps.length > 0 ? (
        <StreamingIndicator message={workingStatus({ ...work.working, note: task.statusNote })} since={work.replyStartedAt} />
      ) : null}
    </>
  );
  return (
    <SessionOverlay
      variant="sheet"
      docked
      label={line}
      title={title}
      icon={coding ? <SquareTerminalIcon className="size-[18px]" /> : undefined}
      meta={
        coding ? (
          <RunMeta
            {...(review ? { review } : {})}
            {...(on === undefined ? {} : { on })}
            {...(spent === undefined ? {} : { tokens: spent })}
            {...(totalMs === undefined ? {} : { total: elapsedText(totalMs) })}
            {...(pullRequests.length > 0 ? { pullRequests } : {})}
          />
        ) : undefined
      }
      status={badge.label}
      statusTone={badge.tone}
      {...(badge.icon ? { statusIcon: badge.icon } : {})}
      onClose={onClose}
      footer={footer}
    >
      {task === undefined ? null : <TaskActions key={task.id} id={task.id} status={task.status} actions={actions} rerun={rerun} />}
      {task && review ? (
        <>
          <ReviewLead key={hold?.id}>
            <ReviewBody review={review} onDraft={setWords} filesOpen={changesOpen} {...(loadPatch ? { loadPatch } : {})} {...(followUp ? { onFollowUp: (note: string) => followUp.start(`${followUpText(task)}${note}`) } : {})} />
          </ReviewLead>
          <Fold data-run-steps label="How it got there">
            <div className="flex flex-col gap-3">{feed}</div>
          </Fold>
        </>
      ) : task && coding ? (
        <>
          <RunningChanges task={task} open={changesOpen} onOpenChange={setChangesOpen} />
          {feed}
        </>
      ) : (
        feed
      )}
    </SessionOverlay>
  );
}

/** The board statuses a task can still be steered in. */
const OPEN = new Set(["pending", "held", "in_progress"]);

/** The review, brought into view once as it arrives: the feed under it opens on its latest step. */
function ReviewLead({ children }: { children: ReactNode }) {
  const lead = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => lead.current?.scrollIntoView?.({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={lead}>{children}</div>;
}

/** How many file chips show before the rest fold into "+N more". */
const CHIPS_SHOWN = 8;

/** "Edited 2 files · ran 5 commands · 2m 14s", and a chip per file the run recorded, named by its file name. */
function TaskSummary({ task, steps }: { task: CodingBoardTask; steps: readonly ItemLine[] }) {
  const files = useRecordedFiles(task) ?? null;
  // One per path (a steer or a review's changes record the path again), and only a path an edit landed on:
  // one whose every attempt failed was tried, not edited.
  const rows = [...new Map((files?.rows ?? []).filter((row) => row.applied !== 0).map((row) => [row.path, row])).values()];
  // A retry runs in the same session: only this run's commands.
  const line = runSummaryLine({
    files: files === null ? null : { count: rows.length, truncated: files.truncated },
    commands: commandsRun(steps, task.run?.requestId),
    durationMs: attemptDurationMs(task),
  });
  if (line === "") return null;
  const shown = rows.slice(0, CHIPS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <div data-task-summary className="flex flex-col gap-1.5">
      <p data-summary-line className="font-mono text-xs text-text-3">
        {line}
      </p>
      {shown.length === 0 ? null : (
        <ul aria-label="Files changed" className="flex flex-wrap gap-1">
          {shown.map(({ path }) => (
            <li key={path} title={path} data-file-chip className="rounded-md border border-border bg-surface-raised/50 px-1.5 py-0.5 font-mono text-xs text-text-2">
              {path.split("/").filter((part) => part !== "").pop() ?? path}
            </li>
          ))}
          {more > 0 ? <li className="px-1 py-0.5 font-mono text-xs text-muted-foreground">+{more} more</li> : null}
        </ul>
      )}
    </div>
  );
}

/** Once a task ended: Copy its result (else its error), and ask the worker that filed it to follow up. */
function TaskOutcomeActions({ task, followUp }: { task: CodingBoardTask; followUp?: FollowUp }) {
  const text = task.detail?.answer ?? task.error ?? undefined;
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
  const button = "h-7 rounded-md border border-border-strong px-2.5 text-xs font-medium text-text-2 hover:bg-surface-raised hover:text-foreground";
  return (
    <div data-outcome-actions className="flex flex-wrap gap-1.5">
      {text === undefined ? null : (
        <button type="button" onClick={() => void copy()} className={button}>
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      {followUp === undefined ? null : (
        <button type="button" onClick={() => followUp.start(followUpText(task))} className={button}>
          Ask {followUp.name} to follow up
        </button>
      )}
    </div>
  );
}

/** A review verdict given in this popup on one task's run (`run`), placed after the steps it was given over (`after` of them). */
type Decision = { id: string; run: string; after: number; text: string };

/** Each verdict no earlier than the one before it and no later than the steps there are now, so no step is drawn twice. Exported for its test. */
export const placeDecisions = (decisions: readonly Decision[], count: number): Decision[] => {
  let at = 0;
  return decisions.map((d) => ({ ...d, after: (at = Math.min(count, Math.max(at, d.after))) }));
};

/** "Accepted", or "Asked for changes: …" with the words sent. */
const decisionLine = (answer: ReviewAnswer) => (answer.verdict === "accepted" ? "Accepted" : `Asked for changes: ${answer.words}`);

/** A question the task's run asked you, with a box for your answer; the run goes on with it. */
function QuestionPopup({ task, answer }: { task: CodingBoardTask; answer: (task: CodingBoardTask, answer: { text: string }) => Promise<void> }) {
  const [words, setWords] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = holdOf(task);
  const unanswerable = hold?.unanswerable ?? null;
  const send = async () => {
    const text = words.trim();
    if (text === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      await answer(task, { text });
      setWords("");
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setPending(false);
    }
  };
  return (
    // A normal card: the highlighter is only its small pill.
    <section aria-label="Waiting on you" data-step="question" className="rounded-lg border border-border bg-card px-3.5 py-3 text-sm shadow-(--shadow-card)">
      <div className="flex items-center gap-2 font-semibold">
        <span className="rounded-full bg-attention px-1.5 font-mono text-xs leading-4 font-semibold text-attention-foreground">Needs you</span>
        Waiting on you
      </div>
      {hold?.ask.prompt ? <MarkdownText className="mt-0.5" text={hold.ask.prompt} /> : null}
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
            className="w-full rounded-md border border-border-strong bg-background p-2 text-sm focus-visible:border-ring focus-visible:outline-none"
          />
          <div>
            <button
              type="button"
              disabled={pending || words.trim() === ""}
              onClick={() => void send()}
              className="rounded-md border border-border-strong px-3 py-1 text-xs font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring"
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
function MessagePopup({ popup, nameOf, lookOf, onClose }: {
  popup: Extract<Popup, { kind: "message" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  onClose: () => void;
}) {
  // The message's row says where it was delivered, a task's session included, and whether it was answered.
  const talk = useTalk(popup.to, [popup.messageId]) ?? [];
  const { client } = useAppClient();
  const feed = useSessionFeed(talk.find((m) => m.id === popup.messageId)?.toSession, { client });
  const steps = useMemo(() => exchangeOf(conversationLines(feed?.items ?? [], [], { renderers: teammatesRenderers }), popup.messageId), [feed?.items, popup.messageId]);
  const to = nameOf(popup.to);
  const line = `Messaged ${to}`;
  return (
    <SessionOverlay variant="modal" label={line} title={<Titled look={lookOf(popup.to)} line={line} />} status={answerIn(talk, popup.messageId)} statusTone="neutral" onClose={onClose}>
      <p className="font-mono text-xs text-muted-foreground">
        {nameOf(popup.from)} → {to}
      </p>
      <Steps lines={steps} nameOf={nameOf} lookOf={lookOf} empty={`${popup.text}\n\n${to} hasn't read it yet.`} />
    </SessionOverlay>
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
