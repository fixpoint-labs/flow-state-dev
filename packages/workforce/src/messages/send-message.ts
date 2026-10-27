/**
 * Sending a worker message (FIX-1989, FIX-2238): the one check every send
 * passes, the log row, and the delivery. The `sendMessage` tool calls it.
 *
 * The check, in order, before anything is written:
 *
 * - the session runs a worker, and the text fits;
 * - a target by task or session (FIX-2160, `./message-target`) resolves to a
 *   session of the user's, checked on its own record: refused by name when it
 *   doesn't, and otherwise delivered there;
 * - the recipient is another worker on the user's roster now (one of theirs or
 *   a standard one: another user's worker is simply not there), whose row
 *   reads;
 * - the recipient hears messages by name: a worker whose `onMessageReceived`
 *   hears only in its tasks' sessions (the coder) is refused here,
 *   `task_sessions_only`;
 * - an answer (`inReplyTo`) names a message the recipient sent this worker;
 * - the budget: one per message a user types (`hop.ts`), at most `perTurn`
 *   per request.
 *
 * The send is paid with its row: its place in the chain is taken in one
 * guarded write that takes it only while the budget has one, and a send
 * refused before that leaves nothing spent.
 *
 * Then one row is written to the user's message log, and the message is
 * dispatched to the recipient's `onMessageReceived` where it lands: an answer
 * in the session that sent the original, even after its task ended; a message
 * from a task's session (or a delegate's) to the worker that filed it, in the
 * session that filed it; any other in the recipient's own conversation (the
 * worker's derived address, opened by the dispatch when absent; the project
 * coordinator's for the sender's project). A dispatch the host refuses marks
 * the row refused. A thrown one may have started, so it is sent again once
 * (the entry acts on a message id once); if that throws too, the row stays
 * unconfirmed.
 *
 * The sender, the sessions and the budget come from the sending turn's own
 * session and request state, never from the tool's input.
 */
import { dispatchThroughSeam, type BlockContext, type DispatchOutcome } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { filingProjectAddressOf, sessionIdOfFiling } from "../conversation-board/filing-session";
import { deriveWorkerSessionId, criteriaState, type WorkerSessionCriteria } from "../workers/derive-session-id";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import { FILING_FLOW_STATE_KEY, FILING_SESSION_STATE_KEY, FILING_WORKER_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { newChainId, TURN_CHAIN_STATE, TURN_MESSAGED_STATE, TURN_SENT_STATE, turnChainOf, turnHopOf } from "./hop";
import { MESSAGE_RECEIVED_ENTRY } from "./keys";
import { messageLimitsOf } from "./message-limits";
import { messageHearingOf } from "./message-received-entry";
import { checkTargetSession, checkTaskTarget, type MessageTarget } from "./message-target";
import {
  MAX_MESSAGE_CHARS,
  messageChainsOf,
  messageLogOf,
  newMessageId,
  type MessageAddress,
  type WorkerMessageRow
} from "./message-log";

/** What a send asks for: the tool's input. */
export interface SendMessageInput {
  /** A worker's id, a task (`{ task }`), or one of the user's conversations (`{ session }`). */
  readonly to: MessageTarget;
  readonly text: string;
  readonly inReplyTo?: string;
}

/** What a send came to. */
export type SendOutcome =
  | { readonly ok: true; readonly id: string; readonly unconfirmed?: string }
  | { readonly ok: false; readonly error: string };

/**
 * Why `sender` can't message `recipient` by name (the roster's row for `to`,
 * or `undefined` when there is none), or `undefined` when it can. The one
 * rule: the send refuses with it, and the tool's description lists only the
 * workers it lets through.
 */
export function recipientRefusal(
  installation: WorkerInstallation,
  sender: string,
  to: string,
  recipient: RosterWorker | undefined
): string | undefined {
  if (to === sender) return "not_yourself: you can't message yourself.";
  if (recipient === undefined) return `no_worker: no worker "${to}" on your roster.`;
  if (recipient.problem !== undefined) return `worker_unavailable: worker "${to}" can't be messaged: ${recipient.problem}.`;
  if (messageHearingOf(installation.workerFlows()[recipient.flow]?.flow) === "task-sessions") {
    return (
      `task_sessions_only: "${to}" answers only from its tasks' sessions, so it can't be messaged by name. ` +
      "File it a task instead."
    );
  }
  return undefined;
}

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
 * The session that filed the running session's work, when `worker` is the
 * worker that filed it: a task's session, or a delegate's, was born naming
 * both (server-written). `undefined` for anything else.
 */
function filingSessionFor(state: Record<string, unknown>, worker: string): MessageAddress | undefined {
  const filing = state[FILING_SESSION_STATE_KEY];
  const flow = state[FILING_FLOW_STATE_KEY];
  if (state[FILING_WORKER_STATE_KEY] !== worker || typeof filing !== "string" || typeof flow !== "string") return undefined;
  return { sessionId: sessionIdOfFiling(filing), flow };
}

/**
 * Send one message from the running session's worker.
 *
 * @param flowKind The flow the running session runs on.
 * @param from The sending block's name, for the dispatch's provenance.
 */
export async function sendMessage(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  input: SendMessageInput,
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

  // ---- the recipient, and where it lands -----------------------------------
  const log = messageLogOf(ctx);
  const to = input.to;
  let recipient: RosterWorker;
  let destination: MessageAddress;
  let exchange: string | undefined;
  if (typeof to !== "string") {
    // A task's session or a conversation, checked on its record (FIX-2160).
    if (input.inReplyTo !== undefined) {
      return refuse("no_such_message: an answer goes to the worker that sent the message, by its id. Leave inReplyTo out, or send to that worker.");
    }
    const checked = "task" in to ? await checkTaskTarget(ctx, installation, to.task) : await checkTargetSession(ctx, installation, to.session, { session: true });
    if (!checked.ok) return refuse(checked.error);
    recipient = checked.target.worker;
    destination = { sessionId: checked.target.sessionId, flow: recipient.flow };
  } else {
    // ---- by name: on the roster, and hearing by name ------------------------
    const named = await installation.rosterWorker(ctx as never, to);
    const refused = recipientRefusal(installation, sender, to, named);
    if (refused !== undefined || named === undefined) return refuse(refused ?? `no_worker: no worker "${to}" on your roster.`);
    recipient = named;
    if (input.inReplyTo !== undefined) {
      const answered = (await log.getOptional(input.inReplyTo))?.state;
      if (answered === undefined || answered.to !== sender || answered.from !== to) {
        return refuse(`no_such_message: inReplyTo "${input.inReplyTo}" names no message "${to}" sent you. Leave inReplyTo out to start a new one.`);
      }
      // In the session that sent the original, even after its task ended.
      destination = { sessionId: answered.fromSession, flow: answered.fromFlow };
      exchange = answered.exchange;
    } else {
      destination = filingSessionFor(state, to) ?? (await conversationAddress(ctx, installation, to, recipient.flow, state));
    }
  }

  // ---- the budget ----------------------------------------------------------
  // One per message a user types: a send's place is its place in its chain's
  // row, and never less than one past its own turn's. A request with no chain
  // behind it (no user's turn, no session's) starts one here, for all its
  // sends. The per-request count is taken first and given back if the chain
  // has no place left, so a refused send spends nothing.
  const limits = messageLimitsOf(installation);
  const chains = messageChainsOf(ctx);
  const floor = turnHopOf(ctx) + 1;
  const budgetRefusal = (hop: number): SendOutcome =>
    refuse(
      `budget: this would be message ${hop} since the user's last line, and the budget is ${limits.hopLimit}. ` +
        "Nothing was sent. Stop passing messages on, and say that you stopped; the next line from the user lets the workers go on."
    );
  const known = turnChainOf(ctx);
  const counted = known === undefined ? 0 : ((await chains.getOptional(known))?.state.sent.length ?? 0);
  if (Math.max(floor, counted + 1) > limits.hopLimit) return budgetRefusal(Math.max(floor, counted + 1));
  const atomicRequest = (mutator: (s: Readonly<Record<string, unknown>>) => Record<string, unknown>) => ctx.request.atomicState(mutator as never);
  const reserved = await withOutcome(atomicRequest, (current: Readonly<Record<string, unknown>>) => {
    const sent = typeof current[TURN_SENT_STATE] === "number" ? (current[TURN_SENT_STATE] as number) : 0;
    if (sent >= limits.perTurn) return { state: {}, result: undefined };
    const turnChain = typeof current[TURN_CHAIN_STATE] === "string" ? (current[TURN_CHAIN_STATE] as string) : (known ?? newChainId());
    return { state: { [TURN_SENT_STATE]: sent + 1, [TURN_CHAIN_STATE]: turnChain }, result: turnChain };
  });
  if (typeof reserved !== "string") {
    return refuse(`per_request_limit: one request sends at most ${limits.perTurn} messages, and this one has. Nothing was sent.`);
  }
  const chain = reserved;
  const id = newMessageId();
  const chainRow = await chains.getOrCreate(chain, { sent: [] });
  await chainRow.updateState((row) =>
    Math.max(floor, row.sent.length + 1) > limits.hopLimit ? row : { ...row, sent: [...row.sent, id] }
  );
  const place = chainRow.state.sent.indexOf(id);
  if (place < 0) {
    await atomicRequest((current) => {
      const sent = typeof current[TURN_SENT_STATE] === "number" ? (current[TURN_SENT_STATE] as number) : 1;
      return { [TURN_SENT_STATE]: Math.max(0, sent - 1) };
    });
    return budgetRefusal(Math.max(floor, chainRow.state.sent.length + 1));
  }
  const hop = Math.max(floor, place + 1);
  await atomicRequest((current) => {
    const messaged = Array.isArray(current[TURN_MESSAGED_STATE]) ? (current[TURN_MESSAGED_STATE] as string[]) : [];
    return { [TURN_MESSAGED_STATE]: [...messaged, recipient.id] };
  });

  // ---- the row, then the delivery ------------------------------------------
  const row: WorkerMessageRow = {
    id,
    from: sender,
    to: recipient.id,
    ...(typeof to === "string" ? {} : "task" in to ? { addressedBy: "task" as const, toTask: to.task } : { addressedBy: "session" as const }),
    text: input.text,
    exchange: exchange ?? id,
    ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
    fromSession: ctx.session.identity.id,
    fromFlow: flowKind,
    toSession: destination.sessionId,
    toFlow: destination.flow,
    hop,
    chain,
    status: "unconfirmed",
    at: Date.now()
  };
  const ref = await log.getOrCreate(id, row);

  const dispatch = () =>
    dispatchThroughSeam(ctx, {
      type: "internal",
      action: MESSAGE_RECEIVED_ENTRY,
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
    return refuse(`not_delivered: the message to "${recipient.id}" was refused (${outcome.refused}: ${outcome.detail}).`);
  }
  await ref.patchState({ status: "delivered", toSession: outcome.sessionId });
  return { ok: true, id };
}
