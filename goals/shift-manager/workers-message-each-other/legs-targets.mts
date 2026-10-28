/**
 * Legs 6, 7 and 8 (FIX-2160): a message to a task, to one of the user's
 * conversations by its id, and to the coder's task. Assertions are tagged
 * `<leg>:<name>`. See goal.md.
 *
 * The sender of every addressed message but one is the courier, a hire whose
 * instructions are to make exactly the call it is handed: a refusal is then
 * seen at the tool, not left to a model that rewrites a target it doesn't
 * recognise. Tasks are filed through the board's own action, not by a model.
 */
import {
  act,
  boardOf,
  callsIn,
  linesIn,
  logOf,
  quiet,
  rosterSessionOf,
  sleep,
  talk,
  until,
  word,
  COS,
  HIRE_MODEL,
  RESEARCHER,
  type Call,
  type Connected,
  type LegResult,
  type World,
} from "./legs.mts";

/** The courier: makes the sendMessage call it is handed, exactly. */
export const COURIER = "courier";
/** Hired, its conversation opened, then fired. */
export const FIRED = "fired-helper";
/** Hired on `agent`, its conversation opened, then moved to another flow. */
export const MOVED = "moved-helper";
/** DevTeam's coder, whose tasks are the only place it hears a message. */
export const CODER = "eng.coder";
/** The project the coder's answer task works in: Sandbox names no repository. */
const SANDBOX = { visibility: "shared" as const, id: "sandbox" };
/** The project whose coordinator conversation leg 7 messages, and DevTeam's coordinator for every project. */
const STOREFRONT = { visibility: "shared" as const, id: "storefront" };
const PROJECT_COORDINATOR = "project-coordinator";

type SessionSummary = { id: string; flowKind: string };
type TaskRow = Record<string, any>;

const ROSTER_FLOW = "workforce-roster";
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 500);
const errorOf = (c: Call) => String(c.output?.error ?? "");

/** What legs 6 to 8 add to the world: the courier, the coder's project, and the targets they open. */
export interface Targets {
  courier: SessionSummary;
  /** Bob's own conversation with his worker, which Alice's sends must not reach. */
  bobConversation: SessionSummary;
  fired: SessionSummary;
  moved: SessionSummary;
  /** Leg 6's Researcher task, once filed, and the session its run named. */
  researcherTask?: { id: string; sessionId: string };
  /** Researcher's ongoing session for the coordinator's conversation: a delegate's session. */
  delegateSession?: string;
}

/** Hire the courier and the two helpers, open their conversations, then fire one and move the other. */
export async function setupTargets(world: World): Promise<{ targets?: Targets; failures: string[] }> {
  const failures: string[] = [];
  const { alice, bob } = world;
  const roster = await rosterSessionOf(alice);
  const step = async (who: Connected, action: string, input: Record<string, unknown>) => {
    const done = await act(who, ROSTER_FLOW, who === alice ? roster : await rosterSessionOf(who), action, input, 60_000);
    if (done.status !== "completed") failures.push(`setup:${action} — ${who.person.label}'s ${action} of ${String(input.id)} ${done.status}: ${done.error ?? show(done.output)}`);
  };
  await step(alice, "hire", {
    id: COURIER,
    flow: "agent",
    description: "The courier: delivers messages exactly as told.",
    instructions:
      "You are the courier. When the user hands you sendMessage calls written as JSON, make each one exactly as written, " +
      "with exactly that `to` value (a string or an object, even if it isn't in your list of workers), one call each, in order. " +
      "Then report what the tool answered for each. Never change, skip or merge a call.",
    settings: { model: HIRE_MODEL },
  });
  for (const id of [FIRED, MOVED]) {
    await step(alice, "hire", { id, flow: "agent", description: `${id}: a short-lived teammate.`, instructions: "Answer briefly.", settings: { model: HIRE_MODEL } });
  }
  if (failures.length > 0) return { failures };
  const courier = await alice.workforce.ensureWorkerSession({ worker: COURIER });
  const fired = await alice.workforce.ensureWorkerSession({ worker: FIRED });
  const moved = await alice.workforce.ensureWorkerSession({ worker: MOVED });
  await step(alice, "fire", { id: FIRED });
  // Any other flow will do: the session was opened on `agent`.
  await step(alice, "edit", { id: MOVED, flow: world.conversation[COS]!.flowKind });
  const bobConversation = await bob.workforce.ensureWorkerSession({ worker: world.words.bobWorker });
  return failures.length > 0 ? { failures } : { targets: { courier, bobConversation, fired, moved }, failures };
}

/** Hand the courier `calls`, one sendMessage each, and read back the calls its turn made. */
async function deliver(world: World, targets: Targets, leg: string, calls: Array<{ to: unknown; text: string }>): Promise<Call[]> {
  const lines = calls.map((c) => JSON.stringify(c)).join("\n");
  const turn = await talk(world.turns, leg, world.alice, COURIER, targets.courier, `Make these sendMessage calls, exactly:\n${lines}`);
  return turn.calls;
}

/** The courier's calls to one target, matched by its `to` value. */
const callsTo = (calls: readonly Call[], to: unknown) => calls.filter((c) => JSON.stringify(c.args.to) === JSON.stringify(to));

/** One row on a conversation's board, by id, as the board's read returns it. */
async function rowOf(who: Connected, conversation: SessionSummary, id: string): Promise<TaskRow | undefined> {
  return (await boardOf(who, conversation.flowKind, conversation.id)).find((row) => row.id === id);
}

/** File a task on a conversation's board through the board's own action. */
async function file(who: Connected, conversation: SessionSummary, init: Record<string, unknown>): Promise<string> {
  const filed = await act(who, conversation.flowKind, conversation.id, "createTask_tasks", init, 60_000);
  const id = (filed.output?.taskId ?? filed.output?.id) as string | undefined;
  if (filed.status !== "completed" || filed.output?.ok === false || id === undefined) {
    throw new Error(`filing ${show(init)} on ${conversation.id}: ${filed.status} ${filed.error ?? show(filed.output)}`);
  }
  return id;
}

/** Wait until a task's run names its session, and return it. */
async function sessionOfTask(who: Connected, conversation: SessionSummary, id: string, timeoutMs = 180_000): Promise<string | undefined> {
  return until(async () => {
    const session = (await rowOf(who, conversation, id))?.run?.sessionId;
    return typeof session === "string" ? session : undefined;
  }, timeoutMs, 1_000);
}

/** The parts of a row a message must not change. */
const settledOf = (row: TaskRow | undefined) => show({ status: row?.status, attempts: row?.attempts, output: row?.output, error: row?.error, session: row?.run?.sessionId });

/** A request's start and end, in ms, whichever names the route uses. */
const startOf = (r: Record<string, any>) => Number(r.startedAtMs ?? r.startedAt ?? r.createdAtMs ?? r.createdAt ?? Number.NaN);
const endOf = (r: Record<string, any>) => Number(r.completedAtMs ?? r.completedAt ?? r.updatedAtMs ?? r.updatedAt ?? Number.NaN);

/** Leg 6: to a task. Lands in the session its run named, after its turn, and changes nothing about it. */
export async function leg6(world: World, targets: Targets): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, bob } = world;
  const cos = world.conversation[COS]!;
  const fact = word();
  const added = await act(alice, cos.flowKind, cos.id, "addDelegate", { worker: RESEARCHER }, 60_000);
  if (added.status !== "completed") r.notes.push(`addDelegate researcher: ${added.status} ${added.error ?? ""}`);

  const taskId = await file(alice, cos, {
    goal: `Remember this word for later: ${fact}. Then reply "Noted" and you're done.`,
    assignee: RESEARCHER,
  });
  const taskSession = await sessionOfTask(alice, cos, taskId);
  if (taskSession === undefined) {
    r.failures.push(`6:setup — Researcher's task ${taskId} named no session within 180 s`);
    return r;
  }
  targets.researcherTask = { id: taskId, sessionId: taskSession };
  const runningWhenSent = (await rowOf(alice, cos, taskId))?.status;
  const before = new Set((await logOf(alice)).map((m) => m.id));
  const first = await deliver(world, targets, "6", [{ to: { task: taskId }, text: "Courier here: a heads-up, no answer needed." }]);
  const sent = callsTo(first, { task: taskId }).find((c) => typeof c.output?.sent === "string");
  const row = sent === undefined ? undefined : (await logOf(alice)).find((m) => m.id === sent.output.sent);
  if (sent === undefined || row?.toSession !== taskSession) {
    r.failures.push(`6:lands-in-task-session — the message to task ${taskId} wasn't delivered to its session ${taskSession}: ${show(first.map((c) => c.output))}; row ${show(row)}`);
  } else {
    // A received item there, and the turn that hears it starts after the task's turn ended.
    const received = await until(async () => (await linesIn(alice, taskSession)).find((l) => l.agentName === COURIER && l.text.startsWith(`From ${COURIER}: `)), 120_000);
    await quiet(alice, 240_000);
    const requests = await alice.routes.requests(taskSession);
    const heard = requests.find((q) => q.id === received?.requestId);
    // A deferred turn's record is written when it is queued, so its
    // `startedAtMs` is that time. It ran when its first item was written.
    const heardItems = (await alice.routes.items(taskSession, "")).filter((i) => i.requestId === heard?.id);
    const heardRan = heardItems.length > 0 ? Math.min(...heardItems.map((i) => Number((i as { ts?: unknown }).ts))) : startOf(heard ?? {});
    const taskTurns = requests.filter((q) => q.id !== received?.requestId && startOf(q) < heardRan);
    const lastTaskEnd = Math.max(...taskTurns.map(endOf));
    if (received === undefined || heard === undefined) {
      r.failures.push(`6:lands-in-task-session — task ${taskId}'s session shows no line from the courier`);
    } else if (taskTurns.length > 0 && !(heardRan >= lastTaskEnd)) {
      r.failures.push(`6:lands-in-task-session — the message's turn ran at ${heardRan}, before the task's turn ended at ${lastTaskEnd}`);
    }
    r.notes.push(`the task was ${runningWhenSent} when the courier sent; the message's turn ${heard?.id} was queued ${startOf(heard ?? {})} and ran ${heardRan}, the task's turns ended ${lastTaskEnd}`);
  }
  await quiet(alice, 240_000);

  // Once finished: the turn runs in the task's session, with its earlier lines.
  const finished = await until(async () => {
    const now = await rowOf(alice, cos, taskId);
    return now !== undefined && ["completed", "failed", "cancelled", "errored"].includes(String(now.status)) ? now : undefined;
  }, 240_000, 2_000);
  const settled = settledOf(finished);
  const second = await deliver(world, targets, "6", [
    { to: { task: taskId }, text: `Courier asking: which word were you told to remember in this task? Answer the courier with sendMessage.` },
  ]);
  if (!callsTo(second, { task: taskId }).some((c) => typeof c.output?.sent === "string")) {
    r.failures.push(`6:finished-keeps-history — the message to finished task ${taskId} wasn't sent: ${show(second.map((c) => c.output))}`);
  } else {
    const answered = await until(async () => {
      const inSession = (await linesIn(alice, taskSession)).some((l) => l.role === "assistant" && l.agentName !== COURIER && l.text.includes(fact));
      const byMessage = (await logOf(alice)).some((m) => !before.has(m.id) && m.from === RESEARCHER && m.fromSession === taskSession && m.text.includes(fact));
      return inSession || byMessage ? true : undefined;
    }, 240_000);
    if (answered === undefined) r.failures.push(`6:finished-keeps-history — no answer from task ${taskId}'s session names ${fact}, the word only its earlier lines hold`);
  }
  await quiet(alice, 240_000);
  const after = settledOf(await rowOf(alice, cos, taskId));
  if (finished === undefined || after !== settled) r.failures.push(`6:task-unchanged — the row went from ${settled} to ${after}`);

  // Not started, an unknown id, Bob's task and its own: each refused, no row.
  const pending = await file(alice, cos, { goal: "Wait; this task is held.", assignee: RESEARCHER, held: true });
  const unknown = `task_${word()}`;
  const bobCos = await bob.workforce.ensureWorkerSession({ worker: COS });
  await act(bob, bobCos.flowKind, bobCos.id, "addDelegate", { worker: world.words.bobWorker }, 60_000);
  const bobTask = await file(bob, bobCos, { goal: "Say hello, then you're done.", assignee: world.words.bobWorker });
  const bobStarted = await sessionOfTask(bob, bobCos, bobTask, 120_000);
  const logBefore = (await logOf(alice)).length;
  const refusals = await deliver(world, targets, "6", [
    { to: { task: pending }, text: "hello pending" },
    { to: { task: unknown }, text: "hello unknown" },
    { to: { task: bobTask }, text: "hello Bob's task" },
  ]);
  const refusedAs = (id: string) => callsTo(refusals, { task: id }).map(errorOf);
  const pendingOut = refusedAs(pending);
  if (pendingOut.length === 0 || !pendingOut.every((e) => e.startsWith("no_task_session"))) r.failures.push(`6:not-started — the held task's message: ${show(pendingOut)}`);
  const unknownOut = refusedAs(unknown);
  const bobOut = refusedAs(bobTask);
  const same = (a: string, b: string, idA: string, idB: string) => a.replaceAll(idA, "<id>") === b.replaceAll(idB, "<id>");
  if (bobOut.length === 0 || unknownOut.length === 0 || !bobOut.every((e) => e.startsWith("no_task_session") && same(e, unknownOut[0]!, bobTask, unknown))) {
    r.failures.push(`6:bobs-task — Bob's task (started: ${bobStarted !== undefined}) wasn't refused exactly as an unknown id: Bob's ${show(bobOut)}, unknown ${show(unknownOut)}`);
  }
  if ((await logOf(alice)).length !== logBefore) r.failures.push(`6:not-started — the refused sends wrote ${(await logOf(alice)).length - logBefore} row(s)`);

  // From the task's own session, to its own task: a follow-up runs there.
  await file(alice, cos, {
    goal: `Call sendMessage with to {"task":"${taskId}"} and text "hello myself", exactly, then report what the tool answered.`,
    followUpOf: taskId,
  });
  await quiet(alice, 240_000);
  const own = callsTo(await callsIn(alice, taskSession), { task: taskId });
  if (own.length === 0 || !own.every((c) => errorOf(c).startsWith("not_yourself"))) {
    r.failures.push(`6:own-task — the task session's calls to its own task weren't all refused not_yourself: ${show(own.map((c) => c.output))}`);
  }
  r.notes.push(`refusals ${show({ pending: pendingOut, unknown: unknownOut, bob: bobOut })}`);
  // A task run in Researcher's ongoing session for this conversation opens its delegate session, which leg 7 addresses.
  const ongoing = await file(alice, cos, { goal: "Reply OK, and you're done.", assignee: RESEARCHER, session: "ongoing" });
  targets.delegateSession = await sessionOfTask(alice, cos, ongoing);
  await quiet(alice, 240_000);
  const removed = await act(alice, cos.flowKind, cos.id, "removeDelegate", { worker: RESEARCHER }, 60_000);
  if (removed.status !== "completed") r.notes.push(`removeDelegate researcher: ${removed.status}`);
  return r;
}

/** Leg 7: to a conversation by its id. Lands in the user's own; every other session is refused, with no row. */
export async function leg7(world: World, targets: Targets): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const researcher = world.conversation[RESEARCHER]!;
  // A second conversation with Researcher, opened as Shift Manager opens one.
  const second = `conv_goal_${word()}`;
  await alice.flow(researcher.flowKind).createSession({ sessionId: second, state: { workerId: RESEARCHER } } as never);
  const note = word();
  const told = await talk(turns, "7", alice, RESEARCHER, researcher, `Call sendMessage with to {"session":"${second}"} and text "Note: ${note}", exactly. That is your own other conversation.`);
  const landed = await until(async () => (await linesIn(alice, second)).find((l) => l.agentName === RESEARCHER && l.text.includes(note)), 120_000);
  if (landed === undefined) r.failures.push(`7:second-conversation — Researcher's second conversation shows no line holding ${note}: ${show(told.calls.map((c) => ({ to: c.args.to, out: c.output })))}`);

  const project = await alice.workforce.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: STOREFRONT } as never);
  const projectWord = word();
  const toProject = await deliver(world, targets, "7", [{ to: { session: project.id }, text: `Project note: ${projectWord}` }]);
  const projectLanded = await until(async () => (await linesIn(alice, project.id)).find((l) => l.agentName === COURIER && l.text.includes(projectWord)), 120_000);
  if (projectLanded === undefined) r.failures.push(`7:project-conversation — the Storefront project coordinator's conversation ${project.id} shows no line from the courier: ${show(toProject.map((c) => c.output))}`);
  await quiet(alice, 240_000);

  // Each session a { session } must not reach: the reason, and no row.
  const refused: Array<{ what: string; session: string; reason: string }> = [
    { what: "Bob's conversation", session: targets.bobConversation.id, reason: "no_session" },
    { what: "a fired worker's conversation", session: targets.fired.id, reason: "no_worker" },
    { what: "a moved worker's conversation", session: targets.moved.id, reason: "worker_unavailable" },
    { what: "the sending conversation", session: targets.courier.id, reason: "not_yourself" },
  ];
  if (targets.researcherTask !== undefined) refused.push({ what: "a task's session", session: targets.researcherTask.sessionId, reason: "not_a_conversation" });
  if (targets.delegateSession !== undefined) refused.push({ what: "a delegate session", session: targets.delegateSession, reason: "not_a_conversation" });
  else r.failures.push("7:refusals — leg 6 opened no delegate session to try");
  const before = (await logOf(alice)).filter((m) => refused.some((x) => x.session === m.toSession)).length;
  const calls = await deliver(world, targets, "7", refused.map((x) => ({ to: { session: x.session }, text: `hello ${x.what}` })));
  for (const x of refused) {
    const outs = callsTo(calls, { session: x.session }).map(errorOf);
    if (outs.length === 0 || !outs.every((e) => e.startsWith(x.reason))) r.failures.push(`7:refusals — ${x.what} (${x.session}) wasn't refused ${x.reason}: ${show(outs)}`);
  }
  const after = (await logOf(alice)).filter((m) => refused.some((x) => x.session === m.toSession)).length;
  if (after !== before) r.failures.push(`7:refusals — the refused sessions gained ${after - before} row(s)`);
  r.notes.push(`refusals tried: ${refused.map((x) => x.what).join(", ")}`);
  return r;
}

/** Leg 8: to the coder's task. A finished one is answered from its coding session; a running one is refused. */
export async function leg8(world: World, targets: Targets): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice } = world;
  const cos = world.conversation[COS]!;
  // `Shipped` types only the client verbs the older legs drive.
  const workforce = alice.workforce as typeof alice.workforce & {
    setWorkProject(worker: string, project: typeof SANDBOX, options: { sessionId: string }): Promise<unknown>;
  };
  await workforce.setWorkProject(COS, SANDBOX, { sessionId: cos.id }).catch((e: unknown) => r.notes.push(`setWorkProject: ${String(e)}`));
  const added = await act(alice, cos.flowKind, cos.id, "addDelegate", { worker: CODER }, 60_000);
  if (added.status !== "completed") r.notes.push(`addDelegate ${CODER}: ${added.status} ${added.error ?? ""}`);

  // A finished task: the message is answered by one run resuming its coding session.
  const done = await file(alice, cos, { goal: "Write a short note on what a scripted run does.", assignee: CODER });
  const doneSession = await sessionOfTask(alice, cos, done);
  const ended = await until(async () => {
    const now = await rowOf(alice, cos, done);
    return now !== undefined && ["completed", "failed", "cancelled", "errored"].includes(String(now.status)) ? now : undefined;
  }, 300_000, 2_000);
  if (doneSession === undefined || ended === undefined) {
    r.failures.push(`8:finished-answered — the coder's task ${done} didn't run to an end: ${show(await rowOf(alice, cos, done))}`);
  } else {
    const settled = settledOf(ended);
    const linesBefore = (await linesIn(alice, doneSession)).length;
    const asked = await deliver(world, targets, "8", [{ to: { task: done }, text: "What did you write?" }]);
    const sent = callsTo(asked, { task: done }).find((c) => typeof c.output?.sent === "string");
    await quiet(alice, 300_000);
    const lines = (await linesIn(alice, doneSession)).slice(linesBefore);
    const heardAt = lines.findIndex((l) => l.agentName === COURIER);
    const answer = heardAt < 0 ? undefined : lines.slice(heardAt + 1).find((l) => l.role === "assistant" && l.agentName !== COURIER);
    if (sent === undefined || answer === undefined) {
      r.failures.push(`8:finished-answered — no answer in the coding task's session after the message: sent ${show(asked.map((c) => c.output))}; new lines ${show(lines.map((l) => `${l.agentName ?? l.role}: ${l.text.slice(0, 60)}`))}`);
    }
    const after = settledOf(await rowOf(alice, cos, done));
    if (after !== settled) r.failures.push(`8:finished-answered — the coder's row changed: ${settled} to ${after}`);
    if (answer !== undefined) r.notes.push(`the coding session answered: ${answer.text.slice(0, 120)}`);
  }

  // A running task: refused before the row.
  const running = await file(alice, cos, { goal: "Write another short note.", assignee: CODER });
  const runningSession = await sessionOfTask(alice, cos, running, 120_000);
  const status = (await rowOf(alice, cos, running))?.status;
  const logBefore = (await logOf(alice)).length;
  const refused = await deliver(world, targets, "8", [{ to: { task: running }, text: "Are you done yet?" }]);
  const outs = callsTo(refused, { task: running }).map(errorOf);
  if (runningSession === undefined || outs.length === 0 || !outs.every((e) => e.startsWith("task_running"))) {
    r.failures.push(`8:running-refused — the message to the coder's running task (${status}) wasn't refused task_running: ${show(refused.map((c) => c.output))}`);
  }
  if ((await logOf(alice)).length !== logBefore) r.failures.push(`8:running-refused — the send wrote a row`);
  await quiet(alice, 300_000);
  await sleep(1_000);
  const removed = await act(alice, cos.flowKind, cos.id, "removeDelegate", { worker: CODER }, 60_000);
  if (removed.status !== "completed") r.notes.push(`removeDelegate ${CODER}: ${removed.status}`);
  return r;
}

