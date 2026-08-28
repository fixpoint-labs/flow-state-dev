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
  | { kind: "refresh" };

/** How the prompt is interpreting keystrokes. */
export type InputMode = "command" | "answer" | "seed";

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
   * request emits a new todo list; shown on the selected running row.
   */
  childPlan: Record<string, PlanItem[]>;
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
    planExpanded: false,
    scroll: 0,
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

export function pushActivity(
  state: ViewState,
  text: string,
  at: number = Date.now(),
  requestId?: string,
): ViewState {
  const item: ActivityItem =
    requestId !== undefined ? { at, text, requestId } : { at, text };
  const activity = [...state.activity, item];
  return { ...state, activity: activity.length > 200 ? activity.slice(-200) : activity };
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
    return live.replace(/^(status|message) · /, "");
  }
  const id = selectedRequestId(state);
  for (let i = state.activity.length - 1; i >= 0; i -= 1) {
    const item = state.activity[i]!;
    if (id !== undefined && item.requestId !== id) continue;
    if (id === undefined && item.requestId !== undefined) continue;
    if (item.text.startsWith("tool · ")) return item.text.slice("tool · ".length);
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

/** The selected row's in-flight request, when there is one. */
export function selectedRunningRequestId(state: ViewState): string | undefined {
  const row = selectedRow(state);
  return row === undefined ? undefined : rowRunningRequestId(row);
}
