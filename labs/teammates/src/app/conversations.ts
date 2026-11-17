/**
 * A worker's one conversation: opening it, sending a line, stopping and
 * retrying a turn, answering an approval, and its items as the entries the
 * screen draws, with whether the worker is answering and its connection.
 */
import { topic, type SessionConnectionStatus } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { delegateAnswerOf, RECEIVED_MESSAGE_DATA_TYPE, SEND_MESSAGE_TOOL } from "@flow-state-dev/workforce/browser";
import { parseNotice } from "@flow-state-dev/orchestration/tasks";
import { stableList } from "../lib/stable";
import { filesOf, parseArgs, sentTo, textOf, type Item } from "./items";
import { isRequest, logFailedRead, POLL_MS, QUIET_ACTIONS, type Unsubscribe } from "./reads";
import type { AppState } from "./state";
import { stepRun, toolStep, type SessionStep, type StepRun } from "./steps";
import { boardCopies, toBoardTask } from "./tasks";

/** One entry of a worker's conversation, in the order it happened. */
export type ConversationEntry =
  /** `files`: what the line carries, as references, in the order attached. */
  | { kind: "user"; id: string; text: string; files?: FileContent[] }
  /** `streaming` while the answer is still being written; `incomplete` when its turn failed before it was finished. */
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; incomplete?: boolean }
  /**
   * A turn that failed, from the engine's `error` item: its reason, its request, and `retryable`
   * when Retry is offered on it: it is the conversation's newest turn, and one the engine will run
   * again for you (a worker's message it was answering is not).
   */
  | { kind: "failed"; id: string; requestId: string; reason: string; code?: string; details?: Record<string, unknown>; retryable: boolean }
  /** The worker messaged another worker (`sendMessage`). */
  | { kind: "sent"; id: string; messageId: string; to: string; text: string }
  /** A message another worker sent, as the `receive` turn that read it. */
  | { kind: "received"; id: string; messageId: string; from: string; text: string; inReplyTo?: string; noAnswer?: boolean }
  /** The worker filed a task; the card reads the board's row by its id, and draws `title` until the row arrives. */
  | { kind: "task"; id: string; taskId: string; title: string; to: string }
  /** A task it filed ended, as a line under the name of the worker that ran it; `title` is the task's, once its row is read. */
  | { kind: "result"; id: string; taskId: string; from: string; text: string; title?: string; failed?: boolean; cancelled?: boolean }
  /** The worker waits for your yes (`suspendForUser` with an approval); `resolution` once answered. */
  | { kind: "approval"; id: string; requestId: string; suspensionId: string; text: string; resolution?: string }
  /** A run of tool calls one turn made in a row, drawn inline as one line ({@link StepRun}) that opens to each. */
  | ({ kind: "steps"; id: string; steps: SessionStep[] } & StepRun)
  /** A turn you stopped: its request ended `aborted`. It follows that turn's last entry. */
  | { kind: "stopped"; id: string; requestId: string };

/** What a conversation shows now. */
export interface ConversationView {
  entries: ConversationEntry[];
  /** The worker is answering in this conversation now. */
  running: boolean;
  /** From an `interrupt` until every turn it aborted has ended. */
  stopping: boolean;
  /**
   * The conversation's background work still running: its unfinished runs as the session stream
   * names them, whichever turn started them. `null` until the stream has named them: unknown is not zero.
   */
  backgroundRunning: number | null;
  /** Present while the conversation holds turns older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
  /** When the conversation's first loaded item was written, in ms. A message sent before it is outside the window. */
  since?: number;
}

/**
 * The request sources the engine retries for a caller (`PUBLIC_REENTRY_SOURCES`): a turn that came
 * in another way, such as a worker's message (`internal`) or a task's run (`task`), it refuses.
 * A copy, since the page can't import the engine; a test pins it to the engine's.
 */
export const RETRYABLE_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", "scheduled"]);

/** The tool a worker files a task with. */
const CREATE_TASK = "createTask";

/**
 * A conversation's items as the entries the screen draws. `ended` names the
 * requests the server lists as over: a step their turn left running (a turn
 * that crashed mid-call) reads failed, not running for good. A failed turn's
 * `error` item is a failed entry, `retryable` when it is the newest turn that drew one and one of
 * `retryableTurns`, the requests the engine will retry.
 */
export function toEntries(
  items: readonly Item[],
  workers: ReadonlySet<string>,
  ended: readonly string[] = [],
  retryableTurns: ReadonlySet<string> = new Set(),
  stopped: readonly string[] = [],
): ConversationEntry[] {
  const copies = boardCopies(items);
  const entries: ConversationEntry[] = [];
  /** The turn the last run of steps belongs to: a run never spans two. */
  let runTurn: unknown;
  // A turn that failed; its reply, if it never finished, is marked incomplete.
  const failedTurns = new Set(items.filter((item) => item.type === "error").map((item) => item.requestId));
  /** The newest turn that drew an entry: a board pass that drew none is not a turn you saw. Retry is offered on it only. */
  let newestTurn: unknown;
  const drawEntry = (item: Item): void => {
    if (item.type === "error") {
      entries.push({
        kind: "failed",
        id: item.id,
        requestId: item.requestId,
        reason: typeof item.message === "string" ? item.message : "",
        ...(typeof item.code === "string" ? { code: item.code } : {}),
        ...(item.details === undefined ? {} : { details: item.details }),
        retryable: false,
      });
    } else if (item.type === "message" && item.role === "user") {
      const files = filesOf(item);
      entries.push({ kind: "user", id: item.id, text: textOf(item), ...(files.length > 0 ? { files } : {}) });
    } else if (item.type === "message" && item.role === "assistant" && workers.has(item.agentName)) {
      // A task it filed ended: the board's line under the worker that ran it, which names its task
      // in its data. A completed task's answer said as is (`resultTo: "conversation"`) names the
      // task it answered; one stored before answers were marked names none.
      const notice = parseNotice(item);
      const taskId = notice?.taskId ?? delegateAnswerOf(item)?.taskId ?? "";
      const copy = copies.get(taskId);
      const task = copy === undefined ? undefined : toBoardTask(copy);
      // An answer is a finished task, never one drawn as failed.
      const cancelled = task?.status === "cancelled";
      const failed = notice !== undefined && task?.status !== "done" && !cancelled;
      entries.push({
        kind: "result",
        id: item.id,
        taskId,
        from: item.agentName,
        text: task?.result ?? task?.error ?? textOf(item),
        ...(task?.title === undefined ? {} : { title: task.title }),
        ...(failed ? { failed: true } : {}),
        ...(cancelled ? { cancelled: true } : {}),
      });
    } else if (item.type === "message" && item.role === "assistant") {
      const text = textOf(item);
      const incomplete = failedTurns.has(item.requestId) && item.status !== "completed";
      if (text.trim() !== "")
        entries.push({ kind: "assistant", id: item.id, text, ...(incomplete ? { incomplete: true } : item.status === "in_progress" ? { streaming: true } : {}) });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL && sentTo(item) !== undefined) {
      const args = parseArgs(item);
      entries.push({ kind: "sent", id: item.id, messageId: item.output.sent, to: String(args.to), text: String(args.text ?? "") });
    } else if (item.type === "tool_output" && item.toolCall?.name === CREATE_TASK && item.output?.ok === true) {
      const args = parseArgs(item);
      entries.push({ kind: "task", id: item.id, taskId: item.output.taskId, title: String(args.title ?? args.goal ?? ""), to: String(args.assignee ?? "") });
    } else if (item.type === "tool_output" && typeof item.toolCall?.name === "string") {
      // Any other call is a step of the turn, inline: a call in a row with the last one, in the same turn, joins its run.
      const step = toolStep(item, ended);
      const last = entries[entries.length - 1];
      if (last?.kind === "steps" && runTurn === item.requestId) {
        const steps = [...last.steps, step];
        entries[entries.length - 1] = { kind: "steps", id: last.id, steps, ...stepRun(steps) };
      } else {
        entries.push({ kind: "steps", id: item.id, steps: [step], ...stepRun([step]) });
        runTurn = item.requestId;
      }
    } else if (item.type === "suspension" && item.reason === "user_approval") {
      entries.push({ kind: "approval", id: item.id, requestId: item.requestId, suspensionId: item.suspensionId, text: item.message });
    } else if (item.type === "suspension_resume") {
      const asked = entries.find((e) => e.kind === "approval" && e.suspensionId === item.suspensionId);
      if (asked?.kind === "approval") asked.resolution = item.resolution;
    } else if (item.type === "data" && item.dataType === RECEIVED_MESSAGE_DATA_TYPE) {
      const { id, from, text, inReplyTo, noAnswer } = item.value ?? {};
      entries.push({ kind: "received", id: item.id, messageId: id, from, text, ...(inReplyTo === undefined ? {} : { inReplyTo }), ...(noAnswer === true ? { noAnswer: true } : {}) });
    }
  };
  /** How many entries there were once each stopped turn's last item was read: its line goes there. */
  const endOf = new Map<string, number>();
  for (const item of items) {
    const drawn = entries.length;
    const lastBefore = entries[drawn - 1];
    drawEntry(item);
    if (entries.length !== drawn) newestTurn = item.requestId;
    const grew = entries.length > drawn || entries[entries.length - 1] !== lastBefore;
    if (grew && stopped.includes(item.requestId)) endOf.set(item.requestId, entries.length);
  }
  const marked = entries.map((entry) =>
    entry.kind === "failed" && entry.requestId === newestTurn && retryableTurns.has(entry.requestId) ? { ...entry, retryable: true } : entry,
  );
  // From the end, so each place is still where it was counted.
  for (const [requestId, at] of [...endOf].sort((a, b) => b[1] - a[1])) {
    marked.splice(at, 0, { kind: "stopped", id: `stopped:${requestId}`, requestId });
  }
  return marked;
}

/**
 * Whether the worker is answering, from the conversation's items and the
 * requests the server lists as in progress. The list is read on a timer, so
 * it trails the items: an item of the newest request still being written is
 * an answer under way before the list says so, unless the requests already
 * show that request ended (`ended`): a failed or aborted turn leaves its
 * half-written item so for good. A finished answer does not end its request
 * here, since one request can answer more than once (a worker that drains its
 * own plan answers again); only the list does.
 */
export function answeringOf(items: readonly Item[], inProgress: readonly string[], ended: readonly string[] = []): boolean {
  // Only the newest request, or one the list names: an item a crashed turn left half-written stays so for good.
  const newest = items[items.length - 1]?.requestId;
  const live = (requestId: string) => inProgress.includes(requestId) || (requestId === newest && !ended.includes(requestId));
  return inProgress.length > 0 || items.some((i) => i.status === "in_progress" && live(i.requestId));
}

/**
 * The turns a Stop pressed now stops, by request id: the answering requests the list names as in
 * progress, and a turn whose answer or tool call is still being written before the list says so
 * (the list trails the items). Only those two item types: the board's own passes write rows, never
 * an answer, and a Stop must never reach them. As in `answeringOf`, a still-written item counts only
 * for the newest request: a crashed or aborted turn leaves its half-written item so for good.
 */
function answeringTurnsOf(items: readonly Item[], inProgress: readonly string[], ended: readonly string[] = []): string[] {
  const newest = items[items.length - 1]?.requestId;
  const writing = items
    .filter((i) => (i.type === "message" || i.type === "tool_output") && i.status === "in_progress" && i.requestId === newest && !ended.includes(i.requestId))
    .map((i) => i.requestId as string);
  return [...new Set([...inProgress, ...writing])];
}

/** A worker's conversation: opening it, sending, stopping, retrying, answering an approval, and watching it. */
export interface ConversationCalls {
  /** The worker's one conversation; the same id every time. */
  openConversation(worker: string): Promise<string>;
  /** Send a line to the worker, with the files attached to it, as references (`upload`). */
  send(sessionId: string, text: string, attachments?: readonly FileContent[]): Promise<void>;
  /**
   * Stop the worker: abort each answering turn the conversation shows running now. A line sent
   * after it starts its own turn, which this never reaches. Rejects with why the server refused one.
   */
  interrupt(sessionId: string): Promise<void>;
  watchConversation(sessionId: string, onChange: (view: ConversationView) => void): Unsubscribe;
  /** Whether the conversation's feed still hears the server, in the session feed's words. */
  watchConnection(sessionId: string, onChange: (state: SessionConnectionStatus) => void): Unsubscribe;
  /** Say yes or no to what an approval entry asks; the worker's turn carries on. */
  answerApproval(sessionId: string, approval: { requestId: string; suspensionId: string }, approve: boolean): Promise<void>;
  /** Run a failed turn of the conversation again, as a new request the engine links to `requestId`. */
  retry(sessionId: string, requestId: string): Promise<void>;
}

/** {@link ConversationCalls} over the app's shared state. */
export function conversationCalls(state: AppState): ConversationCalls {
  const { client, feeds, watchFeed, flowOfSession, conversationOf, runningNow, sent, stops, stopWatchers, wake } = state;
  return {
    async openConversation(worker) {
      return (await conversationOf(worker)).sessionId;
    },
    async send(sessionId, text, attachments = []) {
      const flow = flowOfSession.get(sessionId);
      if (flow === undefined) throw new Error(`teammates: ${sessionId} is not an open conversation`);
      // The id is the page's own, so a Stop pressed before this send can tell this turn came after it.
      const requestId = `req_${crypto.randomUUID()}`;
      sent.set(sessionId, [...(sent.get(sessionId) ?? []), requestId]);
      // Streamed, so the answer shows as it is written (the session stream sends it once finished).
      const response = await client.flow(flow).send("respond", { message: text }, { sessionId, requestId, stream: true, attachments: [...attachments] });
      if (!response.ok) throw new Error(`teammates: the send was refused (${response.status})`);
      if (response.headers.get("content-type")?.includes("text/event-stream")) feeds(sessionId).followResponse(response);
    },
    async interrupt(sessionId) {
      const flow = flowOfSession.get(sessionId);
      if (flow === undefined) throw new Error(`teammates: ${sessionId} is not an open conversation`);
      // The turns running at the press: what the view showed, plus what the server reads now, since the
      // view's read can lag a line sent just before the press. A line sent after it is its own turn.
      const shown = runningNow.get(sessionId) ?? [];
      const sentBefore = new Set(sent.get(sessionId) ?? []);
      const read = (await client.sessions.requests(sessionId, { status: "in_progress", limit: 20 })).filter((r) => !QUIET_ACTIONS.has(r.actionName)).map((r) => r.id);
      // The read answers after the press: a turn this page sent meanwhile is not one Stop stops.
      const sentAfter = new Set((sent.get(sessionId) ?? []).filter((id) => !sentBefore.has(id)));
      const ids = [...new Set([...shown, ...read])].filter((id) => !sentAfter.has(id));
      const stop = { ids: new Set(ids) };
      stops.set(sessionId, stop);
      wake(sessionId);
      const done = () => {
        if (stops.get(sessionId) === stop) stops.delete(sessionId);
        wake(sessionId);
      };
      try {
        for (const id of ids) {
          await client
            .flow(flow)
            .request(id)
            .abort()
            .catch(async (error: unknown) => {
              // A 409 is a turn that ended meanwhile, or one an answer resumed first, which runs on:
              // the record decides. Still running, the server refused the stop.
              if ((error as { status?: number }).status !== 409) throw error;
              const now = (await client.sessions.requests(sessionId, { limit: 20 })).find((r) => r.id === id);
              if (now?.status === "in_progress") throw new Error("The turn went on before the stop reached it. Press Stop again.");
              // Ended already, so the stop waits on it no longer (an old turn may be past the requests read).
              stop.ids.delete(id);
              if (stop.ids.size === 0) done();
            });
        }
      } catch (error) {
        done();
        throw error;
      }
      if (ids.length === 0) done();
    },
    async answerApproval(sessionId, approval, approve) {
      const flow = flowOfSession.get(sessionId);
      if (flow === undefined) throw new Error(`teammates: ${sessionId} is not an open conversation`);
      await client.flow(flow).request(approval.requestId).answer({ suspensionId: approval.suspensionId, action: approve ? "approve" : "reject" });
    },
    async retry(sessionId, requestId) {
      const flow = flowOfSession.get(sessionId) ?? (await client.sessions.get(sessionId)).flowKind;
      await client.flow(flow).request(requestId).retry();
    },
    watchConnection(sessionId, onChange) {
      return feeds(sessionId).watchState(onChange);
    },
    watchConversation(sessionId, onChange) {
      let entries: ConversationEntry[] = [];
      let items: Item[] = [];
      let inProgress: string[] = [];
      let ended: string[] = [];
      let retryable = new Set<string>();
      /** The answering turns that ended `aborted`: each gets a stopped line. */
      let stopped: string[] = [];
      /** The board's own passes (`dispatch`), which are never stopped. */
      let quiet: string[] = [];
      let backgroundRunning: number | null = null;
      let shown: ConversationView | undefined;
      // Unchanged entries keep their objects, so a streamed chunk redraws only the growing one.
      const reuse = stableList<ConversationEntry>((next) => {
        entries = next;
      });
      const feed = feeds(sessionId);
      const loadEarlier = () => feed.loadEarlier();
      const emit = () => {
        // What the view shows answering, never the board's own passes: what a Stop pressed now stops.
        runningNow.set(sessionId, answeringTurnsOf(items, inProgress, ended).filter((id) => !quiet.includes(id)));
        const running = answeringOf(items, inProgress, ended);
        const stop = stops.get(sessionId);
        // A stop ends once the requests show every turn it aborted ended.
        if (stop !== undefined && [...stop.ids].every((id) => ended.includes(id))) stops.delete(sessionId);
        const stopping = stops.has(sessionId);
        const earlier = feed.hasEarlier();
        const since: number | undefined = items[0]?.ts;
        if (
          shown?.entries === entries &&
          shown.running === running &&
          shown.stopping === stopping &&
          shown.backgroundRunning === backgroundRunning &&
          (shown.loadEarlier !== undefined) === earlier &&
          shown.since === since
        )
          return;
        shown = { entries, running, stopping, backgroundRunning, ...(earlier ? { loadEarlier } : {}), ...(since === undefined ? {} : { since }) };
        onChange(shown);
      };
      const stopFeed = watchFeed(sessionId, (next) => next, (next) => {
        items = next;
        reuse(toEntries(items, state.workerIds, ended, retryable, stopped));
        emit();
      });
      // A runs-only change moves the count alone: the entries stay as they are.
      const stopRuns = feed.watchRuns((count) => {
        backgroundRunning = count;
        emit();
      });
      const watchers = stopWatchers.get(sessionId) ?? new Set<() => void>();
      stopWatchers.set(sessionId, watchers.add(emit));
      const stopPoll = client.live([topic.session(sessionId)], {
        read: () => client.sessions.requests(sessionId, { limit: 20 }),
        onValue: (requests) => {
          const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName));
          inProgress = answering.filter((r) => r.status === "in_progress").map((r) => r.id);
          quiet = requests.filter((r) => QUIET_ACTIONS.has(r.actionName)).map((r) => r.id);
          ended = requests.filter((r) => r.status !== "in_progress").map((r) => r.id);
          // Kept for the view's life: a stopped line stays once its turn leaves the 20-request read.
          stopped = [...new Set([...stopped, ...answering.filter((r) => r.status === "aborted").map((r) => r.id)])];
          // The turns the engine would retry: a record with no source predates it, and came in over http.
          retryable = new Set(requests.filter((r) => RETRYABLE_SOURCES.has(r.source ?? "http")).map((r) => r.id));
          // A turn that ended with a call still marked running reads that call failed.
          reuse(toEntries(items, state.workerIds, ended, retryable, stopped));
          emit();
        },
        hear: isRequest,
        pollIntervalMs: POLL_MS,
        onError: logFailedRead,
      }).close;
      return () => {
        watchers.delete(emit);
        if (watchers.size === 0) runningNow.delete(sessionId);
        stopFeed();
        stopRuns();
        stopPoll();
      };
    },
  };
}
