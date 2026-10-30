/**
 * Goal check: a worker knows its own name and role, and its teammates, from
 * its prompt. On a real model, over the Teammates lab's HTTP API, against
 * `fsdev dev --app @flow-state-dev/teammates`. See goal.md for the contract.
 *
 * Legs, each graded from the reply and the turn's items:
 *   1. each of Chief of Staff, researcher and writer is asked who it is: its
 *      reply names it, and never says it is ChatGPT.
 *   2. Chief of Staff is asked who its teammates are: its reply names
 *      researcher and writer, and the turn made no tool call.
 *
 * Control (`GOAL_CONTROL=no-identity`, same command): the built-in worker
 * flow's default layer is patched out as the server loads it. Legs 1 and 2
 * must FAIL.
 *
 * Run: pnpm tsx goals/teammates-lab/a-worker-knows-who-it-is/run.mts
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
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

const fixture = loadFixture<{
  workers: { id: string; name: string }[];
  lead: string;
  teammates: string[];
  whoAreYou: string[];
  whoAreYourTeammates: string[];
}>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const LAB = repoPath("labs", "teammates");
const USER = "u_goal";

/** The `no-identity` control: the default layer's prompt entry, patched out as the server loads it. */
const NO_IDENTITY: ModulePatch[] = [
  {
    module: "packages/workforce/src/agent-worker-flow.ts",
    from: String.raw`workerIdentityPrompt\(ctx, options\.installation\)`,
    to: "undefined",
  },
];
if (!["", "no-identity"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Fsd = ReturnType<typeof createClient>;
type Item = { type: string; role?: string; requestId?: string; blockName?: string; content?: { text?: string }[] };

/** The Teammates lab on a fresh store, over an empty scratch checkout as its working folder. */
async function startTeammates(dir: string, env: Record<string, string>): Promise<{ child: ChildProcess; origin: string }> {
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

/** Every item of a session. */
async function itemsOf(fsd: Fsd, sessionId: string): Promise<Item[]> {
  const items: Item[] = [];
  for (let offset = 0; ; ) {
    const page = (await fsd.sessions.state(sessionId, { includeItems: true, offset, limit: 100 })) as {
      items?: Item[];
      pagination?: { hasMore: boolean; nextOffset: number };
    };
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) return items;
    offset = page.pagination.nextOffset;
  }
}

/** Say one line in a worker's conversation and wait for its turns to end: the turn's reply and how many tools it called. */
async function ask(fsd: Fsd, worker: string, line: string) {
  const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker });
  const sent = await fsd.flow(session.flowId ?? session.flowKind).send("respond", { message: line }, { sessionId: session.id });
  await sent.wait();
  for (let waited = 0; waited < 5 * 60_000; waited += 2_000) {
    if ((await fsd.sessions.requests(session.id, { status: "in_progress", limit: 20 })).length === 0) break;
    await sleep(2_000);
  }
  const turn = (await itemsOf(fsd, session.id)).filter((item) => item.requestId === sent.id);
  const reply = turn
    .filter((item) => item.type === "message" && item.role === "assistant")
    .map((item) => (item.content ?? []).map((part) => part.text ?? "").join(""))
    .join("\n");
  return { reply, toolCalls: turn.filter((item) => item.type === "tool_output").map((item) => item.blockName ?? "(unnamed)") };
}

const pick = <T,>(list: T[]): T => list[randomInt(0, list.length)]!;
const names = (reply: string, name: string) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(reply);

await runGoal(async (failures, tell) => {
  if (CONTROL === "no-identity") console.error(describePatches(NO_IDENTITY, REPO_ROOT));
  const notes: string[] = [];
  const graded: number[] = [];
  for (let n = 1; n <= RUNS; n += 1) {
    const fail = (what: string) => failures.push(`run ${n} · ${what}`);
    const dir = goalTmpDir(`knows-who-it-is-${n}`);
    const mark = join(dir, "patched.txt");
    const lab = await startTeammates(dir, CONTROL === "no-identity" ? modulePatchEnv(NO_IDENTITY, REPO_ROOT, mark) : {});
    try {
      const me = createClient({ userId: USER, baseUrl: lab.origin });

      // ── Leg 1: each worker says who it is.
      for (const worker of fixture.workers) {
        const { reply } = await ask(me, worker.id, pick(fixture.whoAreYou));
        if (!names(reply, worker.name)) fail(`leg 1 · ${worker.name} named: its reply doesn't name it: ${JSON.stringify(reply.slice(0, 300))}`);
        if (/chatgpt/i.test(reply)) fail(`leg 1 · ${worker.name} not ChatGPT: ${JSON.stringify(reply.slice(0, 300))}`);
        notes.push(`run ${n} ${worker.name}: ${JSON.stringify(reply.slice(0, 80))}`);
      }

      // ── Leg 2: Chief of Staff names its teammates, with no tool call.
      const { reply, toolCalls } = await ask(me, fixture.lead, pick(fixture.whoAreYourTeammates));
      for (const teammate of fixture.teammates) {
        if (!names(reply, teammate)) fail(`leg 2 · names ${teammate}: ${JSON.stringify(reply.slice(0, 400))}`);
      }
      if (toolCalls.length !== 0) fail(`leg 2 · no tool call: the turn called [${toolCalls.join(", ")}]`);
      notes.push(`run ${n} teammates: ${JSON.stringify(reply.slice(0, 80))}`);
      if (CONTROL === "no-identity") assertPatched(NO_IDENTITY, REPO_ROOT, mark);
    } finally {
      stopProcessGroup(lab.child);
    }
    graded.push(n);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
