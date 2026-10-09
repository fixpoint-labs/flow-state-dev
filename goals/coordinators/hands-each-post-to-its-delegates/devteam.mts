/**
 * Legs a to d and f: the DevTeam install, served by Shift Manager's own
 * command, with Alice (its owner) and Bob (its second member) each acting
 * through the shipped clients with their own verified bearer, and the chief
 * of staff's turns on the real model its file names.
 *
 * Every change goes through the app: an action on a conversation, a person's
 * line to the chief of staff, or the roster flow's `hire`. Nothing is seeded
 * by a fixture or written to a store. Every grade is read back through the
 * install's routes as that person: the conversation's session record (its
 * delegates and its delivery ledger), its items (its routing records and the
 * turn's tool outputs), and the delegate's own session. A reply's words are
 * graded only in leg d, and only against the list the session holds.
 *
 * The clients are loaded from the checkout under test, so a run on another
 * commit drives that commit's own clients.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { labRoutes, type LabRoutes, type StoredItem } from "../../lib/shift-manager.mts";

/** One person the run acts as. */
export interface Person {
  label: string;
  userId: string;
  bearer: string;
}

type RosterEntry = { id: string; flow: string; standard: boolean; description: string | null };
type SessionSummary = { id: string; flowKind: string };

/** The shipped clients, as the checkout under test exports them. */
export interface Shipped {
  client: {
    createClient(options: { flowKind: string; userId: string; baseUrl?: string; fetcher?: typeof fetch }): {
      sendAction(action: string, input: unknown, options: { sessionId: string }): Promise<{ request: { id: string } }>;
      getRequestStatus(requestId: string): Promise<{ status: string }>;
    };
    createSessionClient(options: { baseUrl?: string; fetcher?: typeof fetch }): {
      createSession(options: { flowKind: string; userId: string; sessionId?: string; state?: Record<string, unknown> }): Promise<{ id: string }>;
      listSessions(options: { flowKind?: string; userId?: string }): Promise<Array<{ id: string; createdAt: number }>>;
    };
  };
  workforce: {
    createWorkforceClient(options: { userId: string; baseUrl?: string; fetcher?: typeof fetch }): {
      roster(): Promise<RosterEntry[]>;
      ensureWorkerSession(criteria: { worker: string }): Promise<SessionSummary>;
    };
  };
}

/** Load the shipped clients from the checkout at `root`. */
export async function loadShipped(root: string): Promise<Shipped> {
  const client = (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as Shipped["client"];
  const workforce = (await import(pathToFileURL(join(root, "packages", "workforce", "src", "browser.ts")).href)) as Shipped["workforce"];
  return { client, workforce };
}

/** A person connected to the served install. */
interface Connected {
  person: Person;
  workforce: ReturnType<Shipped["workforce"]["createWorkforceClient"]>;
  sessions: ReturnType<Shipped["client"]["createSessionClient"]>;
  flow(flowKind: string): ReturnType<Shipped["client"]["createClient"]>;
  routes: LabRoutes;
}

function connect(shipped: Shipped, origin: string, person: Person): Connected {
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  return {
    person,
    workforce: shipped.workforce.createWorkforceClient({ userId: person.userId, ...transport }),
    sessions: shipped.client.createSessionClient(transport),
    flow: (flowKind) => shipped.client.createClient({ flowKind, userId: person.userId, ...transport }),
    routes: labRoutes(origin, { userId: person.userId, bearer: person.bearer }),
  };
}

const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const hex = () => randomBytes(3).toString("hex");
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
/** A held-out word, fresh per run. */
export const word = () => `${WORDS[randomBytes(1)[0]! % WORDS.length]}${hex()}`;

/** One action's end: its status, and its output or error, read back from the store. */
interface Acted {
  status: string;
  requestId: string | null;
  output: any;
  error: string | undefined;
}

async function act(who: Connected, flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 120_000): Promise<Acted> {
  const client = who.flow(flowKind);
  let requestId: string;
  try {
    requestId = (await client.sendAction(action, input, { sessionId })).request.id;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error) };
  }
  let status = "timed-out";
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(400)) {
    const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status;
    if (now !== undefined && !RUNNING.has(now)) {
      status = now;
      break;
    }
  }
  const found = (await who.routes.requests(sessionId).catch(() => [])).find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
}

/** One turn with the chief of staff, as the store holds it. */
export interface Turn {
  leg: string;
  words: string;
  sessionId: string;
  requestId: string | null;
  status: string;
  tools: Array<{ name: string; args: string; output: any }>;
  reply: string;
  providerRetry?: string;
}

function textOf(item: StoredItem | undefined): string {
  if (item === undefined) return "";
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n");
  return JSON.stringify(c ?? "");
}

function parsed(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** A provider error: the model never answered, as opposed to a turn that answered wrong. */
const providerError = (text: string) => /rate.?limit|429|5\d\d |overloaded|timed? ?out|ECONNRESET|fetch failed|provider|gateway|unavailable|stream failed/i.test(text);

/** Say `words` to the chief of staff in `session`, and read the turn back by its request id. A provider error re-runs it once. */
async function talk(turns: Turn[], leg: string, who: Connected, session: SessionSummary, words: string): Promise<Turn> {
  const once = async (): Promise<Turn> => {
    const acted = await act(who, session.flowKind, session.id, "run", { message: words }, 240_000);
    const turn: Turn = { leg, words, sessionId: session.id, requestId: acted.requestId, status: acted.status, tools: [], reply: "" };
    if (acted.requestId === null) {
      turn.reply = `refused: ${acted.error ?? ""}`;
      return turn;
    }
    const mine = (await who.routes.items(session.id, "")).filter((i) => i.requestId === acted.requestId);
    turn.tools = mine
      .filter((i) => i.type === "tool_output")
      .map((i) => ({ name: String(i.toolCall?.name ?? ""), args: String(i.toolCall?.arguments ?? "").slice(0, 300), output: parsed(i.output ?? i.error ?? null) }));
    const reply = mine.filter((i) => i.type === "message" && i.role === "assistant").at(-1);
    turn.reply = reply !== undefined ? textOf(reply) : (acted.error ?? `no reply (${acted.status})`);
    return turn;
  };
  let turn = await once();
  if (turn.status !== "completed" && providerError(turn.reply)) {
    const first = turn.reply;
    turn = await once();
    turn.providerRetry = first.slice(0, 200);
  }
  turns.push(turn);
  return turn;
}

type Delivery = { postId: string; round: number; delegate: { worker: string; target?: string }; status: string; sessionId?: string; answered: boolean };

/** A conversation's session record: its delegates, its fallback and its delivery ledger. */
async function recordOf(who: Connected, sessionId: string): Promise<{ delegates: Array<{ worker: string }> | null; ledger: Delivery[] }> {
  const { session } = await who.routes.get(`/sessions/${encodeURIComponent(sessionId)}`);
  return { delegates: session?.state?.delegates ?? null, ledger: (session?.state?.deliveries ?? []) as Delivery[] };
}

/** The `coordinator-route` records for one post. */
async function routingOf(who: Connected, sessionId: string, postId: string | null): Promise<Array<Record<string, any>>> {
  if (postId === null) return [];
  return (await who.routes.items(sessionId, "component"))
    .filter((i) => (i as { component?: string }).component === "coordinator-route")
    .map((i) => i.data as Record<string, any>)
    .filter((d) => d?.postId === postId);
}

async function ownWorkers(who: Connected): Promise<string[]> {
  return (await who.workforce.roster()).filter((e) => !e.standard).map((e) => e.id).sort();
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

/** One leg's result: each assertion that failed, by name, and what the run saw. */
export interface LegResult {
  failures: string[];
  notes: string[];
  /** Set when the leg could not be run on this commit at all. */
  notRun?: string;
}

/** What {@link devteamLegs} needs. */
export interface DevteamOptions {
  origin: string;
  shipped: Shipped;
  alice: Person;
  bob: Person;
  /** The chief of staff's default delegates, read from its file on the commit. */
  defaults: string[];
  legs: ReadonlySet<string>;
  asks: { a: string; c: string; d: string; f: string };
  say: (line: string) => void;
}

/** The chief of staff's id: its wire id since FIX-1719, pinned by the spec. */
export const COS = "chief-of-staff";

/** The chief of staff's `delegates:` as the commit's file lists them. */
export function cosDefaults(root: string): string[] {
  const file = join(root, "packages", "shift-manager", "teams", "devteam", "workforce", "org", "workers", COS, "WORKER.md");
  const line = /^delegates:\s*\[(.*)\]\s*$/m.exec(readFileSync(file, "utf8"))?.[1];
  return line === undefined ? [] : line.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function devteamLegs(o: DevteamOptions): Promise<{ legs: Record<string, LegResult>; turns: Turn[] }> {
  const legs: Record<string, LegResult> = {};
  const turns: Turn[] = [];
  const leg = (name: string): LegResult => (legs[name] ??= { failures: [], notes: [] });
  const alice = connect(o.shipped, o.origin, o.alice);
  const bob = connect(o.shipped, o.origin, o.bob);

  // ---- a, b, c: one conversation, opened the way the app opens it --------------
  if (o.legs.has("a") || o.legs.has("b") || o.legs.has("c")) {
    const cos = await alice.workforce.ensureWorkerSession({ worker: COS });
    const own0 = await ownWorkers(alice);
    o.say(`Alice's chief of staff: session ${cos.id} on \`${cos.flowKind}\`; her own workers: ${own0.length === 0 ? "none" : own0.join(", ")}`);
    const em = o.defaults.find((d) => /\.em$/.test(d)) ?? "eng.em";
    const slug = `cart-${hex()}`;
    const theWord = word();
    const askA = o.asks.a.replace("{slug}", slug).replace("{word}", theWord);
    let emSession: string | undefined;

    for (const name of ["a", "b"] as const) {
      if (!o.legs.has(name) && !(name === "a" && o.legs.has("b"))) continue;
      const r = leg(name);
      const sent = Date.now();
      o.say(`leg ${name}: "${askA}"`);
      const turn = await talk(turns, name, alice, cos, askA);
      r.notes.push(`the turn ${turn.status}; tools: ${turn.tools.map((t) => `${t.name}(${t.args}) → ${show(t.output)}`).join("; ") || "none"}; reply: ${turn.reply.slice(0, 300)}`);
      const own = await ownWorkers(alice);
      if (!same(own, own0)) r.failures.push(`${name}:no-hire — Alice's own workers went from [${own0.join(", ")}] to [${own.join(", ")}]`);
      // The delivery to the EM, and its session, within 120 s of the post.
      let mine: Delivery[] = [];
      let opened: { at: number; holdsWord: boolean } | undefined;
      for (const until = sent + 120_000; Date.now() < until; await sleep(1_000)) {
        mine = (await recordOf(alice, cos.id)).ledger.filter((d) => d.postId === turn.requestId);
        const toEm = mine.find((d) => d.delegate.worker === em && d.status === "delivered" && d.sessionId !== undefined);
        if (toEm !== undefined) {
          const items = await alice.routes.items(toEm.sessionId!, "message").catch(() => [] as StoredItem[]);
          if (items.length > 0) {
            opened = { at: Date.now() - sent, holdsWord: items.some((i) => i.role === "user" && textOf(i).includes(theWord)) };
            if (opened.holdsWord) break;
          }
        }
        if (turn.requestId === null) break;
        // Nothing was handed on in the turn: no later delivery comes.
        if (mine.length === 0 && Date.now() - sent > 20_000) break;
      }
      const toEm = mine.filter((d) => d.delegate.worker === em);
      if (mine.length !== 1 || toEm.length !== 1 || toEm[0]!.status !== "delivered") {
        r.failures.push(`${name}:one-delivery — wanted one delivery of the post, to ${em}; the conversation's ledger holds ${mine.length === 0 ? "none" : show(mine)}`);
      } else r.notes.push(`one delivery of the post, to ${em}, into ${toEm[0]!.sessionId}`);
      if (opened === undefined) r.failures.push(`${name}:session-120s — no session of ${em}'s for this conversation held the post within 120 s`);
      else if (!opened.holdsWord) r.failures.push(`${name}:carries-word — ${em}'s session opened, but holds no line with the word "${theWord}"`);
      else r.notes.push(`${em}'s session held the post, with the word, ${Math.round(opened.at / 1000)} s after it was sent`);
      const records = await routingOf(alice, cos.id, turn.requestId);
      const judged = records.filter((d) => d.by === "judgment");
      if (records.length !== 1 || judged.length !== 1 || !(judged[0]!.delegates as any[]).some((d) => d.worker === em && d.outcome === "delivered")) {
        r.failures.push(`${name}:judgment-record — wanted one \`by: judgment\` record delivering to ${em}; the post has ${records.length === 0 ? "none" : show(records)}`);
      }
      if (name === "b" && emSession !== undefined && toEm[0]?.sessionId !== undefined && toEm[0].sessionId !== emSession) {
        r.failures.push(`b:same-session — the second delivery went to ${toEm[0].sessionId}, not leg a's ${emSession}`);
      }
      emSession ??= toEm[0]?.sessionId;
    }

    if (o.legs.has("c")) {
      const r = leg("c");
      const own1 = await ownWorkers(alice);
      o.say(`leg c: "${o.asks.c}"`);
      const first = await talk(turns, "c", alice, cos, o.asks.c);
      r.notes.push(`first ask ${first.status}; tools: ${first.tools.map((t) => `${t.name}(${t.args}) → ${show(t.output)}`).join("; ") || "none"}`);
      const own2 = await ownWorkers(alice);
      const hired = own2.filter((id) => !own1.includes(id));
      const hire = hired[0];
      if (hired.length !== 1) r.failures.push(`c:one-hire — wanted one hire on Alice's roster; her own workers went from [${own1.join(", ")}] to [${own2.join(", ")}]`);
      else r.notes.push(`hired \`${hire}\``);
      const after1 = await recordOf(alice, cos.id);
      if (hire === undefined || !(after1.delegates ?? []).some((d) => d.worker === hire)) {
        r.failures.push(`c:added — the hire is not on this conversation's delegates: ${show(after1.delegates)}`);
      }
      const firstDeliveries = after1.ledger.filter((d) => d.postId === first.requestId);
      if (hire === undefined || firstDeliveries.length !== 1 || firstDeliveries[0]!.delegate.worker !== hire || firstDeliveries[0]!.status !== "delivered") {
        r.failures.push(`c:delivered — wanted one delivery of the ask, to the hire; the ledger holds ${show(firstDeliveries)}`);
      }
      o.say(`leg c, again: "${o.asks.c}"`);
      const again = await talk(turns, "c", alice, cos, o.asks.c);
      r.notes.push(`second ask ${again.status}; tools: ${again.tools.map((t) => `${t.name}(${t.args}) → ${show(t.output)}`).join("; ") || "none"}`);
      const own3 = await ownWorkers(alice);
      if (!same(own3, own2)) r.failures.push(`c:no-second-hire — asked again, her own workers went from [${own2.join(", ")}] to [${own3.join(", ")}]`);
      const againDeliveries = (await recordOf(alice, cos.id)).ledger.filter((d) => d.postId === again.requestId);
      if (hire === undefined || !againDeliveries.some((d) => d.delegate.worker === hire && d.status === "delivered")) {
        r.failures.push(`c:same-worker — asked again, wanted a delivery to ${hire ?? "the hire"}; the ledger holds ${show(againDeliveries)}`);
      }
    }
  }

  // ---- d: change the delegates in the app, then ask who they are --------------
  if (o.legs.has("d")) {
    const r = leg("d");
    const kind = (await alice.workforce.ensureWorkerSession({ worker: COS })).flowKind;
    const conv = await alice.sessions.createSession({ flowKind: kind, userId: o.alice.userId, state: { workerId: COS } });
    const session = { id: conv.id, flowKind: kind };
    const roster = await alice.workforce.roster();
    const removeId = o.defaults[randomBytes(1)[0]! % Math.max(1, o.defaults.length)] ?? "eng.coder";
    // Held out: any worker on her roster that isn't a default and may be added, tried in a random order.
    const pool = roster.filter((e) => e.id !== COS && !o.defaults.includes(e.id)).map((e) => e.id).sort(() => randomBytes(1)[0]! - 128);
    let added: string | undefined;
    const refusals: string[] = [];
    for (const candidate of pool) {
      const tried = await act(alice, kind, session.id, "addDelegate", { worker: candidate });
      if (tried.status === "completed") {
        added = candidate;
        break;
      }
      refusals.push(`${candidate}: ${tried.status} ${tried.error ?? ""}`.trim());
    }
    const removed = await act(alice, kind, session.id, "removeDelegate", { worker: removeId });
    if (added === undefined || removed.status !== "completed") {
      r.notRun = `the app could not change the delegates: add ${added === undefined ? `refused for every candidate (${refusals.join(" / ").slice(0, 400)})` : `\`${added}\``}, remove \`${removeId}\` ${removed.status} ${removed.error ?? ""}`;
      r.failures.push(`d:changed — ${r.notRun}`);
    } else {
      r.notes.push(`Alice added \`${added}\` and removed \`${removeId}\` through the app`);
      const list = ((await recordOf(alice, session.id)).delegates ?? []).map((d) => d.worker);
      r.notes.push(`the session holds [${list.join(", ")}]`);
      o.say(`leg d: "${o.asks.d}"`);
      const turn = await talk(turns, "d", alice, session, o.asks.d);
      const read = turn.tools.find((t) => t.name === "listDelegates");
      r.notes.push(`the turn ${turn.status}; tools: ${turn.tools.map((t) => t.name).join(", ") || "none"}; reply: ${turn.reply.slice(0, 400)}`);
      if (read === undefined) r.failures.push(`d:read-called — the chief of staff answered without calling its delegate read`);
      else {
        const readList = ((read.output?.delegates ?? []) as Array<{ worker: string }>).map((d) => d.worker);
        if (!same(readList, list)) r.failures.push(`d:read-equals-list — the delegate read returned [${readList.join(", ")}]; the session holds [${list.join(", ")}]`);
      }
      const others = [...new Set([...roster.map((e) => e.id), ...o.defaults])].filter((id) => id !== COS && !list.includes(id));
      const missingFromReply = list.filter((id) => !turn.reply.includes(id));
      const extra = others.filter((id) => turn.reply.includes(id));
      if (missingFromReply.length > 0 || extra.length > 0) {
        r.failures.push(
          `d:reply-equals-list — the reply names ${extra.length > 0 ? `[${extra.join(", ")}], which the session doesn't hold` : ""}${extra.length > 0 && missingFromReply.length > 0 ? ", and " : ""}${missingFromReply.length > 0 ? `not [${missingFromReply.join(", ")}], which it does` : ""}`,
        );
      }
    }
  }

  // ---- f: Bob's worker on Alice's conversation --------------------------------
  if (o.legs.has("f")) {
    const r = leg("f");
    const rosterKind = "workforce-roster";
    const bobRoster = (await bob.sessions.listSessions({ flowKind: rosterKind, userId: o.bob.userId }))[0]?.id ??
      (await bob.sessions.createSession({ flowKind: rosterKind, userId: o.bob.userId })).id;
    const bobWorker = `bob-${word()}`;
    const hired = await act(bob, rosterKind, bobRoster, "hire", { id: bobWorker, flow: "agent", description: "Answers Bob's questions." });
    const bobs = await ownWorkers(bob);
    if (!bobs.includes(bobWorker)) {
      r.notRun = `setup: Bob could not hire a worker of his own (${hired.status} ${hired.error ?? ""}); his own workers: [${bobs.join(", ")}]`;
      r.failures.push(`f:setup — ${r.notRun}`);
    } else {
      r.notes.push(`Bob hired \`${bobWorker}\` on \`agent\`; Alice's roster ${(await ownWorkers(alice)).includes(bobWorker) ? "LISTS it" : "doesn't list it"}`);
      const kind = (await alice.workforce.ensureWorkerSession({ worker: COS })).flowKind;
      const conv = await alice.sessions.createSession({ flowKind: kind, userId: o.alice.userId, state: { workerId: COS } });
      const missing = `nobody-${word()}`;
      const viaApp = await act(alice, kind, conv.id, "addDelegate", { worker: bobWorker });
      const viaAppMissing = await act(alice, kind, conv.id, "addDelegate", { worker: missing });
      const afterApp = ((await recordOf(alice, conv.id)).delegates ?? []).map((d) => d.worker);
      const answer = (acted: Acted) => (acted.status === "completed" ? undefined : (acted.error ?? acted.status));
      const shape = (text: string | undefined, id: string) => text?.split(id).join("<id>");
      r.notes.push(`in the app: Bob's worker → ${viaApp.status} "${answer(viaApp) ?? ""}"; a missing worker → ${viaAppMissing.status} "${answer(viaAppMissing) ?? ""}"`);
      if (afterApp.includes(bobWorker) || answer(viaApp) === undefined) {
        r.failures.push(`f:bobs-worker-refused — Bob's worker is a delegate: Alice's addDelegate ${viaApp.status}, and her conversation holds [${afterApp.join(", ")}]`);
      } else if (!(answer(viaApp) ?? "").includes(bobWorker)) {
        r.failures.push(`f:bobs-worker-refused — the refusal doesn't name the worker: "${answer(viaApp)}"`);
      }
      if (afterApp.includes(missing) || answer(viaAppMissing) === undefined || !(answer(viaAppMissing) ?? "").includes(missing)) {
        r.failures.push(`f:missing-refused — a worker nobody holds wasn't refused by name: ${viaAppMissing.status} "${answer(viaAppMissing) ?? ""}"`);
      }
      if (answer(viaApp) !== undefined && shape(answer(viaApp), bobWorker) !== shape(answer(viaAppMissing), missing)) {
        r.failures.push(`f:same-answer — Bob's worker and a missing one get different answers: "${answer(viaApp)}" / "${answer(viaAppMissing)}"`);
      }
      // Through the coordinator's own tool.
      const ask = o.asks.f.replace("{worker}", bobWorker);
      o.say(`leg f: "${ask}"`);
      const turn = await talk(turns, "f", alice, { id: conv.id, flowKind: kind }, ask);
      const adds = turn.tools.filter((t) => t.name === "addDelegate");
      r.notes.push(`the turn ${turn.status}; tools: ${turn.tools.map((t) => `${t.name}(${t.args}) → ${show(t.output)}`).join("; ") || "none"}`);
      const afterTool = ((await recordOf(alice, conv.id)).delegates ?? []).map((d) => d.worker);
      if (afterTool.includes(bobWorker)) r.failures.push(`f:bobs-worker-refused — Bob's worker is a delegate after the chief of staff's turn: [${afterTool.join(", ")}]`);
      const refusedByTool = adds.find((t) => typeof t.output?.refused === "string");
      if (adds.length === 0) r.failures.push(`f:tool-refused — the chief of staff never called addDelegate for \`${bobWorker}\`, so the tool's answer wasn't seen`);
      else if (refusedByTool === undefined) r.failures.push(`f:tool-refused — the tool took Bob's worker: ${show(adds.map((t) => t.output))}`);
      else if (shape(refusedByTool.output.refused, bobWorker) !== shape(answer(viaAppMissing), missing)) {
        r.failures.push(`f:tool-refused — the tool's refusal differs from a missing worker's: "${refusedByTool.output.refused}" / "${answer(viaAppMissing)}"`);
      }
      // A create carrying delegates, on the create route the session client posts to, read back whole.
      const seededId = `seeded-${hex()}`;
      const create = await alice.routes.call("POST", `/${encodeURIComponent(kind)}/sessions`, {
        userId: o.alice.userId,
        sessionId: seededId,
        state: { workerId: COS, delegates: [{ worker: bobWorker }] },
      });
      const created = `${create.status} ${JSON.stringify(create.body)}`.slice(0, 400);
      const exists = (await alice.routes.call("GET", `/sessions/${encodeURIComponent(seededId)}`)).status === 200;
      r.notes.push(`a create carrying delegates: ${created}; the session ${exists ? "EXISTS" : "doesn't exist"}`);
      if (exists || create.status !== 400 || !JSON.stringify(create.body).includes("delegates")) {
        r.failures.push(`f:create-refused — a create carrying delegates wasn't refused with 400 naming the field: ${created}${exists ? ", and the session exists" : ""}`);
      }
    }
  }
  return { legs, turns };
}
