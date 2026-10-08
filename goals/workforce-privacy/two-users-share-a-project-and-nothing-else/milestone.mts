/**
 * The milestone (PLAN → The milestone): m1 to m5 on the commit FIX-1788's
 * last PR merges on, and again on each milestone fix's merge commit (QR-15).
 *
 * Only what that commit has: worker sessions and the app's own actions, each
 * as that user with their own bearer, plus what Shift Manager's screens draw
 * for them. No coordinator, delegate, project or fork screen is needed.
 *
 * Every change goes through the shipped clients (`people.mts`); every grade
 * reads the store through the install's routes as that user, by id. Names,
 * the standard worker forked and the word are picked at run time.
 *
 * The final run's leg c (c1 to c6) is written for the finished set and reuses
 * this file's shape: the same people, the same refusal reads.
 */
import { randomBytes, randomInt } from "node:crypto";
import type { Install } from "./install.mts";
import {
  act,
  everythingIn,
  mostRecent,
  refusal,
  talk,
  talkAction,
  type Connected,
  type Person,
  type RosterEntry,
  type SessionSummary,
} from "./people.mts";
import { messageOf, type RunRecord } from "./record.mts";

/** The worker collections, by the key pattern a session's manifest publishes. */
const WORKERS = "workforce/workers/*";
const STANDARD_WORKERS = "workforce/standard-workers/*";
/** The worker flows whose talk action answers a free-text turn; the standard worker forked is picked among these. */
const FREE_TEXT_FLOWS = ["agent", "coordinator"];

const hex = (n = 2) => randomBytes(n).toString("hex");
const WORDS = ["amber", "basalt", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kestrel", "lagoon", "marble", "nimbus", "orchid", "pewter", "quill", "russet", "saffron", "tundra"];
const word = () => WORDS[randomInt(WORDS.length)]!;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The control the milestone runs under, or none. */
export type MilestoneControl = "org-scoped-workers" | null;

export interface MilestoneOptions {
  install: Install;
  record: RunRecord;
  people: { alice: Person; bob: Person; alice2: Person };
  /** Boot 1 (m1 to m4) and boot 2 (m5, with Alice's second-org bearer), over the same store. */
  configs: { first: string; second: string };
  /** Added to both boots' environment: a control's module patch. */
  env: Record<string, string>;
  control: MilestoneControl;
  say(line: string): void;
}

/** What the milestone picked and made, for the report. */
export interface MilestoneFacts {
  standard?: RosterEntry;
  /** The flow and action a worker was made through. */
  madeThrough?: string;
  aliceWorker?: string;
  bobWorker?: string;
  word: string;
  aliceSession?: SessionSummary;
}

/** A collection's rows through one session, with their topics, read through the shipped resource client. */
async function rowsOf(who: Connected, sessionId: string, pattern: string): Promise<{ ref: string; rows: Array<{ topic: string; data: unknown }> }> {
  const ref = await who.routes.refOf(sessionId, pattern);
  if (ref === undefined) throw new Error(`session ${sessionId} publishes no ${pattern} collection`);
  const rows: Array<{ topic: string; data: unknown }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const listed = await who.resources.listCollectionItems(sessionId, ref, cursor === undefined ? {} : { cursor });
    rows.push(...listed.items.map((i: { topic: string; clientData?: unknown }) => ({ topic: i.topic, data: i.clientData })));
    if (listed.nextCursor === undefined || listed.nextCursor === cursor) break;
    cursor = listed.nextCursor;
  }
  return { ref, rows };
}

const lastSegment = (topic: string) => topic.slice(topic.lastIndexOf("/") + 1);

/** The user's session on `flowKind` (the roster flow's, say), found or created through the session client. */
async function sessionOn(who: Connected, flowKind: string): Promise<string> {
  const listed = mostRecent(await who.sessions.listSessions({ flowKind, userId: who.person.userId }));
  return listed?.id ?? (await who.sessions.createSession({ flowKind, userId: who.person.userId })).id;
}

/** Fork `from` (or hire on its flow, when the commit has no fork action) under `id`, as `who`. */
async function makeWorker(who: Connected, through: { kind: string; action: "fork" | "hire" }, from: RosterEntry, id: string) {
  const session = await sessionOn(who, through.kind);
  const input = through.action === "fork" ? { from: from.id, id } : { id, flow: from.flow, description: `Hired by the closure goal as ${id}.` };
  return { session, acted: await act(who, through.kind, session, through.action, input) };
}

export async function milestone(o: MilestoneOptions): Promise<MilestoneFacts> {
  const r = o.record;
  const facts: MilestoneFacts = { word: `${word()}-${word()}-${hex()}` };
  const wordIn = (text: string) => text.toLowerCase().includes(facts.word);

  await o.install.boot("milestone boot 1", o.configs.first, o.env);
  const alice = o.install.as(o.people.alice);
  const bob = o.install.as(o.people.bob);

  // ---- m1 · setup, graded ------------------------------------------------------
  o.say("m1: Alice makes a worker of her own and gives it a word");
  r.via("m1", "action");
  const flows = await alice.flow("workforce-roster").listFlows();
  const actionsOf = (kind: string) => [...new Set(flows.filter((f) => f.kind === kind).flatMap((f) => (Array.isArray(f.actions) ? (f.actions as string[]) : Object.keys(f.actions ?? {}))))];
  const forkFlow = flows.find((f) => actionsOf(f.kind).includes("fork"));
  const hireFlow = flows.find((f) => actionsOf(f.kind).includes("hire"));
  const through = forkFlow !== undefined ? { kind: forkFlow.kind, action: "fork" as const } : hireFlow !== undefined ? { kind: hireFlow.kind, action: "hire" as const } : undefined;
  let roster0: RosterEntry[] | undefined;
  try {
    roster0 = await alice.workforce.roster();
  } catch (error) {
    r.fail("m1", `Alice's roster can't be read through the app (createWorkforceClient().roster()): ${messageOf(error)}`);
  }
  if (through === undefined) {
    r.fail("m1", `the commit has no fork or hire action as Alice: no registered flow takes \`fork\` or \`hire\` (flows: ${flows.map((f) => `${f.id ?? f.kind}[${actionsOf(f.kind).join(",")}]`).join(" ")})`);
  }
  let aliceRosterSession: string | undefined;
  if (roster0 !== undefined && through !== undefined) {
    facts.madeThrough = `\`${through.action}\` on \`${through.kind}\``;
    const own0 = roster0.filter((e) => !e.standard);
    if (own0.length > 0) r.fail("m1", `a fresh store already lists workers of Alice's own: ${own0.map((e) => e.id).join(", ")}`);
    // Only a worker that answers a free-text turn can take the word and be
    // asked for it. A `coder` worker's turn fails ("This task hasn't started")
    // and an `em` one answers by rote, so neither grades the word.
    const pool = roster0.filter((e) => e.standard && FREE_TEXT_FLOWS.includes(e.flow) && talkAction(actionsOf(e.flow)) !== undefined);
    facts.standard = pool[randomInt(Math.max(pool.length, 1))];
    if (facts.standard === undefined) {
      r.notRun("m1", `setup: no standard worker to fork answers a free-text turn: none is on ${FREE_TEXT_FLOWS.map((f) => `\`${f}\``).join(" or ")} with a talk action (roster: ${roster0.map((e) => `${e.id}@${e.flow}`).join(", ")})`);
    } else {
      const pick = facts.standard;
      const name = `${word()}-${hex()}`;
      r.saw("m1", `held-out: forks standard worker \`${pick.id}\` (flow \`${pick.flow}\`) as \`${name}\` through ${facts.madeThrough}`);
      aliceRosterSession = await sessionOn(alice, through.kind);
      const standardBefore = JSON.stringify((await rowsOf(alice, aliceRosterSession, STANDARD_WORKERS).catch(() => ({ rows: [] as Array<{ topic: string; data: unknown }> }))).rows.find((x) => lastSegment(x.topic) === pick.id) ?? null);
      const made = await makeWorker(alice, through, pick, name);
      if (made.acted.status !== "completed") {
        r.fail("m1", `Alice's ${through.action} ended ${made.acted.status}: ${made.acted.error ?? JSON.stringify(made.acted.output)}`);
      } else {
        facts.aliceWorker = name;
        const own1 = (await alice.workforce.roster()).filter((e) => !e.standard);
        if (own1.length !== 1 || own1[0]!.id !== name || own1[0]!.flow !== pick.flow) {
          r.fail("m1", `Alice's roster should list one worker of her own, \`${name}\` on \`${pick.flow}\`; it lists ${JSON.stringify(own1)}`);
        } else r.saw("m1", `Alice's roster lists one worker of her own: \`${name}\` on \`${pick.flow}\``);
        const { rows } = await rowsOf(alice, made.session, WORKERS);
        if (rows.length !== 1 || lastSegment(rows[0]!.topic) !== name) r.fail("m1", `the store should hold one worker row for Alice, \`${name}\`; her worker collection holds ${JSON.stringify(rows.map((x) => x.topic))}`);
        else r.saw("m1", `store: one worker row, \`${rows[0]!.topic}\`, read through her session \`${made.session}\``);
        const manifest = await alice.routes.get(`/sessions/${encodeURIComponent(made.session)}/manifest`);
        const scope = (manifest.resources as Array<{ pattern?: string; scope?: string }>).find((x) => x.pattern === WORKERS)?.scope;
        // Under `org-scoped-workers` the scope is exactly what the control
        // changes, so it is read but not graded (PLAN → Controls).
        if (o.control === "org-scoped-workers") r.saw("m1", `scope not graded under the control; the served collection is declared at \`${scope}\` scope`);
        else if (scope !== "user") r.fail("m1", `the worker collection is declared at \`${scope}\` scope, not user scope`);
        else r.saw("m1", "the worker collection is declared at user scope");
        const standardAfter = JSON.stringify((await rowsOf(alice, made.session, STANDARD_WORKERS).catch(() => ({ rows: [] as Array<{ topic: string; data: unknown }> }))).rows.find((x) => lastSegment(x.topic) === pick.id) ?? null);
        if (standardAfter !== standardBefore) r.fail("m1", `the standard worker \`${pick.id}\` changed: ${standardBefore} → ${standardAfter}`);
        else r.saw("m1", `the standard worker \`${pick.id}\` is unchanged`);
      }
    }
  }
  if (facts.aliceWorker !== undefined) {
    try {
      const session = await alice.workforce.ensureWorkerSession({ worker: facts.aliceWorker });
      facts.aliceSession = session;
      if (session.flowKind !== facts.standard!.flow) r.fail("m1", `Alice's session with \`${facts.aliceWorker}\` is on \`${session.flowKind}\`, not its flow \`${facts.standard!.flow}\``);
      const say = talkAction(actionsOf(session.flowKind))!;
      const turn = await talk(r, "m1", alice, { id: session.id, flowKind: session.flowKind }, say, `Please remember this code word for our later conversations, and keep it with your notes if you keep any: ${facts.word}. Reply with one word: noted.`);
      r.via("m1", "turn");
      if (turn.status !== "completed") r.fail("m1", `Alice's worker didn't take the word: the turn ended ${turn.status}: ${turn.reply.slice(0, 300)}`);
      const held = (await alice.routes.items(session.id, "message")).some((i) => i.role === "user" && wordIn(JSON.stringify(i.content ?? "")));
      if (!held) r.fail("m1", `the word is not in Alice's session \`${session.id}\``);
      else r.saw("m1", `the word is in Alice's session \`${session.id}\` (request \`${turn.requestId}\`)`);
    } catch (error) {
      r.fail("m1", `Alice's talk action on \`${facts.aliceWorker}\` failed: ${messageOf(error)}`);
    }
    const drawn = await o.install.screen("m1", o.people.alice, true, "/roster", "alice-roster");
    r.via("m1", "screen");
    if (!drawn.text.includes(facts.aliceWorker)) r.fail("m1", `Alice's Roster screen doesn't draw her worker \`${facts.aliceWorker}\` (${drawn.rows} worker rows drawn${drawn.errors.length > 0 ? `; ${drawn.errors.join(" | ")}` : ""})`);
    else r.saw("m1", `Alice's Roster screen draws \`${facts.aliceWorker}\``);
  }

  const aliceSession = facts.aliceSession;
  const needs = (step: string) => r.notRun(step, "needs the worker and session m1 was to make, which this commit couldn't");

  // ---- m2 · Bob opens Alice's worker session and posts to it ---------------------
  o.say("m2: Bob reaches for Alice's worker session");
  r.via("m2", "HTTP");
  if (aliceSession === undefined) needs("m2");
  else {
    const say = talkAction(actionsOf(aliceSession.flowKind))!;
    const before = (await alice.routes.items(aliceSession.id, "")).length;
    const opened = await refusal(() => bob.sessions.getSession(aliceSession.id));
    if (opened.status === undefined) r.fail("m2", `Bob opened Alice's worker session \`${aliceSession.id}\`: it came back to him`);
    else r.saw("m2", `Bob opening \`${aliceSession.id}\`: refused, ${opened.status}`);
    const listed = await refusal(() => bob.sessions.listSessions({ flowKind: aliceSession.flowKind, userId: o.people.alice.userId }));
    if (Array.isArray(listed.value) && (listed.value as SessionSummary[]).some((s) => s.id === aliceSession.id)) r.fail("m2", "Bob listing sessions under Alice's user id gets her worker session");
    else r.saw("m2", `Bob listing under Alice's user id: ${listed.status === undefined ? `${(listed.value as unknown[]).length} sessions, not hers` : `refused, ${listed.status}`}`);
    const token = `bob-${hex(3)}`;
    for (const [how, client] of [
      ["as himself", bob.flow(aliceSession.flowKind)],
      ["naming Alice's user id in the body", bob.flow(aliceSession.flowKind, o.people.alice.userId)],
    ] as const) {
      const posted = await refusal(() => client.sendAction(say, { message: `${token} ${how}` }, { sessionId: aliceSession.id }));
      if (posted.status === undefined) r.fail("m2", `Bob's post to Alice's worker session ${how} was accepted: ${JSON.stringify(posted.value).slice(0, 200)}`);
      else r.saw("m2", `Bob posting ${how}: refused, ${posted.status}`);
    }
    await sleep(1500);
    const after = await alice.routes.items(aliceSession.id, "");
    if (after.some((i) => JSON.stringify(i).includes(token))) r.fail("m2", `Bob's words are in Alice's session \`${aliceSession.id}\``);
    else if (after.length !== before) r.fail("m2", `Alice's session went from ${before} to ${after.length} items while Bob posted`);
    else r.saw("m2", `store: Alice's session still holds ${after.length} items, none of Bob's`);
  }

  // ---- m3 · Bob reads Alice's worker, then asks his own for her word ----------------
  o.say("m3: Bob reaches for Alice's worker, and asks his own for her word");
  r.via("m3", "HTTP");
  if (facts.aliceWorker === undefined || aliceRosterSession === undefined || through === undefined) needs("m3");
  else {
    const name = facts.aliceWorker;
    const readsHers = "Bob reads Alice's worker";
    const roster = await refusal(() => bob.workforce.roster());
    if (roster.status !== undefined) r.fail("m3", `Bob's roster can't be read through the app: ${roster.error}`);
    else if ((roster.value as RosterEntry[]).some((e) => e.id === name)) r.fail("m3", `${readsHers}: his roster lists \`${name}\``);
    else r.saw("m3", `Bob's roster (${(roster.value as RosterEntry[]).length} workers) doesn't list \`${name}\``);
    const bobRosterSession = await sessionOn(bob, through.kind);
    const aliceRows = await rowsOf(alice, aliceRosterSession, WORKERS);
    const aliceTopic = aliceRows.rows.find((x) => lastSegment(x.topic) === name)?.topic ?? `workforce/workers/${name}`;
    const bobRows = await rowsOf(bob, bobRosterSession, WORKERS);
    if (bobRows.rows.some((x) => lastSegment(x.topic) === name)) r.fail("m3", `${readsHers}: the worker collection through his own session holds \`${aliceTopic}\``);
    else r.saw("m3", `the worker collection through Bob's session holds ${bobRows.rows.length} rows, none hers`);
    const byKey = await refusal(() => bob.resources.getCollectionItemState(bobRosterSession, bobRows.ref, aliceTopic));
    // The item route answers a topic the caller's scope doesn't hold with a null body.
    if (byKey.status === undefined && byKey.value != null) r.fail("m3", `${readsHers}: \`${aliceTopic}\` read back by key through his own session: ${JSON.stringify(byKey.value).slice(0, 200)}`);
    else r.saw("m3", `Bob reading \`${aliceTopic}\` by key: ${byKey.status === undefined ? "not found" : `refused, ${byKey.status}`}`);
    const throughHers = await refusal(() => bob.resources.listCollectionItems(aliceRosterSession!, aliceRows.ref));
    if (throughHers.status === undefined) r.fail("m3", `${readsHers}: listed through Alice's own session \`${aliceRosterSession}\``);
    else r.saw("m3", `Bob listing through Alice's session: refused, ${throughHers.status}`);
    // Bob makes his own, the same way, and asks it for Alice's word.
    const bobName = `${word()}-${hex()}`;
    const made = await makeWorker(bob, through, facts.standard!, bobName);
    if (made.acted.status !== "completed") r.fail("m3", `Bob's ${through.action} of \`${facts.standard!.id}\` as \`${bobName}\` ended ${made.acted.status}: ${made.acted.error ?? ""}`);
    else {
      facts.bobWorker = bobName;
      try {
        const session = await bob.workforce.ensureWorkerSession({ worker: bobName });
        const turn = await talk(r, "m3", bob, { id: session.id, flowKind: session.flowKind }, talkAction(actionsOf(session.flowKind))!, "Has anyone given you, or any worker you know of, a code word to remember? If you know one, reply with it exactly. If not, reply NONE.");
        r.via("m3", "turn");
        if (turn.status !== "completed") r.fail("m3", `Bob's worker didn't answer: ${turn.status}: ${turn.reply.slice(0, 300)}`);
        else if (turn.reply.trim() === "") r.fail("m3", "Bob's worker gave no answer, so its answer can't show it lacks her word");
        else if (wordIn(turn.reply)) r.fail("m3", `Bob's worker answered with Alice's word: "${turn.reply.slice(0, 300)}"`);
        else r.saw("m3", `Bob's worker \`${bobName}\` answered without her word: "${turn.reply.replace(/\s+/g, " ").slice(0, 200)}"`);
      } catch (error) {
        r.fail("m3", `Bob's talk action on \`${bobName}\` failed: ${messageOf(error)}`);
      }
      const ownRows = await rowsOf(bob, made.session, WORKERS);
      if (wordIn(JSON.stringify(ownRows.rows))) r.fail("m3", "Bob's worker row holds Alice's word");
    }
    const bobSessions = await bob.routes.sessions();
    const holding: string[] = [];
    for (const s of bobSessions) if (wordIn(await everythingIn(bob, s.id))) holding.push(s.id);
    if (holding.length > 0) r.fail("m3", `Alice's word is in Bob's session(s) ${holding.join(", ")}`);
    else r.saw("m3", `store: none of Bob's ${bobSessions.length} sessions holds her word, in state or items`);
    const drawn = await o.install.screen("m3", o.people.bob, false, "/roster", "bob-roster");
    r.via("m3", "screen");
    if (drawn.text.includes(name)) r.fail("m3", `${readsHers}: his Roster screen draws \`${name}\``);
    else if (drawn.rows === 0 && !drawn.text.includes(facts.standard!.id)) r.fail("m3", `Bob's Roster screen drew no worker, so it can't show what it leaves out${drawn.errors.length > 0 ? `: ${drawn.errors.join(" | ")}` : ""}`);
    else r.saw("m3", `Bob's Roster screen draws ${drawn.rows} workers, not \`${name}\``);
  }

  // ---- m4 · Bob creates sessions on Alice's worker -------------------------------------
  o.say("m4: Bob creates sessions naming Alice's worker");
  r.via("m4", "HTTP");
  if (facts.aliceWorker === undefined || aliceSession === undefined) needs("m4");
  else {
    const name = facts.aliceWorker;
    const flowKind = aliceSession.flowKind;
    const viaTalk = await refusal(() => bob.workforce.ensureWorkerSession({ worker: name }));
    if (viaTalk.status === undefined) r.fail("m4", `Bob's talk action opened a session on Alice's worker: \`${(viaTalk.value as SessionSummary).id}\``);
    else r.saw("m4", `Bob's talk action naming \`${name}\`: refused (${viaTalk.error?.slice(0, 120)})`);
    // The worker binding is the readonly `workerId` the create's state seeds
    // (FIX-1788 D5; there is no separate link).
    const seeded = await refusal(() => bob.sessions.createSession({ flowKind, userId: o.people.bob.userId, state: { workerId: name } }));
    if (seeded.status === undefined) r.fail("m4", `Bob created a session seeding \`workerId: ${name}\` in its state: \`${(seeded.value as { id: string }).id}\``);
    else r.saw("m4", `Bob's create seeding \`workerId: ${name}\`: refused, ${seeded.status}`);
    const orgId = (await alice.sessions.getSession(aliceSession.id)).orgId;
    const reserved = await o.install.shipped.workforce.deriveWorkerSessionId({ userId: o.people.alice.userId, orgId, flow: facts.standard!.flow, criteria: { worker: facts.standard!.id } });
    const atHers = await refusal(() => bob.sessions.createSession({ flowKind, userId: o.people.bob.userId, sessionId: reserved, state: { workerId: facts.bobWorker ?? facts.standard!.id } }));
    if (atHers.status === undefined) r.fail("m4", `Bob created a session at \`${reserved}\`, the id Alice's own session with \`${facts.standard!.id}\` is derived to`);
    else r.saw("m4", `Bob's create at Alice's derived id \`${reserved}\`: refused, ${atHers.status}`);
    const bound = await bob.sessions.listSessions({ flowKind, userId: o.people.bob.userId, state: { workerId: name } } as never).catch(() => []);
    if (bound.length > 0) r.fail("m4", `store: Bob holds session(s) on Alice's worker: ${bound.map((s) => s.id).join(", ")}`);
    else r.saw("m4", `store: Bob holds no session on \`${name}\``);
    const taken = await refusal(() => alice.sessions.getSession(reserved));
    if (taken.status === undefined) r.fail("m4", `store: a session now exists at Alice's derived id \`${reserved}\``);
    else r.saw("m4", `store: nothing exists at \`${reserved}\``);
  }

  // ---- m5 · Alice in her second org -----------------------------------------------------------
  const org1Sessions = (await alice.routes.sessions()).map((s) => s.id);
  await o.install.stop();
  o.say("m5: Alice in her second org");
  await o.install.boot("milestone boot 2 (second-org)", o.configs.second, o.env);
  const alice2 = o.install.as(o.people.alice2);
  r.via("m5", "action");
  const roster2 = await refusal(() => alice2.workforce.roster());
  if (roster2.status !== undefined) r.fail("m5", `Alice's roster in her second org can't be read through the app: ${roster2.error}`);
  else {
    const own = (roster2.value as RosterEntry[]).filter((e) => !e.standard);
    if (own.length > 0) r.fail("m5", `Alice in her second org lists workers of her own: ${own.map((e) => e.id).join(", ")}`);
    else r.saw("m5", `Alice's second-org roster: ${(roster2.value as RosterEntry[]).length} standard workers, none of her own`);
  }
  const sessions2 = await alice2.routes.sessions();
  const crossed = sessions2.filter((s) => org1Sessions.includes(s.id));
  if (crossed.length > 0) r.fail("m5", `Alice in her second org lists her first org's session(s): ${crossed.map((s) => s.id).join(", ")}`);
  else r.saw("m5", `Alice's second-org sessions (${sessions2.length}) include none of her ${org1Sessions.length} first-org sessions`);
  const opened: string[] = [];
  for (const id of org1Sessions.slice(0, 25)) if ((await refusal(() => alice2.sessions.getSession(id))).status === undefined) opened.push(id);
  if (opened.length > 0) r.fail("m5", `Alice in her second org opens first-org session(s): ${opened.join(", ")}`);
  else r.saw("m5", `each of ${Math.min(org1Sessions.length, 25)} first-org sessions: refused or not found in her second org`);
  const leaking: string[] = [];
  for (const s of sessions2) {
    const all = await everythingIn(alice2, s.id);
    if (wordIn(all) || (facts.aliceWorker !== undefined && all.includes(facts.aliceWorker))) leaking.push(s.id);
  }
  if (leaking.length > 0) r.fail("m5", `first-org data (her word or worker) is in second-org session(s) ${leaking.join(", ")}`);
  else r.saw("m5", "store: no second-org session holds her first org's word or worker, in state or items");
  if (facts.aliceWorker !== undefined && aliceSession !== undefined) {
    const named = await refusal(() => alice2.sessions.createSession({ flowKind: aliceSession.flowKind, userId: o.people.alice2.userId, state: { workerId: facts.aliceWorker } }));
    if (named.status === undefined) r.fail("m5", `Alice in her second org created a session on her first org's worker \`${facts.aliceWorker}\``);
    else r.saw("m5", `a second-org create naming \`${facts.aliceWorker}\`: refused, ${named.status}`);
    const drawn = await o.install.screen("m5", o.people.alice2, false, "/roster", "alice-second-org-roster");
    r.via("m5", "screen");
    if (drawn.text.includes(facts.aliceWorker)) r.fail("m5", `Alice's Roster screen in her second org draws \`${facts.aliceWorker}\``);
    else if (drawn.rows === 0 && !drawn.text.includes(facts.standard!.id)) r.fail("m5", `Alice's second-org Roster screen drew no worker, so it can't show what it leaves out${drawn.errors.length > 0 ? `: ${drawn.errors.join(" | ")}` : ""}`);
    else r.saw("m5", `Alice's second-org Roster screen draws ${drawn.rows} workers, not \`${facts.aliceWorker}\``);
  } else {
    r.saw("m5", "no first-org worker to look for (m1 made none): sessions and user data only");
  }
  await o.install.stop();
  return facts;
}
