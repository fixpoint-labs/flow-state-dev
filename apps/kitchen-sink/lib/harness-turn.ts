/**
 * A harness session's binding and its turns, and what the page reads off them:
 * the notice under a turn, and the plan panel's state.
 *
 * A leaf module (BP-019): the session flow (`lib/harness-session-flow.ts`)
 * declares the state with these schemas on the server, and the page derives
 * what it shows with the functions below in the browser. Nothing here is
 * harness-specific: a harness reports its failure through core's neutral
 * classification, and its label comes from the mode list as data.
 */
import type { RequestStatus } from "@flow-state-dev/core/types";
import { z } from "zod";

/** What one turn asked for and what came of it, recorded under its request id. */
export const turnRecordSchema = z.object({
  /** The conversation the turn asked to continue: the confirmed id when it started. `null` on a first turn. */
  asked: z.string().nullable().default(null),
  /** The conversation the harness confirmed during this turn, if it confirmed one. */
  confirmed: z.string().nullable().default(null),
  /** The harness's classification of the turn's failure (`harnessFailureKind`), if it failed. */
  failure: z.string().nullable().default(null),
  /** Whether the turn ended because it was stopped. */
  stopped: z.boolean().nullable().default(null),
  /** The turn's error, as the harness worded it. */
  error: z.string().nullable().default(null),
  /** When the turn started, in epoch millis. Orders turns for trimming. */
  at: z.number().nullable().default(null),
  /** Lines sent while the turn ran that the harness took into it (`steer`), oldest first. */
  steered: z.array(z.string()).nullable().default(null),
});

/** One turn's record. */
export type TurnRecord = z.infer<typeof turnRecordSchema>;

/**
 * A harness session's state. `model` is the person's pick, set when the
 * session is created and never after. The other two are written only by the
 * session flow's own resolvers, never by a caller (`serverOwned`).
 */
export const harnessSessionStateSchema = z.object({
  /**
   * The model every turn of this session runs, by the id the harness takes.
   * Set at create and fixed for the session's life (`.readonly()`: the
   * framework refuses any write that would change it). Absent only on a
   * session stored before models could be picked, which runs on the mode's
   * default.
   */
  model: z.string().min(1).optional().readonly(),
  /** The conversation this session is bound to. Written only by `onSession`. */
  binding: z
    .object({ confirmed: z.string().nullable().default(null) })
    .nullable()
    .default(null),
  /** Each recent turn's record, by request id. */
  turns: z.record(turnRecordSchema).nullable().default(null),
});

/** A harness session's state, as the page reads it from `clientData.session`. */
export type HarnessSessionState = z.infer<typeof harnessSessionStateSchema>;

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
export function turnNotice(turn: TurnRecord | null, status: TurnStatus, kept: string | null): TurnNotice | null {
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
}

/** A list marker, as the resource route lists it. */
export interface PlanMarkerItem {
  readonly topic: string;
  readonly status: string | null;
  readonly count: number | null;
  readonly reason: string | null;
}

/** What the plan panel shows. */
export type PlanPanelState =
  /** The harness declares no plan record at all. */
  | { readonly kind: "undeclared"; readonly label: string }
  /** The session has had no turn yet. */
  | { readonly kind: "no-turn" }
  /** The turn's record holds nothing: no marker and no rows. */
  | { readonly kind: "none"; readonly turn: number }
  /** The harness reported an empty list for the turn. */
  | { readonly kind: "empty"; readonly turn: number }
  /** The turn's rows; `incomplete` with its reason when they are not the whole plan. */
  | {
      readonly kind: "rows";
      readonly turn: number;
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
  /** That turn's plan rows, topics under the collection (`<request>/<run>/<item>`). */
  readonly rows: readonly PlanRowItem[];
  /** That turn's list markers, topics under the collection (`<request>/<run>`). */
  readonly markers: readonly PlanMarkerItem[];
}

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
 * turn with several runs (a retried block) shows its last. With a count in
 * the marker, only places below it show, so a row a lost count left behind
 * never does. A marker still `writing` after the turn ended reads as
 * incomplete, the same as `incomplete`.
 */
export function planPanelState(input: PlanPanelInput): PlanPanelState {
  if (!input.declared) return { kind: "undeclared", label: input.label };
  if (input.turn === null) return { kind: "no-turn" };
  const turn = input.turn;
  const runs = [...new Set([...input.rows.map((r) => runOf(r.topic)), ...input.markers.map((m) => runOf(m.topic))])].sort(byNumber);
  const run = runs.at(-1);
  if (run === undefined) return { kind: "none", turn };
  const marker = input.markers.find((m) => runOf(m.topic) === run) ?? null;
  const count = marker?.count ?? null;
  const rows = input.rows
    .filter((r) => runOf(r.topic) === run)
    .map((r) => ({ key: r.topic.split("/").slice(2).join("/"), title: r.title, status: r.status }))
    .filter((r) => count === null || (/^\d+$/.test(r.key) && Number(r.key) < count))
    // A harness's own item ids (`2`, `10`) and zero-padded places both read in order.
    .sort((a, b) => byNumber(a.key, b.key));
  const incomplete =
    marker?.status === "incomplete" || (marker?.status === "writing" && input.ended) ? { reason: marker.reason } : null;
  if (marker?.status === "complete" && count === 0) return { kind: "empty", turn };
  if (marker === null && rows.length === 0) return { kind: "none", turn };
  return { kind: "rows", turn, rows, incomplete };
}
