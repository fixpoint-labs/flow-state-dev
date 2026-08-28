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

/** A line in the activity log. Newest last; the renderer shows a tail. */
export interface ActivityItem {
  at: number;
  text: string;
}

/** The operator verbs this surface can dispatch. */
export type OperatorCommand =
  | { kind: "status"; issue?: string }
  | { kind: "seed"; issue: string; phase?: string }
  | { kind: "wake" }
  | { kind: "answer"; question: string; text: string }
  | { kind: "watch"; issue?: string }
  | { kind: "start"; issue: string; phase?: string }
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
   * In-flight transcript line — a streaming message or the current
   * transient status. `null` when nothing is mid-stream.
   */
  live: string | null;
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

export function pushActivity(state: ViewState, text: string, at: number = Date.now()): ViewState {
  const activity = [...state.activity, { at, text }];
  return { ...state, activity: activity.length > 200 ? activity.slice(-200) : activity };
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
    const id = row.run?.requestId;
    if (id === null || id === undefined || id === "") continue;
    if (row.run?.outcome === "running" || row.status === "in_progress") {
      ids.push(id);
    }
  }
  return ids;
}
