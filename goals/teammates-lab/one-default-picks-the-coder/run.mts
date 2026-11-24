/**
 * Goal check: in the Teammates lab, one value picks the coder. With
 * `TEAMMATES_HARNESS` set, a coding task Lead starts from a person's message
 * lands on the coding worker with that harness and runs on it, whatever worker
 * Lead named or any text says (FIX-2877, leg a). Against
 * `fsdev dev --app @flow-state-dev/teammates`, over HTTP, Lead on the lab's
 * real model, the coders on the scripted harness (`GOAL_HARNESS=stub`). See
 * goal.md for the contract.
 *
 * - *named*: an ask that tells Lead to file on `teammates.cursor`, which Lead
 *   does in its own tool call (checked, so the input holds), still lands on
 *   the default's worker and runs on the default. On `codex` the ask and the
 *   README also say `Coding harness: Cursor` (*planted*).
 * - *default*: for each default, a held-out ask's tasks are on the worker
 *   whose `harness:` is the default, and the run's coder answers that harness.
 * - *board*: a task a person files on the Cursor worker through the board stays
 *   there, and runs on Cursor.
 * - *no-own-harness*: a hire that sets a `harness` is refused, and nothing joins
 *   the roster.
 *
 * Control (same command): `GOAL_CONTROL=model-assignee` patches the server's
 * no-pick assignee out of the harness kit, so Lead's own assignee stands:
 * *named* must FAIL on every run, since Lead itself names `teammates.cursor`.
 *
 * Run: pnpm tsx goals/teammates-lab/one-default-picks-the-coder/run.mts
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";
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

const fixture = loadFixture<{
  lead: string;
  coders: Record<string, string>;
  defaults: string[];
  asks: string[];
  named: string;
  planted: { line: string; readme: string };
  board: { title: string; goal: string };
}>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const USER = "u_goal";
/** A request in one of these has ended; any other is still owed. */
const ENDED = new Set(["completed", "failed", "incomplete", "aborted", "interrupted", "cancelled"]);

const CONTROLS: Record<string, ModulePatch[]> = {
  "": [],
  // The server's no-pick write patched out: the model's assignee stands, as before this change.
  "model-assignee": [
    {
      module: "packages/harness-manager/src/kit/coder-flow.ts",
      from: String.raw`\.\.\.\(options\.defaultHarness === undefined \? \{\} : \{ noPickAssignee: defaultCoderAssignee\(options\.defaultHarness\) \}\),`,
      to: "",
    },
  ],
};
if (!(CONTROL in CONTROLS)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);
const PATCHES = CONTROLS[CONTROL]!;

type Row = { id: string; goal: string; title?: string; assignee?: string; status: string; run?: { sessionId: string } | null };

/** Lead's board rows, read through the board's view. */
async function rows(fsd: Fsd, flow: string, sessionId: string): Promise<Row[]> {
  return (await fsd.view(taskListViewRef(flow, "tasks"), {}, { sessionId })).value as Row[];
}

/** Run one of the board's actions on Lead's conversation; its output. */
async function act(fsd: Fsd, flow: string, sessionId: string, action: string, input: unknown): Promise<unknown> {
  const sent = await fsd.flow(flow).send(action, input, { sessionId });
  const ended = (await sent.wait()) as { id?: string };
  const requests = (await fsd.sessions.requests(sessionId, { limit: 50, includeResultOutput: true })) as Array<{ id: string; result?: { output?: unknown } }>;
  return requests.find((request) => request.id === ended.id)?.result?.output;
}

/** Say `line` to Lead and wait until no request of the user's is open for 15s. */
async function say(fsd: Fsd, flow: string, sessionId: string, line: string): Promise<void> {
  const sent = await fsd.flow(flow).send("respond", { message: line }, { sessionId });
  await sent.wait();
  for (let waited = 0, quiet = 0; waited < 6 * 60_000 && quiet < 15_000; waited += 2_000) {
    const all = (await fsd.sessions.list({ userId: USER })) as Array<{ id: string }>;
    let running = 0;
    for (const { id } of all) {
      const listed = (await fsd.sessions.requests(id, { limit: 50 })) as Array<{ status?: string }>;
      running += listed.filter((request) => !ENDED.has(String(request.status))).length;
    }
    quiet = running === 0 ? quiet + 2_000 : 0;
    await sleep(2_000);
  }
}

/** The harness the run of `row` resolved, asked of its run session's coder; `undefined` while it has no run. */
async function runHarness(fsd: Fsd, flow: string, sessionId: string, taskId: string): Promise<string | undefined> {
  for (const end = Date.now() + 3 * 60_000; Date.now() < end; await sleep(2_000)) {
    const row = (await rows(fsd, flow, sessionId)).find((r) => r.id === taskId);
    if (row?.run == null) continue;
    const sent = await fsd.flow("coder").send("harness", {}, { sessionId: row.run.sessionId });
    const ended = (await sent.wait()) as { id?: string };
    const requests = (await fsd.sessions.requests(row.run.sessionId, { limit: 50, includeResultOutput: true })) as Array<{ id: string; result?: { output?: { harness?: string } } }>;
    return requests.find((request) => request.id === ended.id)?.result?.output?.harness;
  }
  return undefined;
}

await runGoal(async (failures, tell) => {
  if (PATCHES.length > 0) console.error(describePatches(PATCHES, REPO_ROOT));
  if (process.env.AI_GATEWAY_API_KEY === undefined) throw new Error("setup: needs AI_GATEWAY_API_KEY (Lead's model)");
  const notes: string[] = [];
  const graded: string[] = [];
  for (const harness of fixture.defaults) {
    const expected = fixture.coders[harness]!;
    for (let n = 1; n <= RUNS; n += 1) {
      const fail = (what: string) => failures.push(`${harness} run ${n} · ${what}`);
      const dir = goalTmpDir(`one-default-picks-the-coder-${harness}-${n}`);
      const mark = join(dir, "patched.txt");
      // A checkout with one commit; on codex, its README plants another coder's name.
      const workdir = join(dir, "workdir");
      mkdirSync(workdir, { recursive: true });
      writeFileSync(join(workdir, "README.md"), harness === "codex" ? fixture.planted.readme : "# Team\n");
      writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
      git("init", "-q", "-b", "main");
      git("add", ".");
      git("commit", "-q", "-m", "Start the README");
      const lab = await startTeammates(dir, USER, {
        GOAL_HARNESS: "stub",
        GOAL_HARNESS_STEP_MS: "200",
        TEAMMATES_HARNESS: harness,
        ...(PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, mark) : {}),
      }, workdir);
      try {
        const me = createClient({ userId: USER, baseUrl: lab.origin });
        const session = await createWorkforceClient(me).ensureWorkerSession({ worker: fixture.lead });
        const flow = session.flowId ?? session.flowKind;

        /**
         * Ask Lead, and grade every coding task it started from the ask. The
         * scripted run changes no README, so Lead may follow up with more
         * tasks (its prompt says to course-correct): each one is graded.
         */
        const grade = async (signal: string, line: string, modelNames?: string) => {
          const before = new Set((await rows(me, flow, session.id)).map((r) => r.id));
          const seen = (await itemsOf(me, session.id)).length;
          await say(me, flow, session.id, line);
          // The input holds only if Lead's own tool call named that worker: the store is graded against it.
          let named = "";
          if (modelNames !== undefined) {
            const calls = (await itemsOf(me, session.id))
              .slice(seen)
              .filter((item) => item.type === "tool_output" && item.blockName === "createTask")
              .map((item) => {
                try {
                  return String(JSON.parse((item as { toolCall?: { arguments?: string } }).toolCall?.arguments ?? "{}").assignee ?? "");
                } catch {
                  return "";
                }
              });
            if (calls[0] !== modelNames) fail(`${signal}: input didn't hold: Lead's first createTask named ${JSON.stringify(calls[0] ?? null)}, not ${modelNames}`);
            named = `, Lead named ${calls[0] ?? "none"}`;
          }
          // A coding task is one on a coding worker: Lead may also ask researcher to look first.
          const coders = new Set(Object.values(fixture.coders));
          const filed = (await rows(me, flow, session.id)).filter((r) => !before.has(r.id) && r.assignee !== undefined && coders.has(r.assignee));
          if (filed.length === 0) {
            fail(`${signal}: Lead started no coding task`);
            return `${signal} no task`;
          }
          const off = filed.filter((r) => r.assignee !== expected);
          if (off.length > 0) fail(`${signal}: ${off.length} of ${filed.length} tasks are not on ${expected}: ${JSON.stringify(off.map((r) => [r.title, r.assignee]))}`);
          const ran = await runHarness(me, flow, session.id, filed[0]!.id);
          if (ran !== harness) fail(`${signal}: the first task's run resolved harness ${ran}, not ${harness}`);
          return `${signal} ${filed.length - off.length} of ${filed.length} on ${expected}, first ran ${ran}${named}`;
        };

        // The named ask first, on a conversation with no earlier coding task to follow up instead.
        const read: string[] = [
          harness === "codex"
            ? await grade("named+planted", `${fixture.named}${fixture.planted.line}`, fixture.coders.cursor)
            : await grade("named", fixture.named, fixture.coders.cursor),
        ];
        read.push(await grade("default", fixture.asks[randomInt(0, fixture.asks.length)]!));

        // *board* and *no-own-harness*: once per default, on its first run.
        if (n === 1) {
          const out = (await act(me, flow, session.id, "createTask_tasks", { assignee: fixture.coders.cursor, ...fixture.board })) as { ok?: boolean; taskId?: string } | undefined;
          if (out?.ok !== true || out.taskId === undefined) throw new Error(`setup: the board's createTask refused: ${JSON.stringify(out)}`);
          const row = (await rows(me, flow, session.id)).find((r) => r.id === out.taskId);
          const ran = await runHarness(me, flow, session.id, out.taskId);
          if (row?.assignee !== fixture.coders.cursor || ran !== "cursor") fail(`board: a person's task on ${fixture.coders.cursor} is on ${row?.assignee} and ran ${ran}`);
          read.push(`board on ${row?.assignee} ran ${ran}`);

          const workforce = createWorkforceClient(me);
          const hired = await workforce.hire({ id: "tester", description: "Writes tests.", settings: { harness: "cursor" } }).then(() => "hired", (error: unknown) => String(error));
          const roster = await workforce.roster();
          if (hired === "hired" || roster.some((w) => w.id === "tester")) fail(`no-own-harness: a hire setting a harness was taken: ${hired}`);
          if (!/no longer takes/.test(hired)) fail(`no-own-harness: the refusal doesn't say the setting is gone: ${hired}`);
          read.push(`hire with a harness: ${hired.slice(0, 120)}`);
        }
        tell.over(`${harness} run ${n}`, read);
        notes.push(`${harness} run ${n}: ${read.join(", ")}`);
        if (PATCHES.length > 0) assertPatched(PATCHES, REPO_ROOT, mark);
      } finally {
        stopProcessGroup(lab.child);
      }
      graded.push(`${harness} ${n}`);
    }
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${graded.length} runs: ${notes.join("; ")}` };
});
