/**
 * The final run's legs (PLAN → Checks): a1 to a5 and b1 to b7 on one store
 * across their restarts, and c1 to c6 on its own store.
 *
 * Every change goes through the app (D2): the screen where Shift Manager
 * draws one, else a coordinator turn, else the app's own action as that user,
 * with that user's own bearer. Each step says which it used. Every grade reads
 * the store through the install's routes as that user, by id, or, for what
 * the routes don't send a client (a coordinator conversation's delegates and
 * delivery ledger, task rows, which user owns a session row), the store file
 * itself, read-only (`store.mts`). Never Shift Manager's own state.
 *
 * Model turns are graded once (QR-10); a provider error re-runs that one turn
 * and is reported (`talk`). Names, words and asks are picked at run time.
 */
import { randomBytes, randomInt } from "node:crypto";
import type { Browser } from "playwright";
import { harnessFeatureOf } from "@flow-state-dev/harness-manager";
import type { Install } from "./install.mts";
import { rowsOf, sessionOn } from "./milestone.mts";
import { act, everythingIn, refusal, talk, textOf, type Connected, type Person, type RosterEntry, type SessionSummary } from "./people.mts";
import { messageOf, type RunRecord, type Turn } from "./record.mts";
import { askInStream, delegatesPanel, projectGroups, projectWorkstreams, rosterRows, type ProjectAt } from "./screens.mts";
import { isRoutedTask } from "../../lib/routed-tasks.mts";
import type { StoredItem } from "../../lib/shift-manager.mts";
import { anythingRunning, conversationRecord, sessionRows, taskRows, workerRow, type Delivery, type StoredSession, type StoredTask } from "./store.mts";

const hex = (n = 2) => randomBytes(n).toString("hex");
const WORDS = ["amber", "basalt", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kestrel", "lagoon", "marble", "nimbus", "orchid", "pewter", "quill", "russet", "saffron", "tundra"];
const pick = <T,>(xs: readonly T[]): T => xs[randomInt(xs.length)]!;
const word = () => pick(WORDS);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const show = (v: unknown) => JSON.stringify(v)?.slice(0, 400);
/** Whether a collection row's topic names `id`: the bare id, or a path ending in it. */
const named = (topic: string, id: string) => topic === id || topic.endsWith(`/${id}`);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

const ROSTER = "workforce-roster";
const WORKERS = "workforce/workers/*";
const STANDARD_WORKERS = "workforce/standard-workers/*";
const PROJECTS = "projects";
const COORDINATOR = "coordinator";
const SHIFT_COORDINATOR = "shift-coordinator";
const PROJECT_COORDINATOR = "project-coordinator";
/** Orchestration's task tools (b6), by the names a turn calls them: the filer's four (FIX-2081). */
export const TASK_TOOLS = ["createTask", "getTask", "listTasks", "updateTask"] as const;

/** An engineering ask on a research fork fits no delegate, so a4 is NOT RUN when the fork has none of these. */
const feature = (w: string) => `Please get this feature filed for the engineering team (${w}): ${pick(["a gift-wrap option at checkout", "a recently-viewed strip on the product page", "a back-in-stock email signup on sold-out items", "a size guide link beside each size picker"])}.`;
const research = (w: string) => `Please research this and write up the options with a recommendation, no code (${w}): ${pick(["should we offer free returns on sale items", "which payment methods should our EU checkout support first", "how do comparable stores price same-day delivery", "is a loyalty points program worth it for a store our size"])}?`;
const ASK: Record<string, (w: string) => string> = { "eng.em": feature, researcher: research, "general-lead": research };
/**
 * The standard workers a fork may come from: the ones ASK names, each on a flow
 * that takes a task, so a coordinator can route to it (the EM, the
 * researcher, the general lead). The Error Reporter's flow takes no task, so
 * `addDelegate` refuses a fork of it.
 */
const forkableStandard = (standard: readonly RosterEntry[]): RosterEntry[] => standard.filter((e) => Object.hasOwn(ASK, e.id));

export type LegControl = null | "unpartitioned" | "no-follow-up" | "no-delegate-check" | "no-roster-check" | "org-scoped-workers";

export interface LegOptions {
  install: Install;
  browser: Browser;
  record: RunRecord;
  store: string;
  people: { alice: Person; bob: Person; alice2: Person };
  configs: { first: string; second: string };
  env: Record<string, string>;
  control: LegControl;
  /** Steps to run; a control runs only its leg's. */
  only?: ReadonlySet<string>;
  say(line: string): void;
}

/** What the legs picked and made, for the report. */
export interface LegFacts {
  standard?: string;
  fork?: string;
  coordinator?: string;
  forkWord?: string;
  ask?: string;
  projects?: { shared: string; private: string };
  workstreams?: Record<string, { project: string; id: string; session: string | null; lead: string }>;
  emWorkstream?: { id: string; session: string };
  b6Worker?: string;
  notes: string[];
}

// ---- reads -------------------------------------------------------------------------

type Entry = { project: string; owner: string; id: string; lead: string; sessionId: string | null; status: string; title: string; objectives: Array<{ text: string; met: boolean }> };

/** A project's workstream entries, read through `who`'s roster session, at the project's scope. */
async function entriesOf(who: Connected, project: ProjectAt): Promise<Entry[]> {
  const session = await sessionOn(who, ROSTER);
  const ref = project.visibility === "private" ? "privateWorkstreams" : "workstreams";
  const out: Entry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const listed = await who.resources.listCollectionItems(session, ref, cursor === undefined ? {} : { cursor });
    for (const item of listed.items as Array<{ topic: string; clientData?: Record<string, any> }>) {
      const parts = item.topic.split("/");
      const at = parts.findIndex((p) => p.startsWith("~"));
      if (at < 1) continue;
      const projectId = parts[at - 1]!;
      if (projectId !== project.id) continue;
      const d = item.clientData ?? {};
      out.push({
        project: projectId,
        owner: decodeURIComponent(parts[at]!.slice(1)),
        id: parts.slice(at + 1).join("/"),
        lead: String(d.lead),
        sessionId: typeof d.sessionId === "string" ? d.sessionId : null,
        status: String(d.status),
        title: String(d.title),
        objectives: Array.isArray(d.objectives) ? d.objectives.map((o: any) => ({ text: String(o.text), met: o.met === true })) : [],
      });
    }
    if (listed.nextCursor === undefined || listed.nextCursor === cursor) break;
    cursor = listed.nextCursor;
  }
  return out;
}

/** The projects `who` reads: shared rows and their own private ones, by id. */
async function projectsOf(who: Connected): Promise<{ shared: Array<Record<string, any>>; private: Array<Record<string, any>> }> {
  const session = await sessionOn(who, ROSTER);
  const read = async (ref: string) => {
    const listed = await who.resources.listCollectionItems(session, ref, {});
    return (listed.items as Array<{ clientData?: Record<string, any> }>).map((i) => i.clientData ?? {});
  };
  return { shared: await read("projects"), private: await read("privateProjects") };
}

const ownIds = async (who: Connected) => (await who.workforce.roster()).filter((e) => !e.standard).map((e) => e.id).sort();

/** Sessions that appeared after `before` (a set of ids), with their owner, from the store. */
const newSessions = (store: string, before: ReadonlySet<string>) => sessionRows(store).filter((s) => !before.has(s.id));
const sessionIds = (store: string) => new Set(sessionRows(store).map((s) => s.id));

/** Wait until nothing in the store runs, then a grace period. */
async function quiet(store: string, timeoutMs = 240_000, graceMs = 5_000): Promise<boolean> {
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(1_000)) {
    if (!anythingRunning(store)) {
      await sleep(graceMs);
      if (!anythingRunning(store)) return true;
    }
  }
  return false;
}

/** The `coordinator-route` records for one post. */
async function routingOf(who: Connected, sessionId: string, postId: string | null): Promise<Array<Record<string, any>>> {
  if (postId === null) return [];
  return (await who.routes.items(sessionId, "component"))
    .filter((i) => (i as { component?: string }).component === "coordinator-route")
    .map((i) => i.data as Record<string, any>)
    .filter((d) => d?.postId === postId);
}

/** Each session must be `owner`'s and, when it names a worker, name one on `owner`'s roster. */
function gradeOwned(r: RunRecord, step: string, rows: StoredSession[], owner: string, roster: readonly string[], what: string): void {
  const foreign = rows.filter((s) => s.userId !== owner);
  if (foreign.length > 0) r.fail(step, `${what}: session(s) not ${owner}'s: ${foreign.map((s) => `${s.id} (${s.userId})`).join(", ")}`);
  const unknown = rows.filter((s) => typeof s.state.workerId === "string" && !roster.includes(s.state.workerId));
  if (unknown.length > 0) r.fail(step, `${what}: session(s) naming a worker not on ${owner}'s roster: ${unknown.map((s) => `${s.id}→${s.state.workerId}`).join(", ")}`);
  if (foreign.length === 0 && unknown.length === 0) r.saw(step, `${what}: ${rows.length} session(s), each ${owner}'s, each naming a worker on their roster: ${rows.map((s) => `${s.id}[${s.flowKind}${typeof s.state.workerId === "string" ? `:${s.state.workerId}` : ""}]`).join(", ") || "none"}`);
}

// ---- leg a and leg b ------------------------------------------------------------------

/** Legs a and b on one store: a1 to a4, the a5 restart, b1 to b6, the b7 restart. */
export async function legsAB(o: LegOptions): Promise<LegFacts> {
  const r = o.record;
  const runs = (step: string) => o.only === undefined || o.only.has(step);
  const facts: LegFacts = { notes: [] };
  const { alice: A, bob: B } = o.people;
  await o.install.boot("legs a-b boot 1", o.configs.first, o.env);
  let alice = o.install.as(A);
  let bob = o.install.as(B);
  const origin = () => o.install.origin;
  const standard = (await alice.workforce.roster()).filter((e) => e.standard);
  const standardIds = standard.map((e) => e.id).sort();
  const snapshot: Record<string, unknown> = {};

  // ---- a1 · roster ----
  if (runs("a1")) {
    o.say("a1: each roster lists the standard workers and nothing of the other's");
    r.via("a1", "screen");
    const storeStandard = (await rowsOf(alice, await sessionOn(alice, ROSTER), STANDARD_WORKERS)).rows.map((x) => x.topic.slice(x.topic.lastIndexOf("/") + 1)).sort();
    if (!sameSet(storeStandard, standardIds)) r.fail("a1", `Alice's roster's standard workers ${show(standardIds)} differ from the store's standard-worker rows ${show(storeStandard)}`);
    for (const [who, person, owner] of [[alice, A, true], [bob, B, false]] as const) {
      const listed = await who.workforce.roster();
      const std = listed.filter((e) => e.standard);
      const own = listed.filter((e) => !e.standard);
      if (!sameSet(std.map((e) => e.id), standardIds)) r.fail("a1", `${person.label}'s roster lists standard workers ${show(std.map((e) => e.id))}, not ${show(standardIds)}`);
      if (own.length > 0) r.fail("a1", `${person.label}'s fresh roster lists workers of their own: ${own.map((e) => e.id).join(", ")}`);
      const drawn = await rosterRows(o.browser, origin(), person, owner, r, `a1-${person.label.toLowerCase()}-roster`);
      if (drawn.value === undefined) r.fail("a1", `${person.label}'s Roster screen failed: ${drawn.errors.join(" | ")}`);
      else {
        const ids = drawn.value.rows.map((x) => x.id);
        const missing = standardIds.filter((id) => !ids.includes(id));
        const ownDrawn = drawn.value.rows.filter((x) => x.own).map((x) => x.id);
        const flowsWrong = std.filter((e) => !(drawn.value!.rows.find((x) => x.id === e.id)?.kind ?? "").includes(e.flow)).map((e) => e.id);
        if (missing.length > 0) r.fail("a1", `${person.label}'s Roster screen doesn't draw standard worker(s) ${missing.join(", ")}`);
        if (ownDrawn.length > 0) r.fail("a1", `${person.label}'s Roster screen marks ${ownDrawn.join(", ")} as theirs on a fresh store`);
        if (flowsWrong.length > 0) r.fail("a1", `${person.label}'s Roster screen doesn't name the flow of ${flowsWrong.join(", ")}`);
        if (drawn.value.ownUnread !== undefined) r.notRun("a1", `${person.label}'s Roster screen: ${drawn.value.ownUnread}`);
        if (missing.length + ownDrawn.length + flowsWrong.length === 0) r.saw("a1", `${person.label}'s Roster draws ${ids.length} workers, every standard worker with its flow and not marked theirs; the roster read lists ${std.length} standard, 0 own`);
      }
    }
  }

  // ---- a2 · fork ----
  // The standard worker forked: one a coordinator can route a message to (a4) and a4
  // has a held-out ask for.
  const forkable = forkableStandard(standard);
  if (runs("a2")) {
    o.say("a2: Alice forks a standard worker under a held-out name");
    r.via("a2", "action");
    const from = forkable.length > 0 ? pick(forkable) : undefined;
    if (from === undefined) r.notRun("a2", `setup: no standard worker has a held-out ask (roster: ${standard.map((e) => `${e.id}@${e.flow}`).join(", ")})`);
    else {
      facts.standard = from.id;
      const name = `${word()}-${hex()}`;
      r.saw("a2", `held-out: forks \`${from.id}\` (flow \`${from.flow}\`) as \`${name}\`. Surface: the roster flow's \`fork\` action, since no screen draws a fork and the Shift Coordinator has no fork tool (an unpromised screen: an observation, D2)`);
      const rosterSession = await sessionOn(alice, ROSTER);
      const before = JSON.stringify((await rowsOf(alice, rosterSession, STANDARD_WORKERS)).rows.find((x) => named(x.topic, from.id)) ?? null);
      const bobBefore = await ownIds(bob);
      const forked = await act(alice, ROSTER, rosterSession, "fork", { from: from.id, id: name });
      if (forked.status !== "completed") r.fail("a2", `Alice's fork ended ${forked.status}: ${forked.error ?? show(forked.output)}`);
      else {
        facts.fork = name;
        const rows = (await rowsOf(alice, rosterSession, WORKERS)).rows;
        if (rows.length !== 1 || !named(rows[0]!.topic, name)) r.fail("a2", `the store should hold one worker row for Alice, \`${name}\`; it holds ${show(rows.map((x) => x.topic))}`);
        else if ((rows[0]!.data as { flow?: string })?.flow !== from.flow && (rows[0]!.data as { flow?: string })?.flow !== undefined) r.fail("a2", `the fork's row names flow ${show((rows[0]!.data as any).flow)}, not \`${from.flow}\``);
        else r.saw("a2", `store: one worker row, \`${rows[0]!.topic}\``);
        const manifest = await alice.routes.get(`/sessions/${encodeURIComponent(rosterSession)}/manifest`);
        const scope = (manifest.resources as Array<{ pattern?: string; scope?: string }>).find((x) => x.pattern === WORKERS)?.scope;
        if (o.control === "org-scoped-workers") r.saw("a2", `scope not graded under the control (\`${scope}\`)`);
        else if (scope !== "user") r.fail("a2", `the worker collection is declared at \`${scope}\` scope, not user scope`);
        else r.saw("a2", "the worker collection is declared at user scope");
        const listed = (await alice.workforce.roster()).find((e) => e.id === name);
        if (listed?.flow !== from.flow || listed.standard) r.fail("a2", `Alice's roster lists the fork as ${show(listed)}`);
        const after = JSON.stringify((await rowsOf(alice, rosterSession, STANDARD_WORKERS)).rows.find((x) => named(x.topic, from.id)) ?? null);
        if (before === "null") r.fail("a2", `setup: no standard-worker row for \`${from.id}\` to compare`);
        else if (after !== before) r.fail("a2", `the standard worker \`${from.id}\` changed: ${before} → ${after}`);
        else r.saw("a2", `the standard worker \`${from.id}\` is unchanged`);
        const bobAfter = await ownIds(bob);
        if (!sameSet(bobAfter, bobBefore) || (await bob.workforce.roster()).some((e) => e.id === name)) r.fail("a2", `Bob's roster changed: ${show(bobBefore)} → ${show(bobAfter)}`);
        else r.saw("a2", "Bob's roster is unchanged and doesn't list the fork");
        const drawn = await rosterRows(o.browser, origin(), A, true, r, "a2-alice-roster");
        r.via("a2", "screen");
        const row = drawn.value?.rows.find((x) => x.id === name);
        if (row === undefined || !row.own) r.fail("a2", `Alice's Roster screen doesn't draw \`${name}\` as hers (${drawn.value?.ownUnread ?? drawn.errors.join(" | ")})`);
        else r.saw("a2", `Alice's Roster draws \`${name}\` marked hers`);
      }
    }
  }

  // ---- a3 · coordinator ----
  if (runs("a3")) {
    o.say("a3: Alice gets a best-fit coordinator through the Shift Coordinator, and adds two delegates");
    r.via("a3", "turn");
    const name = `${word()}-desk-${hex()}`;
    const shiftCoordinator = await alice.workforce.ensureWorkerSession({ worker: SHIFT_COORDINATOR });
    const own0 = await ownIds(alice);
    const turn = await talk(
      r,
      "a3",
      alice,
      { id: shiftCoordinator.id, flowKind: shiftCoordinator.flowKind },
      "run",
      `Please hire a coordinator for me with the id "${name}": a worker on the coordinator flow that routes each post by best fit (routing: best-fit), using the model openai/gpt-5.4-mini. Description: "My own front desk; hands each ask to whichever of my workers fits it best." Just hire it; I'll add its delegates myself.`,
    );
    const hires = turn.tools.filter((t) => /(^|[./_])hire$/.test(t.name));
    r.saw("a3", `the Shift Coordinator's turn: ${turn.status}; tools ${turn.tools.map((t) => `${t.name}#${t.itemId}`).join(", ") || "none"}`);
    const own1 = await ownIds(alice);
    const added = own1.filter((x) => !own0.includes(x));
    const listed = (await alice.workforce.roster()).find((e) => e.id === name);
    const rosterSession = await sessionOn(alice, ROSTER);
    // The row as stored: the client's projection of a worker row leaves its settings out.
    const row = (await rowsOf(alice, rosterSession, WORKERS)).rows.some((x) => named(x.topic, name)) ? (workerRow(o.store, A.userId, name) as { flow?: string; settings?: Record<string, unknown> } | undefined) : undefined;
    if (hires.length === 0) r.fail("a3", `the Shift Coordinator's turn called no \`hire\` (reply: "${turn.reply.slice(0, 300)}")`);
    if (listed === undefined || row === undefined) r.fail("a3", `no worker \`${name}\` on Alice's roster after the turn (new: ${show(added)})`);
    else if (listed.flow !== COORDINATOR) r.fail("a3", `\`${name}\` is on flow \`${listed.flow}\`, not \`${COORDINATOR}\``);
    else if (row.settings?.routing !== "best-fit") r.fail("a3", `\`${name}\`'s row routes by ${show(row.settings?.routing)}, not best-fit (settings ${show(row.settings)})`);
    else {
      facts.coordinator = name;
      r.saw("a3", `\`${name}\` is on Alice's roster, on \`${COORDINATOR}\`, settings ${show(row.settings)}`);
    }
    if (added.some((x) => x !== name)) r.fail("a3", `the turn put more on Alice's roster than the coordinator: ${show(added)}`);
    if (facts.coordinator !== undefined) {
      const conv = await alice.workforce.ensureWorkerSession({ worker: facts.coordinator });
      r.via("a3", "action");
      const second = standard.find((e) => e.id !== facts.standard && e.flow !== COORDINATOR && e.flow === "coder") ?? forkableStandard(standard).find((e) => e.id !== facts.standard);
      const want = [facts.fork, second?.id].filter((x): x is string => x !== undefined);
      r.saw("a3", `delegates added through the app's \`addDelegate\` on her conversation \`${conv.id}\`: ${want.join(", ")} (the delegates panel is drawn only for the Shift Coordinator, FIX-1791 S10; for her own coordinator no screen exists, an observation, D2)`);
      for (const w of want) {
        const added = await act(alice, COORDINATOR, conv.id, "addDelegate", { worker: w });
        if (added.status !== "completed") r.fail("a3", `addDelegate ${w} ended ${added.status}: ${added.error ?? show(added.output)}`);
      }
      const held = conversationRecord(o.store, A.userId, conv.id).delegates?.map((d) => d.worker) ?? [];
      if (!sameSet(held, want)) r.fail("a3", `her conversation's delegates are ${show(held)}, not exactly ${show(want)}`);
      else r.saw("a3", `store: the conversation's delegates are exactly ${show(held)}`);
      snapshot.conv = conv.id;
    }
  }

  // ---- a4 · post ----
  if (runs("a4")) {
    o.say("a4: Alice posts an ask that fits her fork");
    r.via("a4", "turn");
    const convId = snapshot.conv as string | undefined;
    if (convId === undefined || facts.fork === undefined) r.notRun("a4", "needs a3's coordinator and a2's fork");
    else {
      const w = `${word()}-${hex()}`;
      const ask = facts.standard === undefined ? undefined : ASK[facts.standard];
      if (ask === undefined) r.notRun("a4", `setup: no held-out ask is written for a fork of \`${facts.standard}\`, so none is known to fit it`);
      else {
        facts.ask = ask(w);
        const before = sessionIds(o.store);
        const turn = await talk(r, "a4", alice, { id: convId, flowKind: COORDINATOR }, "respond", facts.ask);
        let mine: Delivery[] = [];
        let answer: { session: string; text: string } | undefined;
        const waited = Date.now();
        for (const until = waited + 180_000; Date.now() < until; await sleep(1_500)) {
          mine = conversationRecord(o.store, A.userId, convId).ledger.filter((d) => d.postId === turn.requestId);
          const to = mine.find((d) => d.delegate.worker === facts.fork && d.status === "delivered" && d.sessionId !== undefined);
          if (to !== undefined) {
            const items = await alice.routes.items(to.sessionId!, "message").catch((): StoredItem[] => []);
            const said = items.filter((i) => i.role === "assistant").at(-1);
            if (said !== undefined) {
              answer = { session: to.sessionId!, text: textOf(said) };
              break;
            }
          }
          if (mine.length === 0 && Date.now() - waited > 30_000) break;
        }
        if (mine.length !== 1 || mine[0]!.delegate.worker !== facts.fork || mine[0]!.status !== "delivered") r.fail("a4", `wanted one delivery of the post, to the fork \`${facts.fork}\`; the ledger holds ${mine.length === 0 ? "none" : show(mine)}`);
        else r.saw("a4", `one delivery, to \`${facts.fork}\`, into \`${mine[0]!.sessionId}\``);
        const routed = await routingOf(alice, convId, turn.requestId);
        const evaluated = routed.filter((x) => x.policy === "best-fit" && x.by === "evaluated" && (x.delegates ?? []).some((d: any) => d.worker === facts.fork && d.outcome === "delivered"));
        if (evaluated.length !== 1) r.fail("a4", `wanted one best-fit record \`by: evaluated\` delivering to the fork; the records are ${show(routed)} (a judgment-turn delivery is a miss, QR-10)`);
        else r.saw("a4", `one routing record: best-fit, by evaluated, delivered to \`${facts.fork}\``);
        if (answer === undefined) r.fail("a4", "the fork's session holds no answer within 180 s");
        else r.saw("a4", `the fork answered in \`${answer.session}\`: "${answer.text.replace(/\s+/g, " ").slice(0, 200)}"`);
        await quiet(o.store, 240_000);
        const created = newSessions(o.store, before);
        gradeOwned(r, "a4", created, A.userId, [...standardIds, ...(await ownIds(alice))], "every session the post created");
        const plain = await alice.workforce.ensureWorkerSession({ worker: facts.fork });
        r.via("a4", "action");
        if (created.some((s) => s.id === plain.id) || mine.some((d) => d.sessionId === plain.id)) r.fail("a4", `opening the fork from the roster lands in \`${plain.id}\`, a session the post created`);
        else r.saw("a4", `opening the fork from the roster (\`ensureWorkerSession({ worker })\`, what the roster's client calls) lands in its plain session \`${plain.id}\`, not the delegate session`);
        r.saw("a4", "the fork's answer is read from the store: Shift Manager draws no conversation with a person's own coordinator (an unpromised screen, D2)");
      }
    }
  }

  // ---- a5 · restart ----
  const readA = async () => ({
    alice: (await alice.workforce.roster()).map((e) => `${e.id}@${e.flow}:${e.standard}`).sort(),
    bob: (await bob.workforce.roster()).map((e) => `${e.id}@${e.flow}:${e.standard}`).sort(),
    delegates: snapshot.conv === undefined ? null : conversationRecord(o.store, A.userId, snapshot.conv as string).delegates,
    ledger: snapshot.conv === undefined ? null : conversationRecord(o.store, A.userId, snapshot.conv as string).ledger.map((d) => `${d.postId}:${d.delegate.worker}:${d.status}`),
  });
  if (runs("a5")) {
    const before = JSON.stringify(await readA());
    await o.install.stop();
    await o.install.boot("legs a-b boot 2 (a5)", o.configs.first, o.env);
    alice = o.install.as(A);
    bob = o.install.as(B);
    r.via("a5", "action");
    const after = JSON.stringify(await readA());
    if (after !== before) r.fail("a5", `a1 to a4 read differently after a restart: ${before.slice(0, 600)} → ${after.slice(0, 600)}`);
    else r.saw("a5", "both rosters, the conversation's delegates and its ledger read the same on a new process over the same store");
    if (facts.fork !== undefined) {
      const drawn = await rosterRows(o.browser, origin(), A, true, r, "a5-alice-roster");
      r.via("a5", "screen");
      if (!drawn.value?.rows.some((x) => x.id === facts.fork && x.own)) r.fail("a5", `after the restart Alice's Roster doesn't draw her fork (${drawn.value?.ownUnread ?? drawn.errors.join(" | ")})`);
    }
  }

  // ---- b1 · projects ----
  const P: ProjectAt = { visibility: "shared", id: `${word()}-${hex()}` };
  const Q: ProjectAt = { visibility: "private", id: `${word()}-${hex()}` };
  if (runs("b1")) {
    o.say("b1: Alice asks the Shift Coordinator for a shared and a private project");
    r.via("b1", "turn");
    const titleP = `${word()} ${word()} ${hex()}`;
    const titleQ = `${word()} ${word()} ${hex()}`;
    const shiftCoordinator = await alice.workforce.ensureWorkerSession({ worker: SHIFT_COORDINATOR });
    const turn = await talk(
      r,
      "b1",
      alice,
      { id: shiftCoordinator.id, flowKind: shiftCoordinator.flowKind },
      "run",
      `Please start two projects for me. First, a shared project with the id "${P.id}" titled "${titleP}", with ${B.userId} as a member. Second, a private project with the id "${Q.id}" titled "${titleQ}", just for me.`,
    );
    r.saw("b1", `turn ${turn.status}; tools ${turn.tools.map((t) => `${t.name}(${t.args})#${t.itemId}`).join("; ") || "none"}`);
    const a = await projectsOf(alice);
    const b = await projectsOf(bob);
    const pRow = a.shared.find((p) => p.id === P.id);
    const qRow = a.private.find((p) => p.id === Q.id);
    if (pRow === undefined) r.fail("b1", `no shared project \`${P.id}\` in Alice's projects (shared ${show(a.shared.map((p) => p.id))}, private ${show(a.private.map((p) => p.id))})`);
    else if (pRow.ownerUserId !== A.userId || !(pRow.members ?? []).includes(B.userId)) r.fail("b1", `\`${P.id}\` is ${show(pRow)}: not Alice's with Bob a member`);
    if (qRow === undefined) r.fail("b1", `no private project \`${Q.id}\` in Alice's private projects (${show(a.private.map((p) => p.id))})`);
    if (!b.shared.some((p) => p.id === P.id)) r.fail("b1", `Bob's projects don't list \`${P.id}\``);
    if ([...b.shared, ...b.private].some((p) => p.id === Q.id)) r.fail("b1", `Bob's projects list Alice's private \`${Q.id}\``);
    if (pRow !== undefined && qRow !== undefined) facts.projects = { shared: P.id, private: Q.id };
    r.via("b1", "screen");
    for (const [person, owner, want, wantNot] of [[A, true, [`shared:${P.id}`, `private:${Q.id}`], []], [B, false, [`shared:${P.id}`], [`private:${Q.id}`, `shared:${Q.id}`]]] as const) {
      const drawn = await projectGroups(o.browser, origin(), person, owner, r, `b1-${person.label.toLowerCase()}-projects`);
      const groups = drawn.value ?? [];
      const missing = want.filter((g) => !groups.includes(g));
      const leaked = wantNot.filter((g) => groups.includes(g));
      if (drawn.value === undefined) r.fail("b1", `${person.label}'s PROJECTS failed to read: ${drawn.errors.join(" | ")}`);
      else if (missing.length > 0 || leaked.length > 0) r.fail("b1", `${person.label}'s PROJECTS draws ${show(groups)}: missing ${show(missing)}, should not draw ${show(leaked)}`);
      else r.saw("b1", `${person.label}'s PROJECTS draws ${show(groups)}`);
    }
  }

  // ---- b2 · workstreams, b3 · hand-offs ----
  const workstreams: NonNullable<LegFacts["workstreams"]> = {};
  facts.workstreams = workstreams;
  const pcSession: Record<string, string> = {};
  if (runs("b2") && facts.projects !== undefined) {
    o.say("b2: each asks their own project coordinator in P's Stream for new work");
    r.via("b2", "screen");
    const roster0 = { alice: await ownIds(alice), bob: await ownIds(bob) };
    for (const [who, person, owner, key] of [[alice, A, true, "alice"], [bob, B, false, "bob"]] as const) {
      const theme = `${word()} ${word()} ${hex()}`;
      const before = (await entriesOf(who, P)).map((e) => `${e.owner}/${e.id}`);
      const asked = await askInStream(o.browser, origin(), person, owner, r, `b2-${key}-stream`, P, `I need a new piece of work done in this project: ${theme}. Nothing of mine covers it yet, so please open a workstream for it and get it started.`);
      if (asked.value === undefined) {
        r.fail("b2", `${person.label} couldn't ask in P's Stream: ${asked.errors.join(" | ")}`);
        continue;
      }
      pcSession[key] = asked.value.sessionId;
      let opened: Entry[] = [];
      for (const until = Date.now() + 180_000; Date.now() < until; await sleep(2_000)) {
        opened = (await entriesOf(who, P)).filter((e) => !before.includes(`${e.owner}/${e.id}`) && e.owner === person.userId);
        if (opened.length > 0 && opened.every((e) => e.sessionId !== null)) break;
      }
      const turnItems = await who.routes.items(asked.value.sessionId, "tool_output").catch(() => []);
      r.saw("b2", `${person.label}'s project coordinator conversation \`${asked.value.sessionId}\` tools: ${turnItems.map((i) => `${i.toolCall?.name}#${i.id}`).join(", ") || "none"}`);
      if (opened.length !== 1) {
        r.fail("b2", `${person.label}'s ask opened ${opened.length} workstreams of theirs in P (wanted 1): ${show(opened)}`);
        continue;
      }
      const e = opened[0]!;
      workstreams[key] = { project: P.id, id: e.id, session: e.sessionId, lead: e.lead };
      const roster = (await who.workforce.roster()).map((x) => x.id);
      if (!roster.includes(e.lead)) r.fail("b2", `${person.label}'s workstream \`${e.id}\` is led by \`${e.lead}\`, not a worker on their roster`);
      const row = sessionRows(o.store).find((s) => s.id === e.sessionId || s.id.endsWith(`:${e.sessionId}`));
      if (row === undefined || row.userId !== person.userId) r.fail("b2", `${person.label}'s workstream session \`${e.sessionId}\` is ${row === undefined ? "not in the store" : `${row.userId}'s`}`);
      else r.saw("b2", `${person.label}: one workstream \`${e.id}\` led by \`${e.lead}\` (on their roster), session \`${e.sessionId}\` theirs`);
    }
    const roster1 = { alice: await ownIds(alice), bob: await ownIds(bob) };
    if (!sameSet(roster1.alice, roster0.alice) || !sameSet(roster1.bob, roster0.bob)) r.fail("b2", `a roster changed: ${show(roster0)} → ${show(roster1)}`);
    else r.saw("b2", "nothing was added to either roster");
    for (const [person, owner, key] of [[A, true, "alice"], [B, false, "bob"]] as const) {
      // The leads keep working after b2's asks and may edit their objectives while the screen is read, so
      // the screen is graded against a store that held still across the read.
      const who = key === "alice" ? alice : bob;
      let entries = await entriesOf(who, P);
      let drawn!: Awaited<ReturnType<typeof projectWorkstreams>>;
      let still = false;
      for (let tries = 0; tries < 3 && !still; tries++) {
        const before = entries;
        drawn = await projectWorkstreams(o.browser, origin(), person, owner, r, `b2-${key}-workstreams`, P);
        entries = await entriesOf(who, P);
        still = JSON.stringify(before) === JSON.stringify(entries);
      }
      if (!still) {
        r.fail("b2", `${person.label}'s P workstreams changed during each of 3 screen reads, so the screen can't be graded against them`);
        continue;
      }
      const want = Object.values(workstreams).map((w) => w.id);
      if (drawn.value === undefined) r.fail("b2", `${person.label}'s P Workstreams tab failed: ${drawn.errors.join(" | ")}`);
      else {
        const ids = drawn.value.entries.map((x) => `${x.owner}/${x.id}`);
        const ownersDrawn = new Set(drawn.value.entries.filter((x) => want.includes(x.id)).map((x) => x.owner));
        const objectives = entries.flatMap((x) => x.objectives);
        if (drawn.value.count !== entries.length || entries.length !== 2) r.fail("b2", `${person.label}'s P progress counts ${drawn.value.count} workstreams; the store holds ${entries.length} (wanted 2)`);
        if (!ownersDrawn.has(A.userId) || !ownersDrawn.has(B.userId)) r.fail("b2", `${person.label}'s P Workstreams draws ${show(ids)}: not both owners' workstreams`);
        if (!drawn.value.objectives.startsWith(`${objectives.filter((x) => x.met).length} of ${objectives.length}`)) r.fail("b2", `${person.label}'s P progress says "${drawn.value.objectives}", the entries hold ${objectives.length} objectives`);
        else r.saw("b2", `${person.label}'s P view counts ${drawn.value.count} workstreams (${show(ids)}) and "${drawn.value.objectives}"`);
      }
    }
  } else if (runs("b2")) r.notRun("b2", "needs b1's shared project");

  if (runs("b3") && workstreams.alice !== undefined && workstreams.bob !== undefined) {
    o.say("b3: each hands further work to their own workstream");
    r.via("b3", "screen");
    for (const [who, person, owner, key] of [[alice, A, true, "alice"], [bob, B, false, "bob"]] as const) {
      const mine = workstreams[key]!;
      const other = workstreams[key === "alice" ? "bob" : "alice"]!;
      const w = `${word()}-${hex()}`;
      // Earlier steps' work (b2's leads filing) settles first, so what appears next is this hand-off's.
      await quiet(o.store);
      // A workstream's session works one routed task at a time (FIX-2083): b2's hand-off still open there
      // (its lead parked on a question, or waiting on work it filed) holds this one until it ends. The person
      // cancels it through the app first, so this step grades the new hand-off, not the order of two.
      for (const open of conversationRecord(o.store, person.userId, pcSession[key]!).ledger.filter((d) => !["completed", "errored", "cancelled"].includes(d.rowStatus))) {
        const cancelled = await act(who, COORDINATOR, pcSession[key]!, "updateTask_tasks", { id: open.taskId, status: "cancelled" });
        r.saw("b3", `${person.label} cancelled b2's still-open routed task \`${open.taskId}\` (${open.rowStatus}) first: ${cancelled.status}`);
      }
      await quiet(o.store);
      const before = sessionIds(o.store);
      const entries0 = (await entriesOf(who, P)).length;
      const ledger0 = conversationRecord(o.store, person.userId, pcSession[key]!).ledger.length;
      const asked = await askInStream(o.browser, origin(), person, owner, r, `b3-${key}-stream`, P, `For my workstream "${mine.id}" in this project: please also handle this as part of it (${w}).`);
      if (asked.value === undefined) {
        r.fail("b3", `${person.label} couldn't ask in P's Stream: ${asked.errors.join(" | ")}`);
        continue;
      }
      let delivered: Delivery[] = [];
      for (const until = Date.now() + 180_000; Date.now() < until; await sleep(2_000)) {
        delivered = conversationRecord(o.store, person.userId, asked.value.sessionId).ledger.slice(ledger0);
        if (delivered.some((d) => d.status === "delivered")) break;
      }
      await quiet(o.store);
      const entries1 = await entriesOf(who, P);
      if (entries1.length !== entries0 || entries1.length !== 2) r.fail("b3", `${person.label}'s hand-off opened a workstream: P holds ${entries1.length}, held ${entries0}`);
      const toMine = delivered.filter((d) => d.status === "delivered" && d.sessionId === mine.session);
      const toOther = delivered.filter((d) => d.sessionId === other.session);
      if (toMine.length !== 1) r.fail("b3", `${person.label}'s hand-off: wanted one delivery into their workstream session \`${mine.session}\`; the ledger's new entries are ${show(delivered)}`);
      if (toOther.length > 0) r.fail("b3", `${person.label}'s hand-off went into the other's workstream session \`${other.session}\``);
      const lines = mine.session === null ? [] : await who.routes.items(mine.session, "message");
      const got = lines.some((i) => i.role === "user" && textOf(i).includes(w));
      const answered = lines.filter((i) => i.role === "assistant").length > 0;
      if (!got) r.fail("b3", `${person.label}'s workstream session holds no line with \`${w}\``);
      if (!answered) r.fail("b3", `the lead wrote nothing in ${person.label}'s workstream session`);
      const otherHolds = other.session === null ? false : JSON.stringify(await everythingIn(who === alice ? bob : alice, other.session)).includes(w);
      if (otherHolds) r.fail("b3", `the other owner's workstream session holds ${person.label}'s word`);
      const created = newSessions(o.store, before);
      gradeOwned(r, "b3", created, person.userId, (await who.workforce.roster()).map((x) => x.id), `every session ${person.label}'s hand-off created`);
      if (toMine.length === 1 && got && answered) r.saw("b3", `${person.label}: delivered into their own workstream session \`${mine.session}\`, the lead answered there; P still counts 2`);
    }
  } else if (runs("b3")) r.notRun("b3", "needs b2's two workstreams");

  // ---- b4 · two boards ----
  if (runs("b4")) {
    o.say("b4: two of Alice's conversations with the Shift Coordinator each add a task");
    r.via("b4", "action");
    r.saw("b4", "surface: the app's `createTask_tasks` action as Alice on each conversation; no screen adds a task, and the Shift Coordinator's view draws one conversation (an observation, D2)");
    const delegate = "eng.coder";
    const before = sessionIds(o.store);
    const convs: Array<{ id: string; task?: string; word: string }> = [];
    for (let i = 0; i < 2; i += 1) {
      const created = await alice.flow(COORDINATOR).createSession({ state: { workerId: SHIFT_COORDINATOR } }).catch((e) => ({ error: messageOf(e) }) as any);
      if (created.error !== undefined) {
        r.fail("b4", `Alice's second conversation with the Shift Coordinator couldn't be opened: ${created.error}`);
        continue;
      }
      convs.push({ id: created.id, word: `${word()}-${hex()}` });
    }
    const listed = await act(alice, COORDINATOR, convs[0]?.id ?? "", "listDelegates", {});
    const takes = ((listed.output as any)?.delegates ?? []).filter((d: any) => d.takes === "tasks" || d.takes === "both").map((d: any) => d.worker);
    if (!takes.includes(delegate)) r.fail("b4", `the Shift Coordinator's conversation has no task-taking delegate \`${delegate}\`: ${show((listed.output as any)?.delegates)}`);
    const t0 = Date.now();
    await Promise.all(
      convs.map(async (c) => {
        const filed = await act(alice, COORDINATOR, c.id, "createTask_tasks", { goal: `Write a short note file in the storefront checkout recording the code ${c.word}, and commit it.`, assignee: delegate, input: { project: { visibility: "shared", id: "storefront" } } });
        c.task = (filed.output as any)?.taskId ?? (filed.output as any)?.task?.id;
        if (filed.status !== "completed" || c.task === undefined) r.fail("b4", `createTask on \`${c.id}\` ended ${filed.status}: ${filed.error ?? show(filed.output)}`);
      }),
    );
    for (const until = Date.now() + 300_000; Date.now() < until; await sleep(2_000)) {
      const rows = taskRows(o.store).filter((t) => convs.some((c) => c.task === t.id));
      if (rows.length === convs.length && rows.every((t) => !["pending", "in_progress", "claimed"].includes(t.status))) break;
    }
    const rows = taskRows(o.store);
    const runsIn = new Map<string, string>();
    for (const c of convs) {
      const row = rows.find((t) => t.id === c.task);
      // A filed task with no stored row is not skipped: b4 would grade nothing about it and stay green.
      if (row === undefined) {
        r.fail("b4", `task \`${c.task ?? "(no id)"}\` from \`${c.id}\` has no stored row, so its partition, session and outcome can't be told`);
        continue;
      }
      if (!row.partition.startsWith(c.id)) r.fail("b4", `task \`${row.id}\` from \`${c.id}\` sits in partition \`${row.partition}\`, not that conversation's`);
      // b4 grades partitioning, not coding: a scripted run can't write the code
      // word, so the coder's judge may refuse it. That refusal is the task's own
      // outcome; any other error (a run that broke) still fails.
      const judgeRefused = row.status === "errored" && (row.error ?? "").startsWith("the judge found the task not done");
      if (row.status !== "completed" && !judgeRefused) r.fail("b4", `task \`${row.id}\` ended \`${row.status}\`${row.error === undefined ? "" : `: ${row.error}`}`);
      const session = sessionRows(o.store).find((s) => s.id === row.run?.sessionId || s.id.endsWith(`:${row.run?.sessionId}`));
      if (session === undefined || session.userId !== A.userId || before.has(session.id)) r.fail("b4", `task \`${row.id}\` ran in ${session === undefined ? "no stored session" : `\`${session.id}\` (${session.userId}${before.has(session.id) ? ", not new" : ""})`}`);
      else runsIn.set(row.id, session.id);
      const own = await act(alice, COORDINATOR, c.id, "listTasks_tasks", {});
      const ids = ((own.output as any)?.tasks ?? []).map((t: any) => t.id);
      if (!sameSet(ids, [c.task!])) r.fail("b4", `conversation \`${c.id}\` lists ${show(ids)}, not only its own \`${c.task}\``);
    }
    if (new Set(runsIn.values()).size !== runsIn.size) r.fail("b4", `two tasks ran in one session: ${show([...runsIn])}`);
    // Each conversation's drain doesn't wait on the other's: the run of each
    // board ended before the other's task did, or both ran side by side.
    const done = convs.map((c) => rows.find((t) => t.id === c.task)?.completedAt ?? Number.NaN);
    r.saw("b4", `tasks ${convs.map((c, i) => `\`${c.task}\` in \`${c.id}\` → ${rows.find((t) => t.id === c.task)?.status} after ${Math.round((done[i]! - t0) / 1000)} s in \`${runsIn.get(c.task ?? "")}\``).join("; ")}`);
    // Without both end times the side-by-side claim reads nothing; that is not a pass.
    const unended = convs.filter((_, i) => !Number.isFinite(done[i]!));
    if (convs.length !== 2 || unended.length > 0) r.fail("b4", `can't tell whether the two boards ran side by side: ${convs.length} conversation(s), ${unended.length === 0 ? "every task ended" : `no recorded end for ${unended.map((c) => `\`${c.task ?? c.id}\``).join(", ")}`}`);
    else if (Math.abs(done[0]! - done[1]!) > 55_000) r.fail("b4", `the two tasks ended ${Math.round(Math.abs(done[0]! - done[1]!) / 1000)} s apart: one board's drain waited on the other's`);
  }

  // ---- b5 · the EM adds tasks, and the result comes back up ----
  if (runs("b5")) {
    o.say("b5: on Storefront, Alice asks her project coordinator for a two-part feature");
    r.via("b5", "screen");
    const S: ProjectAt = { visibility: "shared", id: "storefront" };
    const [one, two] = [pick(["a compare button on each product card", "a quick-view button on each product card", "a save-for-later button on each cart line"]), pick(["a comparison page that lists the chosen products", "a quick-view panel that shows the product's details", "a saved-for-later list under the cart"])];
    const before = sessionIds(o.store);
    const entries0 = (await entriesOf(alice, S)).filter((e) => e.owner === A.userId).map((e) => e.id);
    const roster0 = await ownIds(alice);
    const asked = await askInStream(o.browser, origin(), A, true, r, "b5-alice-stream", S, `I need a two-part feature built: first ${one}, then ${two}.`);
    if (asked.value === undefined) r.fail("b5", `Alice couldn't ask in Storefront's Stream: ${asked.errors.join(" | ")}`);
    else {
      let ws: Entry | undefined;
      for (const until = Date.now() + 180_000; Date.now() < until && ws === undefined; await sleep(2_000)) {
        ws = (await entriesOf(alice, S)).find((e) => e.owner === A.userId && !entries0.includes(e.id) && e.sessionId !== null);
      }
      if (ws === undefined) r.fail("b5", "no workstream of Alice's was opened on Storefront within 180 s");
      else {
        facts.emWorkstream = { id: ws.id, session: ws.sessionId! };
        const lead = (await alice.workforce.roster()).find((e) => e.id === ws!.lead);
        if (lead?.flow !== "em") r.fail("b5", `the workstream \`${ws.id}\` is led by \`${ws.lead}\` (${lead?.flow ?? "not on her roster"}), not the EM`);
        else r.saw("b5", `the coordinator opened \`${ws.id}\` led by \`${ws.lead}\` on \`em\`, session \`${ws.sessionId}\``);
        await quiet(o.store, 420_000, 15_000);
        const filed = taskRows(o.store).filter((t) => t.partition.startsWith(ws!.sessionId!));
        const emItems = await alice.routes.items(ws.sessionId!, "");
        const adds = emItems.filter((i) => i.type === "tool_output" && /(^|[._/])createTask$/.test(String(i.toolCall?.name ?? "")));
        if (adds.length === 0) r.fail("b5", `the EM's workstream session called no \`createTask\` (items: ${emItems.map((i) => i.type).join(",")})`);
        if (filed.length === 0) r.fail("b5", "no task row sits on the workstream session's board");
        const coderish = filed.filter((t) => t.assignee === "eng.coder" || t.assignee === "eng.reviewer");
        if (coderish.length !== filed.length) r.fail("b5", `a task's assignee isn't a DevTeam standard worker: ${show(filed.map((t) => t.assignee))}`);
        const named = filed.filter((t) => harnessFeatureOf(t.input) !== undefined);
        if (named.length !== filed.length) r.fail("b5", `a task names no issue and phase: ${show(filed.map((t) => t.input))}`);
        const unsettled = filed.filter((t) => !["completed", "errored", "cancelled", "failed"].includes(t.status));
        if (unsettled.length > 0) r.fail("b5", `task(s) never ended: ${show(unsettled.map((t) => `${t.id}:${t.status}`))}`);
        // What the session heard: the notices sent into it, not the lead's own replies that name a task.
        const lines = emItems.filter((i) => i.type === "message" && (i as { provenance?: { blockName?: string } }).provenance?.blockName === "conversation-task-line");
        for (const t of filed) {
          const heard = new Set(lines.filter((i) => textOf(i).includes(t.id)).map((i) => i.requestId)).size;
          if (heard !== 1 && !["pending"].includes(t.status)) r.fail("b5", `the EM's workstream session heard task \`${t.id}\` end ${heard} times, not once`);
        }
        const updates = emItems.filter((i) => i.type === "tool_output" && /updateWorkstream$/.test(String(i.toolCall?.name ?? "")));
        const at = (i: { ts?: number; createdAt?: number }) => i.ts ?? i.createdAt ?? 0;
        const lastAdd = Math.max(...adds.map(at));
        const after = updates.filter((i) => at(i) > lastAdd);
        if (after.length === 0) r.fail("b5", `the EM never updated the workstream entry after filing (no \`updateWorkstream\` after its last \`createTask\` at ${lastAdd}; updates at ${show(updates.map(at))})`);
        const entry = (await entriesOf(alice, S)).find((e) => e.owner === A.userId && e.id === ws!.id);
        const drawn = await projectWorkstreams(o.browser, origin(), A, true, r, "b5-alice-workstreams", S);
        const shown = drawn.value?.entries.find((x) => x.owner === A.userId && x.id === ws!.id);
        if (shown === undefined || entry === undefined || !shown.text.toLowerCase().includes(entry.status.toLowerCase())) r.fail("b5", `Alice's Storefront screen doesn't show the entry's status \`${entry?.status}\` (${shown?.text ?? drawn.errors.join(" | ")})`);
        else r.saw("b5", `Alice's Storefront screen shows \`${ws.id}\` with status \`${entry.status}\``);
        r.saw("b5", `${filed.length} task(s) on the workstream session's board: ${filed.map((t) => `\`${t.id}\` ${t.assignee} ${show(t.input)} → ${t.status}${t.error === undefined ? "" : ` (${String(t.error).slice(0, 120)})`}`).join("; ")}`);
        // The coordinator's hand-off of the ask into the workstream session is a routed task on its own board, targeted at that session; any other row makes a third board.
        const handOff = (t: StoredTask) => isRoutedTask(t) && (t.targetSessionId ?? t.sealed?.session?.id) === ws!.sessionId;
        const boards = new Set(taskRows(o.store).filter((t) => !handOff(t) && !before.has(t.partition.split("~")[0]!) && t.partition.split("~")[0] !== ws!.sessionId && newSessions(o.store, before).some((s) => t.partition.startsWith(s.id))).map((t) => t.partition));
        if (boards.size > 0) r.fail("b5", `a third board holds rows: ${show([...boards])}`);
        const created = newSessions(o.store, before);
        gradeOwned(r, "b5", created, A.userId, (await alice.workforce.roster()).map((x) => x.id), "every session b5 created");
        if (!sameSet(await ownIds(alice), roster0)) r.fail("b5", "something was added to Alice's roster");
      }
    }
  }

  // ---- b6 · no task-taking delegate, no task tools ----
  if (runs("b6")) {
    o.say("b6: a worker with no task-taking delegate has no task tools");
    r.via("b6", "turn");
    // Picked off the shipped tree: the project coordinator lists no delegates,
    // and on Alice's private project, where she holds no workstream, it has none.
    facts.b6Worker = PROJECT_COORDINATOR;
    const at = facts.projects === undefined ? undefined : Q;
    if (at === undefined) r.notRun("b6", "needs b1's private project");
    else {
      const s = await alice.workforce.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: at } as never);
      const listed = await act(alice, COORDINATOR, s.id, "listDelegates", {});
      const delegates = (listed.output as any)?.delegates ?? [];
      if (delegates.some((d: any) => d.takes === "tasks" || d.takes === "both")) r.fail("b6", `setup: the picked conversation has a task-taking delegate: ${show(delegates)}`);
      const turn = await talk(r, "b6", alice, { id: s.id, flowKind: COORDINATOR }, "respond", "Before anything else: list every tool you can call in this conversation, by its exact name, one per line.");
      const traces = await alice.routes.items(s.id, "block_trace");
      const offered = new Set<string>();
      for (const t of traces.filter((x) => x.requestId === turn.requestId)) {
        const tools = (t as any).generator?.tools ?? (t as any).tools ?? (t as any).input?.tools ?? (t as any).request?.tools;
        if (Array.isArray(tools)) for (const x of tools) offered.add(typeof x === "string" ? x : String(x?.name ?? ""));
        else if (tools !== undefined && typeof tools === "object") for (const k of Object.keys(tools)) offered.add(k);
      }
      const called = turn.tools.map((t) => t.name);
      const hit = TASK_TOOLS.filter((n) => [...offered, ...called].some((x) => x === n || x.endsWith(`_${n}`) || x.endsWith(`.${n}`) || x.endsWith(`/${n}`)));
      if (offered.size === 0) r.notRun("b6", `the turn's items carry no tool list to read (${traces.length} trace items); graded on the tools it called only: ${show(called)}`);
      if (hit.length > 0) r.fail("b6", `the turn's tool list holds task tools: ${hit.join(", ")}`);
      else r.saw("b6", `the turn offered ${offered.size === 0 ? "(unread)" : show([...offered])} and called ${show(called)}: none of the task tools`);
      r.via("b6", "action");
      const tasksBefore = taskRows(o.store).length;
      const refused = await act(alice, COORDINATOR, s.id, "createTask_tasks", { goal: `b6 ${hex()}`, assignee: "eng.coder" });
      const declined = (refused.output as { ok?: boolean } | undefined)?.ok === false;
      if (refused.status === "completed" && declined) r.saw("b6", `the app's createTask on \`${s.id}\`: refused in its output: ${show(refused.output)}`);
      else if (refused.status === "completed") r.fail("b6", `the app's createTask on \`${s.id}\` was accepted: ${show(refused.output)}`);
      else r.saw("b6", `the app's createTask on \`${s.id}\`: refused (${refused.status}: ${String(refused.error).slice(0, 160)})`);
      if (taskRows(o.store).length !== tasksBefore) r.fail("b6", "a task row was stored");
    }
  }

  // ---- b7 · restart ----
  const readB = async () => ({
    p: await entriesOf(alice, P).then((xs) => xs.map((e) => `${e.owner}/${e.id}:${e.lead}:${e.sessionId}`).sort(), () => []),
    projectsA: await projectsOf(alice).then((x) => [...x.shared.map((p) => `s:${p.id}`), ...x.private.map((p) => `p:${p.id}`)].sort()),
    projectsB: await projectsOf(bob).then((x) => [...x.shared.map((p) => `s:${p.id}`), ...x.private.map((p) => `p:${p.id}`)].sort()),
    tasks: taskRows(o.store).map((t) => `${t.partition}/${t.id}:${t.status}`).sort(),
  });
  if (runs("b7")) {
    const before = JSON.stringify(await readB());
    await o.install.stop();
    await o.install.boot("legs a-b boot 3 (b7)", o.configs.first, o.env);
    alice = o.install.as(A);
    bob = o.install.as(B);
    r.via("b7", "action");
    const after = JSON.stringify(await readB());
    if (after !== before) r.fail("b7", `b1 to b6 read differently after a restart: ${before.slice(0, 700)} → ${after.slice(0, 700)}`);
    else r.saw("b7", "projects, entries and task rows read the same on a new process");
  }
  await o.install.stop();
  return facts;
}

// ---- leg c ---------------------------------------------------------------------------------

/** Leg c on its own store: Alice builds what Bob reaches for, through the app, then c1 to c6. */
export async function legC(o: LegOptions): Promise<LegFacts> {
  const r = o.record;
  const runs = (step: string) => o.only === undefined || o.only.has(step);
  const facts: LegFacts = { notes: [] };
  const { alice: A, bob: B } = o.people;
  await o.install.boot("leg c boot 1", o.configs.first, o.env);
  const alice = o.install.as(A);
  const bob = o.install.as(B);
  const theWord = `${word()}-${word()}-${hex()}`;
  facts.forkWord = theWord;
  const wordIn = (s: string) => s.toLowerCase().includes(theWord);

  // Setup, through the app as Alice: a fork, her coordinator with it as a delegate, a word given to the fork, a shared and a private project, a workstream entry on the shared one.
  const standard = (await alice.workforce.roster()).filter((e) => e.standard);
  const from = forkableStandard(standard)[0];
  const rosterSession = await sessionOn(alice, ROSTER);
  const fork = `${word()}-${hex()}`;
  const coord = `${word()}-desk-${hex()}`;
  const P: ProjectAt = { visibility: "shared", id: `${word()}-${hex()}` };
  const Q: ProjectAt = { visibility: "private", id: `${word()}-${hex()}` };
  const setup: string[] = [];
  const ok = (what: string, acted: { status: string; error?: string; output?: unknown }) => {
    if (acted.status !== "completed") throw new Error(`setup: ${what} ended ${acted.status}: ${acted.error ?? show(acted.output)}`);
    setup.push(what);
  };
  let conv: SessionSummary | undefined;
  let forkSession: SessionSummary | undefined;
  let entryId: string | undefined;
  try {
    if (from === undefined) throw new Error("setup: no standard worker has a held-out ask");
    ok(`fork \`${from.id}\` as \`${fork}\``, await act(alice, ROSTER, rosterSession, "fork", { from: from.id, id: fork }));
    facts.fork = fork;
    ok(`hire coordinator \`${coord}\` (best-fit)`, await act(alice, ROSTER, rosterSession, "hire", { id: coord, flow: COORDINATOR, description: "Alice's own desk.", settings: { routing: "best-fit", model: "openai/gpt-5.4-mini" } }));
    facts.coordinator = coord;
    conv = await alice.workforce.ensureWorkerSession({ worker: coord });
    ok(`addDelegate \`${fork}\` on \`${conv.id}\``, await act(alice, COORDINATOR, conv.id, "addDelegate", { worker: fork }));
    forkSession = await alice.workforce.ensureWorkerSession({ worker: fork });
    const told = await talk(r, "c-setup", alice, { id: forkSession.id, flowKind: forkSession.flowKind }, "respond", `Please remember this code word for our later conversations: ${theWord}. Reply with one word: noted.`);
    if (!JSON.stringify(await alice.routes.items(forkSession.id, "message")).toLowerCase().includes(theWord)) throw new Error(`setup: the word is not in Alice's fork session (${told.status})`);
    setup.push(`gave \`${fork}\` the word in \`${forkSession.id}\``);
    const projects = await sessionOn(alice, PROJECTS);
    ok(`createProject shared \`${P.id}\` with Bob`, await act(alice, PROJECTS, projects, "createProject", { id: P.id, title: `Shared ${P.id}`, visibility: "shared", members: [B.userId] }));
    ok(`createProject private \`${Q.id}\``, await act(alice, PROJECTS, projects, "createProject", { id: Q.id, title: `Private ${Q.id}`, visibility: "private" }));
    entryId = `${word()}-${hex()}`;
    const pc = await alice.workforce.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: P } as never);
    ok(`openWorkstream \`${entryId}\` on \`${P.id}\`, led by eng.em`, await act(alice, PROJECTS, pc.id, "openWorkstream", { projectId: P, id: entryId, title: `Alice's ${entryId}`, lead: "eng.em", objectives: ["Keep it"] }).then(async (x) => (x.status === "completed" ? x : act(alice, PROJECTS, projects, "openWorkstream", { project: P, id: entryId, title: `Alice's ${entryId}`, lead: "eng.em", objectives: ["Keep it"] }))));
    r.saw("c-setup", `through the app as Alice: ${setup.join("; ")}`);
  } catch (error) {
    r.fail("c-setup", messageOf(error));
  }
  r.via("c-setup", "action");

  // ---- c1 · session ----
  if (runs("c1")) {
    r.via("c1", "HTTP");
    if (conv === undefined) r.notRun("c1", "needs the setup's coordinator conversation");
    else {
      const before = (await alice.routes.items(conv.id, "")).length;
      const opened = await refusal(() => bob.sessions.get(conv!.id));
      if (opened.status === undefined) r.fail("c1", `Bob opened Alice's coordinator conversation \`${conv.id}\``);
      else r.saw("c1", `Bob opening \`${conv.id}\`: refused, ${opened.status}`);
      const token = `bob-${hex(3)}`;
      for (const [how, client] of [["as himself", bob.flow(COORDINATOR)], ["naming Alice's user id in the body", bob.flow(COORDINATOR, A.userId)]] as const) {
        const posted = await refusal(() => client.send("respond", { message: `${token} ${how}` }, { sessionId: conv!.id }));
        if (posted.status === undefined) r.fail("c1", `Bob's post to Alice's conversation ${how} was accepted`);
        else r.saw("c1", `Bob posting ${how}: refused, ${posted.status}`);
      }
      await sleep(1_500);
      const after = await alice.routes.items(conv.id, "");
      if (after.some((i) => JSON.stringify(i).includes(token)) || after.length !== before) r.fail("c1", `Alice's conversation changed while Bob posted (${before} → ${after.length} items)`);
      else r.saw("c1", `store: her conversation still holds ${after.length} items`);
    }
  }

  // ---- c2 · worker ----
  if (runs("c2")) {
    r.via("c2", "HTTP");
    const readsHers = "Bob reads Alice's worker";
    if (facts.fork === undefined || from === undefined) r.notRun("c2", "needs the setup's fork");
    else {
      const bobRoster = await refusal(() => bob.workforce.roster());
      if (bobRoster.status !== undefined) r.fail("c2", `Bob's roster can't be read: ${bobRoster.error}`);
      else if ((bobRoster.value as RosterEntry[]).some((e) => e.id === fork)) r.fail("c2", `${readsHers}: his roster lists \`${fork}\``);
      else r.saw("c2", `Bob's roster doesn't list \`${fork}\``);
      const bobSession = await sessionOn(bob, ROSTER);
      const bobRows = await rowsOf(bob, bobSession, WORKERS);
      if (bobRows.rows.some((x) => named(x.topic, fork))) r.fail("c2", `${readsHers}: the worker collection through his session holds it`);
      const byKey = await refusal(() => bob.resources.getCollectionItemState(bobSession, bobRows.ref, `workforce/workers/${fork}`));
      if (byKey.status === undefined && byKey.value != null) r.fail("c2", `${readsHers}: read back by key: ${show(byKey.value)}`);
      else r.saw("c2", `Bob reading it by key: ${byKey.status === undefined ? "not found" : `refused, ${byKey.status}`}`);
      const through = await refusal(() => bob.resources.listCollectionItems(rosterSession, "workforceWorkers"));
      if (through.status === undefined) r.fail("c2", `${readsHers}: listed through Alice's own roster session`);
      const bobFork = `${word()}-${hex()}`;
      const made = await act(bob, ROSTER, bobSession, "fork", { from: from.id, id: bobFork });
      if (made.status !== "completed") r.fail("c2", `Bob's fork ended ${made.status}: ${made.error}`);
      else {
        const s = await bob.workforce.ensureWorkerSession({ worker: bobFork });
        const turn = await talk(r, "c2", bob, { id: s.id, flowKind: s.flowKind }, "respond", "Has anyone given you, or any worker you know of, a code word to remember? If you know one, reply with it exactly. If not, reply NONE.");
        r.via("c2", "turn");
        if (wordIn(turn.reply)) r.fail("c2", `Bob's fork answered with Alice's word: "${turn.reply.slice(0, 300)}"`);
        else r.saw("c2", `Bob's fork answered without her word: "${turn.reply.replace(/\s+/g, " ").slice(0, 200)}"`);
        const holding: string[] = [];
        for (const x of await bob.routes.sessions()) if (wordIn(await everythingIn(bob, x.id))) holding.push(x.id);
        if (holding.length > 0) r.fail("c2", `Alice's word is in Bob's session(s) ${holding.join(", ")}`);
      }
      const drawn = await rosterRows(o.browser, o.install.origin, B, false, r, "c2-bob-roster");
      r.via("c2", "screen");
      if (drawn.value?.rows.some((x) => x.id === fork)) r.fail("c2", `${readsHers}: his Roster screen draws \`${fork}\``);
      else if (drawn.value === undefined || drawn.value.ownUnread !== undefined) r.notRun("c2", `Bob's Roster screen can't show it leaves the fork out: ${drawn.value?.ownUnread ?? drawn.errors.join(" | ")}`);
      else r.saw("c2", `Bob's Roster draws ${drawn.value.rows.length} workers, not \`${fork}\``);
    }
  }

  // ---- c3 · link ----
  if (runs("c3")) {
    r.via("c3", "HTTP");
    if (facts.fork === undefined || from === undefined) r.notRun("c3", "needs the setup's fork");
    else {
      const named = await refusal(() => bob.flow(from.flow).createSession({ state: { workerId: fork } }));
      if (named.status === undefined) r.fail("c3", `Bob created a session naming Alice's fork: \`${(named.value as { id: string }).id}\``);
      else r.saw("c3", `Bob's create naming \`${fork}\`: refused, ${named.status}`);
      const viaTalk = await refusal(() => bob.workforce.ensureWorkerSession({ worker: fork }));
      if (viaTalk.status === undefined) r.fail("c3", "Bob's talk action opened a session on Alice's fork");
      const seeded = await refusal(() => bob.flow(COORDINATOR).createSession({ state: { workerId: SHIFT_COORDINATOR, delegates: [{ worker: fork }] } }));
      if (seeded.status === undefined) r.fail("c3", "Bob created a coordinator session seeding Alice's fork among its delegates");
      else r.saw("c3", `Bob's create seeding delegates: refused, ${seeded.status} (${String(seeded.error).slice(0, 160)})`);
      const bound = sessionRows(o.store).filter((s) => s.userId === B.userId && (s.state.workerId === fork || JSON.stringify(s.state.delegates ?? []).includes(fork)));
      if (bound.length > 0) r.fail("c3", `store: Bob holds session(s) naming Alice's fork: ${bound.map((s) => s.id).join(", ")}`);
    }
  }

  // ---- c4 · delegate (panel, app action and tool, graded apart) ----
  if (runs("c4")) {
    if (facts.fork === undefined) r.notRun("c4", "needs the setup's fork");
    else {
      const missing = `${word()}-${hex()}`;
      const shiftCoordinator = await bob.workforce.ensureWorkerSession({ worker: SHIFT_COORDINATOR });
      r.via("c4", "screen");
      const panel = await delegatesPanel(o.browser, o.install.origin, B, false, r, "c4-bob-delegates");
      if (panel.value === undefined) r.fail("c4", `screen: Bob's delegates panel failed: ${panel.errors.join(" | ")}`);
      else if (panel.value.offered.includes(fork)) r.fail("c4", `screen: Bob's delegates panel offers Alice's fork \`${fork}\``);
      else r.saw("c4", `screen: Bob's delegates panel offers ${show(panel.value.offered)}, not \`${fork}\`; it lists ${show(panel.value.delegates)}`);
      r.via("c4", "action");
      const hers = await act(bob, COORDINATOR, shiftCoordinator.id, "addDelegate", { worker: fork });
      const nobodys = await act(bob, COORDINATOR, shiftCoordinator.id, "addDelegate", { worker: missing });
      const norm = (s: string | undefined, id: string) => String(s ?? "").replaceAll(id, "<id>");
      if (hers.status === "completed") r.fail("c4", `app: Bob's addDelegate naming Alice's fork was accepted: ${show(hers.output)}`);
      else if (norm(hers.error, fork) !== norm(nobodys.error, missing)) r.fail("c4", `app: refused, but not like a missing worker: "${hers.error}" vs "${nobodys.error}"`);
      else r.saw("c4", `app: refused like a missing worker: "${String(hers.error).slice(0, 160)}"`);
      r.via("c4", "turn");
      const turn = await talk(r, "c4", bob, { id: shiftCoordinator.id, flowKind: shiftCoordinator.flowKind }, "respond", `Please add the worker "${fork}" as a delegate in this conversation with addDelegate. Don't hire anyone.`);
      const adds = turn.tools.filter((t) => /addDelegate$/.test(t.name));
      if (adds.length === 0) r.notRun("c4", `tool: the turn called no addDelegate, so the tool path didn't run (reply: "${turn.reply.slice(0, 200)}")`);
      else if (adds.some((t) => !/No worker|not on your roster|refus/i.test(t.output) || /"ok":true/.test(t.output))) r.fail("c4", `tool: an addDelegate naming Alice's fork wasn't refused: ${show(adds)}`);
      else r.saw("c4", `tool: addDelegate refused: ${adds.map((t) => `${t.output}#${t.itemId}`).join("; ").slice(0, 300)}`);
      const list = conversationRecord(o.store, B.userId, shiftCoordinator.id).delegates?.map((d) => d.worker) ?? [];
      if (list.includes(fork)) r.fail("c4", `store: Alice's fork is on Bob's conversation's delegates ${show(list)}`);
    }
  }

  // ---- c5 · entry ----
  if (runs("c5")) {
    r.via("c5", "HTTP");
    if (entryId === undefined) r.notRun("c5", "needs the setup's workstream entry");
    else {
      const before = (await entriesOf(alice, P)).find((e) => e.id === entryId && e.owner === A.userId);
      const bobProjects = await sessionOn(bob, PROJECTS);
      const app = await act(bob, PROJECTS, bobProjects, "updateWorkstream", { projectId: P, owner: A.userId, id: entryId, status: "blocked" });
      if (app.status === "completed") r.fail("c5", `app: Bob's updateWorkstream on Alice's entry was accepted: ${show(app.output)}`);
      else r.saw("c5", `app: Bob's updateWorkstream on her entry: refused (${String(app.error).slice(0, 160)})`);
      r.via("c5", "turn");
      const em = await bob.workforce.ensureWorkerSession({ worker: "eng.em" });
      const turn = await talk(r, "c5", bob, { id: em.id, flowKind: em.flowKind }, "respond", `Use updateWorkstream to set the status of the workstream "${entryId}" in project "${P.id}", owned by ${A.userId}, to blocked.`);
      const updates = turn.tools.filter((t) => /updateWorkstream$/.test(t.name));
      if (updates.length === 0) r.notRun("c5", `tool: the worker's turn called no updateWorkstream, so the tool path didn't run (reply "${turn.reply.slice(0, 200)}")`);
      else r.saw("c5", `tool: ${updates.map((t) => `${t.output}#${t.itemId}`).join("; ").slice(0, 300)}`);
      await quiet(o.store, 120_000);
      const after = (await entriesOf(alice, P)).find((e) => e.id === entryId && e.owner === A.userId);
      if (JSON.stringify(after) !== JSON.stringify(before)) r.fail("c5", `Alice's entry changed: ${show(before)} → ${show(after)}`);
      else r.saw("c5", "store: Alice's entry reads back unchanged");
      r.via("c5", "HTTP");
      const bp = await projectsOf(bob);
      if ([...bp.shared, ...bp.private].some((p) => p.id === Q.id)) r.fail("c5", `Bob lists Alice's private project \`${Q.id}\``);
      const bobRoster = await sessionOn(bob, ROSTER);
      const byKey = await refusal(() => bob.resources.getCollectionItemState(bobRoster, "privateProjects", `projects/${Q.id}`));
      if (byKey.status === undefined && byKey.value != null) r.fail("c5", `Bob read Alice's private project by key: ${show(byKey.value)}`);
      const pc = await refusal(() => bob.workforce.ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: Q } as never));
      if (pc.status === undefined) r.fail("c5", `Bob opened a project coordinator on Alice's private project: \`${(pc.value as SessionSummary).id}\``);
      else r.saw("c5", `Bob listing, reading by key and opening a coordinator on \`${Q.id}\`: none reach it (${pc.status})`);
    }
  }

  // ---- c6 · second org ----
  if (runs("c6")) {
    const org1 = (await alice.routes.sessions()).map((s) => s.id);
    await o.install.stop();
    await o.install.boot("leg c boot 2 (second-org)", o.configs.second, o.env);
    const alice2 = o.install.as(o.people.alice2);
    r.via("c6", "action");
    const own = (await alice2.workforce.roster()).filter((e) => !e.standard);
    if (own.length > 0) r.fail("c6", `Alice in her second org lists workers: ${own.map((e) => e.id).join(", ")}`);
    const s2 = await alice2.routes.sessions();
    const crossed = s2.filter((s) => org1.includes(s.id));
    if (crossed.length > 0) r.fail("c6", `her second org lists first-org sessions: ${crossed.map((s) => s.id).join(", ")}`);
    const opened: string[] = [];
    for (const id of org1.slice(0, 25)) if ((await refusal(() => alice2.sessions.get(id))).status === undefined) opened.push(id);
    if (opened.length > 0) r.fail("c6", `her second org opens first-org sessions: ${opened.join(", ")}`);
    const pr = await projectsOf(alice2);
    if ([...pr.shared, ...pr.private].some((p) => p.id === P.id || p.id === Q.id)) r.fail("c6", "her second org lists her first org's projects");
    const leaking: string[] = [];
    for (const s of s2) {
      const all = await everythingIn(alice2, s.id);
      if (wordIn(all) || all.includes(fork)) leaking.push(s.id);
    }
    if (leaking.length > 0) r.fail("c6", `first-org data in second-org session(s) ${leaking.join(", ")}`);
    r.via("c6", "screen");
    const drawn = await rosterRows(o.browser, o.install.origin, o.people.alice2, false, r, "c6-alice-second-org-roster");
    if (drawn.value?.rows.some((x) => x.id === fork)) r.fail("c6", `her second-org Roster draws \`${fork}\``);
    else if (drawn.value === undefined || drawn.value.ownUnread !== undefined) r.notRun("c6", `her second-org Roster can't show what it leaves out: ${drawn.value?.ownUnread ?? drawn.errors.join(" | ")}`);
    const groups = await projectGroups(o.browser, o.install.origin, o.people.alice2, false, r, "c6-alice-second-org-projects");
    if ((groups.value ?? []).some((g) => g.endsWith(`:${P.id}`) || g.endsWith(`:${Q.id}`))) r.fail("c6", `her second-org PROJECTS draws her first org's projects: ${show(groups.value)}`);
    if (r.verdict("c6") === "PASS") r.saw("c6", `second org: no worker of hers, none of ${org1.length} first-org sessions listed or opened, no first-org project, no word or worker in ${s2.length} sessions, Roster and PROJECTS draw none of it`);
  }
  r.saw("c7", "retired (2026-10-07): nothing is upgraded while there are no consumers");
  await o.install.stop();
  return facts;
}

export type { Turn };
