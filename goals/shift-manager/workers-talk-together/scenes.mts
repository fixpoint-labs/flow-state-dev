/**
 * FIX-2242's scenes: FIX-2070's legs walked together on one durable host, so
 * they collide. Assertions are tagged `<leg>:<name>`. See goal.md.
 *
 * - **ac** · Helper A calls Researcher; the server kills itself after the
 *   call's row is written, before its dispatch (FIX-2240's `exit-after-row`,
 *   on Helper A's messages); restarted without the fault, the call lands
 *   once (c) and the request that made it reads the answer (a).
 * - **ed** · Researcher's conversation stops for Alice. Helper A files Helper
 *   B a task whose brief needs a fact only Helper A holds, then calls
 *   Researcher and parks. Helper B asks midway; the question reaches Helper A
 *   while its call is parked (e), and meanwhile a ring runs on its own line
 *   from Alice (d). The call's deadline passes, Alice answers the stop, and
 *   Helper A waits again by call id.
 * - **b** · a message to Helper B's task while its turn runs, and one after
 *   it finished.
 *
 * Everything is read back from the store as Alice: sessions' items, the
 * message log and the board's own task read. Sent messages are counted from
 * each turn's own tool outputs.
 */
import type { Scene } from "./controls.mts";
import { faultLines } from "../workers-message-each-other/faults.mts";
import { resumedAt, talkThrough } from "../workers-message-each-other/legs-calls.mts";
import { RESEND_FROM, TAKEOVER_MS, requestsFor, senderOf, tookWithin, type Servers } from "../workers-message-each-other/legs-delivery.mts";
import { file, rowOf, sessionOfTask, endOf, startOf } from "../workers-message-each-other/legs-targets.mts";
import {
  act,
  boardOf,
  callsIn,
  linesIn,
  logOf,
  quiet,
  receivedIn,
  sleep,
  talk,
  until,
  word,
  HELPER_A,
  HELPER_B,
  HERALD,
  RESEARCHER,
  type Call,
  type Connected,
  type LegResult,
  type Row,
  type World,
} from "../workers-message-each-other/legs.mts";

type SessionSummary = { id: string; flowKind: string };
type TaskRow = Record<string, any>;
type CallRow = Row & { at: number; call?: boolean; deadlineAt?: number; repliedAt?: number; queuedBehind?: string; deliveredAs?: string };

/** The two ring workers this goal hires: each passes every message it hears on to the other. */
export const RING_ONE = "ring-one";
export const RING_TWO = "ring-two";
/** Leg e's call deadline: long enough for Helper B's question to arrive, and the ring to run, while it is parked. */
export const PARKED_CALL_MS = 150_000;
const ENDED = new Set(["completed", "failed", "aborted", "cancelled", "errored", "expired", "interrupted"]);
const OWED_ENDS = new Set([...ENDED].filter((s) => s !== "interrupted"));
const TERMINAL = new Set(["completed", "failed", "cancelled", "errored"]);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 500);
const errorOf = (c: Call) => String(c.output?.error ?? "");
const isWait = (c: Call) => c.args.wait === true;
const tsOf = (item: Record<string, unknown> | undefined) => Number(item?.ts ?? item?.createdAt ?? Number.NaN);

/** What the scenes leave for the browser journey (j1) and the run's report. */
export interface Walked {
  /** Leg a's call: the crashed one. */
  crashedCall?: string;
  /** Leg e's call: parked, then waited on again. */
  parkedCall?: string;
  /** The ring's sent messages in its own chain, by id (the herald's fan may start another exchange through the ring), and the seventh send's refusal. */
  ringIds?: string[];
  ringRefusal?: { sessionId: string; error: string };
}

/** Send `words` to a worker's conversation and don't wait on the turn: the server may die in it, or it parks. */
async function sendLine(who: Connected, session: SessionSummary, words: string): Promise<string | null> {
  try {
    return (await who.flow(session.flowKind).send("respond", { message: words }, { sessionId: session.id })).id;
  } catch {
    return null;
  }
}

/** A request's status in `sessionId`, polled until it ends (`ends`) or `timeoutMs`: every status seen, with when. */
async function follow(who: Connected, flowKind: string, requestId: string, timeoutMs: number, ends: ReadonlySet<string> = ENDED): Promise<{ status: string; seen: string[]; seenAt: number[] }> {
  const client = who.flow(flowKind);
  const seen: string[] = [];
  const seenAt: number[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(500)) {
    const now = (await client.request(requestId).status().catch(() => undefined))?.status;
    if (now !== undefined && seen.at(-1) !== now) {
      seen.push(now);
      seenAt.push(Date.now());
    }
    if (now !== undefined && ends.has(now)) return { status: now, seen, seenAt };
  }
  return { status: "timed-out", seen, seenAt };
}

/** Hire the ring's two workers on Alice's roster. */
export async function hireRing(world: World): Promise<string[]> {
  const failures: string[] = [];
  const roster = (await world.alice.routes.sessions()).find((s) => (s.flowKind ?? s.flowId) === "workforce-roster" && s.parentSessionId == null);
  const rosterId = roster?.id ?? (await world.alice.flow("workforce-roster").createSession()).id;
  for (const [id, other] of [
    [RING_ONE, RING_TWO],
    [RING_TWO, RING_ONE],
  ] as const) {
    const done = await act(world.alice, "workforce-roster", rosterId, "hire", {
      id,
      flow: "agent",
      description: `${id}: passes messages on.`,
      instructions:
        `Whenever another worker messages you, pass its text on to ${other} with sendMessage, every time, with no exceptions: give to "${other}" and text, the text you heard copied word for word, and leave inReplyTo, wait and deadline out (never wait for a reply). ` +
        "Always make that sendMessage call, even when you're told the exchange can send no more messages: the tool decides, and you report what it answered. " +
        `When the user asks you to start the ring, message ${other} as told.`,
      settings: { model: "openai/gpt-5.4-mini" },
    }, 60_000);
    if (done.status !== "completed") failures.push(`setup:hire — the hire of ${id} ${done.status}: ${done.error ?? show(done.output)}`);
  }
  return failures;
}

/** A scene that ends early grades none of its other assertions: the report reads all of them FAIL, never PASS. */
function stopped(r: LegResult, scene: Scene): LegResult {
  r.failures.push(`${scene}:stopped — setup: the scene ended here, so its other assertions never ran`);
  return r;
}

/**
 * Scene ac. `servers.restart` serves the store with Helper A's `exit-after-row`
 * fault; the runner applies it to Helper A's messages only.
 */
export async function sceneAC(world: World, servers: Servers, walked: Walked): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const helperA = () => world.conversation[HELPER_A]!;
  const researcher = () => world.conversation[RESEARCHER]!;
  const codename = word();
  await talk(world.turns, "a", world.alice, RESEARCHER, researcher(), `Remember this: the launch codename is ${codename}. When any worker asks for it, give it. Reply only "Noted."`);
  await quiet(world.alice, 120_000);
  const receivedBefore = new Set((await receivedIn(world.alice, helperA().id)).map((m) => m.itemId));
  const logBefore = new Set((await logOf(world.alice)).map((m) => m.id));

  const since = Date.now();
  await servers.restart(["exit-after-row"], "ac-exit-after-row");
  const asked = await sendLine(
    world.alice,
    helperA(),
    `Ask ${RESEARCHER} for the launch codename: call sendMessage with to "${RESEARCHER}" and wait: true, so you get the answer in this turn. Then tell me the codename.`,
  );
  if (!(await servers.crashed(240_000))) {
    r.failures.push(`c:lands-once — setup: the server didn't exit within 240 s of Helper A's line (request ${asked})`);
    await servers.restart([], "ac-no-crash");
    return stopped(r, "ac");
  }
  const line = faultLines(servers.faultLog).find((l) => l.fault === "exit-after-row" && l.at >= since);
  await servers.restart([], "ac-after-row");
  if (line === undefined) {
    r.failures.push(`c:lands-once — setup: the exit-after-row fault never fired on Helper A's call, so this scene shows nothing`);
    return stopped(r, "ac");
  }
  walked.crashedCall = line.id;
  r.notes.push(`the server died after writing call ${line.id}'s row, in Helper A's request ${line.request} (the line was ${asked})`);

  // c:lands-once — exactly one received item for the id, delivered, deliveredAs naming the resend.
  const t = await tookWithin(world.alice, line.id, TAKEOVER_MS);
  const stamp = senderOf(t.delivering);
  r.notes.push(`c: ${line.id}: ${t.why}; delivered from ${stamp.block ?? "?"} in ${stamp.session ?? "?"}`);
  if (!t.ok) r.failures.push(`c:lands-once — within ${TAKEOVER_MS / 1000} s of the restart Researcher hadn't taken ${line.id} once: ${t.why}`);
  else if (stamp.block !== RESEND_FROM || stamp.session !== helperA().id) {
    r.failures.push(`c:lands-once — ${line.id} was delivered by a request ${stamp.block ?? "nothing"} sent from ${stamp.session ?? "?"}, not Helper A's pass (${RESEND_FROM} from ${helperA().id})`);
  }

  // a:answer-in-request — the request that made the call, replayed by the host, reads the answer.
  const requestId = line.request ?? asked ?? "";
  // `interrupted` is not an end here: a call that died before it parked still owes its park, and the
  // durability sweep continues it a stale threshold later (FIX-2269). A request that never leaves
  // interrupted reads timed-out.
  const ended = await follow(world.alice, helperA().flowKind, requestId, 360_000, OWED_ENDS);
  const calls = (await callsIn(world.alice, helperA().id)).filter((c) => c.requestId === requestId && c.output != null && typeof c.output === "object");
  const call = calls.find((c) => isWait(c) && c.output?.callId === line.id);
  const lines = await linesIn(world.alice, helperA().id);
  const answer = lines.filter((l) => l.requestId === requestId && l.role === "assistant").at(-1);
  const requests = await world.alice.routes.requests(helperA().id);
  const made = requests.find((q) => q.id === requestId);
  const between = requests.filter((q) => q.id !== requestId && (q.actionName ?? q.action) === "respond" && made !== undefined && startOf(q) > startOf(made));
  r.notes.push(`a: Helper A's request ${requestId} went ${ended.seen.join(" > ") || "unread"}; its call answered ${show(call?.output)}; its last line: ${answer?.text.slice(0, 160) ?? "none"}`);
  if (ended.status !== "completed") {
    r.failures.push(`a:answer-in-request — the request that made the call never completed after the restart: it read ${ended.seen.join(" > ") || "nothing"} (a killed request the host never replays is a finding)`);
  } else if (call === undefined || call.output?.status !== "answered" || !String(call.output?.reply ?? "").includes(codename) || !String(answer?.text ?? "").includes(codename)) {
    r.failures.push(`a:answer-in-request — the replayed request didn't read the codename as its call's result and tell it: calls ${show(calls.map((c) => ({ args: c.args, output: c.output })))}; reply ${answer?.text.slice(0, 200) ?? "none"}`);
  }
  if (between.length > 0) r.failures.push(`a:answer-in-request — ${between.length} other line(s) from Alice ran in Helper A's conversation after the request that made the call`);

  // a:one-place — one row and one budget place for the call, crash and replay included.
  await quiet(world.alice, 180_000);
  const fresh = ((await logOf(world.alice)) as CallRow[]).filter((m) => !logBefore.has(m.id));
  const fromHelper = fresh.filter((m) => m.from === HELPER_A && m.to === RESEARCHER);
  const row = fresh.find((m) => m.id === line.id);
  if (fromHelper.length !== 1 || row === undefined || row.call !== true || row.hop !== 1) {
    r.failures.push(`a:one-place — the log holds ${fromHelper.length} row(s) from Helper A to Researcher since the line, the call's at hop ${String(row?.hop)}: ${show(fromHelper.map((m) => ({ id: m.id, hop: m.hop, call: m.call, status: m.status })))}`);
  }

  // a:no-relay — Researcher's turn sends nothing back; Helper A's conversation gains no received item from it.
  const heardIn = new Set((await requestsFor(world.alice, researcher().id, line.id)).map((q) => q.id));
  const sentBack = (await callsIn(world.alice, researcher().id)).filter((c) => c.requestId !== undefined && heardIn.has(c.requestId) && typeof c.output?.sent === "string");
  const gained = (await receivedIn(world.alice, helperA().id)).filter((m) => !receivedBefore.has(m.itemId) && m.from === RESEARCHER);
  if (sentBack.length > 0 || gained.length > 0) {
    r.failures.push(`a:no-relay — Researcher's turn on the call sent ${sentBack.length} message(s), and Helper A's conversation gained ${gained.length} received item(s) from Researcher`);
  }
  return r;
}

/** The midway questions a row has ever had, answered or not. */
const everAsked = (row: TaskRow | undefined): TaskRow[] => ((row?.questions ?? []) as TaskRow[]).filter((h) => h.source?.kind === "row" && h.midway === true);

/** Scene ed: a call parked while a midway question reaches its filer, and a ring runs on its own line. */
export async function sceneED(world: World, walked: Walked, run: { ring: boolean; question: boolean }): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice } = world;
  const helperA = world.conversation[HELPER_A]!;
  const researcher = world.conversation[RESEARCHER]!;
  const topic = word();
  const venue = word();
  const fyi = word();

  // Researcher's conversation stops for Alice, so the call to it parks until its deadline.
  const stopTurn = await act(alice, researcher.flowKind, researcher.id, "respond", {
    message: `Before anything else, call waitForUser with kind "approval" and prompt "May I publish the ${fyi} report?", and wait for my answer.`,
  });
  const stop = await until(async () => {
    const stops = (await alice.routes.items(researcher.id, "suspension")).filter((i) => i.requestId === stopTurn.requestId && i.reason === "user_approval");
    return stops.at(-1);
  }, 30_000, 1_000);
  if (stop === undefined) {
    r.failures.push(`e:heard-while-calling — setup: Researcher's turn opened no stop for Alice (${stopTurn.status})`);
    return stopped(r, "ed");
  }

  // Helper A's file tells it to answer a worker's question by message; a task's question is answered by
  // updateTask, so Alice gives it a standing rule first, through its own rules tool.
  const rule = await talkThrough(world, "e", HELPER_A, helperA, `Save this as a standing rule with rules_add, word for word: "When a task I filed asks me a question, I answer it only with updateTask (the task's id, the question's id as answers, the answer as message), never with sendMessage."`);
  const saved = (await alice.routes.items(helperA.id, "tool_output")).some((i) => i.requestId === rule.requestId && /^rules[_/]add$/.test(String(i.toolCall?.name)));
  if (!saved) r.notes.push(`e: Helper A saved no standing rule (${rule.status}): ${rule.reply.slice(0, 200)}`);

  const boardBefore = new Set((await boardOf(alice, helperA.flowKind, helperA.id)).map((t) => t.id));
  const logBefore = new Set((await logOf(alice)).map((m) => m.id));
  const words =
    `Do these in order, in this one turn. First, start ${HELPER_B} on a task with createTask, leaving the questions field out entirely (the task asks its own while it works), whose goal is, word for word: ` +
    `"Write a one-line welcome for the ${topic} gala that names its venue. You don't know the venue. Your first step is to call the askQuestion tool, asking the worker who filed this task for the venue; never finish without that tool call. Then write the line." ` +
    `Second, call sendMessage with to "${RESEARCHER}", text "What is seven times six? Answer with the number only.", wait: true and deadline: ${PARKED_CALL_MS}. ` +
    `Then tell me what you got. The ${topic} gala's venue is ${venue}. When ${HELPER_B}'s task asks you for it, answer only by calling updateTask with that task's id, the question's id as answers, and the venue as message. Don't message or call anyone about it.`;
  const requestId = (await alice.flow(helperA.flowKind).send("respond", { message: words }, { sessionId: helperA.id })).id;
  const watching = follow(alice, helperA.flowKind, requestId, PARKED_CALL_MS + 240_000);

  // Once Helper A's request parks on the call, the ring starts on its own line from Alice.
  let ringRequest: Promise<unknown> | undefined;
  let fanRequest: Promise<unknown> | undefined;
  const parked = await until(async () => ((await alice.flow(helperA.flowKind).request(requestId).status().catch(() => undefined))?.status === "suspended" ? true : undefined), 180_000, 500);
  if (parked === undefined) r.notes.push(`e: Helper A's request never read as parked within 180 s`);
  const ringWord = word();
  const ringBefore = new Set((await logOf(alice)).map((m) => m.id));
  if (run.ring) {
    ringRequest = talk(world.turns, "d", alice, RING_ONE, world.conversation[RING_ONE]!, `Start the ring now: message ${RING_TWO} with exactly this text: "ring ${ringWord}: pass this text on to the other ring worker with sendMessage."`);
    fanRequest = talk(world.turns, "d", alice, HERALD, world.conversation[HERALD]!, "Send a one-line hello message to every worker you can message, one message each. Don't skip anyone.");
  }

  const turn = await watching;
  const resumed = resumedAt(turn);
  const calls = (await callsIn(alice, helperA.id)).filter((c) => c.requestId === requestId && c.output != null && typeof c.output === "object");
  const call = calls.find((c) => isWait(c) && c.args.to === RESEARCHER);
  const callId = typeof call?.output?.callId === "string" ? (call.output.callId as string) : undefined;
  walked.parkedCall = callId;
  const callRow = ((await logOf(alice)) as CallRow[]).find((m) => m.id === callId);
  r.notes.push(`e: Helper A's request ${requestId} went ${turn.seen.join(" > ")}; its call ${callId} answered ${show(call?.output)}; sent ${callRow?.at}, deadline ${callRow?.deadlineAt}, went on ${resumed}`);

  // The task Helper A filed, and its midway question.
  const filed = (await boardOf(alice, helperA.flowKind, helperA.id)).find((t) => !boardBefore.has(t.id) && t.assignee === HELPER_B);
  if (filed === undefined) {
    for (const a of ["e:filer-hears", "e:heard-while-calling", "e:steer-releases"]) r.failures.push(`${a} — setup: Helper A filed Helper B no task: calls ${show(calls.map((c) => c.args))}`);
  } else if (run.question) {
    const taskId = String(filed.id);
    // The task read lists only open questions, so the question is caught while it is open.
    let question: TaskRow | undefined;
    const after = await until(async () => {
      const now = await rowOf(alice, helperA, taskId);
      question ??= everAsked(now)[0];
      return now !== undefined && TERMINAL.has(String(now.status)) ? now : undefined;
    }, 300_000, 1_000);
    const listed = after ?? (await rowOf(alice, helperA, taskId));
    // Steers show only on the task's own full read (getTask), not in the list.
    const full = (await alice.routes.act(helperA.flowKind, helperA.id, "getTask_tasks", { id: taskId })).output as { ok?: boolean; task?: TaskRow } | undefined;
    const final = listed === undefined ? undefined : ({ ...listed, steers: full?.ok === true ? full.task?.steers : undefined } as TaskRow);
    question ??= everAsked(final)[0];
    const heard = (await receivedIn(alice, helperA.id)).filter((m) => m.from === HELPER_B && m.text.includes(taskId));
    // Asked and answered between two polls: the question's id is in its message's id (`q:<task>:<hold>`), and in the steer that answered it.
    const told = heard.map((m) => /^q:[^:]+:(.+)$/.exec(String(m.id))?.[1]).find((id) => id !== undefined);
    const answered = ((final?.steers ?? []) as TaskRow[]).find((s) => typeof s.answers === "string")?.answers;
    question ??= (told ?? answered) !== undefined ? ({ id: told ?? answered } as TaskRow) : undefined;
    const heardRequests = await alice.routes.requests(helperA.id);
    const items = await alice.routes.items(helperA.id, "component");
    const heardItem = items.find((i) => i.id === heard[0]?.itemId) as Record<string, unknown> | undefined;
    const heardAction = heardRequests.find((q) => q.id === heard[0]?.requestId)?.actionName;
    r.notes.push(`e: task ${filed.id} ended ${final?.status} on attempt ${final?.attempts}; question ${question?.id ?? "none"}; ${heard.length} received item(s) about it, the first at ${tsOf(heardItem)} in ${heardAction ?? "?"}`);
    if (question === undefined) {
      // Nothing for e's other assertions to grade either: each says so, so none reads as a pass.
      for (const a of ["e:filer-hears", "e:heard-while-calling", "e:steer-releases"]) r.failures.push(`${a} — setup: Helper B's task never asked midway: ${final?.status}, questions ${show(final?.questions)}`);
    } else {
      // e:filer-hears — one received item from Helper B naming the task and the question, on onMessageReceived, in the filing session.
      if (heard.length !== 1 || !heard[0]!.text.includes(String(question.id)) || heardAction !== "onMessageReceived") {
        r.failures.push(`e:filer-hears — Helper A's conversation holds ${heard.length} message(s) from Helper B about ${filed.id}, not one naming ${question.id} heard on onMessageReceived: ${show(heard.map((m) => m.text.slice(0, 120)))}`);
      }
      // e:heard-while-calling — stored before the call resolved.
      const at = tsOf(heardItem);
      if (heard.length === 0 || !Number.isFinite(at) || resumed === undefined || !(at < resumed) || (callRow?.deadlineAt !== undefined && !(at < callRow.deadlineAt))) {
        r.failures.push(`e:heard-while-calling — the question was stored at ${at}, not before the parked call resolved (it went on at ${resumed}, deadline ${callRow?.deadlineAt})`);
      }
      // e:steer-releases — the filer's steer answers it, and the task finishes on attempt 1.
      const steers = ((final?.steers ?? []) as TaskRow[]).filter((s) => s.answers === question!.id);
      if (steers.length === 0 || steers[0]!.from !== "filer" || final?.status !== "completed" || final.attempts !== 1) {
        r.failures.push(`e:steer-releases — the task ended ${final?.status} on attempt ${final?.attempts}, steers ${show(final?.steers)}`);
      } else if (!String(steers[0]!.message).toLowerCase().includes(venue.toLowerCase())) {
        // Only Helper A was told the venue, in the line whose request is parked on the call.
        r.failures.push(`e:steer-releases — the filer's answer doesn't carry the venue it was told, ${venue}: ${show(steers[0]!.message)}`);
      } else if (!String(final.output?.text ?? show(final.output)).toLowerCase().includes(venue.toLowerCase())) {
        r.notes.push(`e: the task's output doesn't name ${venue}: ${show(final.output)}`);
      }
    }
  }

  // e:kept-once, first half — the deadline passed before Alice answered, so the call answered running.
  if (call === undefined || call.args.deadline !== PARKED_CALL_MS) {
    r.failures.push(`e:kept-once — Helper A made no call to Researcher with deadline ${PARKED_CALL_MS}: ${show(calls.map((c) => c.args))}`);
  } else if (call.output?.status !== "running" || call.output?.recipient !== "waiting_on_person") {
    r.failures.push(`e:kept-once — the parked call answered ${show(call.output)}, not running with the recipient waiting on a person`);
  }

  // d — the ring ran on its own line while the call was parked.
  if (run.ring) {
    const fan = (await fanRequest) as Awaited<ReturnType<typeof talk>>;
    await ringRequest;
    const fanSent = fan.calls.filter((c) => typeof c.output?.sent === "string");
    const fanRefused = fan.calls.filter((c) => errorOf(c).startsWith("per_request_limit"));
    if (fanSent.length !== 3 || fanRefused.length === 0) {
      r.failures.push(`d:per-request — the herald's turn sent ${fanSent.length} and had ${fanRefused.length} refused for the per-request limit; wanted 3 sent and the fourth refused: ${show(fan.calls.map((c) => ({ to: c.args.to, out: c.output })))}`);
    }
    const ringRows = async () => {
      const rows = ((await logOf(alice)) as CallRow[]).filter((m) => !ringBefore.has(m.id));
      const start = rows.find((m) => m.from === RING_ONE && m.to === RING_TWO && m.text.includes(ringWord));
      return { start, rows: start?.chain === undefined ? rows.filter((m) => m.text.includes(ringWord)) : rows.filter((m) => m.chain === start.chain) };
    };
    for (const end = Date.now() + 300_000; Date.now() < end; await sleep(5_000)) {
      if ((await ringRows()).rows.length >= 20 || (await quiet(alice, 10_000, 3_000))) break;
    }
    const { start, rows } = await ringRows();
    const sent = rows.filter((m) => m.status !== "refused").sort((a, b) => a.hop - b.hop);
    walked.ringIds = sent.map((m) => m.id);
    let refusal: Call | undefined;
    for (const id of [RING_ONE, RING_TWO]) {
      // The ring's own text, so a refusal in another exchange (the herald's fan reaches the ring too) can't stand in.
      refusal ??= (await callsIn(alice, world.conversation[id]!.id).catch((): Call[] => [])).find((c) => errorOf(c).startsWith("budget") && String(c.args.text ?? "").includes(ringWord));
    }
    if (refusal === undefined) {
      // The seventh may be sent from a session other than a ring worker's own conversation.
      for (const s of await alice.routes.sessions()) refusal ??= (await callsIn(alice, s.id).catch((): Call[] => [])).find((c) => errorOf(c).startsWith("budget") && String(c.args.text ?? "").includes(ringWord));
    }
    if (refusal !== undefined) walked.ringRefusal = { sessionId: refusal.sessionId, error: errorOf(refusal) };
    r.notes.push(`d: ring ${sent.map((m) => `${m.from}>${m.to}@${m.hop}`).join(", ")}; the seventh ${refusal === undefined ? "was never refused" : `refused in ${refusal.sessionId}: ${errorOf(refusal).slice(0, 120)}`}`);
    if (sent.length !== 6 || refusal === undefined) {
      r.failures.push(`d:seventh-refused — the ring's exchange holds ${sent.length} message(s)${sent.length === 6 ? "" : ", not 6"}${refusal === undefined ? ", and no seventh send was refused `budget`" : ""}`);
    }
    // Parked for certain: the request was seen suspended, and the ring's first row falls after the call's row and before
    // both the request went on and the call's deadline.
    const parkedUntil = resumed === undefined || callRow?.deadlineAt === undefined ? undefined : Math.min(resumed, callRow.deadlineAt);
    const overlap = parked !== undefined && callRow?.at !== undefined && start !== undefined && parkedUntil !== undefined && start.at > callRow.at && start.at < parkedUntil;
    if (!overlap) r.failures.push(`d:seventh-refused — setup: the ring didn't start while leg e's call was parked (seen parked ${parked === true}, ring ${start?.at}, call ${callRow?.at} to ${parkedUntil})`);
  }

  // e:kept-once, second half — Alice answers; Helper A waits again by call id and gets the reply, once.
  await alice.flow(researcher.flowKind).request(stopTurn.requestId!).answer({ suspensionId: String(stop.suspensionId), action: "approve" });
  await until(async () => ((await receivedIn(alice, researcher.id)).some((m) => m.id === callId) ? true : undefined), 180_000);
  await quiet(alice, 240_000);
  if (callId !== undefined) {
    const rowsBefore = new Set((await logOf(alice)).map((m) => m.id));
    const callBefore = ((await logOf(alice)) as CallRow[]).find((m) => m.id === callId);
    const kept = await talkThrough(world, "e", HELPER_A, helperA, `Your call ${callId} to ${RESEARCHER} asking what seven times six is answered running. Get its reply now: wait again on it by calling sendMessage with exactly {"callId": "${callId}"}: no wait, to or text field. Then tell me the reply.`);
    const again = kept.calls.find((c) => c.args.callId === callId);
    const after = (await logOf(alice)) as CallRow[];
    const newRows = after.filter((m) => !rowsBefore.has(m.id) && m.from === HELPER_A);
    const forCall = after.filter((m) => m.id === callId);
    if (again === undefined || again.output?.status !== "answered" || !String(again.output?.reply ?? "").includes("42")) {
      r.failures.push(`e:kept-once — Helper A didn't wait again with call ${callId} and get the reply: ${show(kept.calls.map((c) => ({ args: c.args, output: c.output })))}`);
    }
    if (newRows.length > 0 || forCall.length !== 1 || callBefore === undefined || forCall[0]!.hop !== callBefore.hop) {
      r.failures.push(`e:kept-once — waiting again wrote ${newRows.length} new row(s) (${show(newRows.map((m) => m.text.slice(0, 60)))}); the call has ${forCall.length} row(s), at hop ${forCall[0]?.hop} (was ${callBefore?.hop})`);
    }
    const sentSince = after.filter((m) => !logBefore.has(m.id) && m.from === HELPER_A && m.to === RESEARCHER);
    if (sentSince.length !== 1) r.failures.push(`e:kept-once — the log holds ${sentSince.length} row(s) from Helper A to Researcher since the line, not one: ${show(sentSince.map((m) => m.id))}`);
    r.notes.push(`e: waiting again answered ${show(again?.output)}`);
  }
  await quiet(alice, 240_000);
  return r;
}

/** Scene b: a message to Helper B's task while its turn runs, and one after it finished. */
export async function sceneB(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice } = world;
  const helperA = world.conversation[HELPER_A]!;
  const herald = world.conversation[HERALD]!;
  const fact = word();
  const taskId = await file(alice, helperA, {
    goal: `Remember this word for later: ${fact}. Then write a 700-word essay, in seven numbered sections, on why a team might pick it as a codename, and reply with the essay. (It is long so a message can reach you while you write.) You're done after that.`,
    assignee: HELPER_B,
  });
  const taskSession = await sessionOfTask(alice, helperA, taskId);
  if (taskSession === undefined) {
    r.failures.push(`b:in-task-session — setup: Helper B's task ${taskId} named no session within 180 s`);
    return stopped(r, "b");
  }
  const runningWhenSent = (await rowOf(alice, helperA, taskId))?.status;
  const first = await talk(world.turns, "b", alice, HERALD, herald, `Call sendMessage with exactly these arguments, as written: ${JSON.stringify({ to: { task: taskId }, text: "Herald here: a heads-up, no answer needed." })}. Report what the tool answered.`);
  const sent = first.calls.find((c) => (c.args.to as { task?: unknown } | undefined)?.task === taskId && typeof c.output?.sent === "string");
  const row = sent === undefined ? undefined : (await logOf(alice)).find((m) => m.id === sent.output.sent);
  if (sent === undefined || row?.toSession !== taskSession) {
    r.failures.push(`b:in-task-session — the message to task ${taskId} wasn't delivered to its session ${taskSession}: ${show(first.calls.map((c) => c.output))}; row ${show(row)}`);
  } else {
    const heard = await until(async () => (await receivedIn(alice, taskSession)).find((m) => m.id === sent.output.sent), 120_000);
    await quiet(alice, 240_000);
    const requests = await alice.routes.requests(taskSession);
    const heardRequest = requests.find((q) => q.id === heard?.requestId);
    const sessionItems = await alice.routes.items(taskSession, "");
    // Each request's span is read off its items, one clock: a deferred turn's record is written when it is queued.
    const itemsOf = (id: string | undefined) => sessionItems.filter((i) => i.requestId === id).map((i) => tsOf(i as Record<string, unknown>));
    const heardItems = itemsOf(heardRequest?.id);
    const heardRan = heardItems.length > 0 ? Math.min(...heardItems) : startOf(heardRequest ?? {});
    // The task's own turns, not other messages queued in its session.
    const taskTurns = requests.filter((q) => q.id !== heardRequest?.id && q.actionName !== "onMessageReceived" && startOf(q) < heardRan);
    const lastTaskEnd = Math.max(...taskTurns.map((q) => (itemsOf(q.id).length > 0 ? Math.max(...itemsOf(q.id)) : endOf(q))));
    // The message must have been sent while the task's turn ran, or this grades a finished task twice.
    if (taskTurns.length === 0 || !(Number((row as unknown as CallRow).at) < lastTaskEnd)) r.failures.push(`b:in-task-session — setup: the task's turn had ended (${lastTaskEnd}) before the first message was sent (${(row as unknown as CallRow).at})`);
    else if (heard === undefined || heardRequest === undefined) r.failures.push(`b:in-task-session — task ${taskId}'s session holds no received item for ${sent.output.sent}`);
    else if (taskTurns.length > 0 && !(heardRan >= lastTaskEnd)) r.failures.push(`b:in-task-session — the message's turn ran at ${heardRan}, before the task's turn ended at ${lastTaskEnd}`);
    r.notes.push(`b: the task was ${runningWhenSent} when the herald sent; the message's turn ran ${heardRan}, the task's turns ended ${lastTaskEnd}`);
  }
  const finished = await until(async () => {
    const now = await rowOf(alice, helperA, taskId);
    return now !== undefined && TERMINAL.has(String(now.status)) ? now : undefined;
  }, 240_000, 2_000);
  await quiet(alice, 180_000);
  const settled = (t: TaskRow | undefined) => JSON.stringify({ status: t?.status, attempts: t?.attempts, output: t?.output, session: t?.run?.sessionId });
  const settledBefore = settled(finished);
  // Only an answer after this send counts: the task's own output already names the fact.
  const linesBefore = (await linesIn(alice, taskSession)).length;
  const logBefore = new Set((await logOf(alice)).map((m) => m.id));
  const second = await talk(
    world.turns,
    "b",
    alice,
    HERALD,
    herald,
    `Call sendMessage with exactly these arguments, as written: ${JSON.stringify({ to: { task: taskId }, text: "Herald asking: which word were you told to remember in this task? Answer in one line." })}. Report what the tool answered.`,
  );
  if (!second.calls.some((c) => (c.args.to as { task?: unknown } | undefined)?.task === taskId && typeof c.output?.sent === "string")) {
    r.failures.push(`b:in-task-session — the message to finished task ${taskId} wasn't sent: ${show(second.calls.map((c) => c.output))}`);
  } else {
    const answered = await until(async () => {
      const inSession = (await linesIn(alice, taskSession)).slice(linesBefore).some((l) => l.role === "assistant" && l.text.includes(fact));
      const byMessage = (await logOf(alice)).some((m) => !logBefore.has(m.id) && m.from === HELPER_B && m.fromSession === taskSession && m.text.includes(fact));
      return inSession || byMessage ? true : undefined;
    }, 180_000);
    if (answered === undefined) r.failures.push(`b:in-task-session — the finished task's session never answered with ${fact} from its history`);
  }
  await quiet(alice, 180_000);
  const settledAfter = settled(await rowOf(alice, helperA, taskId));
  if (finished?.attempts !== 1 || settledBefore !== settledAfter) {
    r.failures.push(`b:task-unchanged — the row changed: ${settledBefore.slice(0, 500)} → ${settledAfter.slice(0, 500)}`);
  }
  return r;
}
