/**
 * Goal check: an app installs workforce and the coding harnesses with one
 * config object each, and gets every worker, the roster view, one coding
 * worker flow and the readiness view, with no host wiring; no host or goal
 * calls the old install calls, and every file in `workforce/` is used or
 * refused.
 *
 * Model-free: each lab is served by `fsdev serve` over its own config, the
 * real install, with harness-manager's scripted harness under each harness id
 * (`GOAL_HARNESS=stub`), and no model key, so the judge reads nothing.
 *
 * - a: Teammates on kits. Its flows; a task filed from Lead's conversation for
 *   the worker whose file says `harness: codex` runs on the codex entry and
 *   reaches review; the readiness view; the roster view for a user with no session.
 * - b: claude-code-style on kits starts; a planted `workforce/flows/notes.mts`
 *   stops it, named; the claim census reads 0 unclaimed.
 * - c: the callers count reads 0 outside workforce.
 *
 * Run: pnpm tsx goals/kits/workforce-and-harnesses-install-as-kits/run.mts
 * Controls: GOAL_CONTROL=drop-kit-fills | skip-unknown (see goal.md)
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";
import { createWorkforceClient, rosterView } from "@flow-state-dev/workforce/browser";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  intentFreeEnv,
  modulePatchEnv,
  REPO_ROOT,
  runGoal,
  sleep,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";

const FSDEV = join(REPO_ROOT, "packages/fsdev/bin/fsdev.ts");
const TSX = join(REPO_ROOT, "packages/fsdev/node_modules/.bin/tsx");
const TEAMMATES = join(REPO_ROOT, "labs/teammates");
const CCS = join(REPO_ROOT, "labs/claude-code-style");
const KITS = "packages/engine/src/flowstate/kits.ts";
const TMP = goalTmpDir("kits-workforce-and-harnesses-install-as-kits");
const USER = "u_goal";
/** The board's action on the conversation that files a task. */
const CREATE_TASK = "createTask_tasks";
/** Lead, and the coding worker whose file names Codex, in Teammates' own tree. */
const LEAD = "teammates.chief-of-staff";
const CODEX_WORKER = "teammates.codex";
/** The stray a person might leave in claude-code-style's workforce folder, and the folder it makes. */
const STRAY = join(CCS, "workforce/flows/notes.mts");
const STRAY_FOLDER = dirname(STRAY);
/**
 * How the refusal names it. Nothing else under `flows/` is claimed, so the
 * claim pass names the topmost entry no reader used: the folder holding it.
 */
const STRAY_NAMED = 'kit "workforce": "flows" is not used';
const ENDED = new Set(["completed", "failed", "incomplete", "aborted", "interrupted", "cancelled", "suspended"]);

/** Each control degrades the one behaviour it names, in the engine the labs run. */
const CONTROLS: Record<string, ModulePatch[]> = {
  // Drop every kit's slot contribution: `coder` is never registered, and the codex worker is refused at hire.
  "drop-kit-fills": [
    { module: KITS, from: "const given = kit\\.definition\\.contributes\\(\\{ config: kit\\.config, slots: own as never \\}\\);", to: "const given: Record<string, unknown> = {};" },
  ],
  // Pass every entry a reader did not claim, as a loader that skips a stray file would.
  "skip-unknown": [{ module: KITS, from: "await opened\\.unclaimed\\(\\)", to: "await opened.unclaimed().then(() => [])" }],
};
const control = process.env.GOAL_CONTROL;
if (control !== undefined && control !== "" && CONTROLS[control] === undefined) {
  throw new Error(`setup: unknown GOAL_CONTROL "${control}"; known: ${Object.keys(CONTROLS).join(", ")}`);
}
const PATCHES = control === undefined || control === "" ? [] : CONTROLS[control]!;
const MARK = join(TMP, "patched.txt");

/** The environment for a lab: no model override, no model key (the judge reads nothing), the control's patches. */
function labEnv(extra: Record<string, string>): Record<string, string> {
  const env = intentFreeEnv(process.env, { GOAL_CONTROL: "", ...(PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, MARK) : {}), ...extra });
  delete env.AI_GATEWAY_API_KEY;
  delete env.FSDEV_DEFAULT_MODEL;
  return env;
}

interface Served {
  child: ChildProcess;
  origin: string;
  /** Everything the server wrote, so far. */
  log: () => string;
  /** Set when the server exited before it answered. */
  exited?: number;
}

/** `fsdev serve` over the config in `cwd`; resolves once it answers, or once it has exited. */
async function serve(name: string, cwd: string, env: Record<string, string>): Promise<Served> {
  const port = 47_000 + randomInt(0, 9_000);
  const origin = `http://127.0.0.1:${port}`;
  let log = "";
  const child = spawn(TSX, [FSDEV, "serve", "--port", String(port), "--host", "127.0.0.1"], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env });
  const keep = (chunk: Buffer) => {
    log += chunk.toString();
    writeFileSync(join(TMP, `${name}.log`), log);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  const served: Served = { child, origin, log: () => log };
  for (const until = Date.now() + 180_000; Date.now() < until; await sleep(1_000)) {
    if (child.exitCode !== null) {
      served.exited = child.exitCode;
      return served;
    }
    const answered = await fetch(`${origin}/api/flows`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false);
    if (answered) return served;
  }
  stopProcessGroup(child);
  throw new Error(`setup: ${name} neither answered nor exited within 180s; log tail:\n${log.slice(-2000)}`);
}

/** Wait until no request of `client`'s user is still running, for up to `ms`. Every store read comes after. */
async function settled(client: ReturnType<typeof createClient>, ms: number): Promise<boolean> {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1_000)) {
    const sessions = (await client.sessions.list({ userId: USER })) as Array<{ id: string }>;
    let running = 0;
    for (const { id } of sessions) {
      const requests = (await client.sessions.requests(id, { limit: 50 })) as Array<{ status?: string }>;
      running += requests.filter((request) => !ENDED.has(String(request.status))).length;
    }
    if (running === 0) return true;
  }
  return false;
}

/** A git checkout with one commit that ignores `.fsdev/`: a coding run's working folder. */
function workingFolder(dir: string): string {
  const workdir = join(dir, "workdir");
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, "README.md"), "# Team\n");
  writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start the README");
  return workdir;
}

type TaskEntry = { id: string; status: string; run?: { sessionId: string } | null; holds?: Array<{ ask: { kind: string } }> };

await runGoal(async (failures, tell) => {
  if (PATCHES.length > 0) console.error(describePatches(PATCHES, REPO_ROOT));
  const evidence: string[] = [];
  if (existsSync(STRAY_FOLDER)) throw new Error(`setup: ${STRAY_FOLDER} exists before the plant; claude-code-style's workforce folder holds no flows/`);

  // ── a: Teammates on kits ──────────────────────────────────────────────
  const teammatesDir = join(TMP, "teammates");
  rmSync(teammatesDir, { recursive: true, force: true });
  mkdirSync(teammatesDir, { recursive: true });
  // The worker file is the source of the harness: a default would hide a routing that ignores `harness:`.
  const codexFile = readFileSync(join(TEAMMATES, "workforce/teams/teammates/workers/codex/WORKER.md"), "utf8");
  if (!/^harness: codex$/m.test(codexFile) || !/^flow: coder$/m.test(codexFile)) throw new Error("setup: Teammates' codex worker no longer names `flow: coder` and `harness: codex`");
  const teammates = await serve("teammates", TEAMMATES, labEnv({
    TEAMMATES_STORE: join(teammatesDir, "teammates.sqlite"),
    TEAMMATES_USER: USER,
    TEAMMATES_WORKDIR: workingFolder(teammatesDir),
    TEAMMATES_RUNS: join(teammatesDir, "runs"),
    // Not codex: a task that runs on codex was routed by the worker's own line.
    TEAMMATES_HARNESS: "cursor",
    GOAL_HARNESS: "stub",
    GOAL_HARNESS_STEP_MS: "200",
  }));
  try {
    if (teammates.exited !== undefined) {
      failures.push(`a:start: Teammates did not start (exit ${teammates.exited}): ${teammates.log().split("\n").filter((line) => /refus|can't|names no flow|problem/i.test(line)).slice(0, 4).join(" | ")}`);
    } else {
      const me = createClient({ userId: USER, baseUrl: teammates.origin });
      // a:flows: the kits' flows, and no lab-owned coding or readiness flow.
      const flows = tell.over("a:flows", ((await (await fetch(`${teammates.origin}/api/flows`)).json()) as { flows: Array<{ id: string }> }).flows.map((flow) => flow.id));
      for (const id of ["agent", "coder", "harnesses", "workforce-roster"]) if (!flows.includes(id)) failures.push(`a:flows: no "${id}" flow among ${JSON.stringify(flows)}`);
      for (const id of ["teammates-coder", "harness-readiness"]) if (flows.includes(id)) failures.push(`a:flows: the lab still serves its own "${id}"`);
      evidence.push(`a:flows ${JSON.stringify(flows.sort())}`);

      // a:roster: Lead is listed for a user who has opened no session.
      const fresh = createClient({ userId: "u_fresh", baseUrl: teammates.origin });
      const roster = tell.over("a:roster", (await fresh.view(rosterView, {})).value.map((entry) => entry.id));
      if (!roster.includes(LEAD)) failures.push(`a:roster: the roster view for a user with no session lists no ${LEAD}: ${JSON.stringify(roster)}`);
      const freshSessions = (await fresh.sessions.list({ userId: "u_fresh" })) as unknown[];
      tell.over("a:roster no session", freshSessions, { emptyIs: "the roster is read with no session, and that read makes none" });
      if (freshSessions.length > 0) failures.push(`a:roster: reading the roster made ${freshSessions.length} session(s)`);
      evidence.push(`a:roster ${roster.length} workers, ${LEAD} among them, ${freshSessions.length} sessions`);

      // a:task: Lead's board files a task for the codex worker; it runs on the codex entry and reaches review.
      const lead = await createWorkforceClient(me).ensureWorkerSession({ worker: LEAD });
      const leadFlow = lead.flowId ?? lead.flowKind;
      const sent = await me.flow(leadFlow).send(CREATE_TASK, { assignee: CODEX_WORKER, title: "Add a welcome line", goal: "Add the line \"Welcome.\" to README.md and commit it." }, { sessionId: lead.id });
      await sent.wait();
      let entry: TaskEntry | undefined;
      for (const until = Date.now() + 5 * 60_000; Date.now() < until; await sleep(2_000)) {
        entry = ((await me.view(taskListViewRef(leadFlow, "tasks"), {}, { sessionId: lead.id })).value as TaskEntry[]).find((task) => task.run != null || task.status !== "pending");
        if (entry?.holds?.some((hold) => hold.ask.kind === "review") || ["completed", "errored", "cancelled"].includes(entry?.status ?? "")) break;
      }
      if (!(await settled(me, 120_000))) failures.push("a:task: requests were still running after two minutes; nothing below was read settled");
      // Read after every request settled.
      entry = ((await me.view(taskListViewRef(leadFlow, "tasks"), {}, { sessionId: lead.id })).value as TaskEntry[]).find((task) => task.id === entry?.id);
      if (entry?.holds?.some((hold) => hold.ask.kind === "review") !== true) {
        failures.push(`a:task: the codex task never reached review: ${JSON.stringify({ status: entry?.status, holds: entry?.holds?.map((hold) => hold.ask.kind) })}`);
      }
      const runSession = entry?.run?.sessionId;
      const runFlow = runSession === undefined ? undefined : (await me.sessions.get(runSession)) as { flowKind?: string };
      if (runFlow?.flowKind !== "coder") failures.push(`a:task: the run's session is on "${runFlow?.flowKind}", not the kit's "coder"`);
      // Which entry ran: each manager the coding flow builds is named for its harness.
      const items = runSession === undefined ? [] : (((await me.sessions.state(runSession, { includeItems: true, limit: 500 })) as { items?: Array<{ provenance?: { blockName?: string } }> }).items ?? []);
      const managers = tell.over("a:task managers", [...new Set(items.map((item) => item.provenance?.blockName).filter((name): name is string => name !== undefined && /^coder-(?!door|harness|message|steer|work|by-harness)/.test(name)))]);
      if (managers.length !== 1 || managers[0] !== "coder-codex-reviewed") failures.push(`a:task: the run ran on ${JSON.stringify(managers)}, not the codex entry alone ("coder-codex-reviewed")`);
      evidence.push(`a:task ${entry?.id} on ${runFlow?.flowKind} through ${JSON.stringify(managers)}, holds ${JSON.stringify(entry?.holds?.map((hold) => hold.ask.kind))}`);

      // a:readiness: one entry per harness filled, read with no session.
      const readiness = tell.over("a:readiness", (await me.view(harnessReadinessViewRef("harnesses"), {})).value.map((entry) => entry.harness));
      if (JSON.stringify([...readiness].sort()) !== JSON.stringify(["claude-code", "codex", "cursor"])) failures.push(`a:readiness: ${JSON.stringify(readiness)}, not one entry per harness filled`);
      evidence.push(`a:readiness ${JSON.stringify(readiness)}`);
    }
  } finally {
    stopProcessGroup(teammates.child);
  }

  // ── b: claude-code-style on kits, and a stray in its workforce folder ──
  const ccsEnv = (name: string) =>
    labEnv({ CLAUDE_CODE_STYLE_DATA: join(TMP, name), CLAUDE_CODE_STYLE_USER: USER, CLAUDE_CODE_STYLE_HARNESS: "stub", CLAUDE_CODE_STYLE_REPOSITORIES: "" });
  const ccs = await serve("claude-code-style", CCS, ccsEnv("ccs-data"));
  try {
    if (ccs.exited !== undefined) {
      failures.push(`b:start: claude-code-style did not start (exit ${ccs.exited}): ${ccs.log().slice(-600)}`);
    } else {
      const readiness = tell.over("b:start", (await createClient({ userId: USER, baseUrl: ccs.origin }).view(harnessReadinessViewRef("harnesses"), {})).value.map((entry) => entry.harness));
      evidence.push(`b:start claude-code-style answers, readiness ${JSON.stringify(readiness)}`);
    }
  } finally {
    stopProcessGroup(ccs.child);
  }
  mkdirSync(STRAY_FOLDER, { recursive: true });
  writeFileSync(STRAY, "// a note left beside the worker flows\nexport {};\n");
  try {
    const strayed = await serve("claude-code-style-stray", CCS, ccsEnv("ccs-stray-data"));
    stopProcessGroup(strayed.child);
    if (strayed.exited === undefined) failures.push("b:stray: claude-code-style started beside workforce/flows/notes.mts");
    else if (!strayed.log().includes(STRAY_NAMED)) failures.push(`b:stray: it stopped, but its refusal doesn't name the planted folder: ${strayed.log().slice(-600)}`);
    else evidence.push(`b:stray refused (exit ${strayed.exited}): ${strayed.log().split("\n").find((line) => line.includes(STRAY_NAMED))?.trim()}`);
  } finally {
    rmSync(STRAY_FOLDER, { recursive: true, force: true });
  }
  const census = spawnSync("node", [join(REPO_ROOT, "specs/issues/FIX-2627/poc/claim-census/census.mjs")], { encoding: "utf8" });
  const classified = Number(/files classified: (\d+)/.exec(census.stdout)?.[1] ?? 0);
  const unclaimed = /UNCLAIMED \((\d+)\)/.exec(census.stdout)?.[1];
  tell.over("b:census files", classified > 0 ? [classified] : []);
  if (unclaimed !== "0") failures.push(`b:census: ${unclaimed ?? "no count"} unclaimed file(s):\n${census.stdout.split("UNCLAIMED (")[1] ?? census.stderr}`);
  evidence.push(`b:census ${classified} files classified, ${unclaimed} unclaimed`);

  // ── c: no file outside workforce calls what went internal ─────────────
  const callers = spawnSync("node", [join(REPO_ROOT, "specs/issues/FIX-2627/poc/claim-census/callers.mjs")], { encoding: "utf8" });
  const counted = /files calling any of them: (\d+)([^\n]*)/.exec(callers.stdout);
  tell.over("c:callers read", counted === null ? [] : [counted[0]]);
  if (counted === null) failures.push(`c:callers: the count printed no total: ${callers.stderr.slice(-400)}`);
  else if (counted[1] !== "0") failures.push(`c:callers: ${counted[1]} file(s) outside workforce still call what goes${counted[2]}`);
  evidence.push(`c:callers ${counted?.[0]}`);

  if (PATCHES.length > 0) assertPatched(PATCHES, REPO_ROOT, MARK);
  // What each leg read, pass or fail, so a failing run still shows what the passing legs saw.
  console.error(`read:\n${evidence.map((line) => `  ${line}`).join("\n")}`);
  return { failures, evidence: evidence.join("\n") };
});

rmSync(STRAY_FOLDER, { recursive: true, force: true });
