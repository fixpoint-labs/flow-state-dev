/**
 * Send one worker message (FIX-1989). `messageWorker` calls this, and so
 * will a coding run's tool (FIX-1990). The sender, the sessions and the hop
 * come from the running turn, never the tool input. A dispatch that throws
 * is sent once more; the entry acts on a message id once. A second throw
 * leaves the row `unconfirmed`.
 */
import { dispatchThroughSeam, type BlockContext, type DispatchOutcome } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { COORDINATOR_FLOW } from "../coordinator/coordinator-keys";
import { filingProjectAddressOf } from "../conversation-board/filing-session";
import { deriveWorkerSessionId, criteriaState, type WorkerSessionCriteria } from "../workers/derive-session-id";
import type { WorkerInstallation } from "../workers/installation";
import {
  FILING_SESSION_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKER_ID_STATE_KEY,
  WORKERS_RESOURCE
} from "../workers/keys";
import { parseWorkerRow } from "../workers/worker-row";
import { TURN_SENT_STATE, turnHopOf } from "./hop";
import { WORKER_MESSAGE_ENTRY } from "./keys";
import { messageLimitsOf } from "./message-limits";
import {
  MAX_MESSAGE_CHARS,
  messageLogOf,
  newMessageId,
  type MessageAddress,
  type WorkerMessageRow
} from "./message-log";

/** What a send asks for: the tool's input. */
export interface SendWorkerMessage {
  readonly to: string;
  readonly text: string;
  readonly replyTo?: string;
}

/** What a send came to. */
export type SendOutcome =
  | { readonly ok: true; readonly id: string; readonly unconfirmed?: string }
  | { readonly ok: false; readonly error: string };

/** Whether a worker flow takes messages: it declares the `onWorkerMessage` internal entry. */
export function takesWorkerMessages(flow: unknown): boolean {
  const actions = (flow as { internal?: { actions?: Record<string, unknown> } } | undefined)?.internal?.actions;
  return actions !== undefined && Object.hasOwn(actions, WORKER_MESSAGE_ENTRY);
}

/** A coordinator worker's routing, as its row or file declares it: `judgment` when it names none. */
async function routingOf(ctx: BlockContext, installation: WorkerInstallation, workerId: string, standard: boolean): Promise<string> {
  let declared: unknown;
  if (standard) {
    declared = installation.standardWorker(workerId)?.declared.routing;
  } else {
    const collection = (ctx.resources as Record<string, { getOptional(key: string): Promise<{ state: unknown } | undefined> }>)[WORKERS_RESOURCE];
    const parsed = parseWorkerRow((await collection?.getOptional(workerId))?.state);
    declared = "row" in parsed ? parsed.row.settings.routing : undefined;
  }
  return typeof declared === "string" ? declared : "judgment";
}

/** The routings under which a coordinator runs no turn of its own. */
const TURNLESS_ROUTINGS = new Set(["round-robin", "everyone"]);

/**
 * A worker's own conversation with the running session's user: its derived
 * address on its flow, and the state it is opened with. The installation's
 * project coordinator keeps one per project, so it is reached in the one for
 * `project` when the sender works in one.
 */
async function conversationAddress(
  ctx: BlockContext,
  installation: WorkerInstallation,
  worker: string,
  flow: string,
  state: unknown
): Promise<MessageAddress> {
  const identity = ctx.session.identity as { userId?: string; orgId?: string };
  if (identity.userId === undefined || identity.orgId === undefined) {
    throw new Error("A worker message needs a session that names its user and organization.");
  }
  const project = installation.projectCoordinator()?.worker === worker ? filingProjectAddressOf(state) : undefined;
  const criteria: WorkerSessionCriteria = { worker, ...(project === undefined ? {} : { projectId: project }) };
  return {
    sessionId: await deriveWorkerSessionId({ userId: identity.userId, orgId: identity.orgId, flow, criteria }),
    flow,
    state: criteriaState(criteria)
  };
}

/**
 * Send one message from the running session's worker.
 *
 * @param flowKind The flow the running session runs on.
 * @param from The sending block's name, for the dispatch's provenance.
 */
export async function sendWorkerMessage(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  input: SendWorkerMessage,
  from: string
): Promise<SendOutcome> {
  const refuse = (error: string): SendOutcome => ({ ok: false, error });
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  const sender = state[WORKER_ID_STATE_KEY];
  if (typeof sender !== "string" || sender.length === 0) return refuse("not_a_worker: this session runs no worker, so it can't send a message.");
  if (input.text.trim().length === 0) return refuse("empty_message: say something.");
  if (input.text.length > MAX_MESSAGE_CHARS) {
    return refuse(`message_too_long: a message holds at most ${MAX_MESSAGE_CHARS} characters; this one has ${input.text.length}. Nothing was sent.`);
  }
  if (input.to === sender) return refuse("not_yourself: you can't message yourself.");

  const recipient = await installation.rosterWorker(ctx as never, input.to);
  if (recipient === undefined) return refuse(`no_worker: no worker "${input.to}" on your roster.`);
  if (recipient.problem !== undefined) return refuse(`worker_unavailable: worker "${input.to}" can't be messaged: ${recipient.problem}.`);
  const recipientFlow = installation.workerFlows()[recipient.flow]?.flow;
  if (!takesWorkerMessages(recipientFlow)) {
    return refuse(`takes_tasks_only: "${input.to}" only takes tasks and can't be messaged. File a task for it instead.`);
  }
  if (recipient.flow === COORDINATOR_FLOW && TURNLESS_ROUTINGS.has(await routingOf(ctx, installation, input.to, recipient.standard))) {
    return refuse(
      `no_turn: "${input.to}" hands every line to its delegates and runs no turn of its own, so nobody would read a message. ` +
        "Message one of its delegates, or file a task."
    );
  }

  const log = messageLogOf(ctx);
  let destination: MessageAddress;
  let thread: string | undefined;
  if (input.replyTo !== undefined) {
    const answered = (await log.getOptional(input.replyTo))?.state;
    if (answered === undefined || answered.to !== sender || answered.from !== input.to) {
      return refuse(`no_such_message: replyTo "${input.replyTo}" names no message "${input.to}" sent you. Leave replyTo out to start a new one.`);
    }
    destination = answered.answerTo;
    thread = answered.thread;
  } else {
    destination = await conversationAddress(ctx, installation, input.to, recipient.flow, state);
  }

  const limits = messageLimitsOf(installation);
  const hop = turnHopOf(ctx) + 1;
  if (hop > limits.hopLimit) {
    return refuse(
      `hop_limit: this would be message ${hop} in a chain of worker messages with no person in between, and the limit is ${limits.hopLimit}. ` +
        "Nothing was sent. Stop passing messages on, and say that you stopped; the next line from a person lets the workers go on."
    );
  }
  const reserved = await withOutcome(
    (mutator: (s: Readonly<Record<string, unknown>>) => Record<string, unknown>) => ctx.request.atomicState(mutator as never),
    (current: Readonly<Record<string, unknown>>) => {
      const sent = typeof current[TURN_SENT_STATE] === "number" ? (current[TURN_SENT_STATE] as number) : 0;
      if (sent >= limits.perTurn) return { state: {}, result: false };
      return { state: { [TURN_SENT_STATE]: sent + 1 }, result: true };
    }
  );
  if (reserved !== true) {
    return refuse(`per_turn_limit: one turn sends at most ${limits.perTurn} messages, and this one has. Nothing was sent.`);
  }

  const id = newMessageId();
  const sessionId = ctx.session.identity.id;
  // A task's session ends with its turn, and nothing runs there again, so an
  // answer to a message sent from one goes to the sender's own conversation.
  // So does one from a delegate session a conversation opened for a post.
  const fromTaskOrPost = typeof state[TASK_ID_STATE_KEY] === "string" || typeof state[FILING_SESSION_STATE_KEY] === "string";
  const answerTo: MessageAddress = fromTaskOrPost
    ? await conversationAddress(ctx, installation, sender, flowKind, state)
    : { sessionId, flow: flowKind };
  const row: WorkerMessageRow = {
    id,
    from: sender,
    to: input.to,
    text: input.text,
    thread: thread ?? id,
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    fromSession: sessionId,
    fromFlow: flowKind,
    toSession: destination.sessionId,
    toFlow: destination.flow,
    answerTo,
    hop,
    status: "unconfirmed",
    at: Date.now()
  };
  const ref = await log.getOrCreate(id, row);

  const dispatch = () =>
    dispatchThroughSeam(ctx, {
      type: "internal",
      action: WORKER_MESSAGE_ENTRY,
      flowKind: destination.flow,
      session: destination.state === undefined ? { id: destination.sessionId } : { id: destination.sessionId, state: destination.state },
      payload: { messageId: id },
      from
    });
  let outcome: DispatchOutcome | undefined;
  let thrown: unknown;
  for (let attempt = 0; attempt < 2 && outcome === undefined; attempt += 1) {
    try {
      outcome = await dispatch();
    } catch (error) {
      thrown = error;
    }
  }
  if (outcome === undefined) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);
    await ref.patchState({ reason });
    return { ok: true, id, unconfirmed: `the delivery couldn't be confirmed (${reason}); it may still arrive.` };
  }
  if (!outcome.ok) {
    await ref.patchState({ status: "refused", reason: `${outcome.refused}: ${outcome.detail}` });
    return refuse(`not_delivered: the message to "${input.to}" was refused (${outcome.refused}: ${outcome.detail}).`);
  }
  await ref.patchState({ status: "delivered", toSession: outcome.sessionId });
  return { ok: true, id };
}
