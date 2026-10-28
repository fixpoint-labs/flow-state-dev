/**
 * Legs a to c, on Shift Manager's DevTeam install served by its own command
 * over a fresh SQLite store, with Alice (the Lab's owner), Bob (its second
 * member) and Alice in a second organization, each over HTTP with their own
 * verified bearer.
 *
 * Every change goes through the install's routes as that person: the
 * `projects` flow's `createProject`, `projectSetup`, `openWorkstream` and
 * `updateWorkstream`, the roster flow's `hire`, a turn in a session, or the
 * registered `goal-entry-writer` flow. Nothing is seeded. Every grade reads
 * back what that person gets from the routes, and, for a coordinator's
 * delivery ledger (server-written state no route exposes), the session row
 * that person owns in the store file.
 *
 * Each opener leads their workstream with a worker of their own: the roster
 * flow's `hire` puts one on `agent` on their roster, listing the coder as its
 * delegate and holding the lead's `updateWorkstream` tool, then
 * `openWorkstream` names it as the lead over HTTP, as any app may.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient, projectProgress } from "@flow-state-dev/workforce/browser";
import { routedDeliveries, type RoutedDelivery } from "../../lib/routed-tasks.mts";
import { labRoutes, type LabRoutes, type StoredItem } from "../../lib/shift-manager.mts";
import { ENTRY_WRITER_KIND } from "./controls/patches.mts";
import { ENTRY_WRITER_ACTION } from "./flows/entry-writer.mts";

/** One person the run acts as. */
export interface Person {
  label: string;
  userId: string;
  bearer: string;
}

/** The held-out inputs, as `fixtures/inputs.json` holds them. */
export interface Inputs {
  privateProjects: Array<{ id: string; title: string }>;
  sharedProjects: Array<{ id: string; title: string; brief: string }>;
  aliceWorkstreams: WorkstreamInput[];
  bobWorkstreams: WorkstreamInput[];
  statusWords: string[];
  tamperWords: string[];
  workWords: string[];
  asks: { status: string; work: string; workAgain: string; tool: string };
}
type WorkstreamInput = { id: string; title: string; objectives: string[]; due: string };

/** The engine's refusal of a write by anyone but the row's owner. */
const OWNER_RULE = "A row of an owner-writes collection is written only by the user it belongs to.";

const PROJECTS_FLOW = "projects";
const ROSTER_KIND = "workforce-roster";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 500);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const pick = <T,>(list: readonly T[]): T => list[randomBytes(1)[0]! % list.length]!;
const hex = () => randomBytes(3).toString("hex");
const withTag = <T extends { id: string },>(x: T, tag: string): T => ({ ...x, id: `${x.id}-${tag}` });

/** One run's values: a pick from each held-out list, every id and word with a fresh suffix. */
export function drawInputs(inputs: Inputs) {
  const tag = hex();
  const ws = (w: WorkstreamInput) => withTag(w, tag);
  return {
    privateProject: withTag(pick(inputs.privateProjects), tag),
    sharedProject: withTag(pick(inputs.sharedProjects), tag),
    aliceWs: ws(pick(inputs.aliceWorkstreams)),
    bobWs: ws(pick(inputs.bobWorkstreams)),
    statusWord: `${pick(inputs.statusWords)}-${hex()}`,
    tamperWord: `${pick(inputs.tamperWords)}-${hex()}`,
    workWord: `${pick(inputs.workWords)}${hex()}`,
    asks: inputs.asks,
  };
}
export type Drawn = ReturnType<typeof drawInputs>;

const fill = (template: string, slots: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_m, k: string) => slots[k] ?? `{${k}}`);

/** A person connected to the served install. */
interface Connected {
  person: Person;
  routes: LabRoutes;
  workforce: ReturnType<typeof createWorkforceClient>;
}

function connect(origin: string, person: Person): Connected {
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    return fetch(input, { ...init, headers });
  };
  return {
    person,
    routes: labRoutes(origin, { userId: person.userId, bearer: person.bearer }),
    workforce: createWorkforceClient(createClient({ userId: person.userId, baseUrl: origin, fetcher })),
  };
}

/** One action's end, read back from the store. */
interface Acted {
  status: string;
  requestId: string | null;
  output: any;
  error: string | undefined;
}

async function act(who: Connected, kind: string, sessionId: string, action: string, input: unknown, timeoutMs = 60_000): Promise<Acted> {
  const enc = encodeURIComponent;
  const posted = await who.routes.call("POST", `/${enc(kind)}/${enc(sessionId)}/actions/${enc(action)}`, { userId: who.person.userId, input });
  if (posted.status !== 202) return { status: `http ${posted.status}`, requestId: null, output: undefined, error: show(posted.body) };
  const requestId = String(posted.body?.request?.id);
  const status = await who.routes.settle(kind, requestId, timeoutMs);
  const found = (await who.routes.requests(sessionId).catch((): Array<Record<string, any>> => [])).find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
}

const refusedBy = (text: string | undefined, rule: string) => text !== undefined && text.includes(rule);

/** The id of the worker an opener hires to lead one workstream. */
const leadIdFor = (project: string, workstream: string) => `lead-${project}-${workstream}`;

/** What a hired lead is told: lead one workstream, and keep its entry current with `updateWorkstream`. */
const LEAD_INSTRUCTIONS =
  "You lead one workstream of a project, for the person who owns it. When asked for work, file it as a task " +
  "for eng.coder with createTask. When its status changes, or there is something to report, call updateWorkstream " +
  "with a short status in your own words and your latest report. Mark it done only when the owner says it is finished.";

/** The person's own session on a flow, at the id Shift Manager reads under (`readerSessionId`). */
const ownSession = (who: Connected, kind: string, suffix = "") => `${kind}-own-${who.person.userId}${suffix}`;

/** Make sure `who` holds a session at `id` on `kind`; a 409 is one they made before. */
async function holdSession(who: Connected, kind: string, id: string): Promise<void> {
  const made = await who.routes.call("POST", `/${encodeURIComponent(kind)}/sessions`, { userId: who.person.userId, sessionId: id });
  if (made.status >= 300 && made.status !== 409) throw new Error(`${who.person.label} couldn't open a ${kind} session ${id}: ${made.status} ${show(made.body)}`);
}

/** Every row of a collection, by its accessor, through one session: `[topic, clientData]`. Throws on a refused read. */
async function rows(who: Connected, sessionId: string, ref: string, prefix?: string): Promise<Array<{ key: string; data: Record<string, any> }>> {
  const out: Array<{ key: string; data: Record<string, any> }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const q = [`limit=200`, ...(prefix === undefined ? [] : [`topicPrefix=${encodeURIComponent(prefix)}`]), ...(cursor === undefined ? [] : [`cursor=${encodeURIComponent(cursor)}`])];
    const body = await who.routes.get(`/sessions/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(ref)}?${q.join("&")}`);
    for (const item of (body.items ?? []) as Array<{ topic?: string; storageKey?: string; clientData?: Record<string, any> }>) {
      out.push({ key: String(item.storageKey ?? item.topic ?? ""), data: item.clientData ?? {} });
    }
    if (body.nextCursor == null || body.nextCursor === cursor) break;
    cursor = body.nextCursor;
  }
  return out;
}

/** The ids of the projects one collection lists to `who`. */
async function projectIds(who: Connected, sessionId: string, ref: "projects" | "privateProjects"): Promise<string[]> {
  return (await rows(who, sessionId, ref)).map((r) => String(r.data.id ?? r.key.split("/").at(-1)));
}

/** A workstream entry as a reader gets it: its owner and id read off its key, and its published fields. */
type Entry = { key: string; owner: string; id: string; data: Record<string, any> };

/** The shared project's entries, read by its one prefix through `who`'s roster session. */
async function entriesOf(who: Connected, sessionId: string, project: string): Promise<Entry[]> {
  return (await rows(who, sessionId, "workstreams", `workstreams/${project}/`)).flatMap((r) => {
    const parts = r.key.replace(/^workstreams\//, "").split("/");
    if (parts.length !== 3 || parts[0] !== project || !parts[1]!.startsWith("~")) return [];
    return [{ key: r.key, owner: decodeURIComponent(parts[1]!.slice(1)), id: parts[2]!, data: r.data }];
  });
}

/** An entry's state and report, as `who` reads them: what "unchanged" is graded on. */
async function entrySnapshot(who: Connected, sessionId: string, entry: Entry): Promise<string> {
  const content = await who.routes.call("GET", `/sessions/${encodeURIComponent(sessionId)}/resources/workstreams/${encodeURIComponent(entry.key)}/content`);
  return JSON.stringify({ state: entry.data, content: content.status === 200 ? content.body : `http ${content.status}` });
}

function textOf(item: StoredItem | undefined): string {
  if (item === undefined) return "";
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n");
  return JSON.stringify(c ?? "");
}
const parsed = (value: unknown): any => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** One turn in a session, read back by its request id. */
interface Turn {
  status: string;
  requestId: string | null;
  tools: Array<{ name: string; args: string; output: any }>;
  reply: string;
  providerRetry?: string;
}

const providerError = (text: string) => /rate.?limit|429|5\d\d |overloaded|timed? ?out|ECONNRESET|fetch failed|provider|gateway|unavailable|stream failed/i.test(text);

/** Say `words` in `sessionId` (on `kind`); a provider error re-runs it once. */
async function talk(who: Connected, kind: string, sessionId: string, words: string): Promise<Turn> {
  const once = async (): Promise<Turn> => {
    const acted = await act(who, kind, sessionId, "respond", { message: words }, 240_000);
    const turn: Turn = { status: acted.status, requestId: acted.requestId, tools: [], reply: "" };
    if (acted.requestId === null) {
      turn.reply = `refused: ${acted.error ?? ""}`;
      return turn;
    }
    const mine = (await who.routes.items(sessionId, "")).filter((i) => i.requestId === acted.requestId);
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
  return turn;
}

const calls = (name: string, tool: string) => name === tool || [`/${tool}`, `.${tool}`, `_${tool}`].some((s) => name.endsWith(s));

type Delivery = RoutedDelivery;

/**
 * A coordinator session's routed tasks, from the store file, from the rows `who`
 * owns. No route exposes them with their server-written payload.
 */
function ledgerOf(store: string, who: Connected, sessionId: string): Delivery[] {
  return routedDeliveries(store, who.person.userId, sessionId);
}

/** What each leg found: failures by assertion name, and notes. */
export interface LegResult {
  failures: string[];
  notes: string[];
}

export interface LegsOptions {
  origin: string;
  store: string;
  alice: Person;
  bob: Person;
  alice2: Person;
  drawn: Drawn;
  legs: ReadonlySet<string>;
  say: (line: string) => void;
}

/** Run the legs asked for, in order (each needs the ones before it as setup). */
export async function runLegs(o: LegsOptions): Promise<Record<string, LegResult>> {
  const out: Record<string, LegResult> = {};
  const leg = (name: string): LegResult => (out[name] ??= { failures: [], notes: [] });
  const alice = connect(o.origin, o.alice);
  const bob = connect(o.origin, o.bob);
  const alice2 = connect(o.origin, o.alice2);
  const d = o.drawn;
  const P = d.privateProject;
  const S = d.sharedProject;
  const shared = { visibility: "shared" as const, id: S.id };
  const priv = { visibility: "private" as const, id: P.id };

  // Each person's own sessions on the projects flow and the roster flow, as Shift Manager reads under.
  // Session ids aren't scoped by organization, so Alice's second-org reader takes its own id.
  const reader = { alice: ownSession(alice, ROSTER_KIND), bob: ownSession(bob, ROSTER_KIND), alice2: ownSession(alice2, ROSTER_KIND, "-second-org") };
  await holdSession(alice, ROSTER_KIND, reader.alice);
  await holdSession(bob, ROSTER_KIND, reader.bob);
  await holdSession(alice2, ROSTER_KIND, reader.alice2);

  // ---- leg a: a private project is nobody else's ---------------------------
  {
    const r = leg("a");
    o.say(`leg a: Alice makes private "${P.id}" and shared "${S.id}" (Bob a member)`);
    const made = [
      await act(alice, PROJECTS_FLOW, ownSession(alice, PROJECTS_FLOW), "createProject", { id: P.id, title: P.title, visibility: "private" }),
      await act(alice, PROJECTS_FLOW, ownSession(alice, PROJECTS_FLOW), "createProject", { id: S.id, title: S.title, brief: S.brief, visibility: "shared", members: [bob.person.userId] }),
    ];
    for (const m of made) if (m.status !== "completed") throw new Error(`setup: Alice's createProject ${m.status}: ${m.error}`);

    const lists = {
      alice: { shared: await projectIds(alice, reader.alice, "projects"), private: await projectIds(alice, reader.alice, "privateProjects") },
      bob: { shared: await projectIds(bob, reader.bob, "projects"), private: await projectIds(bob, reader.bob, "privateProjects") },
      alice2: { shared: await projectIds(alice2, reader.alice2, "projects"), private: await projectIds(alice2, reader.alice2, "privateProjects") },
    };
    r.notes.push(`listings: ${show(lists)}`);
    if (!lists.alice.private.includes(P.id)) r.failures.push(`a:alice-lists-hers — Alice's own private listing doesn't hold "${P.id}": ${show(lists.alice.private)}`);
    if (lists.bob.private.includes(P.id) || lists.bob.shared.includes(P.id)) r.failures.push(`a:bob-cant-list — Bob's listings hold Alice's private "${P.id}": ${show(lists.bob)}`);
    if (!lists.alice.shared.includes(S.id) || !lists.bob.shared.includes(S.id)) r.failures.push(`a:both-see-shared — wanted "${S.id}" in both shared listings: Alice ${show(lists.alice.shared)}, Bob ${show(lists.bob.shared)}`);
    if (lists.alice2.private.includes(P.id) || lists.alice2.shared.includes(P.id) || lists.alice2.shared.includes(S.id)) {
      r.failures.push(`a:second-org — Alice in her second org lists a first-org project: ${show(lists.alice2)}`);
    }

    // Opening it by its address, as Shift Manager's project view reads a row.
    const open = async (who: Connected, sid: string, ref: string) => {
      const got = await who.routes.call("GET", `/sessions/${encodeURIComponent(sid)}/resources/${ref}/${encodeURIComponent(P.id)}`);
      return { status: got.status, found: got.status === 200 && got.body !== null && got.body?.clientData != null };
    };
    const bobOpens = [await open(bob, reader.bob, "privateProjects"), await open(bob, reader.bob, "projects")];
    const aliceOpens = await open(alice, reader.alice, "privateProjects");
    const alice2Opens = await open(alice2, reader.alice2, "privateProjects");
    r.notes.push(`opening "${P.id}" by address: Alice ${show(aliceOpens)}, Bob ${show(bobOpens)}, Alice in her second org ${show(alice2Opens)}`);
    if (!aliceOpens.found) r.failures.push(`a:alice-lists-hers — Alice can't open her own private project by its address: ${show(aliceOpens)}`);
    if (bobOpens.some((x) => x.found)) r.failures.push(`a:bob-cant-open — Bob opened Alice's private project through the resource route: ${show(bobOpens)}`);
    if (alice2Opens.found) r.failures.push(`a:second-org — Alice opened her first org's private project from her second org: ${show(alice2Opens)}`);

    // A worker linked to it: the project coordinator, whose readProject tool reads the linked project.
    const coordinatorFor = async (who: Connected, projectId: { visibility: "shared" | "private"; id: string }) => {
      try {
        const s = await who.workforce.ensureWorkerSession({ worker: "project-coordinator", projectId } as never);
        return { ok: true as const, id: s.id };
      } catch (error) {
        return { ok: false as const, error: messageOf(error).slice(0, 200) };
      }
    };
    const bobPriv = await coordinatorFor(bob, priv);
    const bobShared = await coordinatorFor(bob, shared);
    const alice2Priv = await coordinatorFor(alice2, priv);
    r.notes.push(`a project coordinator linked to "${P.id}": Bob ${show(bobPriv)}, Alice in her second org ${show(alice2Priv)}; Bob's on "${S.id}": ${show(bobShared)}`);
    if (bobPriv.ok) r.failures.push(`a:bob-cant-read — Bob opened a project coordinator linked to Alice's private project: ${bobPriv.id}`);
    if (alice2Priv.ok) r.failures.push(`a:second-org — Alice's second-org session opened a coordinator linked to her first org's private project: ${alice2Priv.id}`);
    if (!bobShared.ok) r.failures.push(`a:both-see-shared — Bob can't open a project coordinator on the shared project: ${bobShared.error}`);
  }
  if (!o.legs.has("b")) return out;

  // ---- leg b: one owner per workstream ------------------------------------
  const r = leg("b");
  const setup = await act(alice, PROJECTS_FLOW, ownSession(alice, PROJECTS_FLOW), "projectSetup", {});
  const projectCoordinator = setup.output?.projectCoordinator as string | null | undefined;
  if (setup.status !== "completed" || typeof projectCoordinator !== "string") {
    throw new Error(`setup: projectSetup ${setup.status}: ${show(setup.output)} ${setup.error ?? ""}`);
  }
  r.notes.push(`projectSetup: project coordinator "${projectCoordinator}"`);

  const openFor = async (who: Connected, rosterSession: string, ws: WorkstreamInput) => {
    const lead = leadIdFor(S.id, ws.id);
    const hired = await act(who, ROSTER_KIND, rosterSession, "hire", {
      id: lead,
      flow: "agent",
      description: "Leads one workstream, and keeps its entry current.",
      instructions: LEAD_INSTRUCTIONS,
      settings: { delegates: ["eng.coder"], tools: ["updateWorkstream"], model: "openai/gpt-5.4-mini" },
    });
    if (hired.status !== "completed") throw new Error(`setup: ${who.person.label}'s hire of ${lead} ${hired.status}: ${hired.error}`);
    const opened = await act(who, PROJECTS_FLOW, ownSession(who, PROJECTS_FLOW), "openWorkstream", {
      project: shared,
      id: ws.id,
      title: ws.title,
      lead,
      due: ws.due,
      objectives: ws.objectives,
    });
    if (opened.status !== "completed") throw new Error(`setup: ${who.person.label}'s openWorkstream ${opened.status}: ${opened.error}`);
    return { lead, view: opened.output?.workstream as Record<string, any> };
  };
  o.say(`leg b: Alice opens "${d.aliceWs.id}", Bob opens "${d.bobWs.id}", each led by a worker hired onto their roster`);
  const aliceWs = await openFor(alice, reader.alice, d.aliceWs);
  const bobWs = await openFor(bob, reader.bob, d.bobWs);

  for (const [who, other, ws, input] of [
    [alice, bob, aliceWs, d.aliceWs],
    [bob, alice, bobWs, d.bobWs],
  ] as const) {
    const v = ws.view;
    if (v?.owner !== who.person.userId || v?.lead !== ws.lead || typeof v?.sessionId !== "string" || v?.id !== input.id) {
      r.failures.push(`b:opened — ${who.person.label}'s open answered ${show(v)}, wanted owner ${who.person.userId}, lead ${ws.lead}, a session`);
      continue;
    }
    const mine = (await who.workforce.roster()).find((e) => e.id === ws.lead);
    const theirs = (await other.workforce.roster()).find((e) => e.id === ws.lead);
    if (mine === undefined || mine.standard) r.failures.push(`b:own-roster — ${who.person.label}'s roster lists the lead as ${show(mine)}, not a worker of their own`);
    if (theirs !== undefined) r.failures.push(`b:own-roster — ${other.person.label}'s roster lists ${who.person.label}'s lead ${ws.lead}`);
    // The workstream session: the owner's, naming the lead; nobody else's to open.
    const listed = (await who.routes.sessions()).some((s) => s.id === v.sessionId);
    const ownRead = await who.routes.call("GET", `/sessions/${encodeURIComponent(v.sessionId)}/state`);
    const otherRead = await other.routes.call("GET", `/sessions/${encodeURIComponent(v.sessionId)}/state`);
    // Found as an app finds it: the owner's session with the lead, for this workstream (its readonly workerId and workstreamId).
    const found = await who.workforce
      .findWorkerSession({ worker: ws.lead, workstreamId: { project: shared, id: input.id } } as never)
      .then((x) => x?.id ?? null, (error: unknown) => `refused: ${messageOf(error).slice(0, 120)}`);
    if (!listed || ownRead.status !== 200 || found !== v.sessionId) {
      r.failures.push(`b:session-owner — ${who.person.label}'s workstream session ${v.sessionId}: listed ${listed}, read ${ownRead.status}, found with the lead and the workstream as ${show(found)}`);
    }
    if (otherRead.status === 200) r.failures.push(`b:session-owner — ${other.person.label} read ${who.person.label}'s workstream session ${v.sessionId}`);
    r.notes.push(`${who.person.label}: lead ${ws.lead}, session ${v.sessionId} (theirs: listed, and found by its lead and workstream; ${other.person.label}'s read: ${otherRead.status})`);
  }

  // Bob writes Alice's entry by three paths; her entry must be as it was.
  const aliceEntry = async () => (await entriesOf(alice, reader.alice, S.id)).find((e) => e.owner === alice.person.userId && e.id === d.aliceWs.id);
  const before = await aliceEntry();
  if (before === undefined) throw new Error(`setup: Alice can't read her own entry "${d.aliceWs.id}"`);
  const snapshot0 = await entrySnapshot(alice, reader.alice, before);
  const writes: string[] = [];
  const landed: string[] = [];

  // (1) The app's action, naming her entry.
  const viaAction = await act(bob, PROJECTS_FLOW, ownSession(bob, PROJECTS_FLOW), "updateWorkstream", {
    project: shared,
    owner: alice.person.userId,
    id: d.aliceWs.id,
    status: d.tamperWord,
    report: `Bob wrote this: ${d.tamperWord}`,
  });
  writes.push(`the app's updateWorkstream: ${viaAction.status}, ${viaAction.error?.slice(0, 160) ?? "no error"}`);
  if (viaAction.status === "completed" || !refusedBy(viaAction.error, OWNER_RULE)) landed.push(`the app's updateWorkstream ${viaAction.status} (${viaAction.error ?? "no refusal"})`);

  // (2) A registered flow's code writing the rows. Alice first plants a sacrificial row under her own key,
  // so Bob's delete has a real row to remove; she takes it back out after.
  const writer = (who: Connected, mode: "plant" | "tamper" | "unplant") =>
    act(who, ENTRY_WRITER_KIND, `goal-entry-writer-${who.person.userId}`, ENTRY_WRITER_ACTION, {
      project: shared,
      owner: alice.person.userId,
      id: d.aliceWs.id,
      status: d.tamperWord,
      report: `Bob wrote this: ${d.tamperWord}`,
      mode,
    });
  const plantedId = `${d.aliceWs.id}-planted`;
  const hasPlanted = async () => (await entriesOf(alice, reader.alice, S.id)).some((e) => e.owner === alice.person.userId && e.id === plantedId);
  const plant = await writer(alice, "plant");
  if (plant.status !== "completed" || plant.output?.plant !== "landed" || !(await hasPlanted())) {
    throw new Error(`setup: Alice couldn't plant "${plantedId}" under her own key: ${plant.status} ${show(plant.output ?? plant.error)}`);
  }
  const viaFlow = await writer(bob, "tamper");
  writes.push(`goal-entry-writer: ${viaFlow.status}, ${show(viaFlow.output ?? viaFlow.error)}`);
  if (viaFlow.status !== "completed") throw new Error(`setup: the registered goal-entry-writer flow didn't run: ${viaFlow.status} ${viaFlow.error}`);
  for (const path of ["status", "report", "deletePlanted", "createUnderOwner"] as const) {
    const said = String(viaFlow.output?.[path] ?? "missing");
    if (!refusedBy(said, OWNER_RULE)) landed.push(`goal-entry-writer's ${path} write: ${said.slice(0, 160)}`);
  }
  // The delete is graded on the row too: her planted row must still be there.
  if (!(await hasPlanted())) landed.push(`Bob's delete removed Alice's planted row "${plantedId}"`);
  const unplant = await writer(alice, "unplant");
  if (await hasPlanted()) throw new Error(`setup: Alice couldn't remove her planted row "${plantedId}": ${show(unplant.output ?? unplant.error)}`);

  // (3) A worker's tool: Bob's own lead, asked to change her workstream. Its tool writes the workstream its session leads.
  const toolAsk = fill(d.asks.tool, { alice: alice.person.userId, aliceId: d.aliceWs.id, project: S.id, word: d.tamperWord });
  let toolTurn = await talk(bob, "agent", bobWs.view.sessionId, toolAsk);
  if (!toolTurn.tools.some((t) => calls(t.name, "updateWorkstream"))) toolTurn = await talk(bob, "agent", bobWs.view.sessionId, toolAsk);
  const toolWrites = toolTurn.tools.filter((t) => calls(t.name, "updateWorkstream"));
  writes.push(`Bob's lead's updateWorkstream tool: ${toolWrites.map((t) => show(t.output?.workstream ? { owner: t.output.workstream.owner, id: t.output.workstream.id, status: t.output.workstream.status } : t.output)).join("; ") || "not called"}`);
  r.notes.push(`Bob's lead's turn ${toolTurn.status}; reply: ${toolTurn.reply.slice(0, 240).replace(/\n/g, " ")}${toolTurn.providerRetry === undefined ? "" : ` (after a provider error: ${toolTurn.providerRetry})`}`);
  if (toolWrites.length === 0) r.failures.push(`b:tool-reached — Bob's lead never called updateWorkstream (twice asked), so the worker's-tool path wasn't exercised: ${toolTurn.reply.slice(0, 200)}`);
  for (const t of toolWrites) {
    const owner = t.output?.workstream?.owner;
    if (owner !== undefined && owner !== bob.person.userId) landed.push(`Bob's lead's tool wrote ${owner}'s entry: ${show(t.output.workstream)}`);
  }

  const after = await aliceEntry();
  const snapshot1 = after === undefined ? "her entry is gone" : await entrySnapshot(alice, reader.alice, after);
  if (snapshot1 !== snapshot0) landed.push(`Alice's entry changed: before ${snapshot0.slice(0, 300)}; after ${snapshot1.slice(0, 300)}`);
  r.notes.push(`Bob's writes to Alice's entry: ${writes.join(" | ")}`);
  if (landed.length > 0) r.failures.push(`b:bobs-write-refused — ${landed.join(" / ")}`);

  // The owner's own write lands: Bob sets his workstream's status.
  const own = await act(bob, PROJECTS_FLOW, ownSession(bob, PROJECTS_FLOW), "updateWorkstream", { project: shared, id: d.bobWs.id, status: d.statusWord });
  if (own.status !== "completed") r.failures.push(`b:owner-writes — Bob's write to his own entry ${own.status}: ${own.error}`);

  // The project read, as each of them gets it: two workstreams, both owners' objectives.
  for (const who of [alice, bob]) {
    const entries = await entriesOf(who, who === alice ? reader.alice : reader.bob, S.id);
    const progress = projectProgress(
      entries.map((e) => ({ owner: e.owner, id: e.id, status: String(e.data.status), due: e.data.due ?? null, updatedAt: String(e.data.updatedAt), objectives: (e.data.objectives ?? []) as Array<{ met: boolean }> })) as never,
      Date.now(),
    );
    const byOwner = Object.fromEntries(entries.map((e) => [e.owner, e]));
    const objectiveTexts = (e: Entry | undefined) => ((e?.data.objectives ?? []) as Array<{ text: string }>).map((x) => x.text);
    const wantObjectives = d.aliceWs.objectives.length + d.bobWs.objectives.length;
    const ok =
      entries.length === 2 &&
      byOwner[alice.person.userId]?.id === d.aliceWs.id &&
      byOwner[bob.person.userId]?.id === d.bobWs.id &&
      JSON.stringify(objectiveTexts(byOwner[alice.person.userId])) === JSON.stringify(d.aliceWs.objectives) &&
      JSON.stringify(objectiveTexts(byOwner[bob.person.userId])) === JSON.stringify(d.bobWs.objectives) &&
      progress.workstreams === 2 &&
      progress.objectives.total === wantObjectives;
    if (!ok) {
      r.failures.push(
        `b:project-read — ${who.person.label} reads ${entries.length} entries (${entries.map((e) => `${e.owner}/${e.id}: ${show(e.data.objectives)}`).join("; ")}), progress ${show(progress)}; wanted 2 workstreams and ${wantObjectives} objectives`,
      );
    }
    const bobsAsRead = byOwner[bob.person.userId];
    if (bobsAsRead?.data.status !== d.statusWord) r.failures.push(`b:owner-writes — ${who.person.label} reads Bob's status as ${show(bobsAsRead?.data.status)}, not "${d.statusWord}"`);
    r.notes.push(`${who.person.label}'s project read: ${progress.workstreams} workstreams, objectives ${progress.objectives.met}/${progress.objectives.total}, statuses ${show(progress.byStatus)}`);
  }
  if (!o.legs.has("c")) return out;

  // ---- leg c: each talks to the project through their own coordinator ------
  const c = leg("c");
  const coordinator = await alice.workforce.ensureWorkerSession({ worker: projectCoordinator, projectId: shared } as never);
  o.say(`leg c: Alice's project coordinator ${coordinator.id} (${coordinator.flowKind})`);

  const statusAsk = fill(d.asks.status, { project: S.title, bob: bob.person.userId, bobTitle: d.bobWs.title });
  const t1 = await talk(alice, coordinator.flowKind, coordinator.id, statusAsk);
  c.notes.push(`status turn ${t1.status}: tools ${t1.tools.map((t) => t.name).join(", ") || "none"}; reply: ${t1.reply.slice(0, 300).replace(/\n/g, " ")}${t1.providerRetry === undefined ? "" : ` (after a provider error: ${t1.providerRetry})`}`);
  const reads = t1.tools.filter((t) => calls(t.name, "readProject"));
  const bobsInRead = reads.flatMap((t) => (t.output?.workstreams ?? []) as Array<Record<string, any>>).find((w) => w.owner === bob.person.userId && w.id === d.bobWs.id);
  if (bobsInRead?.status !== d.statusWord) c.failures.push(`c:read-holds-status — Alice's coordinator's readProject output (${reads.length} call(s)) holds Bob's workstream as ${show(bobsInRead)}, not with status "${d.statusWord}"`);
  if (!t1.reply.toLowerCase().includes(d.statusWord.toLowerCase())) c.failures.push(`c:names-status — Alice's coordinator's answer doesn't name Bob's status "${d.statusWord}": ${t1.reply.slice(0, 300)}`);

  const workTurns: Turn[] = [await talk(alice, coordinator.flowKind, coordinator.id, fill(d.asks.work, { word: d.workWord }))];
  const first = workTurns[0]!;
  if (first.status === "completed" && !first.tools.some((t) => calls(t.name, "createTask"))) {
    workTurns.push(await talk(alice, coordinator.flowKind, coordinator.id, fill(d.asks.workAgain, { word: d.workWord })));
  }
  for (const turn of workTurns) {
    c.notes.push(`work turn ${turn.status}: tools ${turn.tools.map((t) => `${t.name}(${t.args})`).join(", ") || "none"}; reply: ${turn.reply.slice(0, 300).replace(/\n/g, " ")}${turn.providerRetry === undefined ? "" : ` (after a provider error: ${turn.providerRetry})`}`);
  }
  if (!workTurns.at(-1)!.tools.some((t) => calls(t.name, "createTask"))) c.notes.push("the coordinator called createTask on no work ask");
  const postIds = new Set(workTurns.map((t) => t.requestId).filter((id): id is string => id !== null));
  const aliceTarget = `shared/${S.id}/${d.aliceWs.id}`;
  const bobTarget = `shared/${S.id}/${d.bobWs.id}`;
  const holdsWord = (items: StoredItem[]) => items.filter((i) => i.role === "user" && textOf(i).includes(d.workWord));
  let ledger: Delivery[] = [];
  let mineItems: StoredItem[] = [];
  const sent = Date.now();
  for (let settledAt: number | undefined; Date.now() - sent < 150_000; await sleep(1_500)) {
    ledger = ledgerOf(o.store, alice, coordinator.id).filter((x) => postIds.has(x.postId));
    mineItems = holdsWord(await alice.routes.items(aliceWs.view.sessionId, "message"));
    if (ledger.length > 0 && ledger.every((x) => x.status !== "pending") && mineItems.length > 0) {
      settledAt ??= Date.now();
      // A little longer, so a second delivery or a late one to Bob's would show.
      if (Date.now() - settledAt > 10_000) break;
    }
    if (ledger.length === 0 && Date.now() - sent > 30_000) break;
  }
  const routing = (await alice.routes.items(coordinator.id, "component"))
    .filter((i) => (i as { component?: string }).component === "coordinator-route")
    .map((i) => i.data as Record<string, any>)
    .filter((x) => postIds.has(x?.postId));
  const bobsItems = holdsWord(await bob.routes.items(bobWs.view.sessionId, "message"));
  c.notes.push(`the post's ledger: ${show(ledger)}; routing: ${show(routing.map((x) => ({ by: x.by, delegates: x.delegates })))}`);

  const toMine = ledger.filter((x) => x.delegate.worker === aliceWs.lead && x.delegate.target === aliceTarget);
  if (toMine.length !== 1 || toMine[0]!.status !== "delivered" || toMine[0]!.sessionId !== aliceWs.view.sessionId || mineItems.length !== 1) {
    c.failures.push(
      `c:delivers-once — wanted one delivery to her lead ${aliceWs.lead} into ${aliceWs.view.sessionId} and one line with "${d.workWord}" there; ledger to hers: ${show(toMine)}, lines there: ${mineItems.length}`,
    );
  }
  const toBobs = ledger.filter((x) => x.delegate.worker === bobWs.lead || x.delegate.target === bobTarget);
  const routedToBobs = routing.flatMap((x) => ((x.delegates ?? []) as Array<{ worker: string; outcome: string }>).filter((dl) => dl.worker === bobWs.lead && dl.outcome !== "skipped"));
  if (toBobs.length > 0 || routedToBobs.length > 0 || bobsItems.length > 0) {
    c.failures.push(`c:never-to-bobs — Alice's coordinator handed the post to Bob's workstream: ledger ${show(toBobs)}, routing ${show(routedToBobs)}, lines in his session ${bobsItems.length}`);
  }
  return out;
}
