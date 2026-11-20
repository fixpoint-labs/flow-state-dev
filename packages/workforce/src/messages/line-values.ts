// FIX-2848 D1.
/**
 * What workforce's conversation lines carry: the `value` of each `data` item
 * the server writes for an app to draw (`workforce:received`, `:sent`,
 * `:task`, `:result`), and the key that ties a line to the tool call that
 * wrote it.
 *
 * A line written inside a tool call is keyed by that call's logical id
 * (`${requestId}:${path}`), so React's `conversationLines` reads the call as
 * this line and not as a step, and a second write in the same call (a waited
 * send's answer) replaces the first. The browser entry exports the types.
 */
import { logicalBlockIdOf } from "@flow-state-dev/core/internal";

/** A message another worker sent this one (`workforce:received`). */
export type ReceivedMessageValue = {
  /** The message's id: what an answer names as `inReplyTo`. */
  id: string;
  /** The worker that sent it. */
  from: string;
  text: string;
  /** The message this one answers, when it is an answer. */
  inReplyTo?: string;
  /** How many more messages the exchange may send. */
  budget: number;
  /** The sender asked for a reply. */
  replyRequested?: true;
  /** The framework's "no answer": the worker asked gave none. */
  noAnswer?: true;
};

/** Who a sent message went to: a worker's id, the session that works a task, or one of the user's conversations. */
export type SentMessageTarget = string | { task: string } | { session: string };

/** How a waited send stands (`wait: true`): `waiting` until the answer or the deadline, then the call's result; `error` says why a `failed` one got no answer. */
export type SentMessageWait = { status: "waiting" | "answered" | "running" | "failed"; reply?: string; noAnswer?: true; error?: string; recipient?: "waiting_on_person" };

/** A message this worker sent (`workforce:sent`). One per call: a refused send is a line too, saying why. */
export type SentMessageValue = {
  to: SentMessageTarget;
  text: string;
  /** The message's id, once it was sent. */
  messageId?: string;
  /** The message it answers. */
  inReplyTo?: string;
  /** It asked for a reply, which comes later as a message. */
  replyRequested?: true;
  /** It waits for the answer in this turn. The line is written again when it ends, under the same key. */
  wait?: SentMessageWait;
  /** Why nothing was sent: the send's own error. */
  refused?: string;
};

/** A task this conversation filed (`workforce:task`). */
export type FiledTaskValue = {
  taskId: string;
  /** The task's title, else its goal. */
  title: string;
  /** The worker it is for, when the filing named one. */
  assignee?: string;
};

/** A task this conversation filed ended (`workforce:result`), under the worker that ran it. */
export type TaskResultValue = {
  taskId: string;
  /** The worker that ran it. */
  from?: string;
  title: string;
  /** What the board said of the ending, as its message beside this line says it. */
  text: string;
  ending: "completed" | "errored" | "cancelled";
};

/**
 * The key a line written in `ctx` carries: the logical id of the tool call
 * that runs it, which ties the line to that call. `undefined` outside a tool
 * call (a board pass, an entry): the line stands alone.
 */
export function callLineKey(ctx: unknown): string | undefined {
  const logical = logicalBlockIdOf(ctx as Parameters<typeof logicalBlockIdOf>[0]);
  if (logical === undefined) return undefined;
  // `${requestId}:${path}`: the path's last segment names the block that runs, a tool call's `tool[name][callId]`.
  const last = logical.slice(logical.indexOf(":") + 1).split("/").at(-1) ?? "";
  return last.startsWith("tool[") ? logical : undefined;
}
