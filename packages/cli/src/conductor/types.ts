/**
 * Shared shapes for the operator surface. The TUI and the headless commands
 * both render a `status` payload — the board row is the authority, the run
 * record is the commentary, and open questions are the only thing a person
 * can act on.
 */

/** One open question, as `status` returns it. */
export interface StatusQuestion {
  /** The inbox row's name — pass this verbatim to `answer`. */
  question: string;
  text: string;
  attempt: number;
  askedAt: number | null;
}

/** The run record as `status` attaches it. Fields may be null (BP-023). */
export interface StatusRun {
  attempt: number | null;
  taskId: string | null;
  workspacePath: string | null;
  branch: string | null;
  outcome: "running" | "succeeded" | "failed" | null;
  reason: string | null;
  sessionId: string | null;
  finalMessage: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  costUsd: number | null;
  childSessionId: string | null;
  requestId: string | null;
  /** The pull request that attempt produced, when status carried one. */
  prUrl?: string | null;
  /** Setup defects this attempt repaired on the worktree before the run. */
  healed?: string[] | null;
  updatedAt: number | null;
}

/** One board row plus the run and questions `status` joins onto it. */
export interface StatusRow {
  taskId: string;
  issue: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  feedback: string | null;
  /**
   * What the operator filed with the issue, when `status` carried it.
   * Absent or null on a legacy row.
   */
  brief?: string | null;
  run: StatusRun | null;
  questions: StatusQuestion[];
}

/** The `status` action's output. */
export interface StatusOutput {
  rows: StatusRow[];
}

/** What `seed` answers with. */
export interface SeedOutput {
  taskId: string;
}

/** What `answer` answers with. */
export interface AnswerOutput {
  result: "answered" | "recovered" | "declined";
  reason: string | null;
  question: string;
  taskStatus: string | null;
  questionStatus: string | null;
  drained: boolean;
}

/** One row of a coding run's todo list. */
export interface PlanItem {
  mark: "x" | "·" | " ";
  text: string;
}

/** One Write / Edit hunk kept for the reserved band. */
export interface HunkEntry {
  file: string;
  lines: string[];
}

/** How many per-request hunks the band can cycle. */
export const HUNK_STACK_MAX = 12;

/** Last-touch-last stack. A later write to the same file replaces that entry. */
export function pushHunk(stack: readonly HunkEntry[], entry: HunkEntry): HunkEntry[] {
  const next = stack.filter((item) => item.file !== entry.file);
  next.push(entry);
  return next.length <= HUNK_STACK_MAX ? next : next.slice(-HUNK_STACK_MAX);
}

/** A line in the activity log. Newest last; the renderer shows a tail. */
export interface ActivityItem {
  at: number;
  text: string;
  /**
   * Child request this line belongs to. Absent means the board or an
   * operator action (`seed` / `wake` / `status` / `answer`) — those stay
   * visible on every selected row.
   */
  requestId?: string;
}

/** The operator verbs this surface can dispatch. */
export type OperatorCommand =
  | { kind: "status"; issue?: string }
  | { kind: "seed"; issue: string; phase?: string; brief?: string }
  | { kind: "wake" }
  | { kind: "answer"; question: string; text: string }
  | { kind: "steer"; message: string }
  | { kind: "watch"; issue?: string }
  | { kind: "start"; issue: string; phase?: string; brief?: string }
  | { kind: "abort"; issue?: string }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "refresh" }
  | { kind: "find"; query?: string };

/** How the prompt is interpreting keystrokes. */
export type InputMode = "command" | "answer" | "seed" | "find";

/** Everything the renderer and the key reducer need. */
export interface ViewState {
  /** Shown in the header. The board is one epic. */
  epicLabel: string;
  /** Product checkout basename, when `CONDUCTOR_REPO` is set. */
  repoLabel: string | null;
  rows: StatusRow[];
  selected: number;
  /** Which open question on the selected row the answer prompt targets. */
  questionIndex: number;
  input: string;
  inputMode: InputMode;
  /** The question row being answered, when `inputMode === "answer"`. */
  answering: string | null;
  help: boolean;
  busy: boolean;
  notice: string | null;
  activity: ActivityItem[];
  /**
   * In-flight operator line — a streaming message or transient status
   * from `seed` / `wake` / `status` / `answer`. `null` when nothing in
   * this process is mid-stream.
   */
  live: string | null;
  /**
   * In-flight line per followed child request. The renderer shows the
   * selected row's entry, so two live children do not share a slot.
   */
  childLive: Record<string, string>;
  /**
   * Latest checklist per followed child request. Replaced when that
   * request emits a new todo list; shown on the selected row.
   */
  childPlan: Record<string, PlanItem[]>;
  /**
   * Files that request has written, edited, or read — last touch last.
   * Kept beside the transcript so a long run does not drop them when
   * activity is capped.
   */
  childFiles: Record<string, string[]>;
  /**
   * Write / Edit hunks for that request — last touch last, one entry
   * per file. Each entry is the full changed span, not the ten-line
   * transcript cap. `hunkAt` picks which one the band shows.
   */
  childHunks: Record<string, HunkEntry[]>;
  /**
   * Offset from the latest hunk (`0` is last touch). `H` steps older.
   */
  hunkAt: number;
  /**
   * When true, the RUN band shows the full checklist. When false, one
   * current item and a count — the transcript keeps the rest of the height.
   */
  planExpanded: boolean;
  /**
   * When true, the reserved band and inspect pane show more of the
   * file list. When false, the last three paths.
   */
  filesExpanded: boolean;
  /**
   * When true, the reserved band and inspect pane show more of the
   * last hunk. When false, the last three changed lines.
   */
  hunksExpanded: boolean;
  /**
   * When true, the reserved band shows more of the last Read peek or
   * Bash / Grep / Glob tail. When false, three lines.
   */
  peekExpanded: boolean;
  /**
   * Transcript pager offset from the latest line. `0` follows new activity
   * (Grok-style). PageUp / wheel-up increase it.
   */
  scroll: number;
  /**
   * Case-insensitive query over the selected row's transcript. `null`
   * means find is off. Matches stay in context — the transcript is not
   * filtered to hits.
   */
  find: string | null;
  /**
   * Index into `findMatches`. A new query starts on the last (newest)
   * hit; `n` steps older, `N` newer.
   */
  findAt: number;
  /**
   * Index into `slashMatches(input)` while a slash verb is being typed.
   * Ignored once the line has arguments or the prompt is empty.
   */
  slashAt: number;
  lastRefreshAt: number | null;
  /** Submitted compose lines, newest last. Survives `/quit` when a sidecar is set. */
  drafts: string[];
  /** Index into `drafts` while walking with ↑/↓, or `null` on the live draft. */
  draftAt: number | null;
  /** Unsent compose text stashed when the first ↑ leaves the live draft. */
  draftHold: string | null;
  /** Index into `input` while composing (`0` is before the first character). */
  caret: number;
  /**
   * Inspect one row (question, transcript, files). The board is the
   * other screen — rows and the prompt, not the question body.
   */
  inspect: boolean;
}

export function emptyView(epicLabel: string): ViewState {
  return {
    epicLabel,
    repoLabel: null,
    rows: [],
    selected: 0,
    questionIndex: 0,
    input: "",
    inputMode: "command",
    answering: null,
    help: false,
    busy: false,
    notice: null,
    activity: [],
    live: null,
    childLive: {},
    childPlan: {},
    childFiles: {},
    childHunks: {},
    hunkAt: 0,
    planExpanded: false,
    filesExpanded: false,
    hunksExpanded: false,
    peekExpanded: false,
    scroll: 0,
    find: null,
    findAt: 0,
    slashAt: 0,
    lastRefreshAt: null,
    drafts: [],
    draftAt: null,
    draftHold: null,
    caret: 0,
    inspect: false,
  };
}

/**
 * First line looks like an issue id (`LAB-151`, `FIX-1`). Seed compose
 * ↑ only walks these so a talk line cannot be filed as an issue.
 */
export function isSeedDraft(text: string): boolean {
  const first = (text.split("\n")[0] ?? "").trim();
  return /^[A-Za-z][A-Za-z0-9]*-\d+/.test(first);
}

/** Drafts ↑/↓ may recall in this compose mode. Seed skips talk lines. */
export function composeDrafts(state: ViewState): string[] {
  if (state.inputMode === "seed") return state.drafts.filter(isSeedDraft);
  return state.drafts;
}

/** The currently selected row, if the board is not empty. */
export function selectedRow(state: ViewState): StatusRow | undefined {
  return state.rows[state.selected];
}

/** Open questions on the selected row. */
export function selectedQuestions(state: ViewState): StatusQuestion[] {
  return selectedRow(state)?.questions ?? [];
}

/** The question the answer prompt will send, if any. */
export function selectedQuestion(state: ViewState): StatusQuestion | undefined {
  const questions = selectedQuestions(state);
  return questions[state.questionIndex] ?? questions[0];
}

/**
 * A row whose last attempt failed. `pending` plus `run.outcome === "failed"`
 * is the usual daily shape — the row is still retryable, the attempt is not.
 */
export function rowFailed(row: StatusRow): boolean {
  if (rowSpent(row)) return true;
  return row.run?.outcome === "failed";
}

/**
 * The board will not take this row again. `/wake` is a no-op here —
 * `errored` spent the retry budget; `cancelled` was withdrawn.
 */
export function rowSpent(row: StatusRow): boolean {
  return row.status === "errored" || row.status === "cancelled";
}

/** A running row with no write for this long is stalled. */
export const STALL_AFTER_MS = 30_000;

/** A running row whose last write is older than `STALL_AFTER_MS`. */
export function rowStalled(
  row: StatusRow,
  activity: readonly ActivityItem[] = [],
  now: number = Date.now(),
): boolean {
  if (!rowRunning(row)) return false;
  const at = lastActivityAt(row, activity);
  if (at === null) return false;
  return now - at >= STALL_AFTER_MS;
}

/**
 * A row a person should look at next — an open question, a failed
 * attempt, or a running child that has gone silent.
 */
export function rowNeedsYou(
  row: StatusRow,
  activity: readonly ActivityItem[] = [],
  now: number = Date.now(),
): boolean {
  return row.questions.length > 0 || rowFailed(row) || rowStalled(row, activity, now);
}

/** Why a failed row failed. Prefer the run reason, then feedback, then the last message. */
export function failureReason(row: StatusRow): string {
  const reason = row.run?.reason ?? row.feedback ?? row.run?.finalMessage;
  if (reason !== null && reason !== undefined && reason !== "") return reason;
  return row.status === "cancelled" ? "cancelled" : "failed";
}

/**
 * The selected row's failure, when there is one and no open question.
 * An open question wins — answer it before retrying.
 */
export function selectedFailure(state: ViewState): { reason: string } | undefined {
  if (selectedQuestion(state) !== undefined) return undefined;
  const row = selectedRow(state);
  if (row === undefined || !rowFailed(row)) return undefined;
  return { reason: failureReason(row) };
}

export function clampSelected(state: ViewState): ViewState {
  if (state.rows.length === 0) {
    return { ...state, selected: 0, questionIndex: 0 };
  }
  const selected = Math.max(0, Math.min(state.selected, state.rows.length - 1));
  const questions = state.rows[selected]?.questions ?? [];
  const questionIndex =
    questions.length === 0
      ? 0
      : Math.max(0, Math.min(state.questionIndex, questions.length - 1));
  return { ...state, selected, questionIndex };
}

/**
 * When a poll surfaces a new question and the operator is not composing,
 * inspect that row so the question is readable.
 */
export function focusNewlyAsked(prev: StatusRow[], state: ViewState): ViewState {
  if (state.inputMode !== "command" || state.input !== "") return state;
  const index = state.rows.findIndex((row) => {
    const before = prev.find((r) => r.taskId === row.taskId);
    if (before === undefined) return row.questions.length > 0;
    return row.questions.some((q) => !before.questions.some((p) => p.question === q.question));
  });
  if (index < 0) return state;
  const row = state.rows[index]!;
  const before = prev.find((r) => r.taskId === row.taskId);
  const questionIndex = row.questions.findIndex(
    (q) => before === undefined || !before.questions.some((p) => p.question === q.question),
  );
  return clampSelected({
    ...state,
    selected: index,
    questionIndex: questionIndex < 0 ? 0 : questionIndex,
    scroll: 0,
    inspect: true,
  });
}

/**
 * When a poll shows a row that just stopped running and the operator is
 * not composing, inspect that row so the finished attempt is on screen.
 * A new question wins — answer it first.
 */
export function focusNewlySettled(prev: StatusRow[], state: ViewState): ViewState {
  if (state.inputMode !== "command" || state.input !== "") return state;
  const index = state.rows.findIndex((row) => {
    const before = prev.find((r) => r.taskId === row.taskId);
    if (before === undefined) return false;
    return rowRunning(before) && !rowRunning(row);
  });
  if (index < 0) return state;
  return clampSelected({
    ...state,
    selected: index,
    questionIndex: 0,
    scroll: 0,
    inspect: true,
  });
}

/** Newest this many lines are kept per unselected request, and for board-only lines. */
export const ACTIVITY_CAP = 2000;

/** Cap activity so a long implement cannot grow the TUI state without bound. */
export function pushActivity(
  state: ViewState,
  text: string,
  at: number = Date.now(),
  requestId?: string,
): ViewState {
  const item: ActivityItem =
    requestId !== undefined ? { at, text, requestId } : { at, text };
  return { ...state, activity: capActivity([...state.activity, item], selectedRequestId(state)) };
}

/**
 * Operator talk. The stream also emits `you ·`; do not double this turn.
 *
 * A prior turn that used the same words does not count — that was
 * yesterday's line. Only an unanswered `you ·` on this turn is a repeat.
 */
export function echoTalk(state: ViewState, message: string, at: number = Date.now()): ViewState {
  const text = `you · ${message}`;
  let youAt = -1;
  for (let i = state.activity.length - 1; i >= 0; i -= 1) {
    const item = state.activity[i]!;
    if (item.requestId === undefined && item.text.startsWith("you · ")) {
      youAt = i;
      break;
    }
  }
  if (youAt >= 0 && state.activity[youAt]!.text === text) {
    const replied = state.activity.slice(youAt + 1).some(
      (item) => item.text.startsWith("message · ") || item.text.startsWith("coord · "),
    );
    if (!replied) return state;
  }
  return pushActivity(state, text, at);
}

/**
 * After a steer turn, put the coordinator output on the transcript when
 * this turn did not already stream a reply.
 *
 * A prior turn's `message ·` or `coord ·` does not count — that was the
 * last reply. Only lines after the latest operator `you ·` do.
 */
export function noteSteerReply(
  state: ViewState,
  said: string,
  at: number = Date.now(),
): ViewState {
  let start = 0;
  for (let i = state.activity.length - 1; i >= 0; i -= 1) {
    const item = state.activity[i]!;
    if (item.requestId === undefined && item.text.startsWith("you · ")) {
      start = i + 1;
      break;
    }
  }
  const already = state.activity.slice(start).some(
    (item) => item.text.startsWith("message · ") || item.text.startsWith("coord · "),
  );
  if (already) return state;
  const trimmed = said.trim();
  const text =
    trimmed !== "" ? `coord · ${trimmed.split("\n")[0]!.trim()}` : "coordinator turn finished";
  return pushActivity(state, text, at);
}

/**
 * Re-apply the per-request cap. The selected attempt stays whole so
 * `/find` can still match an early tool.
 */
export function trimActivity(state: ViewState): ViewState {
  return { ...state, activity: capActivity(state.activity, selectedRequestId(state)) };
}

/** Drop one request's in-memory lines so a journal reload can replace them. */
export function dropRequestActivity(state: ViewState, requestId: string): ViewState {
  const childHunks = { ...state.childHunks };
  delete childHunks[requestId];
  return {
    ...state,
    activity: state.activity.filter((item) => item.requestId !== requestId),
    childHunks,
  };
}

/**
 * Drop the oldest overflow per request. Another row's tools do not evict
 * this one's transcript. The selected request is not capped.
 */
function capActivity(activity: ActivityItem[], keep?: string): ActivityItem[] {
  const extra = new Map<string | undefined, number>();
  for (const item of activity) {
    extra.set(item.requestId, (extra.get(item.requestId) ?? 0) + 1);
  }
  let overflow = false;
  for (const [key, count] of extra) {
    if (key !== undefined && key === keep) {
      extra.set(key, 0);
      continue;
    }
    if (count > ACTIVITY_CAP) {
      extra.set(key, count - ACTIVITY_CAP);
      overflow = true;
    } else {
      extra.set(key, 0);
    }
  }
  if (!overflow) return activity;
  return activity.filter((item) => {
    const drop = extra.get(item.requestId) ?? 0;
    if (drop <= 0) return true;
    extra.set(item.requestId, drop - 1);
    return false;
  });
}

/**
 * The selected row's last-known request id — still set after the run
 * settles, so the transcript can show that attempt's tools.
 */
export function selectedRequestId(state: ViewState): string | undefined {
  const id = selectedRow(state)?.run?.requestId;
  if (id === null || id === undefined || id === "") return undefined;
  return id;
}

/**
 * The selected row's child stream. Talk, seed, and wake stay on the
 * board strip — inspect is that attempt, not the host log. Another
 * row's tools stay off this view until that row is selected.
 */
export function activityForView(state: ViewState): ActivityItem[] {
  const id = selectedRequestId(state);
  if (id === undefined) return [];
  return state.activity.filter((item) => item.requestId === id);
}

/** The selected row's latest checklist, when that request wrote one. */
export function selectedPlan(state: ViewState): PlanItem[] {
  const id = selectedRequestId(state);
  if (id === undefined) return [];
  return state.childPlan[id] ?? [];
}

const FILE_TOOL = /^(Write|Edit|Read) (.+)$/;

/** Strip the sub-agent indent a nested tool line carries. */
export function transcriptBody(text: string): string {
  return text.replace(/^ +/, "");
}

/** Path from a Write / Edit / Read transcript line. Bash and search stay out. */
export function fileFromToolLine(text: string): string | undefined {
  const line = transcriptBody(text);
  if (!line.startsWith("tool · ")) return undefined;
  const rest = line.slice("tool · ".length).replace(/ · (failed|stopped)$/, "");
  const match = FILE_TOOL.exec(rest);
  if (match === null) return undefined;
  const path = match[2]!.trim();
  return path === "" ? undefined : path;
}

/** The selected row's Write / Edit hunks, last touch last. */
export function selectedHunkStack(state: ViewState): HunkEntry[] {
  const id = selectedRequestId(state);
  if (id === undefined) return [];
  return state.childHunks[id] ?? [];
}

/** The hunk the band is showing — latest, or an older one after `H`. */
export function selectedHunkEntry(state: ViewState): HunkEntry | undefined {
  const stack = selectedHunkStack(state);
  if (stack.length === 0) return undefined;
  const at = ((state.hunkAt % stack.length) + stack.length) % stack.length;
  return stack[stack.length - 1 - at];
}

/** Lines of the hunk the band is showing. */
export function selectedHunk(state: ViewState): string[] {
  return selectedHunkEntry(state)?.lines ?? [];
}

/** Step to an older (`+1`) or newer (`-1`) hunk. Wraps. */
export function stepHunk(state: ViewState, delta: number): ViewState {
  const n = selectedHunkStack(state).length;
  if (n <= 1) return state;
  return { ...state, hunkAt: (state.hunkAt + delta + n) % n };
}

/**
 * Files the selected run has written, edited, or read — unique, last
 * touch last. Derived from that row's transcript; another row's tools
 * stay off this list.
 */
export function selectedFiles(state: ViewState): string[] {
  const id = selectedRequestId(state);
  if (id !== undefined && state.childFiles[id] !== undefined) {
    return state.childFiles[id] ?? [];
  }
  const files: string[] = [];
  for (const item of activityForView(state)) {
    const file = fileFromToolLine(item.text);
    if (file === undefined) continue;
    const prior = files.indexOf(file);
    if (prior >= 0) files.splice(prior, 1);
    files.push(file);
  }
  return files;
}

/** The item in progress, else the first pending, else the last completed. */
export function currentPlanItem(plan: readonly PlanItem[]): PlanItem | undefined {
  return (
    plan.find((item) => item.mark === "·") ??
    plan.find((item) => item.mark === " ") ??
    plan.at(-1)
  );
}

function stripLivePrefix(text: string): string {
  return transcriptBody(text).replace(/^(status|message|tool) · /, "");
}

/**
 * Last `tool ·` or `think ·` line for this request, or for board-only
 * lines when `id` is absent. A think after the last tool wins — that is
 * what the child is doing now.
 */
function lastActionForRequest(state: ViewState, id: string | undefined): string | undefined {
  for (let i = state.activity.length - 1; i >= 0; i -= 1) {
    const item = state.activity[i]!;
    if (id !== undefined && item.requestId !== id) continue;
    if (id === undefined && item.requestId !== undefined) continue;
    const body = transcriptBody(item.text);
    if (body.startsWith("tool · ")) return body.slice("tool · ".length);
    if (body.startsWith("think · ")) return body;
  }
  return undefined;
}

/**
 * What that row is doing right now. That request's live line wins;
 * otherwise its last tool or think line. Another row's stream stays off this.
 */
export function rowNow(state: ViewState, row: StatusRow): string | undefined {
  const id = row.run?.requestId;
  if (id === null || id === undefined || id === "") return undefined;
  const live = state.childLive[id];
  if (live !== undefined && live !== "") return stripLivePrefix(live);
  return lastActionForRequest(state, id);
}

/**
 * What the selected run is doing right now. The live line wins; otherwise
 * the last tool or think line from that request's transcript.
 */
export function selectedNow(state: ViewState): string | undefined {
  const live = visibleLive(state);
  if (live !== null && live !== "") return stripLivePrefix(live);
  return lastActionForRequest(state, selectedRequestId(state));
}

/**
 * First lines of the selected run's last Read, when that Read is still
 * the last tool. A later Write, Edit, or Bash drops the peek — the hunk
 * or the command result is what the band should show then.
 */
export function selectedReadPeek(state: ViewState): string[] {
  return lastToolFollowLines(state, (name) => name === "Read");
}

/**
 * Last lines of the selected run's last Bash / Grep / Glob / LS, when
 * that tool is still the last one. A later Write or Read drops the tail.
 */
export function selectedCommandTail(state: ViewState): string[] {
  return lastToolFollowLines(state, (name) =>
    name === "Bash" || name === "Grep" || name === "Glob" || name === "LS",
  );
}

function lastToolFollowLines(
  state: ViewState,
  match: (name: string) => boolean,
): string[] {
  const items = activityForView(state);
  let start = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const body = transcriptBody(items[i]!.text);
    if (!body.startsWith("tool · ")) continue;
    const rest = body.slice("tool · ".length).replace(/ · (failed|stopped)$/, "");
    const name = rest.split(" ")[0] ?? "";
    if (!match(name)) return [];
    start = i;
    break;
  }
  if (start < 0) return [];
  const follow: string[] = [];
  for (let i = start + 1; i < items.length; i += 1) {
    const body = transcriptBody(items[i]!.text);
    if (
      body.startsWith("tool · ") ||
      body.startsWith("status · ") ||
      body.startsWith("message · ") ||
      body.startsWith("think · ") ||
      body.startsWith("sub · ")
    ) {
      break;
    }
    follow.push(body.replace(/^ {2}/, ""));
  }
  return follow;
}

/**
 * Live line for the selected child's stream. The operator slot (`live`)
 * is the board strip — a status poll does not appear on inspect.
 */
export function visibleLive(state: ViewState): string | null {
  const id = selectedRequestId(state);
  if (id === undefined) return null;
  const child = state.childLive[id];
  return child === undefined ? null : child;
}

const PAGE = 8;

/** Scroll the transcript. Positive looks further back. Clamped at render time. */
export function scrollTranscript(state: ViewState, delta: number): ViewState {
  return { ...state, scroll: Math.max(0, state.scroll + delta) };
}

export function pageTranscript(state: ViewState, direction: -1 | 1): ViewState {
  return scrollTranscript(state, direction * PAGE);
}

/**
 * Idle Home / End. Oldest is a large offset; render clamps to the
 * window. Follow is the live tail (`scroll === 0`).
 */
export function jumpTranscript(state: ViewState, to: "oldest" | "follow"): ViewState {
  return { ...state, scroll: to === "follow" ? 0 : Number.MAX_SAFE_INTEGER };
}

/** One match of the current find query in `activityForView`. */
export interface FindHit {
  /** Index into `activityForView`. */
  itemIndex: number;
  /** Inclusive start in `item.text`. */
  start: number;
  /** Exclusive end in `item.text`. */
  end: number;
}

/**
 * Case-insensitive hits in the selected row's transcript. Empty when
 * find is off or the query is empty. Non-overlapping, oldest first.
 */
export function findMatches(state: ViewState): FindHit[] {
  const query = state.find;
  if (query === null || query === "") return [];
  const needle = query.toLowerCase();
  const hits: FindHit[] = [];
  const items = activityForView(state);
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const hay = items[itemIndex]!.text.toLowerCase();
    let from = 0;
    while (from <= hay.length - needle.length) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      hits.push({ itemIndex, start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }
  return hits;
}

/** Turn find on with `query`, or off when the query is empty. Starts on the newest hit. */
export function applyFindQuery(state: ViewState, query: string): ViewState {
  if (query === "") {
    return { ...state, find: null, findAt: 0 };
  }
  const next: ViewState = { ...state, find: query };
  const hits = findMatches(next);
  return { ...next, findAt: hits.length === 0 ? 0 : hits.length - 1 };
}

/**
 * Step to an older (`-1`) or newer (`1`) hit. Wraps. No-op when there
 * are no matches.
 */
export function stepFind(state: ViewState, direction: -1 | 1): ViewState {
  const hits = findMatches(state);
  if (hits.length === 0) return state;
  const at = ((state.findAt % hits.length) + hits.length) % hits.length;
  return { ...state, findAt: (at + direction + hits.length) % hits.length };
}

/** The current hit, if find is on and the query matched. */
export function currentFindHit(state: ViewState): FindHit | undefined {
  const hits = findMatches(state);
  if (hits.length === 0) return undefined;
  const at = Math.min(Math.max(0, state.findAt), hits.length - 1);
  return hits[at];
}

/**
 * Request ids of coding runs that are still in flight. `status` puts the
 * child's id on `run.requestId`; the operator surface follows that stream
 * through the same store subscription the HTTP attach route uses.
 */
export function runningRequestIds(rows: readonly StatusRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = rowRunningRequestId(row);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/**
 * A row whose coding run is still in flight.
 *
 * The board row is the authority. The run record stays `running` across a
 * park on purpose — that is bookkeeping, not a live child. `/quit` and
 * idle Ctrl-C must not abort a parked question.
 */
export function rowRunning(row: StatusRow): boolean {
  return row.status === "in_progress";
}

/**
 * Last child write we know about. Journal `at` for that request wins
 * when it is newer; `run.updatedAt` is the fallback when the journal
 * is empty. `updatedAt` is last write, not start — do not treat a
 * missing journal as elapsed-since-start.
 */
export function lastActivityAt(
  row: StatusRow,
  activity: readonly ActivityItem[] = [],
): number | null {
  let last: number | null = null;
  const id = row.run?.requestId;
  if (id !== null && id !== undefined && id !== "") {
    for (const item of activity) {
      if (item.requestId === id) last = item.at;
    }
  }
  const updated = row.run?.updatedAt ?? null;
  if (last === null) return updated;
  if (updated === null) return last;
  return Math.max(last, updated);
}

/** Last child write on the selected row. */
export function selectedLastActivityAt(state: ViewState): number | null {
  const row = selectedRow(state);
  if (row === undefined) return null;
  return lastActivityAt(row, state.activity);
}

/** The child's request id when this row is still in flight, otherwise absent. */
export function rowRunningRequestId(row: StatusRow): string | undefined {
  const id = row.run?.requestId;
  if (id === null || id === undefined || id === "") return undefined;
  if (!rowRunning(row)) return undefined;
  return id;
}

/**
 * Last-attempt request ids on rows that are no longer running.
 * `status ISSUE` and a `watch` that just exited catch-up these
 * journals; a full-board status loads running rows only.
 */
export function settledRequestIds(rows: readonly StatusRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = row.run?.requestId;
    if (id === null || id === undefined || id === "") continue;
    if (rowRunning(row)) continue;
    ids.push(id);
  }
  return ids;
}

/** The selected row's in-flight request, when there is one. */
export function selectedRunningRequestId(state: ViewState): string | undefined {
  const row = selectedRow(state);
  return row === undefined ? undefined : rowRunningRequestId(row);
}

/** True when any board row still has a coding run in flight. */
export function boardHasRunning(rows: readonly StatusRow[]): boolean {
  return runningRequestIds(rows).length > 0;
}

/** Why `/quit` and idle Ctrl-C stay when a child is still running. */
export const STAY_WHILE_RUNNING = "a run is still going — stay, or select it and press x";

/**
 * Journals the board should be reading. Running rows stay tailed. The
 * selected row's last request is included even after it settles — reopening
 * the board, or moving onto a finished row, still catch-up that attempt.
 */
export function idsToFollow(state: ViewState): string[] {
  const ids = runningRequestIds(state.rows);
  const selected = selectedRequestId(state);
  if (selected !== undefined && !ids.includes(selected)) ids.push(selected);
  return ids;
}
