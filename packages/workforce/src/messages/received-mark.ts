/**
 * The mark `messageReceivedEntry` puts on the entry it builds, and its
 * readers. A leaf: the send, the target check and the conversation board read
 * a flow's mark here without importing the entry, whose own imports reach the
 * board (the board's delivery reads the mark for a task's midway question,
 * FIX-2241).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { RowHold, Task } from "@flow-state-dev/orchestration/tasks";
import { MESSAGE_RECEIVED_ENTRY } from "./keys";

/**
 * Where a worker hears messages. `"task-sessions"`: only in its tasks'
 * sessions, so a message to it by name is refused before anything is written
 * (`task_sessions_only`). Absent: wherever a message lands.
 */
export type MessageHearing = "task-sessions";

/** Tell a task's filer its open midway questions, from the asking request (FIX-2241). */
export type MidwayQuestionTeller = (ctx: BlockContext, row: Task, holds: readonly RowHold[]) => Promise<void>;

/**
 * The mark `messageReceivedEntry` puts on what it builds.
 * Enumerable, so it survives the spreads a flow is built with; a registered
 * symbol, so two installed copies of this package read each other's mark.
 */
export const RECEIVED_MARK = Symbol.for("@flow-state-dev/workforce/message-received");

/** What the mark carries. */
export interface ReceivedMark {
  readonly hears?: MessageHearing;
  /** How this flow's worker tells a task's filer its midway question, with the installation and flow it was built for. */
  readonly tellMidwayQuestion?: MidwayQuestionTeller;
}

/** The mark on `flow`'s `onMessageReceived`, or `undefined` for a flow with no entry `messageReceivedEntry` built. */
function receivedMarkOf(flow: unknown): ReceivedMark | undefined {
  const entry = (flow as { internal?: { actions?: Record<string, unknown> } } | undefined)?.internal?.actions?.[MESSAGE_RECEIVED_ENTRY];
  if (typeof entry !== "object" || entry === null) return undefined;
  return (entry as Record<symbol, ReceivedMark | undefined>)[RECEIVED_MARK];
}

/**
 * Where `flow`'s worker hears messages: the `hears` its `onMessageReceived`
 * declares, `"anywhere"` when it declares none, or `undefined` when the flow
 * has no entry `messageReceivedEntry` built. The one reader of `hears`: the
 * hire, the send and the tool's list all read it here.
 */
export function messageHearingOf(flow: unknown): MessageHearing | "anywhere" | undefined {
  const mark = receivedMarkOf(flow);
  if (mark === undefined) return undefined;
  return mark.hears ?? "anywhere";
}

/**
 * How the running flow's worker tells a task's filer its midway question
 * (FIX-2241), or `undefined` for a flow with no entry `messageReceivedEntry`
 * built: such a worker can't send, and the question is in the Inbox only.
 */
export function midwayQuestionTellerOf(flow: unknown): MidwayQuestionTeller | undefined {
  return receivedMarkOf(flow)?.tellMidwayQuestion;
}
