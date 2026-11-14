/**
 * Goal check: the Teammates lab knows which coding harnesses can run on this
 * machine, says so at start, reads it again on request, and Lead
 * files coding work only on a ready one (FIX-2391). Against
 * `fsdev dev --app @flow-state-dev/teammates`, over HTTP. See goal.md for the
 * contract.
 *
 * Cursor is ready (a key in the lab's environment); Codex is not (no key, and
 * `CODEX_HOME` an empty folder, so the SDK's own `codex login status` finds no
 * login).
 *
 * - *start log*: the server's log has the Codex row, naming `codex login`.
 * - *re-check*: the harness kit's `harnesses` flow's readiness view returns Codex not ready
 *   with a remedy; after the SDK's own program logs in with a dummy key into
 *   that `CODEX_HOME`, `{ refresh: true }` returns it ready.
 * - *routes*: asked to have Codex change the README, Lead files no
 *   task on the Codex worker, and its reply says what to run.
 *
 * Controls (same command): `GOAL_CONTROL=no-readiness-context` takes the
 * readiness capability off the workers' `uses` (*routes* must fail);
 * `GOAL_CONTROL=kept-answer` makes `refresh` return the kept rows (*re-check*
 * must fail).
 *
 * Run: pnpm tsx goals/teammates-lab/routes-only-to-ready-harnesses/run.mts
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { findCodexProgram } from "@flow-state-dev/codex";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  REPO_ROOT,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { itemsOf, sleep, startTeammates, type Fsd } from "../lab.mts";

const fixture = loadFixture<{ lead: string; codexWorker: string; asks: string[]; remedy: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const USER = "u_goal";
const READINESS = "harnesses";
/** A request in one of these has ended; any other is still owed. */
const ENDED = new Set(["completed", "failed", "incomplete", "aborted", "interrupted", "cancelled"]);

const CONTROLS: Record<string, ModulePatch[]> = {
  "": [],
  // The workers' context loses the rows: the incident, where Codex is filed on regardless.
  "no-readiness-context": [
    { module: "packages/harness-manager/src/kit/harnesses-kit.ts", from: String.raw`\[harnessReadinessCapability\(readiness\)\]`, to: "[]" },
  ],
  // A refresh answers from the kept rows: a sign-in made after start is never seen.
  "kept-answer": [
    {
      module: "packages/harness-manager/src/readiness.ts",
      from: String.raw`const again = refresh === true \|\| refresh === harness;`,
      to: "const again = false;",
    },
  ],
};
if (!(CONTROL in CONTROLS)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);
const PATCHES = CONTROLS[CONTROL]!;

type Row = { harness: string; ready: boolean; reason: string | null; remedy: string | null };

/** The readiness view's rows, read with no session, checked again when `refresh` is set. */
async function readRows(fsd: Fsd, refresh: boolean): Promise<Row[]> {
  return (await fsd.view(harnessReadinessViewRef(READINESS), refresh ? { refresh: true } : {})).value;
}

/** Log Codex in with a dummy key, through the SDK's own program, into `codexHome`. */
async function codexLogin(codexHome: string): Promise<void> {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CODEX_HOME: codexHome };
  const program = await findCodexProgram(env);
  execFileSync(program.path, ["login", "--with-api-key"], {
    env: { ...env, PATH: [...program.pathDirs, env.PATH].join(delimiter) },
    input: "sk-goal-dummy\n",
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/** Say `line` to Lead, wait until no request of the user's is open for 20s, and return what came after. */
async function ask(fsd: Fsd, line: string) {
  const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker: fixture.lead });
  const before = (await itemsOf(fsd, session.id)).length;
  const sent = await fsd.flow(session.flowId ?? session.flowKind).send("respond", { message: line }, { sessionId: session.id });
  await sent.wait();
  for (let waited = 0, quiet = 0; waited < 8 * 60_000 && quiet < 20_000; waited += 2_000) {
    const all = (await fsd.sessions.list({ userId: USER })) as Array<{ id: string }>;
    let running = 0;
    for (const { id } of all) {
      const listed = (await fsd.sessions.requests(id, { limit: 50 })) as Array<{ status?: string }>;
      running += listed.filter((request) => !ENDED.has(String(request.status))).length;
    }
    quiet = running === 0 ? quiet + 2_000 : 0;
    await sleep(2_000);
  }
  const items = (await itemsOf(fsd, session.id)).slice(before);
  const reply = items
    .filter((item) => item.type === "message" && item.role === "assistant")
    .map((item) => (item.content ?? []).map((part) => part.text ?? "").join(""))
    .join("\n");
  const filed = items.filter((item) => item.type === "tool_output" && item.blockName === "createTask").map((item) => JSON.stringify(item));
  return { reply, filed };
}

await runGoal(async (failures, tell) => {
  if (PATCHES.length > 0) console.error(describePatches(PATCHES, REPO_ROOT));
  const notes: string[] = [];
  const graded: number[] = [];
  for (let n = 1; n <= RUNS; n += 1) {
    const fail = (what: string) => failures.push(`run ${n} · ${what}`);
    const dir = goalTmpDir(`routes-only-to-ready-harnesses-${n}`);
    const codexHome = join(dir, "codex-home");
    mkdirSync(codexHome, { recursive: true });
    const mark = join(dir, "patched.txt");
    const env = {
      // Cursor ready on a key alone; Codex with no key and no login.
      CURSOR_API_KEY: "goal-dummy-cursor-key",
      CODEX_API_KEY: "",
      CODEX_HOME: codexHome,
      ...(PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, mark) : {}),
    };
    const lab = await startTeammates(dir, USER, env);
    try {
      const me = createClient({ userId: USER, baseUrl: lab.origin });

      // *start log*: the table lands once the first read finishes.
      let log = "";
      for (const until = Date.now() + 60_000; Date.now() < until && !/✗ Codex/.test(log); await sleep(1_000)) {
        log = readFileSync(join(dir, "server.log"), "utf8");
      }
      const row = log.split("\n").find((line) => line.includes("✗ Codex"));
      if (row === undefined || !row.includes(fixture.remedy)) fail(`start log: no Codex row naming \`${fixture.remedy}\`: ${JSON.stringify(row ?? log.slice(-600))}`);

      // *re-check*: not ready now, ready after a login and a refresh.
      const rows = await readRows(me, false);
      const first = rows.find((r) => r.harness === "codex");
      if (first?.ready !== false || first.remedy === null) fail(`re-check: Codex should read not ready with a remedy, read ${JSON.stringify(first)}`);
      const cursor = rows.find((r) => r.harness === "cursor");
      if (cursor?.ready !== true) throw new Error(`setup: Cursor should be ready on its key, read ${JSON.stringify(cursor)}`);

      // *routes*: before the login, so Codex is still not ready.
      const { reply, filed } = await ask(me, fixture.asks[randomInt(0, fixture.asks.length)]!);
      if (reply.trim() === "") throw new Error(`run ${n}: Lead gave no reply, nothing to grade`);
      const onCodex = filed.filter((call) => call.includes(fixture.codexWorker));
      if (onCodex.length > 0) fail(`routes: a task was filed on ${fixture.codexWorker}: ${onCodex[0]!.slice(0, 400)}`);
      if (!reply.includes(fixture.remedy)) fail(`routes: the reply doesn't say to run \`${fixture.remedy}\`: ${JSON.stringify(reply.slice(0, 500))}`);
      console.error(`run ${n}: filed ${filed.length} (${onCodex.length} on Codex)\n${reply}\n---`);

      await codexLogin(codexHome);
      const again = (await readRows(me, true)).find((r) => r.harness === "codex");
      if (again?.ready !== true) fail(`re-check: after \`codex login\`, a refresh should read Codex ready, read ${JSON.stringify(again)}`);

      notes.push(`run ${n}: start row ${JSON.stringify(row ?? "")}, filed ${filed.length} (${onCodex.length} on Codex), refresh ready ${again?.ready}`);
      if (PATCHES.length > 0) assertPatched(PATCHES, REPO_ROOT, mark);
    } finally {
      stopProcessGroup(lab.child);
    }
    graded.push(n);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
