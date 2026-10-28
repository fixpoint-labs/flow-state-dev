/**
 * Leg 9 (FIX-2240): a message lands once. Each sub-leg has the herald message
 * a worker with a held-out word, on a server started with one fault
 * (`faults.mts`), and reads the result back from the store. Assertions are
 * tagged `9:<sub-leg>`. See goal.md.
 *
 * "Took it" is read the same way everywhere: the recipient's conversation
 * holds exactly one received item for the id, one `onMessageReceived` request
 * got past the take for it (it holds that item), and the row is `delivered`
 * with `deliveredAs` naming that request.
 */
import { writeFileSync } from "node:fs";
import { faultLines, LATE_COPY_FROM, type FaultLine, type FaultName } from "./faults.mts";
import {
  act,
  linesIn,
  logOf,
  receivedIn,
  rosterSessionOf,
  sleep,
  talk,
  until,
  word,
  HELPER_B,
  HERALD,
  HIRE_MODEL,
  type Connected,
  type LegResult,
  type World,
} from "./legs.mts";

export const SUB_LEGS = ["crash-after-row", "resent", "lost-after-accept", "seen-once", "crash-after-take", "late-refusal"] as const;
export type SubLeg = (typeof SUB_LEGS)[number];

/** Hired for 9:late-refusal and fired mid-leg, so Helper B stays on the roster for every other leg. */
export const LATE_HELPER = "late-helper";
/** The block name the pass's resend is dispatched from (`MESSAGE_RESEND_FROM`). */
const RESEND_FROM = "worker-message-resend";
const RECEIVED_ENTRY = "onMessageReceived";
const ROSTER_FLOW = "workforce-roster";
/** Every send here is a plain message: a call (FIX-2239) parks the herald's turn on the reply, which no sub-leg grades. */
const NO_WAIT = "Send it as a plain message: don't wait for a reply.";
/** How long a takeover from a crashed taker may take: the engine's stale-heartbeat window, then one backoff step (32 s). */
const TAKEOVER_MS = 120_000;

type SessionSummary = { id: string; flowKind: string };
type Request = Record<string, any>;
type MessageRow = Record<string, any>;

/** What the runner lends leg 9: servers it can restart with a fault, and the fault log. */
export interface Servers {
  /** Stop the running server and start one on the same store with `faults` (none: as shipped). The world's clients follow it. */
  restart(faults: readonly FaultName[], label: string): Promise<void>;
  /** Whether the running server exits on its own within `timeoutMs`. */
  crashed(timeoutMs: number): Promise<boolean>;
  /** The fault log's path. */
  faultLog: string;
  /** The file whose presence releases `hold-resend`. */
  release: string;
}

/** The fault lines `fault` wrote since `since`. */
const fired = (servers: Servers, fault: FaultName, since: number): FaultLine[] => faultLines(servers.faultLog).filter((l) => l.fault === fault && l.at >= since);

/** The `onMessageReceived` requests for message `id` in `sessionId`, oldest first. */
async function requestsFor(who: Connected, sessionId: string, id: string): Promise<Request[]> {
  return (await who.routes.requests(sessionId))
    .filter((r) => (r.actionName ?? r.action) === RECEIVED_ENTRY && r.input?.messageId === id)
    .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
}

/** The block a request's dispatch stamp names as its sender, and the session it came from. */
const senderOf = (r: Request | undefined) => ({
  block: r?.metadata?.dispatch?.from?.block as string | undefined,
  session: r?.metadata?.dispatch?.from?.sessionId as string | undefined,
});

/** Message `id`'s row in the person's log. */
async function rowOf(who: Connected, id: string): Promise<MessageRow | undefined> {
  return ((await logOf(who)) as unknown as MessageRow[]).find((m) => m.id === id);
}

/** What a reader of "took it" needs: the row, its received items, and the requests for it. */
interface Took {
  ok: boolean;
  why: string;
  row: MessageRow | undefined;
  requests: Request[];
  delivering: Request | undefined;
}

/** Whether the recipient took message `id`, as the file header defines it. */
async function took(who: Connected, id: string): Promise<Took> {
  const row = await rowOf(who, id);
  if (row === undefined) return { ok: false, why: `no row for ${id}`, row, requests: [], delivering: undefined };
  const items = (await receivedIn(who, row.toSession)).filter((m) => m.id === id);
  const requests = await requestsFor(who, row.toSession, id);
  const holding = new Set(items.map((m) => m.requestId));
  const delivering = requests.find((r) => r.id === row.deliveredAs);
  const facts = `row ${row.status}${row.deliveredAs === undefined ? "" : ` as ${row.deliveredAs}`}, ${items.length} received item(s) in ${holding.size} request(s), ${requests.length} request(s) for it`;
  const ok = row.status === "delivered" && items.length === 1 && holding.size === 1 && holding.has(row.deliveredAs) && delivering !== undefined;
  return { ok, why: facts, row, requests, delivering };
}

/** Poll {@link took} until it holds, or the last reading after `timeoutMs`. */
async function tookWithin(who: Connected, id: string, timeoutMs: number): Promise<Took> {
  const got = await until(async () => {
    const t = await took(who, id);
    return t.ok ? t : undefined;
  }, timeoutMs);
  return got ?? (await took(who, id));
}

/** Send `words` to the herald and don't wait on the turn: the server may die in it. */
async function sendLine(who: Connected, session: SessionSummary, words: string): Promise<string | null> {
  try {
    return (await who.flow(session.flowKind).send("respond", { message: words }, { sessionId: session.id })).id;
  } catch {
    return null;
  }
}

/** The one fault line `fault` wrote for this sub-leg, or a setup failure. */
function oneFired(servers: Servers, fault: FaultName, since: number, sub: SubLeg, r: LegResult): FaultLine | undefined {
  const lines = fired(servers, fault, since);
  if (lines.length === 0) {
    r.failures.push(`9:${sub} — setup: the ${fault} fault never fired, so this sub-leg shows nothing`);
    return undefined;
  }
  return lines[0];
}

/** Leg 9: the six sub-legs named in `subLegs`, each on its own server. */
export async function leg9(world: World, servers: Servers, subLegs: ReadonlySet<SubLeg>): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const herald = () => world.conversation[HERALD]!;
  const helperB = () => world.conversation[HELPER_B]!;
  const say = world.say;
  const sub = async (name: SubLeg, run: () => Promise<void>) => {
    if (!subLegs.has(name)) return;
    say(`leg 9:${name}`);
    try {
      await run();
    } catch (error) {
      r.failures.push(`9:${name} — threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  };

  // ---- 9:crash-after-row ---------------------------------------------------
  await sub("crash-after-row", async () => {
    const since = Date.now();
    const w = word();
    await servers.restart(["exit-after-row"], "9-exit-after-row");
    await sendLine(world.alice, herald(), `Message the worker ${HELPER_B} saying "${w}". ${NO_WAIT}`);
    if (!(await servers.crashed(240_000))) {
      r.failures.push(`9:crash-after-row — setup: the server didn't exit within 240 s of the herald's line`);
      return;
    }
    const line = oneFired(servers, "exit-after-row", since, "crash-after-row", r);
    await servers.restart([], "9-after-row");
    if (line === undefined) return;
    const t = await tookWithin(world.alice, line.id, 60_000);
    const stamp = senderOf(t.delivering);
    r.notes.push(`9:crash-after-row ${line.id}: ${t.why}; delivered from ${stamp.block ?? "?"} in ${stamp.session ?? "?"}`);
    if (!t.ok) r.failures.push(`9:crash-after-row — within 60 s of the restart Helper B hadn't taken ${line.id}: ${t.why}`);
    else if (stamp.block !== RESEND_FROM || stamp.session !== herald().id) {
      r.failures.push(`9:crash-after-row — ${line.id} was delivered by a request ${stamp.block ?? "nothing"} sent from ${stamp.session ?? "?"}, not the herald's pass (${RESEND_FROM} from ${herald().id})`);
    }
  });

  // ---- 9:resent -------------------------------------------------------------
  await sub("resent", async () => {
    const since = Date.now();
    const w = word();
    await servers.restart(["fast-path-throws"], "9-fast-path-throws");
    const turn = await talk(world.turns, "9", world.alice, HERALD, herald(), `Message the worker ${HELPER_B} saying "${w}". ${NO_WAIT}`);
    const line = oneFired(servers, "fast-path-throws", since, "resent", r);
    if (line === undefined) return;
    const answered = turn.calls.find((c) => c.output?.sent === line.id);
    if (answered === undefined) r.failures.push(`9:resent — the tool didn't answer { sent: "${line.id}" }: ${JSON.stringify(turn.calls.map((c) => c.output)).slice(0, 300)}`);
    const t = await tookWithin(world.alice, line.id, 60_000);
    const stamp = senderOf(t.delivering);
    r.notes.push(`9:resent ${line.id}: ${t.why}; resent ${t.row?.resent?.n ?? 0}; delivered from ${stamp.block ?? "?"}`);
    if (!t.ok) r.failures.push(`9:resent — within 60 s Helper B hadn't taken ${line.id}: ${t.why}`);
    else if (stamp.block !== RESEND_FROM) r.failures.push(`9:resent — ${line.id} was delivered from ${stamp.block ?? "nothing"}, not the pass's resend`);
    if (t.ok && !((t.row?.resent?.n ?? 0) >= 1)) r.failures.push(`9:resent — ${line.id}'s row records no resend`);
  });

  // ---- 9:lost-after-accept --------------------------------------------------
  await sub("lost-after-accept", async () => {
    const since = Date.now();
    const w = word();
    await servers.restart(["lose-first-take"], "9-lose-first-take");
    await talk(world.turns, "9", world.alice, HERALD, herald(), `Message the worker ${HELPER_B} saying "${w}". ${NO_WAIT}`);
    const line = oneFired(servers, "lose-first-take", since, "lost-after-accept", r);
    if (line === undefined) return;
    const t = await tookWithin(world.alice, line.id, 60_000);
    r.notes.push(`9:lost-after-accept ${line.id}: ${t.why}; lost ${line.request}, delivered ${t.row?.deliveredAs ?? "?"}; resent ${t.row?.resent?.n ?? 0}`);
    if (!t.ok) r.failures.push(`9:lost-after-accept — within 60 s Helper B hadn't taken ${line.id}: ${t.why}`);
    else if (t.row?.deliveredAs === line.request || t.requests[0]?.id === t.row?.deliveredAs) {
      r.failures.push(`9:lost-after-accept — ${line.id} was delivered by the first request, the one the fault lost`);
    }
    if (t.ok && !((t.row?.resent?.n ?? 0) >= 1)) r.failures.push(`9:lost-after-accept — ${line.id}'s row records no resend`);
  });

  // ---- 9:seen-once ----------------------------------------------------------
  await sub("seen-once", async () => {
    const since = Date.now();
    const [w1, w2] = [word(), word()];
    await servers.restart(["late-copy"], "9-late-copy");
    const turn = await talk(
      world.turns,
      "9",
      world.alice,
      HERALD,
      herald(),
      `Send the worker ${HELPER_B} two separate messages, one after the other: first "${w1}", then "${w2}". ${NO_WAIT}`,
    );
    const ids = turn.calls.flatMap((c) => (c.args.to === HELPER_B && typeof c.output?.sent === "string" ? [c.output.sent as string] : []));
    if (ids.length < 2) {
      r.failures.push(`9:seen-once — setup: the herald sent ${ids.length} message(s) to Helper B, not two: ${turn.reply.slice(0, 200)}`);
      return;
    }
    const copied = await until(async () => fired(servers, "late-copy", since)[0], 90_000);
    if (copied === undefined) {
      r.failures.push(`9:seen-once — setup: the late-copy fault never fired, so this sub-leg shows nothing`);
      return;
    }
    // The copy's request: wait for it to end before reading what it left.
    const copy = await until(async () => {
      const found = (await requestsFor(world.alice, helperB().id, copied.id)).find((q) => senderOf(q).block === LATE_COPY_FROM);
      return found !== undefined && !["pending", "queued", "in_progress", "running"].includes(String(found.status)) ? found : undefined;
    }, 120_000);
    for (const id of ids.slice(0, 2)) {
      const t = await tookWithin(world.alice, id, 60_000);
      r.notes.push(`9:seen-once ${id}: ${t.why}`);
      if (!t.ok) r.failures.push(`9:seen-once — ${id}: ${t.why}`);
    }
    if (copy === undefined) {
      r.failures.push(`9:seen-once — the late copy of ${copied.id} has no ended request in Helper B's conversation`);
      return;
    }
    const itemsInCopy = (await receivedIn(world.alice, helperB().id)).filter((m) => m.requestId === copy.id).length + (await linesIn(world.alice, helperB().id)).filter((l) => l.requestId === copy.id).length;
    r.notes.push(`9:seen-once copy of ${copied.id}: request ${copy.id} ${copy.status}, ${itemsInCopy} item(s)`);
    if (copy.status !== "completed" || itemsInCopy > 0) r.failures.push(`9:seen-once — the late copy of ${copied.id} (request ${copy.id}) ended ${copy.status} with ${itemsInCopy} item(s), not at the take with none`);
  });

  // ---- 9:crash-after-take ---------------------------------------------------
  await sub("crash-after-take", async () => {
    const since = Date.now();
    const w = word();
    await servers.restart(["exit-after-take"], "9-exit-after-take");
    await sendLine(world.alice, herald(), `Message the worker ${HELPER_B} saying "${w}". ${NO_WAIT}`);
    if (!(await servers.crashed(240_000))) {
      r.failures.push(`9:crash-after-take — setup: the server didn't exit within 240 s of the herald's line`);
      return;
    }
    const line = oneFired(servers, "exit-after-take", since, "crash-after-take", r);
    await servers.restart([], "9-after-take");
    if (line === undefined) return;
    // The copies sent while the crashed taker still reads as running find it busy; the engine marks it
    // interrupted once its heartbeat goes stale (about 60 s), and the next resend on the backoff takes over.
    const t = await tookWithin(world.alice, line.id, TAKEOVER_MS);
    r.notes.push(`9:crash-after-take ${line.id}: ${t.why}; crashed ${line.request}, delivered ${t.row?.deliveredAs ?? "?"}`);
    if (!t.ok) r.failures.push(`9:crash-after-take — within ${TAKEOVER_MS / 1000} s of the restart Helper B hadn't taken ${line.id}: ${t.why}`);
    else if (t.row?.deliveredAs === line.request) r.failures.push(`9:crash-after-take — ${line.id} was delivered by the request the crash interrupted`);
  });

  // ---- 9:late-refusal -------------------------------------------------------
  await sub("late-refusal", async () => {
    const roster = await rosterSessionOf(world.alice);
    const hired = await act(world.alice, ROSTER_FLOW, roster, "hire", {
      id: LATE_HELPER,
      flow: "agent",
      description: `${LATE_HELPER}: a short-lived teammate.`,
      instructions: "Answer briefly.",
      settings: { model: HIRE_MODEL },
    }, 60_000);
    if (hired.status !== "completed") {
      r.failures.push(`9:late-refusal — setup: the hire of ${LATE_HELPER} ${hired.status}: ${hired.error ?? ""}`);
      return;
    }
    // Opened, so a resend that skipped the recheck would land in it.
    await world.alice.workforce.ensureWorkerSession({ worker: LATE_HELPER });
    const since = Date.now();
    const w = word();
    await servers.restart(["fast-path-throws", "hold-resend"], "9-late-refusal");
    const turn = await talk(world.turns, "9", world.alice, HERALD, herald(), `Message the worker ${LATE_HELPER} saying "${w}". ${NO_WAIT}`);
    const line = oneFired(servers, "fast-path-throws", since, "late-refusal", r);
    if (line === undefined) return;
    if (!turn.calls.some((c) => c.output?.sent === line.id)) r.failures.push(`9:late-refusal — setup: the tool didn't answer { sent: "${line.id}" }`);
    const held = await until(async () => fired(servers, "hold-resend", since).find((l) => l.id === line.id), 60_000);
    if (held === undefined) {
      r.failures.push(`9:late-refusal — setup: the hold-resend fault never fired for ${line.id}`);
      return;
    }
    const fire = await act(world.alice, ROSTER_FLOW, await rosterSessionOf(world.alice), "fire", { id: LATE_HELPER }, 60_000);
    if (fire.status !== "completed") {
      r.failures.push(`9:late-refusal — setup: firing ${LATE_HELPER} ${fire.status}: ${fire.error ?? ""}`);
      return;
    }
    writeFileSync(servers.release, "released\n");
    const ended = await until(async () => {
      const row = await rowOf(world.alice, line.id);
      return row !== undefined && row.status !== "unconfirmed" ? row : undefined;
    }, 60_000);
    const row = ended ?? (await rowOf(world.alice, line.id));
    r.notes.push(`9:late-refusal ${line.id}: row ${row?.status} (${String(row?.reason ?? "").slice(0, 120)})`);
    // A fired worker is off the roster, so the recheck names it `no_worker` (as leg 7 reads a fired worker's refusal).
    if (row?.status !== "refused" || !/^(no_worker|worker_unavailable)\b/.test(String(row?.reason ?? ""))) {
      r.failures.push(`9:late-refusal — after ${LATE_HELPER} was fired, ${line.id}'s row is ${row?.status ?? "missing"} (${String(row?.reason ?? "").slice(0, 160)}), not refused for the fired worker`);
      return;
    }
    await sleep(30_000);
    const dispatched = await requestsFor(world.alice, row.toSession, line.id);
    if (dispatched.length > 0) r.failures.push(`9:late-refusal — ${dispatched.length} dispatch(es) of ${line.id} reached ${LATE_HELPER}'s conversation: ${dispatched.map((q) => senderOf(q).block).join(", ")}`);
    const landed = (await receivedIn(world.alice, row.toSession)).filter((m) => m.id === line.id);
    if (landed.length > 0) r.failures.push(`9:late-refusal — ${LATE_HELPER}'s conversation holds ${landed.length} received item(s) for ${line.id}`);
    const told = (await linesIn(world.alice, herald().id)).filter((l) => l.text.includes(line.id) && l.text.includes(LATE_HELPER) && /wasn't delivered/.test(l.text));
    if (told.length !== 1) r.failures.push(`9:late-refusal — the herald's conversation holds ${told.length} line(s) telling it ${line.id} to ${LATE_HELPER} wasn't delivered, not one`);
    const asked = await talk(world.turns, "9", world.alice, HERALD, herald(), `Did ${LATE_HELPER} get your message? Answer yes or no first, then why.`);
    r.notes.push(`9:late-refusal herald: ${asked.reply.slice(0, 200).replace(/\n/g, " ")}`);
    if (!/^\W*no\b/i.test(asked.reply) && !/\b(didn't|did not|wasn't|was not|not delivered|undeliver|couldn't|could not)\b/i.test(asked.reply)) {
      r.failures.push(`9:late-refusal — asked whether ${LATE_HELPER} got the message, the herald didn't say it hadn't: ${asked.reply.slice(0, 200)}`);
    }
  });

  return r;
}
