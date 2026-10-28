/**
 * What Alice does in the closure's walk, over HTTP against the Lab served by Shift Manager's
 * command, through the shipped clients. It only acts and waits; `run.mts` grades, from what
 * Alice's actions answered and from the store file, read-only.
 *
 * Every wait is on the store: until a row the leg is about ends, then until nothing runs, then
 * a grace for anything late (a second notice, a stray run).
 */
import { DatabaseSync } from "node:sqlite";
import { PEOPLE } from "../../workers/files-and-splits-down-the-chain/lab/people.mts";
import { connect, quiet, type Acted, type Shipped } from "../../workers/files-and-splits-down-the-chain/scripted.mts";
import { allTaskRows, type StoredTask } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";
import { CAST, type Cast } from "./cast.mts";

/** The wait after things go quiet, before the store is read. */
export const GRACE_MS = 6_000;
const TERMINAL = new Set(["completed", "errored", "cancelled"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Every row on a plan ledger (`plan/<partition>/<id>`), with its partition. */
export function planRows(file: string): Array<StoredTask & { session?: string; filedByTask?: string }> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return (db.prepare("SELECT resource_key, state FROM resource_state WHERE resource_key LIKE 'plan/%'").all() as Array<{ resource_key: string; state: string }>).map((row) => ({
      ...(JSON.parse(row.state) as StoredTask),
      partition: decodeURIComponent(row.resource_key.split("/")[1] ?? ""),
    }));
  } finally {
    db.close();
  }
}

/** Wait until the row `pick` finds is terminal, then until the store is quiet, then a grace. */
export async function settled(store: string, pick: (rows: StoredTask[]) => StoredTask | undefined, timeoutMs = 420_000): Promise<StoredTask | undefined> {
  const until = Date.now() + timeoutMs;
  let row: StoredTask | undefined;
  for (; Date.now() < until; await sleep(500)) {
    row = pick(allTaskRows(store));
    if (row !== undefined && TERMINAL.has(row.status)) break;
  }
  await quiet(store, 300_000);
  await sleep(GRACE_MS);
  await quiet(store, 300_000);
  return pick(allTaskRows(store));
}

/** The routed task a respond request filed, by its id's shape (`routed:<request>:<round>:<delegate>`). */
export const routedFor = (requestId: string | null, delegate: string) => (rows: StoredTask[]) =>
  rows.find((r) => r.id.startsWith(`routed:${requestId}:`) && r.id.endsWith(`:${delegate}`));

/** Alice signed in to the Lab at `origin`. */
export const alice = (shipped: Shipped, origin: string, store: string) => connect(shipped, origin, store, PEOPLE.alice);

/** The message Alice sends launch. */
export const askFor = (cast: Cast) => `Draft the launch post for ${cast.topic}. Use the word "${cast.word}".`;

/** Leg a, the concept's walk less the call and the Inbox. */
export interface WalkA {
  conv: string;
  turn: Acted;
  /** Alice's list right after her message, and her read of the routed task before the follow-up. */
  listedAtOnce: Acted;
  routed: StoredTask | undefined;
  before: Acted | undefined;
  followUp: Acted | undefined;
  followUpRow: StoredTask | undefined;
  after: Acted | undefined;
  followUpRead: Acted | undefined;
}

/** Leg a: Alice asks launch for a draft, waits for it, then files writer a follow-up from its task. */
export async function walkA(o: { origin: string; store: string; shipped: Shipped; cast: Cast; say: (s: string) => void }): Promise<WalkA> {
  const a = alice(o.shipped, o.origin, o.store);
  const conv = await a.conversation("coordinator", CAST.launch);
  o.say(`a: "${askFor(o.cast)}"`);
  const turn = await a.act("coordinator", conv, "respond", { message: askFor(o.cast) });
  const listedAtOnce = await a.act("coordinator", conv, "listTasks_tasks", {});
  const routed = await settled(o.store, routedFor(turn.requestId, CAST.writer));
  if (routed === undefined || routed.status !== "completed") return { conv, turn, listedAtOnce, routed, before: undefined, followUp: undefined, followUpRow: undefined, after: undefined, followUpRead: undefined };
  const before = await a.act("coordinator", conv, "getTask_tasks", { id: routed.id });
  o.say(`a: the follow-up of ${routed.id}`);
  const followUp = await a.act("coordinator", conv, "createTask_tasks", {
    goal: `Write a new version of the post, half as long. Keep the word "${o.cast.word}".`,
    followUpOf: routed.id,
  });
  const fuId = (followUp.output as { taskId?: string } | undefined)?.taskId;
  const followUpRow = fuId === undefined ? undefined : await settled(o.store, (rows) => rows.find((r) => r.id === fuId));
  const after = await a.act("coordinator", conv, "getTask_tasks", { id: routed.id });
  const followUpRead = fuId === undefined ? undefined : await a.act("coordinator", conv, "getTask_tasks", { id: fuId });
  return { conv, turn, listedAtOnce, routed, before, followUp, followUpRow, after, followUpRead };
}

/** Journey j1: Alice asks chief a question; editor files for researcher and waits in the same request. */
export async function journeyHandsOut(o: { origin: string; store: string; shipped: Shipped; cast: Cast; say: (s: string) => void }) {
  const a = alice(o.shipped, o.origin, o.store);
  const conv = await a.conversation("coordinator", CAST.chief);
  const message = `What is the battery life of ${o.cast.topic}?`;
  o.say(`j1: "${message}"`);
  const turn = await a.act("coordinator", conv, "respond", { message });
  const routed = await settled(o.store, routedFor(turn.requestId, CAST.editor));
  return { conv, turn, routed };
}

/** Journey j2: Alice steers one routed task while it waits on research, and cancels another. */
export async function journeyCoordinator(o: { origin: string; store: string; shipped: Shipped; cast: Cast; say: (s: string) => void }) {
  const a = alice(o.shipped, o.origin, o.store);
  const steerConv = await a.conversation("coordinator", CAST.launch);
  const cancelConv = await a.conversation("coordinator", CAST.launch);
  const steerTurn = await a.act("coordinator", steerConv, "respond", { message: askFor(o.cast) });
  const cancelTurn = await a.act("coordinator", cancelConv, "respond", { message: `Draft a teaser for ${o.cast.topic}.` });
  // The steer lands while writer's task waits on its research: running, its filed work open.
  let steer: Acted | undefined;
  const steerAt = Date.now();
  for (const until = Date.now() + 180_000; Date.now() < until && steer === undefined; await sleep(250)) {
    const rows = allTaskRows(o.store);
    const routed = routedFor(steerTurn.requestId, CAST.writer)(rows);
    if (routed === undefined || TERMINAL.has(routed.status)) continue;
    if (!rows.some((r) => (r as { filedByTask?: string }).filedByTask === routed.id)) continue;
    o.say(`j2: steering ${routed.id}`);
    steer = await a.act("coordinator", steerConv, "updateTask_tasks", { id: routed.id, message: `Also use the word "${o.cast.steerWord}".` });
  }
  let cancel: Acted | undefined;
  const cancelled = routedFor(cancelTurn.requestId, CAST.writer)(allTaskRows(o.store));
  if (cancelled !== undefined) {
    o.say(`j2: cancelling ${cancelled.id}`);
    cancel = await a.act("coordinator", cancelConv, "updateTask_tasks", { id: cancelled.id, status: "cancelled" });
  }
  const steered = await settled(o.store, routedFor(steerTurn.requestId, CAST.writer));
  const cancelledRow = await settled(o.store, routedFor(cancelTurn.requestId, CAST.writer), 60_000);
  return { steerConv, cancelConv, steerTurn, cancelTurn, steer, steerWaitedMs: Date.now() - steerAt, cancel, steered, cancelledRow };
}

/** Leg b's first half: Alice's message on a Lab that dies once researcher's ending is written. */
export async function walkUntilKilled(o: { origin: string; store: string; shipped: Shipped; cast: Cast; exited: Promise<void>; say: (s: string) => void }) {
  const a = alice(o.shipped, o.origin, o.store);
  const conv = await a.conversation("coordinator", CAST.launch);
  const turn = await a.act("coordinator", conv, "respond", { message: askFor(o.cast) });
  const died = await Promise.race([o.exited.then(() => true), sleep(300_000).then(() => false)]);
  return { conv, turn, died, killedAt: Date.now() };
}

/** Leg c: Alice's message on a Lab whose researcher fails every call. */
export async function walkFails(o: { origin: string; store: string; shipped: Shipped; cast: Cast; say: (s: string) => void }) {
  const a = alice(o.shipped, o.origin, o.store);
  const conv = await a.conversation("coordinator", CAST.launch);
  o.say(`c: "${askFor(o.cast)}" (researcher's model refuses every call)`);
  const turn = await a.act("coordinator", conv, "respond", { message: askFor(o.cast) });
  const routed = await settled(o.store, routedFor(turn.requestId, CAST.writer));
  return { conv, turn, routed };
}
