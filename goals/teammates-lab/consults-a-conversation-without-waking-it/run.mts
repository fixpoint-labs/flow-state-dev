/**
 * Goal check: a worker answers from another of the user's conversations
 * without waking it. On a real model, over the labs' HTTP API, against
 * `fsdev dev` on `labs/teammates` (legs 1 and 2) and on
 * `labs/claude-code-style` (leg 3). See goal.md for the contract.
 *
 * Legs, each graded from the reply, the sessions' requests and items, and the
 * message log, never from the tool call alone:
 *   1. the user tells writer a held-out value in writer's conversation, then
 *      asks lead for it: lead's reply names it, and so does a consult's reading
 *      in that turn (the lab's user memory also carries the value to lead, so
 *      the reply alone proves nothing); writer's conversation has the
 *      same requests and items as before; the message log has no row; the
 *      consult's generator ran on the lab's utility model.
 *   2. a second user asks their own lead to read the first user's writer
 *      conversation by its id: no value, and the turn holds a consult refused
 *      `no_session`.
 *   3. in the Claude Code-style lab, the user says a value in session A, then
 *      asks `desk.main` in session B what they said there, by A's id: the
 *      value comes back, and A has no new request.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command):
 *   - `no-consult`: lead's file doesn't name `consultSessions: [consult]`.
 *     Leg 1 must FAIL; leg 2 fails too (no consult call) and leg 3 is not run.
 *   - `no-owner-check`: the engine's one owner rule skips its user check, as
 *     the server loads it. Leg 2 must FAIL on `no value`.
 *
 * Run: pnpm tsx goals/teammates-lab/consults-a-conversation-without-waking-it/run.mts
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient, readEveryCollectionPage } from "@flow-state-dev/client";
import { createWorkforceClient, WORKER_MESSAGES_RESOURCE } from "@flow-state-dev/workforce/browser";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  intentFreeEnv,
  loadFixture,
  modulePatchEnv,
  refuseIfAnswering,
  repoPath,
  REPO_ROOT,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { startLab as startDesk } from "../../claude-code-style-lab/lab.mts";

interface Told {
  topic: string;
  say: string;
  ask: string;
}
const fixture = loadFixture<{
  lead: string;
  writer: string;
  main: string;
  told: Told[];
  intruderAsk: string;
  otherSessionAsk: string;
}>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const LAB = repoPath("labs", "teammates");
const USER = "u_goal";
const INTRUDER = "u_goal_intruder";
/** The utility model both labs read a consult on. */
const UTILITY = "gpt-6-luna";
const TOOL = "consultSessionHistory";
const ANSWER_BLOCK = `${TOOL}-answer`;

/** The `no-owner-check` control: the owner rule's user check, patched out as the server loads it. */
const NO_OWNER_CHECK: ModulePatch[] = [
  {
    module: "packages/engine/src/context/request-sessions.ts",
    from: String.raw`record\.userId !== identity\.userId \|\|`,
    to: "",
  },
];
if (!["", "no-consult", "no-owner-check"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Fsd = ReturnType<typeof createClient>;
type Item = {
  type: string;
  role?: string;
  requestId?: string;
  blockName?: string;
  output?: any;
  content?: { text?: string }[];
};

/** The teammates lab, served from a copy of its workers' tree, over an empty scratch checkout as its working folder. */
async function startTeammates(dir: string, tree: string, env: Record<string, string>): Promise<{ child: ChildProcess; origin: string }> {
  const workdir = join(dir, "workdir");
  mkdirSync(workdir, { recursive: true });
  execFileSync("git", ["init", "-q", workdir]);
  const port = 46_000 + randomInt(0, 9_000);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  let log = "";
  const child = spawn("npx", ["tsx", "../../packages/cli/bin/fsdev.ts", "dev", "--app", "@flow-state-dev/teammates", "--port", String(port), "--no-open"], {
    cwd: LAB,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: intentFreeEnv(process.env, {
      GOAL_CONTROL: "",
      TEAMMATES_STORE: join(dir, "teammates.sqlite"),
      TEAMMATES_TREE: tree,
      TEAMMATES_USER: USER,
      TEAMMATES_WORKDIR: workdir,
      ...env,
    }),
  });
  const keep = (chunk: Buffer) => {
    log += chunk.toString();
    writeFileSync(join(dir, "server.log"), log);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  for (const until = Date.now() + 120_000; Date.now() < until; ) {
    if (child.exitCode !== null) throw new Error(`setup: the lab exited (${child.exitCode}); log tail:\n${log.slice(-2000)}`);
    if (await fetch(origin, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)) return { child, origin };
    await sleep(500);
  }
  stopProcessGroup(child);
  throw new Error(`setup: the lab did not answer on ${origin} within 120s; log tail:\n${log.slice(-2000)}`);
}

/**
 * The models the consult's answer ran on in one request, from the lab's store.
 * Its message is kept off the client by design, so no HTTP read returns it.
 */
function answerModels(store: string, requestId: string): string[] {
  const db = new DatabaseSync(store, { readOnly: true });
  try {
    const rows = db.prepare("SELECT data FROM request_items WHERE request_id = ? AND item_type = 'message'").all(requestId) as { data: string }[];
    return rows
      .map((row) => JSON.parse(row.data) as { provenance?: { blockName?: string }; model?: { actual?: string } })
      .filter((item) => item.provenance?.blockName === ANSWER_BLOCK)
      .map((item) => item.model?.actual ?? "(none)");
  } finally {
    db.close();
  }
}

/** Every item of a session, or only the types named. */
async function itemsOf(fsd: Fsd, sessionId: string, itemTypes?: string[]): Promise<Item[]> {
  const items: Item[] = [];
  for (let offset = 0; ; ) {
    const page = (await fsd.sessions.state(sessionId, { includeItems: true, ...(itemTypes ? { itemTypes } : {}), offset, limit: 100 })) as {
      items?: Item[];
      pagination?: { hasMore: boolean; nextOffset: number };
    };
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) return items;
    offset = page.pagination.nextOffset;
  }
}

const requestCount = async (fsd: Fsd, sessionId: string) => (await fsd.sessions.requests(sessionId, { limit: 100 })).length;

/** Say one line in a session and wait for every turn there to end; the turn's reply and its consult results. */
async function say(fsd: Fsd, flow: string, sessionId: string, line: string) {
  const sent = await fsd.flow(flow).send("respond", { message: line }, { sessionId });
  await sent.wait();
  for (let waited = 0; waited < 5 * 60_000; waited += 2_000) {
    if ((await fsd.sessions.requests(sessionId, { status: "in_progress", limit: 20 })).length === 0) break;
    await sleep(2_000);
  }
  const turn = (await itemsOf(fsd, sessionId)).filter((item) => item.requestId === sent.id);
  const reply = turn
    .filter((item) => item.type === "message" && item.role === "assistant")
    .map((item) => (item.content ?? []).map((part) => part.text ?? "").join(""))
    .join("\n");
  const consults = turn.filter((item) => item.type === "tool_output" && item.blockName === TOOL).map((item) => item.output);
  return { id: sent.id, reply, consults };
}

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
const heldOut = () => `${["Hall", "Pier", "Room", "Gate"][randomInt(0, 4)]} ${String.fromCharCode(65 + randomInt(0, 26))}-${randomInt(10, 99)}${randomInt(0, 10)}`;

/** Legs 1 and 2 on the Teammates lab. */
async function teammatesRun(n: number, tree: string, fail: (what: string) => void, notes: string[]) {
  const dir = goalTmpDir(`consults-teammates-${n}`);
  const mark = join(dir, "patched.txt");
  const env = CONTROL === "no-owner-check" ? modulePatchEnv(NO_OWNER_CHECK, REPO_ROOT, mark) : {};
  const told = fixture.told[randomInt(0, fixture.told.length)]!;
  const value = heldOut();
  const lab = await startTeammates(dir, tree, env);
  try {
    const me = createClient({ userId: USER, baseUrl: lab.origin });
    const workforce = createWorkforceClient(me);

    // ── Leg 1: tell writer, then ask lead.
    const writer = await workforce.ensureWorkerSession({ worker: fixture.writer });
    await say(me, writer.flowId ?? writer.flowKind, writer.id, fill(told.say, { value }));
    const before = { requests: await requestCount(me, writer.id), items: (await itemsOf(me, writer.id)).length };
    const lead = await workforce.ensureWorkerSession({ worker: fixture.lead });
    const asked = await say(me, lead.flowId ?? lead.flowKind, lead.id, told.ask);
    if (!asked.reply.includes(value)) fail(`leg 1 · value named: lead's reply doesn't name ${value}: ${JSON.stringify(asked.reply.slice(0, 300))}`);
    // The lab's user memory carries what writer heard to lead too, so the reply alone doesn't prove a consult.
    if (!asked.consults.some((out) => typeof out?.reading === "string" && out.reading.includes(value))) {
      fail(`leg 1 · reading names it: no consult in lead's turn read ${value} from writer's conversation`);
    }
    const after = { requests: await requestCount(me, writer.id), items: (await itemsOf(me, writer.id)).length };
    if (after.requests !== before.requests) fail(`leg 1 · writer not woken: writer's requests went ${before.requests} → ${after.requests}`);
    if (after.items !== before.items) fail(`leg 1 · writer unchanged: writer's items went ${before.items} → ${after.items}`);
    const rows = await readEveryCollectionPage(me.resources, lead.id, WORKER_MESSAGES_RESOURCE);
    if (rows.length !== 0) fail(`leg 1 · no message: the message log holds ${rows.length} row(s)`);
    const models = answerModels(join(dir, "teammates.sqlite"), asked.id);
    if (!models.some((model) => model.includes(UTILITY))) fail(`leg 1 · utility model: no consult answer ran on ${UTILITY}: [${models.join(", ")}]`);
    notes.push(`run ${n} leg 1: "${told.topic}" ${value}, ${asked.consults.length} consult(s) on [${models.join(", ")}], writer ${before.requests}/${before.items} → ${after.requests}/${after.items}`);

    // ── Leg 2: another user asks their own lead to read the first user's writer conversation.
    const them = createClient({ userId: INTRUDER, baseUrl: lab.origin });
    const theirLead = await createWorkforceClient(them).ensureWorkerSession({ worker: fixture.lead });
    const intruded = await say(them, theirLead.flowId ?? theirLead.flowKind, theirLead.id, fill(fixture.intruderAsk, { session: writer.id, topic: told.topic }));
    if (intruded.reply.includes(value) || JSON.stringify(intruded.consults).includes(value)) fail("leg 2 · no value: another user was told the value");
    if (intruded.consults.length === 0) fail("leg 2 · refused no_session: the turn made no consult");
    else if (!intruded.consults.some((out) => typeof out?.error === "string" && out.error.startsWith("no_session"))) {
      fail(`leg 2 · refused no_session: ${JSON.stringify(intruded.consults).slice(0, 300)}`);
    }
    notes.push(`run ${n} leg 2: ${intruded.consults.length} consult(s)`);
    if (CONTROL === "no-owner-check") assertPatched(NO_OWNER_CHECK, REPO_ROOT, mark);
  } finally {
    stopProcessGroup(lab.child);
  }
}

/** Leg 3 on the Claude Code-style lab: session B reads session A. */
async function deskRun(n: number, fail: (what: string) => void, notes: string[]) {
  const scratch = goalTmpDir(`consults-desk-${n}`);
  const told = fixture.told[randomInt(0, fixture.told.length)]!;
  const value = heldOut();
  const lab = await startDesk(join(scratch, "data"), USER, {});
  try {
    const me = createClient({ userId: USER, baseUrl: lab.origin });
    const a = (await me.flow("agent").createSession({ state: { workerId: fixture.main } })).id;
    await say(me, "agent", a, fill(told.say, { value }));
    const before = await requestCount(me, a);
    const b = (await me.flow("agent").createSession({ state: { workerId: fixture.main } })).id;
    const asked = await say(me, "agent", b, fill(fixture.otherSessionAsk, { session: a, topic: told.topic }));
    if (!asked.reply.includes(value)) fail(`leg 3 · value named: session B's reply doesn't name ${value}: ${JSON.stringify(asked.reply.slice(0, 300))}`);
    const after = await requestCount(me, a);
    if (after !== before) fail(`leg 3 · A not woken: session A's requests went ${before} → ${after}`);
    notes.push(`run ${n} leg 3: "${told.topic}" ${value}, ${asked.consults.length} consult(s), A ${before} → ${after}`);
  } finally {
    stopProcessGroup(lab.child);
  }
}

await runGoal(async (failures, tell) => {
  // A copy of the workers' tree, so the `no-consult` control never edits the checkout.
  const tree = join(goalTmpDir("consults-tree"), "workforce");
  cpSync(join(LAB, "workforce"), tree, { recursive: true });
  if (CONTROL === "no-consult") {
    const file = join(tree, "teams/teammates/workers/lead/WORKER.md");
    const original = readFileSync(file, "utf8");
    const stripped = original.replace(/\ncapabilities:\n  consultSessions: \[consult\]\n/, "\n");
    if (stripped === original) throw new Error("setup: lead's file names no consultSessions preset to drop");
    writeFileSync(file, stripped);
  }
  if (CONTROL === "no-owner-check") console.error(describePatches(NO_OWNER_CHECK, REPO_ROOT));
  const notes: string[] = [];
  const graded: number[] = [];
  for (let n = 1; n <= RUNS; n += 1) {
    const fail = (what: string) => failures.push(`run ${n} · ${what}`);
    await teammatesRun(n, tree, fail, notes);
    if (CONTROL === "") await deskRun(n, fail, notes);
    graded.push(n);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
