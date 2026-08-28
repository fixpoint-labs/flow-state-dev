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
  | { kind: "seed"; issue: string; phase?: string }
  | { kind: "wake" }
  | { kind: "answer"; question: string; text: string }
  | { kind: "watch"; issue?: string }
  | { kind: "start"; issue: string; phase?: string }
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
   * When true, the RUN band shows the full checklist. When false, one
   * current item and a count — the transcript keeps the rest of the height.
   */
  planExpanded: boolean;
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
}

export function emptyView(epicLabel: string): ViewState {
  return {
    epicLabel,
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
    planExpanded: false,
    scroll: 0,
    find: null,
    findAt: 0,
    slashAt: 0,
    lastRefreshAt: null,
  };
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
  if (row.status === "errored" || row.status === "cancelled") return true;
  return row.run?.outcome === "failed";
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
 * Re-apply the per-request cap. The selected attempt stays whole so
 * `/find` can still match an early tool.
 */
export function trimActivity(state: ViewState): ViewState {
  return { ...state, activity: capActivity(state.activity, selectedRequestId(state)) };
}

/** Drop one request's in-memory lines so a journal reload can replace them. */
export function dropRequestActivity(state: ViewState, requestId: string): ViewState {
  return {
    ...state,
    activity: state.activity.filter((item) => item.requestId !== requestId),
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
 * Board/operator lines plus the selected row's child stream. Another
 * row's tools stay off this view until that row is selected.
 */
export function activityForView(state: ViewState): ActivityItem[] {
  const id = selectedRequestId(state);
  return state.activity.filter(
    (item) => item.requestId === undefined || item.requestId === id,
  );
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

/**
 * What the selected run is doing right now. The live line wins; otherwise
 * the last tool name from that request's transcript.
 */
export function selectedNow(state: ViewState): string | undefined {
  const live = visibleLive(state);
  if (live !== null && live !== "") {
    return transcriptBody(live).replace(/^(status|message|tool) · /, "");
  }
  const id = selectedRequestId(state);
  for (let i = state.activity.length - 1; i >= 0; i -= 1) {
    const item = state.activity[i]!;
    if (id !== undefined && item.requestId !== id) continue;
    if (id === undefined && item.requestId !== undefined) continue;
    const body = transcriptBody(item.text);
    if (body.startsWith("tool · ")) return body.slice("tool · ".length);
  }
  return undefined;
}

/**
 * Live line for the current view. A selected child that is mid-stream
 * wins over the operator slot so a status poll does not hide the run.
 */
export function visibleLive(state: ViewState): string | null {
  const id = selectedRequestId(state);
  if (id !== undefined) {
    const child = state.childLive[id];
    if (child !== undefined) return child;
  }
  return state.live;
}

const PAGE = 8;

/** Scroll the transcript. Positive looks further back. Clamped at render time. */
export function scrollTranscript(state: ViewState, delta: number): ViewState {
  return { ...state, scroll: Math.max(0, state.scroll + delta) };
}

export function pageTranscript(state: ViewState, direction: -1 | 1): ViewState {
  return scrollTranscript(state, direction * PAGE);
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
export function runningRequestIds(rows: StatusRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = rowRunningRequestId(row);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** A row whose coding run is still in flight. */
export function rowRunning(row: StatusRow): boolean {
  return row.run?.outcome === "running" || row.status === "in_progress";
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
 * journals; a full-board status does not replay every history.
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
