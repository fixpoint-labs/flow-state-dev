/**
 * The mark `messageReceivedEntry` puts on the entry it builds, and its
 * readers. A leaf: the send, the target check and the conversation board read
 * a flow's mark here without importing the entry, whose own imports reach the
 * board (the board's delivery reads the mark for a task's midway question,
 * FIX-2241).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { RowQuestion, Task } from "@flow-state-dev/orchestration/tasks";
import { MESSAGE_RECEIVED_ENTRY } from "./keys";

/**
 * Where a worker hears messages. `"task-sessions"`: only in its tasks'
 * sessions, so a message to it by name is refused before anything is written
 * (`task_sessions_only`). Absent: wherever a message lands.
 */
export type MessageHearing = "task-sessions";

/** Tell a task's filer its open midway questions, from the asking request (FIX-2241). */
export type MidwayQuestionTeller = (ctx: BlockContext, row: Task, questions: readonly RowQuestion[]) => Promise<void>;

/**
 * The mark `messageReceivedEntry` puts on what it builds.
 * Enumerable, so it survives the spreads a flow is built with; a registered
 * symbol, so two installed copies of this package read each other's mark.
 */
export const RECEIVED_MARK = Symbol.for("@flow-state-dev/workforce/message-received");

/** What the mark carries. */
export interface ReceivedMark {
  readonly hears?: MessageHearing;
  /** Whether the entry runs a turn on a message, so a call to it gets a reply. Absent on a mark built before it said (read as unknown). */
  readonly runsTurn?: boolean;
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
 * Whether `flow`'s `onMessageReceived` runs a turn on a message: `false` for
 * an entry built with no turn, so nothing ever answers a call to it;
 * `undefined` when the flow says nothing (no entry `messageReceivedEntry`
 * built, or a mark from before it said).
 */
export function runsMessageTurn(flow: unknown): boolean | undefined {
  return receivedMarkOf(flow)?.runsTurn;
}

/**
 * Why a call to `to`, or a message asking it for a reply (FIX-2310), can't be
 * answered (FIX-2300): its flow runs nothing on a message. `asked` names what
 * to leave out. The send refuses with it before anything is written where it can
 * tell; the call answers it failed where it learns only once it lands.
 */
export function noReplyError(to: string, asked: "wait" | "replyRequested" = "wait"): string {
  return `no_reply: "${to}" takes messages but runs nothing on them, so no reply comes back. Send without ${asked}, or file it a task.`;
}

/**
 * How the running flow's worker tells a task's filer its midway question
 * (FIX-2241), or `undefined` for a flow with no entry `messageReceivedEntry`
 * built: such a worker can't send, and the question is in the Inbox only.
 */
export function midwayQuestionTellerOf(flow: unknown): MidwayQuestionTeller | undefined {
  return receivedMarkOf(flow)?.tellMidwayQuestion;
}
