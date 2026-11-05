/**
 * The one read of a session's settled past turns (FIX-2173).
 *
 * A turn's history window (`createExecutionContext`) loads through it, so the
 * rule for which of a session's turns a model may read is written once: list
 * the newest past turns under the session's request scope, leave out the
 * running request, an interrupted turn that will run again (parked) or that a
 * retry re-ran, keep only the settled items of any other interrupted turn,
 * and order what is left oldest first.
 *
 * A turn waiting on a call is read as far as it got (FIX-2279). A call is a
 * wait gate bound to a request it started (`dispatcher({ wait: true })`, a
 * worker's `sendMessage` with `wait`), and a turn parked on one gives its
 * session back, so another turn can run there before it resumes. That turn
 * reads the waiting one's settled items, the line that started it and the
 * calls that finished, followed by a line saying it is still waiting, built
 * here from its own unfinished tool calls (or the gate's message). It is the
 * same whether the waiting request is `suspended` or `interrupted` with its
 * gate still pending. Any other turn still running, suspended or parked is
 * never read: a stop for the user (whose answer resumes the turn reading the
 * session as it left it), a wait on a task, or work still in progress.
 */
import { isSuspensionWait, type MessageItem, type ToolOutputItem } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import { isWaitGate, waitGateDataOf, type SuspensionRecord } from "@flow-state-dev/core/types";
import type { DurabilityProvider } from "../durability/types";
import { parkedInterruptedIds } from "../durability/stop-suspended";
import { PAST_TURN_STATUSES, retriedIds } from "../execution/past-turns";
import type { RequestRecord, RequestStore, WakeStore } from "../stores/types";
import { compareTurnsOldestFirst } from "./history";
import type { sessionRequestScope } from "./session-request-scope";

export type SettledTurnsInputs = {
  requests: Pick<RequestStore, "list">;
  /** The session's request scope, from `sessionRequestScope`. */
  scope: ReturnType<typeof sessionRequestScope>;
  /** How many of the most recently started past turns to read. */
  turns: number;
  /** The running request, when it is in this session: never read as a past turn. */
  runningRequestId?: string;
  /** The running request's metadata, when it is in this session: a retry names the turn it re-runs. */
  runningMetadata?: Record<string, unknown>;
  /**
   * The session's turns open now (running or suspended), read by a caller
   * that is not one of them: a retry still running names the turn it re-runs
   * as well.
   */
  openTurns?: readonly Pick<RequestRecord, "metadata">[];
  /** Where parked gates are read. Without one, nothing is treated as parked. */
  durability?: Pick<DurabilityProvider, "listSuspended" | "loadSuspension">;
  /** Where a park a turn owes is read (FIX-2269): a turn that owes one is parked. */
  wakes?: WakeStore;
  /**
   * Called when the parked gates could not be read. The read goes on with
   * nothing treated as parked: a view that may show a parked turn, never a
   * failed turn.
   */
  onGateReadError: (error: unknown) => void;
};

export type SettledTurns = {
  /**
   * The window: the `turns` most recently started past turns, oldest first,
   * before any is left out. A retried or parked turn still holds its place.
   */
  window: RequestRecord[];
  /** The first turn the window holds, when an earlier turn fell out of it. */
  start?: { requestId: string };
  /** The ids of turns a retry re-ran. */
  retried: Set<string>;
  /** The ids of interrupted turns in the window that will run again. */
  parked: Set<string>;
  /**
   * The ids of turns waiting on a call that `settled` holds as far as they
   * got: not settled, so a reader that marks turns settled marks these open.
   */
  waiting: Set<string>;
  /** The turns a model reads, oldest first. */
  settled: RequestRecord[];
};

/** Read a session's settled past turns. See the file header for the rule. */
export async function readSettledTurns(inputs: SettledTurnsInputs): Promise<SettledTurns> {
  const { turns, runningRequestId } = inputs;
  // The newest past turns (`PAST_TURN_STATUSES`). The status filter excludes
  // the running request and any in-flight siblings; an `interrupted` request
  // is a turn its host died in, and what it persisted (the message that
  // started it, the calls that ran) is part of the conversation.
  // `orderBy:"startedAtMs"` keeps the selection robust to out-of-order
  // metadata writes. One row past the window is read only to learn whether an
  // earlier turn fell out of it; it is dropped before anything reads the
  // window.
  const listed = await inputs.requests.list({
    ...inputs.scope,
    status: PAST_TURN_STATUSES,
    limit: turns + 1,
    orderBy: "startedAtMs",
    withItems: true
  });

  // The store's newest-first order breaks a start-time tie by id; trimming
  // before reversing keeps the turn at the edge the same as without the extra row.
  const window = listed.slice(0, turns).reverse();
  const start = listed.length > turns && window[0] !== undefined ? { requestId: window[0].id } : undefined;
  const retried = retriedIds([...window, ...(inputs.openTurns ?? [])], inputs.runningMetadata);
  let parked = new Set<string>();
  let calls = new Map<string, SuspensionRecord>();
  // The session's suspended turns no older than the window: those waiting on
  // a call are read as far as they got. Without a durability provider nothing
  // suspends, so there is nothing to list.
  const first = start !== undefined ? window[0] : undefined;
  const suspended =
    inputs.durability === undefined
      ? []
      : (await inputs.requests.list({ ...inputs.scope, status: ["suspended"], limit: turns, orderBy: "startedAtMs", withItems: true })).filter(
          (r) => r.id !== runningRequestId && (first === undefined || compareTurnsOldestFirst(r.startedAtMs, r.id, first.startedAtMs, first.id) >= 0)
        );
  try {
    parked = await parkedInterruptedIds(inputs.durability, window, inputs.wakes);
    calls = await callWaits(inputs.durability, [...suspended, ...window.filter((r) => parked.has(r.id) && !retried.has(r.id))]);
  } catch (error) {
    inputs.onGateReadError(error);
  }
  const waiting = new Set([...calls.keys()]);
  const settled = [...window, ...suspended.filter((r) => calls.has(r.id))]
    .filter((r) => r.id !== runningRequestId)
    .filter((r) => r.status !== "interrupted" || waiting.has(r.id) || (!retried.has(r.id) && !parked.has(r.id)))
    .map((r) => {
      if (r.status === "completed" || r.items === undefined) return r;
      const gate = calls.get(r.id);
      // A waiting turn's parked call is recorded as a failed tool call (`isSuspensionWait`):
      // it has not failed, so the waiting line names it instead.
      const items = r.items.filter((i) => i.status !== "in_progress" && (gate === undefined || !parkedCall(i)));
      return { ...r, items: gate === undefined ? items : [...items, waitingLine(r, r.items, gate)] };
    })
    .sort((a, b) => compareTurnsOldestFirst(a.startedAtMs, a.id, b.startedAtMs, b.id));

  return { window, ...(start !== undefined ? { start } : {}), retried, parked, waiting, settled };
}

/**
 * The pending call gates of `records`, by request id: a wait gate bound to a
 * request, never a stop for the user or a wait on a task. One pending-gate read
 * per session. Without a durability provider nothing can wait.
 */
async function callWaits(
  provider: Pick<DurabilityProvider, "listSuspended"> | undefined,
  records: readonly Pick<RequestRecord, "id" | "userId" | "sessionId">[]
): Promise<Map<string, SuspensionRecord>> {
  const calls = new Map<string, SuspensionRecord>();
  if (provider === undefined || records.length === 0) return calls;
  const ids = new Set(records.map((r) => r.id));
  const others = new Set<string>();
  const sessions = new Map<string, { userId: string; sessionId: string | undefined }>();
  for (const r of records) sessions.set(`${r.userId}\u0000${r.sessionId ?? ""}`, { userId: r.userId, sessionId: r.sessionId });
  for (const { userId, sessionId } of sessions.values()) {
    const pending = await provider.listSuspended({ userId, ...(sessionId !== undefined ? { sessionId } : {}), status: "pending" });
    for (const gate of pending) {
      if (!ids.has(gate.requestId)) continue;
      const binding = isWaitGate(gate) ? waitGateDataOf(gate)?.binding : undefined;
      if (binding !== undefined && "requestId" in binding) calls.set(gate.requestId, gate);
      else others.add(gate.requestId);
    }
  }
  // A request that also holds another gate (a stop for the user beside its call) stays out.
  for (const id of others) calls.delete(id);
  return calls;
}

/** A tool call a park left on the log: recorded failed, coded `SUSPENSION` (`isSuspensionWait`). */
function parkedCall(item: RuntimeItem): boolean {
  return item.type === "tool_output" && isSuspensionWait(item as ToolOutputItem);
}

/** How much of a waiting tool call's arguments the waiting line quotes. */
const WAITING_ARGUMENTS_CHARS = 300;

/**
 * The line that closes a turn read while it waits on a call: what it still
 * waits on, from its unfinished tool calls (the parked one among them), else
 * the gate's message. Built at
 * read time and never stored; hidden from clients.
 */
function waitingLine(record: RequestRecord, items: readonly RuntimeItem[], gate: SuspensionRecord): RuntimeItem {
  const open = items.filter((i): i is ToolOutputItem & RuntimeItem => i.type === "tool_output" && (i.status === "in_progress" || parkedCall(i)));
  const quote = (args: string) => (args.length > WAITING_ARGUMENTS_CHARS ? `${args.slice(0, WAITING_ARGUMENTS_CHARS)}…` : args);
  const on =
    open.length > 0
      ? open.map((i) => `${i.toolCall.alias ?? i.toolCall.name}(${quote(i.toolCall.arguments)})`).join(", ")
      : (gate.message ?? "a call");
  const last = items.reduce((max, i) => Math.max(max, i.ts), record.startedAtMs);
  const line: MessageItem = {
    id: `waiting:${record.id}`,
    type: "message",
    status: "completed",
    requestId: record.id,
    itemIndex: items.reduce((max, i) => Math.max(max, i.itemIndex), -1) + 1,
    provenance: { blockName: "history", blockInstanceId: "history", phase: "main" },
    ts: last + 1,
    itemVisibility: { client: false, history: true },
    role: "assistant",
    content: [{ type: "output_text", text: `(This turn has not finished: it is still waiting on ${on}. Its result is not known yet.)` }]
  } as MessageItem;
  return line as RuntimeItem;
}
