// FIX-1989, FIX-2238; FIX-2160; FIX-2318; FIX-2310; FIX-2300; FIX-2240.
/**
 * Sending a worker message: the one check every send
 * passes, the log row, and the delivery. The `sendMessage` tool calls it.
 *
 * The check, in order, before anything is written:
 *
 * - the session runs a worker, and the text fits;
 * - a target by task or session (`./message-target`) resolves to a
 *   session of the user's, checked on its own record: refused by name when it
 *   doesn't, and otherwise delivered there;
 * - the recipient is another worker on the user's roster now (one of theirs or
 *   a standard one: another user's worker is simply not there), whose row
 *   reads;
 * - the recipient hears messages by name: a worker whose `onMessageReceived`
 *   hears only in its tasks' sessions (the coder) is refused here,
 *   `task_sessions_only`;
 * - an answer (`inReplyTo`) names a message the recipient sent this worker,
 *   and asks for no reply while that message's sender still waits for it
 *   (`reply_to_waiting`);
 * - a message that asks for a reply, waited on or not, lands
 *   where a turn runs on it: one to a flow whose entry runs nothing is
 *   refused, `no_reply`;
 * - the budget: one per message a user types (`hop.ts`), at most `perTurn`
 *   per request.
 *
 * The send is paid with its row: its place in the chain is taken in one
 * guarded write that takes it only while the budget has one, and a send
 * refused before that leaves nothing spent.
 *
 * Then the message is owed (`delivery.ts`): the session's pass a
 * wake, and the id on the session's owed list. Then one row is written to the
 * user's message log, and the message is dispatched once to the recipient's
 * `onMessageReceived` where it lands: an answer
 * in the session that sent the original, even after its task ended; a message
 * from a task's session (or a delegate's) to the worker that filed it, in the
 * session that filed it; any other in the recipient's own conversation (the
 * worker's derived address, opened by the dispatch when absent; the project
 * coordinator's for the sender's project). A final refusal of that dispatch
 * marks the row refused, and the send says so. An answer whose sender still
 * waits for it goes out the same way; in the sender's session it
 * wakes that wait and is its tool result, not a message (`./wait-for-reply`).
 * Anything else (accepted,
 * thrown, refused for now) leaves the row `unconfirmed` until the recipient
 * takes it, and the sending session's board pass sends it again until then.
 * A session whose flow carries no pass sends on that one dispatch only.
 *
 * The sender, the sessions and the budget come from the sending turn's own
 * session and request state, never from the tool's input.
 */
import type { BlockContext, DispatchOutcome, ResourceRef } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { filingProjectAddressOf, sessionIdOfFiling } from "../conversation-board/filing-session";
import { deriveWorkerSessionId, criteriaState, type WorkerSessionCriteria } from "../workers/derive-session-id";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import { FILING_FLOW_STATE_KEY, FILING_SESSION_STATE_KEY, FILING_WORKER_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { newChainId, TURN_CHAIN_STATE, TURN_PAID_STATE, TURN_SENT_STATE, turnChainOf, turnHopOf } from "./hop";
import { carriesPass, dispatchMessage, dropOwed, endMessage, isFinalRefusal, oweMessage } from "./delivery";
import { messageLimitsOf } from "./message-limits";
import { messageHearingOf, noReplyError, runsMessageTurn } from "./received-mark";
import { checkTargetSession, checkTaskTarget, type MessageTarget } from "./message-target";
import {
  MAX_MESSAGE_CHARS,
  messageChainsOf,
  messageLogOf,
  newMessageId,
  type MessageAddress,
  type WorkerMessageResourceState
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
  /** `requestId`: the request the send's own dispatch became, when the host accepted it. */
  | { readonly ok: true; readonly id: string; readonly requestId?: string }
  | { readonly ok: false; readonly error: string };

/**
 * Why `sender` can't message `recipient` by name (the roster's row for `to`,
 * or `undefined` when there is none), or `undefined` when it can. The one
 * rule: the send refuses with it, and the tool's description lists only the
 * workers it lets through.
 *
 * @param answering The send answers one of `to`'s messages (`inReplyTo`), so
 *   it lands where that message came from, not by name.
 */
export function recipientRefusal(
  installation: WorkerInstallation,
  sender: string,
  to: string,
  recipient: RosterWorker | undefined,
  answering = false
): string | undefined {
  // An answer to yourself comes from another of your conversations, and goes back there.
  if (to === sender && !answering) return "not_yourself: you can't message yourself.";
  if (recipient === undefined) return `no_worker: no worker "${to}" on your roster.`;
  if (recipient.problem !== undefined) return `worker_unavailable: worker "${to}" can't be messaged: ${recipient.problem}.`;
  // An answer lands in the session its original came from, which is one of
  // the worker's tasks' sessions, so only a message by name is refused.
  if (!answering && messageHearingOf(installation.workerFlows()[recipient.flow]?.flow) === "task-sessions") {
    return (
      `task_sessions_only: "${to}" answers only from its tasks' sessions, so it can't be messaged by name. ` +
      "File it a task instead."
    );
  }
  return undefined;
}

// FIX-2240; FIX-2160.
/**
 * The recipient check a resend runs again: the send's, as it reads
 * now, so a worker fired since the send is refused. A message to a task or a
 * conversation re-runs that target's check on its record; one by
 * name, the roster's, and an answer (`inReplyTo`) keeps the send's answering
 * exception. Not the budget: the row paid it once.
 */
export async function recheckRecipient(
  ctx: BlockContext,
  installation: WorkerInstallation,
  row: Pick<WorkerMessageResourceState, "from" | "to" | "addressedBy" | "toTask" | "toSession" | "inReplyTo">
): Promise<string | undefined> {
  if (row.addressedBy === "task" || row.addressedBy === "session") {
    const checked =
      row.addressedBy === "task" && row.toTask !== undefined
        ? await checkTaskTarget(ctx, installation, row.toTask)
        : await checkTargetSession(ctx, installation, row.toSession, { session: true });
    if (!checked.ok) return checked.error;
    // The resend goes to the session on the row: a task now worked in another
    // session (reassigned) checked that one, not where this message would land.
    if (checked.target.sessionId !== row.toSession) {
      return `task_moved: task "${row.toTask}" is worked in another session now, so this message can't reach it. Send it again if it still matters.`;
    }
    return undefined;
  }
  const recipient = await installation.rosterWorker(ctx, row.to);
  return recipientRefusal(installation, row.from, row.to, recipient, row.inReplyTo !== undefined);
}

/**
 * A worker's own conversation with the running session's user: its derived
 * address on its flow, and the state it is opened with. The installation's
 * project coordinator keeps one per project, so it is reached in the one for
 * `project` when the sender works in one.
 */
export async function conversationAddress(
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

/** A send's place: its id, its chain and its hop, or why the budget refused it. */
type Place = { readonly ok: true; readonly id: string; readonly chain: string; readonly hop: number } | { readonly ok: false; readonly error: string };

// FIX-2269.
/**
 * The place a send pays for. One per message a user types: a send's place is
 * its place in its chain's row, and never less than one past its own turn's. A
 * request with no chain behind it (no user's turn, no session's) starts one
 * here, for all its sends. The per-request count is taken first and given back
 * if the chain has no place left, so a refused send spends nothing. A `given`
 * id already paid for (a send repeated after a crash) pays nothing
 * again: neither count takes it twice.
 */
async function payPlace(ctx: BlockContext, installation: WorkerInstallation, given: string | undefined): Promise<Place> {
  const limits = messageLimitsOf(installation);
  const chains = messageChainsOf(ctx);
  const floor = turnHopOf(ctx) + 1;
  const budgetRefusal = (hop: number): Place => ({
    ok: false,
    error:
      `budget: this would be message ${hop} since the user's last line, and the budget is ${limits.budget}. ` +
      "Nothing was sent. Stop passing messages on, and say that you stopped; the next line from the user lets the workers go on."
  });
  /** The place a send takes in a chain that already holds `sent`. */
  const placeAfter = (sent: number) => Math.max(floor, sent + 1);
  const known = turnChainOf(ctx);
  const atomicRequest = (mutator: (s: Readonly<Record<string, unknown>>) => Record<string, unknown>) => ctx.request.atomicState(mutator as never);
  const paidOf = (current: Readonly<Record<string, unknown>>): string[] =>
    Array.isArray(current[TURN_PAID_STATE]) ? (current[TURN_PAID_STATE] as string[]) : [];
  const reserved = await withOutcome(atomicRequest, (current: Readonly<Record<string, unknown>>) => {
    const sent = typeof current[TURN_SENT_STATE] === "number" ? (current[TURN_SENT_STATE] as number) : 0;
    const turnChain = typeof current[TURN_CHAIN_STATE] === "string" ? (current[TURN_CHAIN_STATE] as string) : (known ?? newChainId());
    const paid = paidOf(current);
    if (given !== undefined && paid.includes(given)) return { state: {}, result: turnChain };
    if (sent >= limits.perTurn) return { state: {}, result: undefined };
    return {
      state: { [TURN_SENT_STATE]: sent + 1, [TURN_CHAIN_STATE]: turnChain, ...(given === undefined ? {} : { [TURN_PAID_STATE]: [...paid, given] }) },
      result: turnChain
    };
  });
  if (typeof reserved !== "string") {
    return { ok: false, error: `per_request_limit: one request sends at most ${limits.perTurn} messages, and this one has. Nothing was sent.` };
  }
  const chain = reserved;
  const id = given ?? newMessageId();
  const chainRow = await chains.getOrCreate(chain, { sent: [] });
  await chainRow.updateState((row) =>
    row.sent.includes(id) || placeAfter(row.sent.length) > limits.budget ? row : { ...row, sent: [...row.sent, id] }
  );
  const place = chainRow.state.sent.indexOf(id);
  if (place < 0) {
    await atomicRequest((current) => {
      const sent = typeof current[TURN_SENT_STATE] === "number" ? (current[TURN_SENT_STATE] as number) : 1;
      return { [TURN_SENT_STATE]: Math.max(0, sent - 1), [TURN_PAID_STATE]: paidOf(current).filter((paid) => paid !== id) };
    });
    return budgetRefusal(placeAfter(chainRow.state.sent.length));
  }
  const hop = placeAfter(place);
  return { ok: true, id, chain, hop };
}

// FIX-2241.
/**
 * The server's own message's place: one past the sending turn's, in
 * its chain or a new one, written into neither the chain's row nor the
 * request's count, so it costs no budget and no spent one refuses it. Every
 * exempt send in one request shares that hop, intentionally: none is a reply
 * to another, and the hop limit still bounds what each one draws.
 */
function exemptPlace(ctx: BlockContext, given: string | undefined): Place {
  return { ok: true, id: given ?? newMessageId(), chain: turnChainOf(ctx) ?? newChainId(), hop: turnHopOf(ctx) + 1 };
}

// FIX-2241; FIX-2310; FIX-2318.
/**
 * Send one message from the running session's worker.
 *
 * @param flowKind The flow the running session runs on.
 * @param from The sending block's name, for the dispatch's provenance.
 * @param options.id A server-chosen id, so a send repeated after a crash is
 *   one message: when its row is already written, the repeat owes nothing,
 *   pays nothing and answers as the row reads (a refusal stays one). From a
 *   flow with no pass, a repeat finding the row never taken dispatches it
 *   again, since nothing else would; a waited send's repeat does too, so its
 *   sender has the request to wait on. Never a model's input.
 * @param options.exempt The server's own message (a task's midway question, or the framework's answer to a reply-requested message): it costs no
 *   budget and no spent one refuses it. Never a model's input.
 * @param options.replyRequested The sender asks for a reply: the
 *   row says so, and the recipient's turn owes one answer. With `deadlineAt`
 *   the sender waits for it until then (`./wait-for-reply`), and
 *   the dispatch says the sender waits on it. Set by server code, never by a model.
 * @param options.noAnswer The framework's "no answer" to the message this one
 *   answers: the row says so, for an app to draw.
 */
export async function sendMessage(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  input: SendMessageInput,
  from: string,
  options: SendOptions = {}
): Promise<SendOutcome> {
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  const sender = state[WORKER_ID_STATE_KEY];
  if (typeof sender !== "string" || sender.length === 0) return refuse("not_a_worker: this session runs no worker, so it can't send a message.");
  const repeated = await checkTextAndRepeat(ctx, installation, flowKind, input.text, from, options.id);
  if (repeated !== undefined) return repeated;

  // ---- the recipient, and where it lands -----------------------------------
  const log = messageLogOf(ctx);
  const to = input.to;
  let recipientId: string;
  let destination: MessageAddress;
  let exchange: string | undefined;
  if (typeof to !== "string") {
    // A task's session or a conversation, checked on its record (FIX-2160).
    if (input.inReplyTo !== undefined) {
      return refuse("no_such_message: an answer goes to the worker that sent the message, by its id. Leave inReplyTo out, or send to that worker.");
    }
    const checked = "task" in to ? await checkTaskTarget(ctx, installation, to.task) : await checkTargetSession(ctx, installation, to.session, { session: true });
    if (!checked.ok) return refuse(checked.error);
    recipientId = checked.target.worker.id;
    destination = { sessionId: checked.target.sessionId, flow: checked.target.worker.flow };
  } else {
    // ---- by name: on the roster, and hearing by name ------------------------
    const named = await installation.rosterWorker(ctx, to);
    const refused = recipientRefusal(installation, sender, to, named, input.inReplyTo !== undefined);
    if (refused !== undefined || named === undefined) return refuse(refused ?? `no_worker: no worker "${to}" on your roster.`);
    recipientId = named.id;
    if (input.inReplyTo !== undefined) {
      const answered = (await log.getOptional(input.inReplyTo))?.state;
      if (answered === undefined || answered.to !== sender || answered.from !== to) {
        return refuse(`no_such_message: inReplyTo "${input.inReplyTo}" names no message "${to}" sent you. Leave inReplyTo out to start a new one.`);
      }
      if (answered.fromSession === ctx.session.identity.id) return refuse("not_yourself: that message came from this session.");
      // An answer its sender still waits for is that wait's result, never a message (FIX-2318),
      // so nothing would owe a reply to it: one that asks for a reply is refused.
      if (options.replyRequested !== undefined && answered.replyRequested === true && answered.deadlineAt !== undefined && answered.waitEndedAt === undefined && answered.answeredBy === undefined) {
        return refuse(
          `reply_to_waiting: "${to}" is waiting for this answer as its tool's result, so the answer can't ask for a reply. ` +
            "Nothing was sent. Answer without replyRequested or wait, then send a new message to ask."
        );
      }
      // In the session that sent the original, even after its task ended.
      destination = { sessionId: answered.fromSession, flow: answered.fromFlow };
      exchange = answered.exchange;
    } else {
      destination = filingSessionFor(state, to) ?? (await conversationAddress(ctx, installation, to, named.flow, state));
    }
  }

  // ---- a reply request needs a turn to answer it ---------------------------
  // The flow it lands on, which for an answer is the original sender's.
  if (options.replyRequested !== undefined && runsMessageTurn(installation.workerFlows()[destination.flow]?.flow) === false) {
    return refuse(`${noReplyError(recipientId)} Nothing was sent.`);
  }
  const addressed = typeof to === "string" ? {} : "task" in to ? { addressedBy: "task" as const, toTask: to.task } : { addressedBy: "session" as const };
  return sendTo(ctx, installation, flowKind, input, from, options, { sender, recipientId, destination, exchange, addressed });
}

// FIX-2534, epic D9.
/** A service's delivery: who it is from, the subscription's session it goes to, and the message. */
interface ServiceMessage {
  /** Where the sending worker would stand: `service:<provider>`. */
  readonly sender: string;
  /** A live subscription's session, the worker it runs, and its flow: the subscription entry is the recipient check. */
  readonly to: { readonly sessionId: string; readonly flow: string; readonly worker: string };
  readonly text: string;
  /** The server-chosen id, so a repeat lands once. */
  readonly id: string;
  /** An unheard event forwarded to an unmatched subscription: how it reached it, and its link. */
  readonly forward?: WorkerMessageResourceState["forward"];
}

/**
 * Send a service's delivery to a subscription's session: the server's own
 * message (no budget), from `service:<provider>`, to the session the
 * subscription entry names. That row is its recipient check, not the roster's
 * or `checkTargetSession`'s. Set by server code from a subscription entry,
 * never by a model.
 */
export async function sendServiceMessage(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  message: ServiceMessage,
  from: string
): Promise<SendOutcome> {
  const repeated = await checkTextAndRepeat(ctx, installation, flowKind, message.text, from, message.id);
  if (repeated !== undefined) return repeated;
  return sendTo(
    ctx,
    installation,
    flowKind,
    { text: message.text },
    from,
    { id: message.id, exempt: true },
    {
      sender: message.sender,
      recipientId: message.to.worker,
      destination: { sessionId: message.to.sessionId, flow: message.to.flow },
      addressed: { addressedBy: "session" as const },
      ...(message.forward === undefined ? {} : { forward: message.forward })
    }
  );
}

/** What a send is given beside its input. Server code only, never a model's input. */
interface SendOptions {
  readonly id?: string;
  readonly exempt?: true;
  readonly replyRequested?: { readonly deadlineAt?: number };
  readonly noAnswer?: true;
}

const refuse = (error: string): SendOutcome => ({ ok: false, error });

/**
 * What every send checks before its recipient: the text, then whether a send
 * under `id` was already written. Answers the send when it ends here, or
 * `undefined` to go on.
 */
async function checkTextAndRepeat(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  text: string,
  from: string,
  givenId: string | undefined
): Promise<SendOutcome | undefined> {
  if (text.trim().length === 0) return refuse("empty_message: say something.");
  if (text.length > MAX_MESSAGE_CHARS) {
    return refuse(`message_too_long: a message holds at most ${MAX_MESSAGE_CHARS} characters; this one has ${text.length}. Nothing was sent.`);
  }
  const writtenRef = givenId === undefined ? undefined : await messageLogOf(ctx).getOptional(givenId);
  const written = writtenRef?.state;
  if (writtenRef === undefined || written === undefined) return undefined;
  // The repeat answers what the first send did: an ended row stays a refusal.
  if (written.status === "refused" || written.status === "undeliverable") {
    return refuse(`not_delivered: the message to "${written.to}" was ${written.status} (${written.reason ?? "no reason was given"}).`);
  }
  // A flow with no pass sends on its own dispatch only, so a repeat finding
  // the row never taken (the first send ended between the write and the
  // dispatch) sends it again; the take keeps it once. A waited send's repeat
  // sends it again too, pass or not (FIX-2269): its sender waits on the
  // request that dispatch starts, and a resend from the pass leaves it none
  // to follow.
  const resends = carriesPass(installation, flowKind);
  if (written.status === "unconfirmed" && written.takenBy === undefined && (written.deadlineAt !== undefined || !resends)) {
    return markAnswer(ctx, written, await dispatchOnce(ctx, writtenRef, written, from, resends));
  }
  return markAnswer(ctx, written, { ok: true, id: written.id });
}

/** A send's checked recipient: who it is from and to, where it lands, and how the row says it was addressed. */
interface Resolved {
  readonly sender: string;
  readonly recipientId: string;
  readonly destination: MessageAddress;
  readonly exchange?: string;
  readonly addressed: Pick<WorkerMessageResourceState, "addressedBy" | "toTask">;
  /** A service's forward: the mark the message carries. */
  readonly forward?: WorkerMessageResourceState["forward"];
}

/** Every send's tail, once its recipient is checked: the budget, the owed id, the row, then one dispatch. */
async function sendTo(
  ctx: BlockContext,
  installation: WorkerInstallation,
  flowKind: string,
  input: Pick<SendMessageInput, "text" | "inReplyTo">,
  from: string,
  options: SendOptions,
  resolved: Resolved
): Promise<SendOutcome> {
  const { destination } = resolved;
  // ---- the budget ----------------------------------------------------------
  // The server's own message costs none (FIX-2241); every other send pays its place.
  const paid = options.exempt === true ? exemptPlace(ctx, options.id) : await payPlace(ctx, installation, options.id);
  if (!paid.ok) return paid;
  const { id, chain, hop } = paid;

  // ---- owed, the row, then one dispatch ------------------------------------
  const resends = carriesPass(installation, flowKind);
  if (resends) await oweMessage(ctx, id);
  const row: WorkerMessageResourceState = {
    id,
    from: resolved.sender,
    to: resolved.recipientId,
    ...resolved.addressed,
    ...(resolved.forward === undefined ? {} : { forward: resolved.forward }),
    text: input.text,
    exchange: resolved.exchange ?? id,
    ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
    fromSession: ctx.session.identity.id,
    fromFlow: flowKind,
    toSession: destination.sessionId,
    toFlow: destination.flow,
    ...(destination.state === undefined ? {} : { toState: destination.state }),
    hop,
    chain,
    ...(options.replyRequested === undefined ? {} : { replyRequested: true as const }),
    ...(options.replyRequested?.deadlineAt === undefined ? {} : { deadlineAt: options.replyRequested.deadlineAt }),
    ...(options.noAnswer === true ? { noAnswer: true as const } : {}),
    status: "unconfirmed",
    at: Date.now()
  };
  const ref = await messageLogOf(ctx).getOrCreate(id, row);
  // An answer claims the message it answers before it goes out, so a crash
  // after the dispatch can't leave room for a second answer; a refused one
  // gives the claim back. One its sender still waits for goes out the same way:
  // landing in the sender's session, it wakes that wait (`wakeHeldWait`, FIX-2318).
  await claimAnswer(ctx, row);
  const outcome = await dispatchOnce(ctx, ref, row, from, resends);
  if (!outcome.ok) await releaseAnswer(ctx, row);
  return outcome;
}

// FIX-2310; FIX-2318.
/**
 * Claim `row` as the one answer: `answeredBy`, written once, so the
 * framework's answer at the turn's end, or the pass's, sends nothing more. A
 * waiting sender's end of the wait writes `waitEndedAt` only while this is
 * unset, so a claimed answer is either that wait's or a message.
 */
async function claimAnswer(ctx: BlockContext, row: Pick<WorkerMessageResourceState, "id" | "inReplyTo">): Promise<void> {
  if (row.inReplyTo === undefined) return;
  const asked = await messageLogOf(ctx).getOptional(row.inReplyTo);
  if (asked?.state.replyRequested === true && asked.state.answeredBy === undefined) {
    await asked.updateState((current) => (current.answeredBy === undefined ? { ...current, answeredBy: row.id } : current));
  }
}

/** Give back {@link claimAnswer}'s claim when `row`'s send was refused: a refused answer answers nothing. */
async function releaseAnswer(ctx: BlockContext, row: Pick<WorkerMessageResourceState, "id" | "inReplyTo">): Promise<void> {
  if (row.inReplyTo === undefined) return;
  const asked = await messageLogOf(ctx).getOptional(row.inReplyTo);
  if (asked?.state.answeredBy === row.id) {
    await asked.updateState((current) => {
      if (current.answeredBy !== row.id) return current;
      const { answeredBy: _answeredBy, ...rest } = current;
      return rest;
    });
  }
}

/** {@link claimAnswer} for a repeat of a send that went out: the first send's claim, if its process ended before it. */
async function markAnswer(ctx: BlockContext, row: Pick<WorkerMessageResourceState, "id" | "inReplyTo">, outcome: SendOutcome): Promise<SendOutcome> {
  if (outcome.ok) await claimAnswer(ctx, row);
  return outcome;
}

/**
 * Dispatch `row` once and answer the send: a final refusal ends the row and
 * is the answer; anything else is recorded on the row for the pass to send
 * again, and the send is ok.
 *
 * @param resends The sending flow carries a pass, which owes `row`'s id.
 */
async function dispatchOnce(
  ctx: BlockContext,
  ref: ResourceRef<WorkerMessageResourceState>,
  row: WorkerMessageResourceState,
  from: string,
  resends: boolean
): Promise<SendOutcome> {
  const { id } = row;
  let outcome: DispatchOutcome | undefined;
  try {
    outcome = await dispatchMessage(ctx, row, from, row.deadlineAt !== undefined);
  } catch (error) {
    // It may have started: the pass sends it again, and the take keeps it once.
    await ref.patchState({ reason: error instanceof Error ? error.message : String(error) });
  }
  if (outcome !== undefined && !outcome.ok) {
    const reason = `${outcome.refused}: ${outcome.detail}`;
    if (isFinalRefusal(outcome.refused) && (await endMessage(ref, "refused", reason, { told: true }))) {
      if (resends) await dropOwed(ctx, [id]);
      return { ok: false, error: `not_delivered: the message to "${row.to}" was refused (${reason}).` };
    }
    await ref.patchState({ reason });
  }
  return { ok: true, id, ...(outcome?.ok === true ? { requestId: outcome.requestId } : {}) };
}
