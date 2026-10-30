/**
 * A harness session's binding and its turns, and what the page reads off them:
 * the notice under a turn, and the plan panel's state.
 *
 * The state is `@flow-state-dev/harness-manager`'s harness session flow's
 * (`harnessSessionStateSchema`), imported here as types only, so the page
 * derives what it shows with the functions below in the browser. Nothing here is
 * harness-specific: a harness reports its failure through core's neutral
 * classification, and its label comes from the mode list as data.
 */
import type { HarnessTurnRecord } from "@flow-state-dev/harness-manager";
import type { RequestStatus } from "@flow-state-dev/core/types";

/** The classification a harness sets when it doesn't know the conversation it was asked to continue. */
export const UNKNOWN_CONVERSATION = "unknown-conversation";

/** How a turn's request stands, from the session's request list. */
export type TurnStatus = "running" | "completed" | "failed" | "stopped";

/** The code of the status item the framework writes when a request is stopped. */
const STOP_CODE = "system.request_aborted";

/** A session item, as far as finding the turns needs it. */
export interface TurnItem {
  readonly requestId: string;
  readonly type: string;
  readonly detail?: unknown;
}

/** The session's latest turn: its request id, its number from 1, and how it stands. */
export interface LatestTurn {
  readonly requestId: string;
  readonly number: number;
  readonly status: TurnStatus;
}

/** A request's status, as the session's request list reports it. */
function statusOf(status: RequestStatus): TurnStatus {
  switch (status) {
    case "completed":
    case "incomplete":
      return "completed";
    case "failed":
    case "interrupted":
      return "failed";
    case "aborted":
      return "stopped";
    default:
      return "running";
  }
}

function isStopItem(item: TurnItem): boolean {
  const detail = item.detail;
  return item.type === "status" && typeof detail === "object" && detail !== null && (detail as { code?: unknown }).code === STOP_CODE;
}

/**
 * The session's latest turn, or `null` before the first.
 *
 * Turns are the requests the items belong to, in the order they started. A
 * stop is read off the framework's own stop item, which the engine writes and
 * the page draws at once: the session hook doesn't re-read a request's status
 * after a stop, so its latest-request summary can still say it is running.
 * Otherwise the turn runs while it streams, or until the summary names it.
 *
 * @param input The session's items, whether it is streaming, and its latest request as last read.
 */
export function latestTurn(input: {
  readonly items: readonly TurnItem[];
  readonly streaming: boolean;
  readonly request: { readonly id: string; readonly status: RequestStatus } | null;
}): LatestTurn | null {
  const turns = new Set<string>();
  const stopped = new Set<string>();
  for (const item of input.items) {
    turns.add(item.requestId);
    if (isStopItem(item)) stopped.add(item.requestId);
  }
  const requestId = [...turns].at(-1);
  if (requestId === undefined) return null;
  const status: TurnStatus = stopped.has(requestId)
    ? "stopped"
    : input.streaming || input.request?.id !== requestId
      ? "running"
      : statusOf(input.request.status);
  return { requestId, number: turns.size, status };
}

/** What the session says under a turn. */
export type TurnNotice =
  | { readonly kind: "continued"; readonly conversation: string }
  | { readonly kind: "started"; readonly conversation: string }
  | { readonly kind: "moved"; readonly conversation: string; readonly previous: string }
  | { readonly kind: "refused"; readonly conversation: string; readonly error: string | null }
  | { readonly kind: "error"; readonly error: string | null; readonly conversation: string | null }
  | { readonly kind: "stopped"; readonly conversation: string | null };

/**
 * The notice for one turn, from that turn's own record and how it ended.
 *
 * Read in this order, and the order is the rule: a stop is a stop, never a
 * refusal, even before the harness confirmed anything; a refusal is only the
 * harness's own unknown-conversation classification, never a message read
 * here (a refusing harness may still have named the asked id first, so this is
 * checked before "confirmed what it asked"); any other failure is an error,
 * with the session's conversation kept. Two session-wide fields could not tell
 * these apart, which is why each turn has a record.
 *
 * @param turn The turn's record, or `null` if the turn never reached the harness.
 * @param status How the turn's request stands.
 * @param kept The session's bound conversation, which a failure never moves.
 * @returns The notice, or `null` while the turn runs or when it has nothing to say.
 */
export function turnNotice(turn: HarnessTurnRecord | null, status: TurnStatus, kept: string | null): TurnNotice | null {
  if (status === "running") return null;
  if (status === "stopped" || turn?.stopped === true) return { kind: "stopped", conversation: kept };
  if (turn?.failure === UNKNOWN_CONVERSATION && turn.asked !== null) {
    return { kind: "refused", conversation: turn.asked, error: turn.error };
  }
  if (status === "failed" || (turn?.error ?? null) !== null) {
    return { kind: "error", error: turn?.error ?? null, conversation: kept };
  }
  if (turn === null || turn.confirmed === null) return null;
  if (turn.asked === null) return { kind: "started", conversation: turn.confirmed };
  if (turn.confirmed === turn.asked) return { kind: "continued", conversation: turn.confirmed };
  return { kind: "moved", conversation: turn.confirmed, previous: turn.asked };
}

/** A plan row, as the resource route lists it: the topic under the collection, and its projected fields. */
export interface PlanRowItem {
  readonly topic: string;
  readonly title: string | null;
  readonly status: string | null;
  /** The request that last wrote the row; absent or `null` on a row stored per turn. */
  readonly requestId?: string | null;
}

/** A list marker, as the resource route lists it. */
export interface PlanMarkerItem {
  readonly topic: string;
  readonly status: string | null;
  readonly count: number | null;
  readonly reason: string | null;
  /** Set on a run's pointer to its conversation's plan, which is not a list marker. */
  readonly conversation?: string | null;
}

/**
 * Where the panel's plan was read from: the latest turn's own rows (stored per
 * turn, before plans were kept by conversation), or the bound conversation's.
 */
export type PlanScope = "turn" | "conversation";

/** What the plan panel shows. */
export type PlanPanelState =
  /** The harness declares no plan record at all. */
  | { readonly kind: "undeclared"; readonly label: string }
  /** The session has had no turn yet. */
  | { readonly kind: "no-turn" }
  /**
   * The record holds nothing: no marker and no rows. `turn` is the turn the
   * panel labels: the latest for a turn's plan, `null` for a conversation's.
   */
  | { readonly kind: "none"; readonly scope: PlanScope; readonly turn: number | null }
  /** The harness reported an empty list. */
  | { readonly kind: "empty"; readonly scope: PlanScope; readonly turn: number | null }
  /**
   * The plan's rows; `incomplete` with its reason when they are not the whole
   * plan. `turn` is the latest turn for a turn's plan, and for a
   * conversation's the turn that last changed a row (`null` if none is known).
   */
  | {
      readonly kind: "rows";
      readonly scope: PlanScope;
      readonly turn: number | null;
      readonly rows: readonly { readonly key: string; readonly title: string | null; readonly status: string | null }[];
      readonly incomplete: { readonly reason: string | null } | null;
    };

/** Everything the panel's state is derived from. */
export interface PlanPanelInput {
  /** Whether the session's resource manifest declares the plan record. */
  readonly declared: boolean;
  /** The mode's label, from the mode list. */
  readonly label: string;
  /** The session's latest turn, numbered from 1, or `null` before the first. */
  readonly turn: number | null;
  /** Whether that turn's request has ended. */
  readonly ended: boolean;
  /**
   * The plan's rows, topics under the collection: `<request>/<run>/<item>` for
   * a turn's plan, `conversation/<id>/<item>` for a conversation's.
   */
  readonly rows: readonly PlanRowItem[];
  /** The plan's list markers, topics under the collection (`<request>/<run>`, or `conversation/<id>`). */
  readonly markers: readonly PlanMarkerItem[];
  /**
   * Set when the rows are the bound conversation's plan: each turn's number by
   * its request id, for the label, and whether the conversation began before
   * plans were kept by conversation, so its plan may be missing what those
   * turns recorded.
   */
  readonly conversation?: { readonly turns: ReadonlyMap<string, number>; readonly predates: boolean } | null;
}

/** What the panel says when a conversation's plan may be missing what its earliest turns recorded. */
export const PREDATES_REASON = "this conversation began before plans were kept across turns";

/** How far along a plan row is, in the panel's three words plus whatever else a harness says. */
export interface PlanRowStage {
  readonly stage: "pending" | "active" | "done" | "other";
  /** What the row reads as: a known stage's plain words, or the harness's own word. */
  readonly label: string;
}

/**
 * Reads a plan row's status. A harness's create records none (Claude Code's
 * `TaskCreate` carries no status), so `null` is a row nobody has started.
 * Spelling (snake, kebab, spaced, camel) is forgiven; a word this does not know is kept as said.
 */
export function planRowStage(status: string | null): PlanRowStage {
  if (status === null || status.trim() === "") return { stage: "pending", label: "To do" };
  // `inProgress` (Cursor) and `in_progress` (Claude Code) are one word.
  switch (status.trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "pending":
    case "todo":
    case "not_started":
      return { stage: "pending", label: "To do" };
    case "in_progress":
    case "running":
      return { stage: "active", label: "In progress" };
    case "completed":
    case "complete":
    case "done":
      return { stage: "done", label: "Done" };
    default:
      return { stage: "other", label: status };
  }
}

/** Numeric-aware order: `step#10` after `step#2`, item `10` after `2`. */
function byNumber(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** The run segment of a topic: `<request>/<run>` from `<request>/<run>[/<item>]`. */
function runOf(topic: string): string {
  return topic.split("/").slice(0, 2).join("/");
}

/**
 * The plan panel's state for the session's latest turn.
 *
 * Read from the record only: the panel never rebuilds a plan from items. A
 * turn's plan with several runs (a retried block) shows its last; a
 * conversation's plan is one run. With a count in the marker, only places
 * below it show, so a row a lost count left behind never does. A marker still
 * `writing` after the turn ended reads as incomplete, the same as
 * `incomplete`. A run's pointer to its conversation is never a list marker.
 */
export function planPanelState(input: PlanPanelInput): PlanPanelState {
  if (!input.declared) return { kind: "undeclared", label: input.label };
  if (input.turn === null) return { kind: "no-turn" };
  const conversation = input.conversation ?? null;
  const scope: PlanScope = conversation === null ? "turn" : "conversation";
  const markers = input.markers.filter((m) => m.conversation == null);
  const runs = [...new Set([...input.rows.map((r) => runOf(r.topic)), ...markers.map((m) => runOf(m.topic))])].sort(byNumber);
  const run = runs.at(-1);
  const unlabelled = conversation === null ? input.turn : null;
  if (run === undefined) return { kind: "none", scope, turn: unlabelled };
  const marker = markers.find((m) => runOf(m.topic) === run) ?? null;
  const count = marker?.count ?? null;
  const inRun = input.rows.filter((r) => runOf(r.topic) === run);
  const rows = inRun
    .map((r) => ({ key: r.topic.split("/").slice(2).join("/"), title: r.title, status: r.status }))
    .filter((r) => count === null || (/^\d+$/.test(r.key) && Number(r.key) < count))
    // A harness's own item ids (`2`, `10`) and zero-padded places both read in order.
    .sort((a, b) => byNumber(a.key, b.key));
  const listIncomplete =
    marker?.status === "incomplete" || (marker?.status === "writing" && input.ended) ? { reason: marker.reason } : null;
  if (marker?.status === "complete" && count === 0) return { kind: "empty", scope, turn: unlabelled };
  if (marker === null && rows.length === 0) return { kind: "none", scope, turn: unlabelled };
  if (conversation === null) return { kind: "rows", scope, turn: input.turn, rows, incomplete: listIncomplete };
  const changedIn = inRun
    .map((r) => (typeof r.requestId === "string" ? conversation.turns.get(r.requestId) : undefined))
    .filter((n): n is number => n !== undefined);
  const turn = changedIn.length === 0 ? null : Math.max(...changedIn);
  const incomplete = listIncomplete ?? (conversation.predates ? { reason: PREDATES_REASON } : null);
  return { kind: "rows", scope, turn, rows, incomplete };
}

/** Where the panel reads the latest turn's plan from. */
export type PlanSource =
  /** A conversation's plan, by its namespace. */
  | { readonly kind: "conversation"; readonly namespace: string }
  /** The rows stored under the turn itself; when it has none, the conversation `whenEmpty` names, if any. */
  | { readonly kind: "turn"; readonly whenEmpty: string | null };

/**
 * Where the panel reads the latest turn's plan from. The turn's pointer wins.
 * Without one, a running turn reads the bound conversation's plan (its
 * pointer is not written yet). An ended turn reads its own per-turn rows (a
 * session from before plans were kept by conversation), and when it has none
 * (a turn stopped or failed before the harness named its conversation), the
 * bound conversation's plan, which that turn left as it was.
 *
 * @param pointer The conversation namespace the turn's run points at, or `null`.
 * @param ended Whether the turn's request has ended.
 * @param bound The bound conversation's namespace, or `null`.
 */
export function planSource(pointer: string | null, ended: boolean, bound: string | null): PlanSource {
  if (pointer !== null) return { kind: "conversation", namespace: pointer };
  if (!ended && bound !== null) return { kind: "conversation", namespace: bound };
  return { kind: "turn", whenEmpty: bound };
}

/**
 * Each turn's number, from 1, by its request id: the requests the items
 * belong to, in the order they started, as `latestTurn` numbers them.
 */
export function turnNumbers(items: readonly TurnItem[]): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  for (const item of items) if (!numbers.has(item.requestId)) numbers.set(item.requestId, numbers.size + 1);
  return numbers;
}

/**
 * The request of the earliest recorded turn in a conversation, by its turn
 * records: the turn that asked for it or confirmed it, earliest `at` first.
 * `null` when no record names it.
 *
 * @param turns The session's turn records, by request id.
 * @param matches Whether a conversation id is the one asked about.
 */
export function earliestTurnOf(
  turns: Readonly<Record<string, HarnessTurnRecord>> | null | undefined,
  matches: (conversationId: string) => boolean,
): string | null {
  let earliest: { requestId: string; at: number } | null = null;
  for (const [requestId, record] of Object.entries(turns ?? {})) {
    const named = [record.asked, record.confirmed].some((id) => id !== null && matches(id));
    if (!named) continue;
    const at = record.at ?? Number.POSITIVE_INFINITY;
    if (earliest === null || at < earliest.at) earliest = { requestId, at };
  }
  return earliest?.requestId ?? null;
}
