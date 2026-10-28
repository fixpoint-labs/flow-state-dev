/**
 * The goal's controls. Each is a scratch patch to one or two modules, applied
 * as the process under test loads them (`goals/lib/module-patch.mjs`).
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export const CONTROL_NAMES = [
  "relay-back",
  "ongoing-at-0",
  "refuse-at-receive",
  "answer-to-conversation",
  "no-turn-back",
  "no-hire-check",
  "pay-first",
  "no-wake",
  "no-hop-cap",
  "no-roster-check",
  "fresh-hop-on-task",
  "memory-log",
  "task-to-conversation",
  "no-kind-check",
  "coder-resumes-open",
  "no-debt",
  "accept-clears",
  "window-dedupe",
  "take-is-final",
  "no-recheck",
  "no-person-hold",
  "ignore-deadline",
  "no-default-deadline",
  "send-again",
  "relay-the-call",
  "no-step-guard",
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the legs it runs (the one that must fail, and any that leg needs first), the assertion that must go red, and its patches. */
export interface Control {
  name: ControlName;
  legs: string[];
  assertion: string;
  patches: ModulePatch[];
  does: string;
  /** Leg 9's sub-legs it runs (default: all), when it runs leg 9. */
  subLegs?: string[];
}

const MESSAGES = "packages/workforce/src/messages";
const ENTRY = `${MESSAGES}/message-received-entry.ts`;
const SEND = `${MESSAGES}/send-message.ts`;
const TARGET = `${MESSAGES}/message-target.ts`;
const DELIVERY = `${MESSAGES}/delivery.ts`;
/** The anchor every recipient-refusal patch adds after: the first check `recipientRefusal` makes. */
const CALL = `${MESSAGES}/call.ts`;
const QUEUE = `${MESSAGES}/queue.ts`;
const TOOL = `${MESSAGES}/message-tool.ts`;
/** The one wait check a call and `getTask` share. */
const WAIT_CHECK = "packages/orchestration/src/tasks/helpers/wait-on-task.ts";
const NOT_YOURSELF = String.raw`if \(to === sender && !answering\) return "not_yourself: you can't message yourself\.";`;

export const CONTROLS: Record<ControlName, Control> = {
  "relay-back": {
    name: "relay-back",
    legs: ["1"],
    assertion: "1:no-relay",
    patches: [
      {
        module: ENTRY,
        from: String.raw`return \{ act: "heard", received \};`,
        to:
          'await (await import("./send-message")).sendMessage(ctx, options.installation, options.flowKind, ' +
          '{ to: row.from, text: `Relayed: ${row.text}`, inReplyTo: row.id }, "relay-back"); ' +
          'return { act: "heard", received };',
      },
    ],
    does: "the recipient sends every message straight back to its sender, as the relay did",
  },
  "ongoing-at-0": {
    name: "ongoing-at-0",
    legs: ["3"],
    assertion: "3:ring-stops-at-6",
    patches: [
      { module: "packages/workforce/src/conversation-board/board.ts", from: String.raw`\.\.\.carriedHopState\(ctx\.session\.state\),`, to: "workforceMessageHop: 0," },
      {
        module: "packages/workforce/src/conversation-board/task-entry.ts",
        from: String.raw`if \(mark !== undefined\) await startTurnAtHop\(ctx(?: as never)?, mark\.hop, mark\.chain\);`,
        to: "if (mark !== undefined) await startTurnAtHop(ctx, 0, null);",
      },
    ],
    does: "a delegate's ongoing session counts on its own: born at 0, and its task's turn starts there rather than at its filing's count",
  },
  "refuse-at-receive": {
    name: "refuse-at-receive",
    legs: ["4"],
    assertion: "4:coder-refused",
    patches: [{ module: SEND, from: String.raw`=== "task-sessions"\)`, to: '=== "never")' }],
    does: "the send no longer refuses a worker that hears only in its tasks' sessions, so the row is written and the refusal is left to its entry",
  },
  "answer-to-conversation": {
    name: "answer-to-conversation",
    legs: ["1b", "2"],
    assertion: "2:lands-in-task-session",
    patches: [
      {
        module: SEND,
        from: String.raw`destination = \{ sessionId: answered\.fromSession, flow: answered\.fromFlow \};`,
        to: "destination = await conversationAddress(ctx, installation, input.to, recipient.flow, state);",
      },
    ],
    does: "an answer lands in the recipient's own conversation, not the session its original was sent from",
  },
  "no-turn-back": {
    name: "no-turn-back",
    legs: ["4"],
    assertion: "4:round-robin-heard",
    patches: [
      {
        module: SEND,
        from: NOT_YOURSELF,
        to:
          'if (to === sender && !answering) return "not_yourself: you can\'t message yourself."; ' +
          'if (recipient?.flow === "coordinator" && to !== "chief-of-staff") return `no_turn: "${to}" hands every line to its delegates and runs no turn of its own.`;',
      },
    ],
    does: "a coordinator that hands every line on (any but the best-fit Shift Coordinator here) is refused `no_turn`, as before",
  },
  "no-hire-check": {
    name: "no-hire-check",
    legs: ["4"],
    assertion: "4:hire-refuses",
    patches: [{ module: "packages/workforce/src/workers/register.ts", from: String.raw`if \(deaf\.length > 0\) \{`, to: "if (deaf.length < 0) {" }],
    does: "hireWorkforce takes a worker flow with no onMessageReceived",
  },
  "pay-first": {
    name: "pay-first",
    legs: ["3"],
    assertion: "3:refused-pays-nothing",
    patches: [
      {
        module: SEND,
        from: String.raw`const named = await installation\.rosterWorker\(ctx(?: as never)?, to\);`,
        to:
          "const __paid = turnChainOf(ctx); " +
          'if (__paid !== undefined) await (await messageChainsOf(ctx).getOrCreate(__paid, { sent: [] })).updateState((row) => ({ ...row, sent: [...row.sent, `paid-${Date.now()}`] })); ' +
          "const named = await installation.rosterWorker(ctx, to);",
      },
    ],
    does: "a send takes its place in the chain before the recipient is checked, so a refused send spends one",
  },
  "no-wake": {
    name: "no-wake",
    legs: ["1"],
    assertion: "1:answer-holds-codename",
    patches: [{ module: ENTRY, from: String.raw`got\.act === "heard",`, to: "false," }],
    does: "a message lands as its items in the recipient's conversation and never wakes its turn",
  },
  "no-hop-cap": {
    name: "no-hop-cap",
    legs: ["3"],
    assertion: "3:ring-stops-at-6",
    patches: [{ module: SEND, from: String.raw`const limits = messageLimitsOf\(installation\);`, to: "const limits = { ...messageLimitsOf(installation), hopLimit: Number.POSITIVE_INFINITY };" }],
    does: "an exchange of worker messages has no budget (the per-request limit stays)",
  },
  "no-roster-check": {
    name: "no-roster-check",
    legs: ["4"],
    assertion: "4:bobs-worker-refused",
    patches: [
      {
        module: SEND,
        from: String.raw`const named = await installation\.rosterWorker\(ctx(?: as never)?, to\);`,
        to: 'const named = (await installation.rosterWorker(ctx, to)) ?? { id: to, flow: "agent", standard: false, description: null, delegates: [] };',
      },
    ],
    does: "a worker that isn't on the sender's user's roster is taken as one of theirs on `agent`",
  },
  "fresh-hop-on-task": {
    name: "fresh-hop-on-task",
    legs: ["3b"],
    assertion: "3b:counts-on",
    patches: [
      {
        module: "packages/workforce/src/conversation-board/task-entry.ts",
        from: String.raw`if \(mark !== undefined\) await startTurnAtHop\(ctx(?: as never)?, mark\.hop, mark\.chain\);`,
        to: "if (mark !== undefined) await startTurnAtHop(ctx, 0, null);",
      },
    ],
    does: "a task's turn starts a fresh exchange at 0, not at the count its filing recorded",
  },
  "memory-log": {
    name: "memory-log",
    legs: ["1", "5"],
    assertion: "5:lists-every-message",
    patches: [
      {
        module: `${MESSAGES}/message-log.ts`,
        from: String.raw`export function messageLogOf\(ctx[^)]*\)[^{]*\{`,
        to:
          "const __memoryLog = new Map(); " +
          "const __memoryRef = (id) => ({ get state() { return __memoryLog.get(id); }, patchState: async (patch) => { __memoryLog.set(id, { ...__memoryLog.get(id), ...patch }); } }); " +
          "export function messageLogOf(ctx) { return { getOptional: async (id) => (__memoryLog.has(id) ? __memoryRef(id) : undefined), getOrCreate: async (id, initial) => { if (!__memoryLog.has(id)) __memoryLog.set(id, initial); return __memoryRef(id); } }; } " +
          "function __storedMessageLogOf(ctx) {",
      },
    ],
    does: "the message log is kept in the server's memory, not in the store",
  },
  "task-to-conversation": {
    name: "task-to-conversation",
    legs: ["6"],
    assertion: "6:lands-in-task-session",
    patches: [{ module: TARGET, from: String.raw`const sessionId = ledger\.get\(taskId\)\?\.run\?\.sessionId;`, to: "const sessionId = (await findTaskPartitions(ctx, CONVERSATION_LEDGER_ID, taskId))[0];" }],
    does: "a { task } message lands in the conversation that filed the task, not in the session working it",
  },
  "no-kind-check": {
    name: "no-kind-check",
    legs: ["6", "7"],
    assertion: "7:refusals",
    patches: [
      {
        module: TARGET,
        from: String.raw`if \(!viaTask && \(state\[TASK_ID_STATE_KEY\] != null \|\| state\[FILING_SESSION_STATE_KEY\] != null\)\) \{`,
        to: "if (false) {",
      },
    ],
    does: "a { session } message isn't checked for a task's or a delegate's session",
  },
  "coder-resumes-open": {
    name: "coder-resumes-open",
    legs: ["8"],
    assertion: "8:running-refused",
    patches: [
      {
        module: TARGET,
        from: String.raw`if \(rowsInSession\(of\.ledger, sessionId\)\.some\(\(row\) => !isTerminalStatus\(row\.status\)\)\) \{`,
        to: "if (false) {",
      },
    ],
    does: "a message to the coder's open task is sent, to reach the coding session the work is in",
  },
  "no-debt": {
    name: "no-debt",
    legs: ["9"],
    subLegs: ["crash-after-row", "resent"],
    assertion: "9:crash-after-row",
    patches: [{ module: SEND, from: String.raw`const resends = carriesPass\(installation, flowKind\);`, to: "const resends = false;" }],
    does: "the send owes no wake and keeps no owed id, so nothing sends a message again",
  },
  "accept-clears": {
    name: "accept-clears",
    legs: ["9"],
    subLegs: ["lost-after-accept"],
    assertion: "9:lost-after-accept",
    patches: [
      {
        module: SEND,
        from: String.raw`return \{ ok: true, id, \.\.\.\(outcome\?\.ok === true \? \{ requestId: outcome\.requestId \} : \{\}\) \};`,
        to: 'if (outcome?.ok === true) { await ref.patchState({ status: "delivered" }); if (resends) await dropOwed(ctx, [id]); } $&',
      },
    ],
    does: "an accepted dispatch marks the row delivered and drops the debt",
  },
  "window-dedupe": {
    name: "window-dedupe",
    legs: ["9"],
    subLegs: ["seen-once"],
    assertion: "9:seen-once",
    patches: [
      // The session window FIX-2240 replaced is gone from the code; what it
      // stood for at a distance past its size is a take that doesn't read the row.
      { module: DELIVERY, from: String.raw`row\.status !== "unconfirmed"\) return undefined;`, to: "false) return undefined;" },
      { module: DELIVERY, from: String.raw`const rule = await decideTake\(ctx, row\.takenBy\);`, to: 'const rule = { take: "own" };' },
      {
        module: DELIVERY,
        from: String.raw`if \(current\.status !== "unconfirmed" \|\| current\.takenBy !== seen\) return \{ state: current, result: undefined \};`,
        to: "",
      },
    ],
    does: "the take doesn't read the row's status or taker, as a dedupe window that has moved past the id wouldn't, so a late copy lands again",
  },
  "take-is-final": {
    name: "take-is-final",
    legs: ["9"],
    subLegs: ["crash-after-take"],
    assertion: "9:crash-after-take",
    patches: [
      {
        module: DELIVERY,
        from: String.raw`const rule = await decideTake\(ctx, row\.takenBy\);`,
        to: 'const rule = row.takenBy === undefined || row.takenBy === ctx.request.identity.id ? { take: "own" } : { take: "busy" };',
      },
    ],
    does: "a copy never takes over from a taker that ended",
  },
  "no-recheck": {
    name: "no-recheck",
    legs: ["9"],
    subLegs: ["late-refusal"],
    assertion: "9:late-refusal",
    patches: [{ module: DELIVERY, from: String.raw`const refusal = await recheck\(ctx, ref\.state\);`, to: "const refusal = undefined;" }],
    does: "a resend skips the recipient check",
  },
  "no-person-hold": {
    name: "no-person-hold",
    legs: ["10b"],
    assertion: "10b:queued",
    patches: [{ module: QUEUE, from: String.raw`\(\) => userHoldOf\(ctx\)\)`, to: "async () => null)" }],
    does: "the admission never reads the person's stop: a message lands in a session stopped for a person",
  },
  "ignore-deadline": {
    name: "ignore-deadline",
    legs: ["10b"],
    assertion: "10b:queued",
    patches: [{ module: CALL, from: String.raw`message: \`Waiting on the reply to message`, to: "deadlineAt: deadlineAt + 3_600_000, message: `Waiting on the reply to message" }],
    does: "a call waits for the reply whatever its deadline (an hour past it)",
  },
  "no-default-deadline": {
    name: "no-default-deadline",
    legs: ["10b"],
    assertion: "10:default-deadline",
    patches: [{ module: WAIT_CHECK, from: String.raw`const deadlineMs = options\.deadlineMs \?\? defaultMs;`, to: "const deadlineMs = options.deadlineMs ?? maxMs;" }],
    does: "a call with no deadline waits the host's maximum, not its default",
  },
  "send-again": {
    name: "send-again",
    legs: ["10b"],
    assertion: "10b:kept",
    patches: [
      {
        module: TOOL,
        from: String.raw`return callAnswer\(await waitAgain\(ctx(?: as never)?, callId, deadline\)\);`,
        to:
          '{ const row = (await (await import("./message-log")).messageLogOf(ctx).getOptional(callId))?.state; ' +
          'return callAnswer(await callWorker(ctx, installation, flowKind, { to: row?.to ?? "", text: row?.text ?? "" }, SEND_MESSAGE_TOOL)); }',
      },
    ],
    does: "waiting again sends the call's message again, as a new call",
  },
  "relay-the-call": {
    name: "relay-the-call",
    legs: ["10"],
    assertion: "10:no-second-line",
    patches: [
      {
        module: ENTRY,
        from: String.raw`return \{ reply: reply\.slice\(0, MAX_MESSAGE_CHARS\) \};`,
        to:
          '{ const row = typeof call === "string" ? (await messageLogOf(ctx).getOptional(call))?.state : undefined; ' +
          'if (row !== undefined) await (await import("./send-message")).sendMessage(ctx, options.installation, options.flowKind, { to: row.from, text: reply, inReplyTo: row.id }, "relay-the-call"); ' +
          'return { reply: reply.slice(0, MAX_MESSAGE_CHARS) }; }',
      },
    ],
    does: "a call's reply is also sent back to the caller as a message",
  },
  "no-step-guard": {
    name: "no-step-guard",
    legs: ["10c"],
    assertion: "10c:one-wait-per-step",
    patches: [{ module: WAIT_CHECK, from: String.raw`if \(holder !== options\.key\) \{`, to: "if (false) {" }],
    does: "a model step may hold two waits",
  },
};
