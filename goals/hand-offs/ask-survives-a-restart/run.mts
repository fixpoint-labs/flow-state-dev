/**
 * Goal check: a worker asks a colleague and carries on the same turn with the
 * colleague's real answer; a server restart during the wait loses nothing, and
 * the colleague's work is filed once (FIX-1816). See goal.md.
 *
 * Shift Manager's DevTeam install, served by its own command over a fresh
 * SQLite store. Alice hires two workers on `agent`, both on the real model:
 * the colleague, who alone knows a word picked at run time, and the asker,
 * whose delegate the colleague is. She asks the asker for the word. While the
 * asker's request reads `suspended`, the server is killed with SIGKILL, then
 * started again on the same store. After that the only thing Alice does is
 * look at the asker's task list now and then, as a person would.
 *
 * Every grade reads the store file the run wrote, read-only.
 *
 * Run:      pnpm tsx goals/hand-offs/ask-survives-a-restart/run.mts
 * Controls: GOAL_CONTROL=no-run-once | no-waker
 * Attempts: GOAL_ATTEMPTS=<n> fresh stores, until it first passes (default 3; 1 under a control)
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalModel, goalTmpDir, keysServing, loadFixture, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, startShiftManager, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { loadShipped, type Person } from "../../coordinators/files-tasks-down-the-owners-chain/devteam.mts";
import { items, requests, taskRows, textOf, type StoredTask } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";

const SCRATCH = goalTmpDir("ask-survives-a-restart");
const say = (s: string) => console.error(`[ask ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const word = () => `${["heron", "copper", "lantern", "saffron", "willow", "glacier"][randomBytes(1)[0]! % 6]}${randomBytes(3).toString("hex")}`;

// ---- controls -------------------------------------------------------------------

interface Control {
  name: string;
  assertions: string[];
  patches: ModulePatch[];
  does: string;
}

const WAIT = "packages/orchestration/src/tasks/helpers/wait-for-response.ts";

const CONTROLS: Record<string, Control> = {
  "no-run-once": {
    name: "no-run-once",
    assertions: ["one-row"],
    patches: [
      {
        module: WAIT,
        from: String.raw`const filed = await ctx\.runOnce\(`,
        to: "const filed = await ((_key, fn) => fn())(",
      },
    ],
    does: "the ask records its row's id without runOnce, so the replay after the resume reaches addTask with a new id and files again",
  },
  "no-waker": {
    name: "no-waker",
    assertions: ["a:completed"],
    patches: [
      {
        module: WAIT,
        from: String.raw`const owed = collection\.list\(\{ resumeOwed: true \}\);`,
        to: "const owed = collection.list({ resumeOwed: true }).slice(0, 0);",
      },
    ],
    does: "nothing resumes a waiting turn: the board's touch finds no owed resume, whatever the rows say",
  },
};

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && CONTROLS[controlName] === undefined) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = controlName === "" ? undefined : CONTROLS[controlName];

// ---- the clients ----------------------------------------------------------------

type Shipped = Awaited<ReturnType<typeof loadShipped>>;

function connect(shipped: Shipped, origin: string, person: Person) {
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  return {
    sessions: shipped.createSessionClient(transport),
    flow: (flowKind: string) => shipped.createClient({ flowKind, userId: person.userId, ...transport }),
  };
}

/** Send an action and wait until it stops running; `suspended` counts as stopped. */
async function act(who: ReturnType<typeof connect>, flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 120_000) {
  const client = who.flow(flowKind);
  const requestId = (await client.sendAction(action, input, { sessionId })).request.id;
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(300)) {
    const status = (await client.getRequestStatus(requestId).catch(() => undefined))?.status;
    if (status !== undefined && !["pending", "queued", "in_progress", "running"].includes(status)) return { requestId, status };
  }
  return { requestId, status: "timed-out" };
}

/** SIGKILL a process and everything under it: the command's `tsx` wrapper and the server it runs. */
function killTree(pid: number): number[] {
  const table = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number) as [number, number]);
  const tree = [pid];
  for (let i = 0; i < tree.length; i += 1) for (const [child, parent] of table) if (parent === tree[i]) tree.push(child);
  for (const p of tree) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return tree;
}

// ---- one attempt ----------------------------------------------------------------

interface Observed {
  asker: string;
  colleague: string;
  word: string;
  conv: string;
  asked: string;
  suspendedAtKill: boolean;
  statusAtKill: string | undefined;
  killedAfterMs: number;
}

async function attempt(o: {
  serve: (label: string) => Promise<ServedShiftManager>;
  store: string;
  shipped: Shipped;
  alice: Person;
  model: string;
  label: string;
}): Promise<Observed> {
  const fixture = loadFixture<{ asker: string; colleague: string; ask: string }>(import.meta.url, "ask.json");
  const asker = `lead-${word()}`;
  const colleague = `keeper-${word()}`;
  const secret = word();

  let served = await o.serve(`${o.label}-before`);
  let alice = connect(o.shipped, served.origin, o.alice);
  const roster =
    (await alice.sessions.listSessions({ flowKind: "workforce-roster", userId: o.alice.userId }))[0]?.id ??
    (await alice.sessions.createSession({ flowKind: "workforce-roster", userId: o.alice.userId })).id;
  for (const [id, instructions] of [
    [colleague, fixture.colleague.replaceAll("{word}", secret)],
    [asker, fixture.asker],
  ] as const) {
    const hired = await act(alice, "workforce-roster", roster, "hire", { id, flow: "agent", description: "Release team.", instructions, settings: { model: o.model } });
    if (hired.status !== "completed") throw new Error(`hiring ${id} ended ${hired.status}`);
  }
  const conv = (await alice.sessions.createSession({ flowKind: "agent", userId: o.alice.userId, state: { workerId: asker } })).id;
  const added = await act(alice, "agent", conv, "addDelegate", { worker: colleague });
  if (added.status !== "completed") throw new Error(`addDelegate ended ${added.status}`);

  // The ask. Kill the server the moment the asker's request reads suspended.
  const ask = fixture.ask.replaceAll("{colleague}", colleague);
  say(`${o.label}: "${ask}" (the word is ${secret})`);
  const client = alice.flow("agent");
  const asked = (await client.sendAction("run", { message: ask }, { sessionId: conv })).request.id;
  const sentAt = Date.now();
  let killedAfterMs = -1;
  for (const until = Date.now() + 180_000; Date.now() < until; await sleep(40)) {
    const status = requests(o.store).find((r) => r.id === asked)?.status;
    if (status === "suspended") {
      const killed = killTree(served.child.pid!);
      killedAfterMs = Date.now() - sentAt;
      say(`${o.label}: the asker's request read suspended; SIGKILL to ${killed.join(", ")}`);
      break;
    }
    if (status !== undefined && !["pending", "queued", "in_progress", "running"].includes(status)) break;
  }
  if (killedAfterMs < 0) killTree(served.child.pid!);
  await served.exited;
  // What the store says now is what the dead server left.
  const statusAtKill = requests(o.store).find((r) => r.id === asked)?.status;

  // Start again on the same store. From here Alice only looks at the task list.
  served = await o.serve(`${o.label}-after`);
  alice = connect(o.shipped, served.origin, o.alice);
  try {
    let quietSince: number | undefined;
    for (const until = Date.now() + 300_000; Date.now() < until; await sleep(5_000)) {
      await act(alice, "agent", conv, "listTasks_tasks", {}, 30_000).catch(() => undefined);
      if (requests(o.store).find((r) => r.id === asked)?.status === "completed") break;
      const ended = taskRows(o.store, o.alice.userId, LAB_ORG).filter((t) => ["completed", "errored", "cancelled"].includes(t.status));
      if (ended.length > 0) quietSince ??= Date.now();
      // The asked work ended a minute ago and the turn still hasn't: it won't.
      if (quietSince !== undefined && Date.now() - quietSince > 60_000) break;
    }
    await sleep(5_000);
  } finally {
    await served.stop();
  }
  return { asker, colleague, word: secret, conv, asked, suspendedAtKill: statusAtKill === "suspended", statusAtKill, killedAfterMs };
}

let LAB_ORG = "";

function grade(O: Observed, store: string, userId: string): { failures: string[]; notes: string[] } {
  const failures: string[] = [];
  const notes: string[] = [];
  if (!O.suspendedAtKill) failures.push(`kill:suspended — the server was not killed while the asker's request read suspended (it read ${O.statusAtKill})`);

  const all = requests(store);
  const askedRequest = all.find((r) => r.id === O.asked);
  if (askedRequest?.status !== "completed") failures.push(`a:completed — the asker's request ended ${askedRequest?.status}, not completed`);
  const turns = all.filter((r) => r.sessionId === O.conv && r.actionName === "run");
  if (turns.length !== 1) failures.push(`a:same-turn — the asker's conversation ran ${turns.length} turns; the ask must resume its own, not start another`);
  const said = items(store, O.conv, "message")
    .filter((m) => m.requestId === O.asked && m.role === "assistant")
    .map(textOf)
    .join("\n");
  if (!said.toLowerCase().includes(O.word.toLowerCase())) failures.push(`a:word — the asking request's own output doesn't carry "${O.word}": ${show(said)}`);

  const rows = taskRows(store, userId, LAB_ORG).filter((t: StoredTask & { ask?: unknown }) => t.assignee === O.colleague);
  if (rows.length !== 1) failures.push(`one-row — ${rows.length} rows were filed for ${O.colleague}, not one: ${show(rows.map((t) => [t.id, t.status, t.attempts]))}`);
  const asked = rows.filter((t) => (t as { ask?: unknown }).ask != null);
  if (asked.length !== rows.length) failures.push(`one-row — a row for ${O.colleague} isn't marked asked`);
  const completedRuns = all.filter((r) => r.actionName === "work" && r.status === "completed" && rows.some((t) => t.run?.sessionId === r.sessionId));
  const completedRows = rows.filter((t) => t.status === "completed");
  if (completedRows.length !== 1 || completedRuns.length !== 1) {
    failures.push(`b:once — ${O.colleague} completed ${completedRows.length} rows in ${completedRuns.length} runs, not one`);
  }
  notes.push(
    `killed ${O.killedAfterMs} ms after the ask; asker ${askedRequest?.status}; ${turns.length} turn(s); rows ${show(rows.map((t) => [t.status, t.attempts]))}; ` +
      `completed runs ${completedRuns.length}; said: ${said.slice(0, 200).replace(/\n/g, " ")}`,
  );
  return { failures, notes };
}

// ---- the run ------------------------------------------------------------------------

await runGoal(async () => {
  const model = goalModel();
  const keys = keysServing(model);
  if (!keys.some((k) => (process.env[k] ?? "") !== "")) {
    return { failures: [`blocked: no key here serves ${model}; none of ${keys.join(", ")} is set`], evidence: "" };
  }
  mkdirSync(join(SCRATCH, "stores"), { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const env = control === undefined ? {} : modulePatchEnv(control.patches, REPO_ROOT, mark);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  const profile = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam");
  const host = (await import(pathToFileURL(join(profile, "host.mts")).href)) as { LAB_USERS?: Record<string, { userId: string; bearer: string }>; LAB_ORG_ID?: string };
  const owner = host.LAB_USERS?.owner;
  if (owner === undefined || host.LAB_ORG_ID === undefined) throw new Error("setup: the DevTeam host exports no LAB_USERS owner or LAB_ORG_ID");
  LAB_ORG = host.LAB_ORG_ID;
  const alice: Person = { label: "Alice", ...owner };
  const shipped = await loadShipped(REPO_ROOT);
  say(`building Shift Manager's pages`);
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));

  const attempts = Number(process.env.GOAL_ATTEMPTS ?? (control === undefined ? 3 : 1));
  let result: { failures: string[]; notes: string[] } = { failures: ["no attempt ran"], notes: [] };
  for (let n = 1; n <= attempts; n += 1) {
    const label = `${control?.name ?? "plain"}-${n}`;
    const storeDir = join(SCRATCH, "stores", `${RUN_STAMP}-${label}`);
    const store = join(storeDir, "devteam.sqlite");
    mkdirSync(storeDir, { recursive: true });
    const serve = (name: string) =>
      startShiftManager({ scratch: SCRATCH, label: name, config: join(profile, "fsdev.config.mts"), pages, env: { DEVTEAM_STORE: store, ...env }, timeoutMs: 180_000 });
    try {
      const observed = await attempt({ serve, store, shipped, alice, model, label });
      result = grade(observed, store, alice.userId);
    } catch (error) {
      result = { failures: [`setup — ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}`], notes: [] };
    }
    for (const note of result.notes) say(`attempt ${n}: ${note}`);
    say(`attempt ${n} of ${attempts}: ${result.failures.length === 0 ? "PASS" : `FAIL (${[...new Set(result.failures.map((f) => f.split(" — ")[0]))].join(", ")})`}`);
    if (result.failures.length === 0) break;
    // A model that never asked is the model's flakiness; a mechanism failure fails every attempt the same way.
  }

  if (control !== undefined) assertPatched(control.patches, REPO_ROOT, mark);
  const failures = [...result.failures];
  if (control !== undefined) {
    for (const assertion of control.assertions) {
      const named = failures.some((f) => f.startsWith(`${assertion} `));
      failures.unshift(
        named
          ? `control ${control.name}: ${assertion} failed, as it must`
          : `control ${control.name}: ${assertion} did NOT fail, so the check can't see what the control removes`,
      );
    }
  }
  return { failures, evidence: `DevTeam on ${model}, SQLite, the server killed with SIGKILL while the ask waited; ${result.notes.join("; ")}` };
});
