/**
 * Legs 10, 10b and 10c (FIX-2239): a call, a message whose sender waits for
 * the reply in the same request. Assertions are tagged `<leg>:<name>`. See
 * goal.md.
 *
 * Helper A makes every call; the herald makes the one a schema must refuse.
 * A turn that calls parks on a wait, so it is read until it ends, not until
 * it first stops running (`talkThrough`). Times are the call's row (`at`,
 * `deadlineAt`) and when the parked turn read as running again, polled.
 */
import {
  act,
  callsIn,
  linesIn,
  logOf,
  quiet,
  receivedIn,
  sleep,
  until,
  word,
  COS,
  HELPER_A,
  HELPER_B,
  HERALD,
  RESEARCHER,
  type Call,
  type Connected,
  type LegResult,
  type Row,
  type Turn,
  type World,
} from "./legs.mts";
import { endOf, file, rowOf, startOf } from "./legs-targets.mts";

type SessionSummary = { id: string; flowKind: string };
/** A call's row: a message row with the call's own fields. */
type CallRow = Row & { at: number; call?: boolean; deadlineAt?: number; repliedAt?: number; queuedBehind?: string; deliveredAs?: string };

const ENDED = new Set(["completed", "failed", "aborted", "cancelled", "errored", "expired"]);
/** The host's wait default this run sets (`DEVTEAM_WAIT_DEFAULT_MS`, run.mts). */
export const WAIT_DEFAULT_MS = 8_000;
/** How late after its deadline a call may answer: the sweep's wake, the resume, and the run's 500 ms poll. */
const SLACK_MS = 6_000;
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 500);

/** A turn, read until its request ends: a call parks it on a wait, which isn't an end. */
async function talkThrough(world: World, leg: string, worker: string, session: SessionSummary, words: string, timeoutMs = 180_000): Promise<Turn & { seen: string[]; seenAt: number[] }> {
  const { alice } = world;
  const client = alice.flow(session.flowKind);
  const requestId = (await client.send("respond", { message: words }, { sessionId: session.id })).id;
  const seen: string[] = [];
  const seenAt: number[] = [];
  let status = "timed-out";
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(500)) {
    const now = (await client.request(requestId).status().catch(() => undefined))?.status;
    if (now !== undefined && seen.at(-1) !== now) {
      seen.push(now);
      seenAt.push(Date.now());
    }
    if (now !== undefined && ENDED.has(now)) {
      status = now;
      break;
    }
  }
  const mine = (await linesIn(alice, session.id)).filter((l) => l.requestId === requestId && l.role === "assistant");
  const turn = { leg, worker, words, sessionId: session.id, requestId, status, reply: mine.at(-1)?.text ?? `no reply (${status})`, calls: [] as Call[], seen, seenAt };
  // A parked call writes an empty output; its replay writes the real one.
  turn.calls = (await callsIn(alice, session.id)).filter((c) => c.requestId === requestId && c.output != null && typeof c.output === "object");
  world.turns.push(turn);
  return turn;
}

/**
 * When a parked turn went on: the first time it read as running again after
 * it first parked, as polled every 500 ms. A call's answer is the turn going on.
 */
function resumedAt(turn: { seen: string[]; seenAt: number[] }): number | undefined {
  const parked = turn.seen.indexOf("suspended");
  if (parked < 0) return undefined;
  const next = turn.seen.findIndex((status, i) => i > parked && status !== "suspended");
  return next < 0 ? undefined : turn.seenAt[next];
}

const callRows = async (who: Connected) => (await logOf(who)) as CallRow[];
const isWait = (c: Call) => c.args.wait === true;

/** Leg 10: a call answered in turn, no second line, a call to a finished task. */
export async function leg10(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice } = world;
  const researcher = world.conversation[RESEARCHER]!;
  const helperA = world.conversation[HELPER_A]!;
  const codename = word();

  await talkThrough(world, "10", RESEARCHER, researcher, `Remember this: the launch codename is ${codename}. When anyone asks for it, give it. Reply only "Noted."`);
  const receivedBefore = (await receivedIn(alice, helperA.id)).filter((m) => m.from === RESEARCHER).length;
  const asked = await talkThrough(
    world,
    "10",
    HELPER_A,
    helperA,
    `Ask ${RESEARCHER} for the launch codename: call sendMessage with to "${RESEARCHER}" and wait: true, so you get the answer now. Then tell me the codename.`,
  );
  const call = asked.calls.find((c) => isWait(c) && c.args.to === RESEARCHER);
  if (call === undefined || call.output?.status !== "answered" || !String(call.output?.reply ?? "").includes(codename) || !asked.reply.includes(codename)) {
    r.failures.push(`10:answer-in-turn — Helper A's turn (${asked.status}) didn't get the codename back as its call's result and tell it: calls ${show(asked.calls.map((c) => ({ args: c.args, output: c.output })))}; reply ${asked.reply.slice(0, 200)}`);
  } else {
    // The reply is the output of an onMessageReceived request in Researcher's session.
    const requests = await alice.routes.requests(researcher.id);
    const answering = requests.find((q) => (q.result?.output as { reply?: unknown } | undefined)?.reply === call.output.reply);
    if (answering === undefined) r.failures.push(`10:answer-in-turn — no request in Researcher's session outputs the reply Helper A got`);
    r.notes.push(`call ${call.output.callId} answered "${String(call.output.reply).slice(0, 80)}" in Researcher's request ${answering?.id}`);
  }
  await quiet(alice, 180_000);
  if (call !== undefined && typeof call.output?.callId === "string") {
    const rows = await callRows(alice);
    const asRow = rows.find((m) => m.id === call.output.callId);
    const after = rows.filter((m) => m.from === RESEARCHER && m.to === HELPER_A && asRow !== undefined && m.at >= asRow.at);
    const heard = (await receivedIn(alice, helperA.id)).filter((m) => m.from === RESEARCHER).length - receivedBefore;
    if (after.length > 0 || heard > 0) {
      r.failures.push(`10:no-second-line — after the call Researcher sent Helper A ${after.length} message(s) and Helper A's conversation gained ${heard} from Researcher: ${show(after.map((m) => m.text.slice(0, 80)))}`);
    }
  }

  // A call to a finished task, answered from its session.
  const cos = world.conversation[COS]!;
  const colour = word();
  await act(alice, cos.flowKind, cos.id, "addDelegate", { worker: RESEARCHER }, 60_000);
  const taskId = await file(alice, cos, { goal: `Remember this colour for later: ${colour}. Then reply "Noted" and you're done.`, assignee: RESEARCHER });
  const finished = await until(async () => {
    const now = await rowOf(alice, cos, taskId);
    return now !== undefined && ["completed", "failed", "cancelled"].includes(String(now.status)) ? now : undefined;
  }, 240_000, 2_000);
  await quiet(alice, 180_000);
  const taskCall = await talkThrough(
    world,
    "10",
    HELPER_A,
    helperA,
    `Call sendMessage with to {"task":"${taskId}"} and wait: true, asking which colour it was told to remember. Then tell me the colour.`,
  );
  const toTask = taskCall.calls.find((c) => isWait(c) && (c.args.to as { task?: unknown } | undefined)?.task === taskId);
  if (toTask === undefined || toTask.output?.status !== "answered" || !String(toTask.output?.reply ?? "").includes(colour)) {
    const taskSession = finished?.run?.sessionId as string | undefined;
    const there = taskSession === undefined ? [] : await linesIn(alice, taskSession);
    r.failures.push(
      `10:task-call — the call to task ${taskId} (${finished?.status ?? "not finished"}) didn't answer with ${colour}: ${show(taskCall.calls.map((c) => ({ args: c.args, output: c.output })))}; ` +
        `its session's last lines: ${show(there.slice(-3).map((l) => `${l.role}: ${l.text.slice(0, 100)}`))}`,
    );
  }
  await act(alice, cos.flowKind, cos.id, "removeDelegate", { worker: RESEARCHER }, 60_000);
  return r;
}

/** Leg 10b: a call and a send into a session stopped for a person queue; the reply is kept; waiting again gets it. Also `10:default-deadline`. */
export async function leg10b(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice } = world;
  const researcher = world.conversation[RESEARCHER]!;
  const helperA = world.conversation[HELPER_A]!;
  const fyi = word();

  // Researcher's conversation stops for Alice.
  const stopTurn = await act(alice, researcher.flowKind, researcher.id, "respond", {
    message: `Before anything else, call waitForUser with kind "approval" and prompt "May I publish the ${fyi} report?", and wait for my answer.`,
  });
  const stop = await until(async () => {
    const stops = (await alice.routes.items(researcher.id, "suspension")).filter((i) => i.requestId === stopTurn.requestId && i.reason === "user_approval");
    return stops.at(-1);
  }, 30_000, 1_000);
  if (stop === undefined) {
    r.failures.push(`10b:queued — Researcher's turn opened no stop for the person (${stopTurn.status}): the leg can't run`);
    return r;
  }

  const queuedTurn = await talkThrough(
    world,
    "10b",
    HELPER_A,
    helperA,
    `Do two things. First, ask ${RESEARCHER} "What is seven times six? Answer with the number only." by calling sendMessage with wait: true and deadline: 5000. ` +
      `Then send ${RESEARCHER} a plain message, without wait: "FYI: ${fyi}". Then tell me what you got.`,
  );
  const call = queuedTurn.calls.find((c) => isWait(c) && c.args.to === RESEARCHER);
  const callId = typeof call?.output?.callId === "string" ? (call.output.callId as string) : undefined;
  const plain = queuedTurn.calls.find((c) => !isWait(c) && typeof c.output?.sent === "string");
  if (call === undefined || call.args.deadline !== 5000) {
    r.failures.push(`10b:queued — Helper A made no call with deadline 5000: ${show(queuedTurn.calls.map((c) => c.args))}`);
  } else {
    const rows = await callRows(alice);
    const row = rows.find((m) => m.id === callId);
    const at = resumedAt(queuedTurn);
    const held = (await receivedIn(alice, researcher.id)).filter((m) => m.id === callId || m.id === plain?.output?.sent);
    if (call.output?.status !== "running" || call.output?.recipient !== "waiting_on_person") {
      r.failures.push(`10b:queued — the call answered ${show(call.output)}, not running with the recipient waiting on a person`);
    }
    if (row?.deadlineAt === undefined || at === undefined || at < row.deadlineAt || at > row.deadlineAt + SLACK_MS || Math.abs(row.deadlineAt - row.at - 5000) > 1_000) {
      r.failures.push(`10b:queued — the call's answer wasn't stored between 5 s and 5 s plus ${SLACK_MS} ms after it was sent: ${show({ sent: row?.at, deadlineAt: row?.deadlineAt, answeredAt: at })}`);
    }
    if (!queuedTurn.seen.includes("suspended")) r.failures.push(`10b:queued — Helper A's request never read as parked on a wait: ${show(queuedTurn.seen)}`);
    if (held.length > 0) r.failures.push(`10b:queued — ${held.length} message(s) landed in Researcher's session while its stop was open`);
    if (queuedTurn.status !== "completed" || queuedTurn.reply.trim() === "") r.failures.push(`10b:queued — Helper A's turn didn't go on to answer Alice: ${queuedTurn.status}`);
    r.notes.push(`call ${callId}: sent ${row?.at}, deadline ${row?.deadlineAt}, answered ${at}; Helper A's request went ${queuedTurn.seen.join(" > ")}`);
  }
  if (plain === undefined) r.failures.push(`10b:queued — Helper A sent no plain message beside the call: ${show(queuedTurn.calls.map((c) => c.args))}`);

  // 10:default-deadline — a call with no deadline into the same stopped session waits the host's default.
  const defaultTurn = await talkThrough(
    world,
    "10",
    HELPER_A,
    helperA,
    `Call sendMessage with to "${RESEARCHER}", text "Are you there?" and wait: true. Don't pass a deadline. Then tell me what it answered.`,
  );
  const plainCall = defaultTurn.calls.find((c) => isWait(c) && c.args.to === RESEARCHER);
  if (plainCall === undefined || plainCall.args.deadline !== undefined) {
    r.failures.push(`10:default-deadline — Helper A made no call without a deadline: ${show(defaultTurn.calls.map((c) => c.args))}`);
  } else {
    const row = (await callRows(alice)).find((m) => m.id === plainCall.output?.callId);
    const at = resumedAt(defaultTurn);
    const waited = row === undefined || at === undefined ? undefined : at - row.at;
    if (plainCall.output?.status !== "running" || waited === undefined || waited < WAIT_DEFAULT_MS || waited > WAIT_DEFAULT_MS + SLACK_MS) {
      r.failures.push(`10:default-deadline — the call answered ${show(plainCall.output)} after ${waited} ms; wanted running between ${WAIT_DEFAULT_MS} and ${WAIT_DEFAULT_MS + SLACK_MS} ms`);
    }
    r.notes.push(`the call with no deadline answered ${plainCall.output?.status} after ${waited} ms`);
  }

  // 10b:kept — Alice answers; the messages land after the stopped request ends; waiting again gets the kept reply.
  await alice.flow(researcher.flowKind).request(stopTurn.requestId!).answer({ suspensionId: String(stop.suspensionId), action: "approve" });
  const landed = await until(async () => {
    const received = (await receivedIn(alice, researcher.id)).filter((m) => m.id === callId || m.id === plain?.output?.sent);
    return received.length >= (plain === undefined ? 1 : 2) ? received : undefined;
  }, 180_000);
  await quiet(alice, 180_000);
  const requests = await alice.routes.requests(researcher.id);
  const stopped = requests.find((q) => q.id === stopTurn.requestId);
  for (const m of landed ?? []) {
    const heard = requests.find((q) => q.id === m.requestId);
    if (stopped === undefined || heard === undefined || !(startOf(heard) >= endOf(stopped) || Number(heard.result?.completedAtMs ?? 0) >= endOf(stopped))) {
      // The message request started before the stop; its turn must run after the stop ended.
      const deliveredAt = (await callRows(alice)).find((row) => row.id === m.id) as (CallRow & { deliveredAt?: number }) | undefined;
      if (stopped === undefined || deliveredAt?.deliveredAt === undefined || deliveredAt.deliveredAt < endOf(stopped)) {
        r.failures.push(`10b:kept — message ${m.id} landed at ${deliveredAt?.deliveredAt} before the stopped request ended at ${stopped === undefined ? "?" : endOf(stopped)}`);
      }
    }
  }
  if (landed === undefined) r.failures.push(`10b:kept — the queued messages never landed in Researcher's session after Alice answered`);
  const rowsBefore = await callRows(alice);
  const kept = await talkThrough(world, "10b", HELPER_A, helperA, `Get me ${RESEARCHER}'s answer to the seven-times-six question you asked earlier.`);
  const again = kept.calls.find((c) => c.args.callId === callId);
  const rowsAfter = await callRows(alice);
  const newRows = rowsAfter.filter((m) => !rowsBefore.some((b) => b.id === m.id) && m.from === HELPER_A);
  if (again === undefined || again.output?.status !== "answered" || !String(again.output?.reply ?? "").includes("42")) {
    r.failures.push(`10b:kept — Helper A didn't wait again with call ${callId} and get the reply: ${show(kept.calls.map((c) => ({ args: c.args, output: c.output })))}`);
  }
  const callRowsFor = rowsAfter.filter((m) => m.id === callId);
  if (newRows.length > 0 || callRowsFor.length !== 1) {
    r.failures.push(`10b:kept — waiting again wrote ${newRows.length} new row(s) (${show(newRows.map((m) => m.text.slice(0, 60)))}); the call has ${callRowsFor.length} row(s)`);
  }
  r.notes.push(`waiting again answered ${show(again?.output)}`);
  return r;
}

/** Leg 10c: two waits in one step, and a call the caller can't mark. */
export async function leg10c(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice } = world;
  const helperA = world.conversation[HELPER_A]!;
  const both = await talkThrough(
    world,
    "10c",
    HELPER_A,
    helperA,
    `In one single step, make two sendMessage calls at the same time, as parallel tool calls, both with wait: true: one to "${RESEARCHER}" with text "ping one?" and one to "${HELPER_B}" with text "ping two?". Then tell me what each returned.`,
  );
  const waits = both.calls.filter(isWait);
  if (waits.length < 2) {
    r.failures.push(`10c:one-wait-per-step — Helper A made ${waits.length} call(s) with wait, not two: ${show(both.calls.map((c) => c.args))}`);
  } else if (!waits.some((c) => String(c.output?.error ?? "").startsWith("wait_already_pending"))) {
    r.failures.push(`10c:one-wait-per-step — neither of the two waits was refused wait_already_pending: ${show(waits.map((c) => c.output))}`);
  }
  await quiet(alice, 180_000);

  const herald = world.conversation[HERALD]!;
  await talkThrough(world, "10c", HERALD, herald, `Call sendMessage with exactly these arguments, as written: {"to":"${HELPER_B}","text":"hello from the herald","call":true}. Report what the tool answered.`);
  const sessions = await alice.routes.sessions();
  const callIds = new Set<string>();
  let taken = 0;
  for (const s of sessions) {
    for (const c of await callsIn(alice, s.id).catch((): Call[] => [])) {
      if (typeof c.output?.callId === "string") callIds.add(c.output.callId);
      if (Object.hasOwn(c.args, "call") && (typeof c.output?.sent === "string" || typeof c.output?.callId === "string")) taken += 1;
    }
  }
  const unset = (await callRows(alice)).filter((m) => m.call === true && !callIds.has(m.id));
  if (taken > 0 || unset.length > 0) {
    r.failures.push(`10c:not-settable — ${taken} call(s) naming \`call\` were taken, and ${unset.length} row(s) carry a call flag no call set: ${show(unset.map((m) => m.id))}`);
  }
  await quiet(alice, 180_000);
  return r;
}
