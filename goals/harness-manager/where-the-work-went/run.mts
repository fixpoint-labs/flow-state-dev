/**
 * Goal check for `goal.md` beside this file: wherever a coding run worked, a
 * person sees its branch and commit count, and the commands they copy reach
 * the work. Model-free: the harness is a script that commits.
 *
 * Run:      pnpm tsx goals/harness-manager/where-the-work-went/run.mts
 * Controls: GOAL_CONTROL=no-record (must FAIL a:recorded) · GOAL_CONTROL=no-base (must FAIL b:log)
 *           GOAL_CONTROL=no-viewer (must FAIL a:attached)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { harnessSessionFlow, harnessStub, workPlace, type HarnessSessionFeeds, type PhaseSpec } from "@flow-state-dev/harness-manager";
import { localWorkspaceHost, type WorktreeRow } from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  REPO_ROOT,
  actingAs,
  assertPatched,
  describePatches,
  loadFixture,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch,
} from "../../lib/index.mts";
import { HARNESS_GOAL_FLOW_KIND, harnessGoalFlow } from "../host.mts";

const fixture = loadFixture<{ sessionSubjects: string[]; taskSubject: string; issue: string; phase: string; epic: string }>(
  import.meta.url,
  "input.json",
);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "where-the-work-went-user";
const SESSION_KIND = "where-session";

/** Each control: its patch to the code under test, and the leg it runs. */
const CONTROLS: Record<string, { patches: ModulePatch[]; legs: string[] }> = {
  // The session flow never points at its worktree's row.
  "no-record": {
    patches: [
      {
        module: "packages/harness-manager/src/session-flow.ts",
        from: String.raw`workspace: \{ worktree \} \}\)\);`,
        to: "workspace: { worktree: null } }));",
      },
    ],
    legs: ["a"],
  },
  // workPlace ignores who is looking, so an attached session reads as the owner.
  "no-viewer": {
    patches: [
      {
        module: "packages/harness-manager/src/work-place.ts",
        from: String.raw`attachedTo: attachedTo\(fields\.owner, viewer\),`,
        to: "attachedTo: attachedTo(fields.owner, undefined),",
      },
    ],
    legs: ["a"],
  },
  // The manager's output names no base.
  "no-base": {
    patches: [
      {
        module: "packages/harness-manager/src/manager.ts",
        from: String.raw`baseCommit: state\.filesOnly === true \? null : state\.baseCommit,`,
        to: "baseCommit: null,",
      },
    ],
    legs: ["b"],
  },
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}

// A control re-runs this file with its patch applied as the code loads.
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!.patches;
  const mark = join(mkdtempSync(join(tmpdir(), "where-the-work-went-mark-")), "mark");
  console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_LEGS: CONTROLS[CONTROL]!.legs.join(","), ...modulePatchEnv(patches, REPO_ROOT, mark) },
  });
  if (child.status !== 2) assertPatched(patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}
const legs = new Set((process.env.GOAL_LEGS ?? "a,b").split(",").map((s) => s.trim()));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=goal@example.com", "-c", "user.name=goal", ...args], { cwd, encoding: "utf8" }).trim();
/** A command as a person pastes it into a shell, from `cwd`. */
const shell = (cwd: string, command: string) => execFileSync("bash", ["-c", command], { cwd, encoding: "utf8" }).trim();

/** A scratch repository with one commit, under a path with a space, as a state directory can have. */
function scratchRepo(): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), "where the work went-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "scratch\n");
  // The manager refuses a repository that would commit a run's question file.
  writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  return { root, repo };
}

/** Commit one file named for `subject` in `cwd`. */
function commit(cwd: string, subject: string): void {
  writeFileSync(join(cwd, `${subject.replace(/\W+/g, "-")}.txt`), `${subject}\n`);
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", subject);
}

function neverResolvesAModel(): never {
  throw new Error("where-the-work-went: no generator runs here; the harness is a script.");
}
const modelResolver = Object.assign(neverResolvesAModel, { resolveId: neverResolvesAModel }) as never;

await runGoal(async (failures) => {
  const { createFlowState, inMemoryStores, runAction } = await import("@flow-state-dev/engine");
  const evidence: string[] = [];

  // ── a · harness sessions, read through the client as a page reads them ──
  if (legs.has("a")) {
    const { root, repo } = scratchRepo();
    const base = git(repo, "rev-parse", "HEAD");
    const host = localWorkspaceHost({
      root: join(root, "worktrees"),
      remotes: { allow: [] },
      localRepositories: [repo],
      source: () => ({ kind: "repo", repo, baseRef: "HEAD" }),
    });
    const source = { kind: "repo" as const, repo, baseRef: "HEAD" };
    const branchOf = (sessionId: string) => `where/${sessionId}`;
    let subject = 0;
    const flow = harnessSessionFlow({
      kind: SESSION_KIND,
      workspace: {
        // The workspace host writes the worktree's row, as an app adopting the package wires it.
        provision: async (place, request) => {
          const made = await host.provision(source, {
            place: [place.flowKind, place.sessionId],
            branch: branchOf(place.sessionId),
            ...(request?.worktrees !== undefined ? { worktrees: request.worktrees } : {}),
          });
          return { path: made.cwd, ...(made.worktree !== undefined ? { worktree: made.worktree } : {}) };
        },
        locate: (place) => host.locate(source, { place: [place.flowKind, place.sessionId] }).cwd,
        branch: (place) => branchOf(place.sessionId),
        attach: async (owner, request) => await host.attach!({ place: [owner.flowKind, owner.sessionId] }, request),
        recordCheckout: async (place, request) => await host.recordCheckout!({ place: [place.flowKind, place.sessionId] }, request),
      },
      agent: (feeds: HarnessSessionFeeds) =>
        handler({
          name: "committing-harness",
          inputSchema: z.object({ prompt: z.string() }),
          execute: async (input, ctx) => {
            const hctx = ctx as unknown as HarnessCallbackContext;
            await feeds.resume(hctx);
            const cwd = await feeds.cwd(hctx);
            if (input.prompt !== "look") commit(cwd, fixture.sessionSubjects[subject++]!);
            return { outcome: "completed" };
          },
        }) as unknown as HarnessBlock,
    });
    const app = createFlowState({
      flows: { [SESSION_KIND]: flow },
      modelResolver,
      stores: { prod: { primary: inMemoryStores() } },
      defaultProfile: "prod",
      logger: silentLogger,
    } as never);
    const http = actingAs((await app.getRouter()) as never, USER);
    const sessionId = await http.open(SESSION_KIND, { model: "stub-model" });
    /** The row a session points at, both read through the client's routes as a page reads them. */
    const rowOf = async (id: string): Promise<WorktreeRow | undefined> => {
      const state = (await http.client.sessions.state(id)) as { clientData?: { session?: { workspace?: { worktree?: string | null } | null } } };
      const key = state.clientData?.session?.workspace?.worktree;
      if (key == null) return undefined;
      const listed = await http.call("GET", ["sessions", id, "resources", "worktrees"]);
      const items = (JSON.parse(listed.text) as { items?: Array<{ clientData?: WorktreeRow }> }).items ?? [];
      return items.map((item) => item.clientData).find((row) => row?.key === key);
    };

    for (const [turn, expected] of [[1, 1], [2, 2]] as const) {
      await http.act(SESSION_KIND, sessionId, "turn", { prompt: `turn ${turn}` });
      const row = await rowOf(sessionId);
      if (row === undefined) {
        failures.push(`a:recorded — after turn ${turn} the session points at no worktree row`);
        break;
      }
      if (row.branch !== branchOf(sessionId) || row.baseCommit !== base || !existsSync(row.path ?? "")) {
        failures.push(`a:recorded — after turn ${turn}: ${JSON.stringify(row)}; wanted branch ${branchOf(sessionId)}, base ${base}, an existing path`);
      }
      if (row.commits !== expected) failures.push(`a:count — after turn ${turn} the row's count is ${row.commits}, wanted ${expected}`);
    }
    const ownerRow = await rowOf(sessionId);
    const place = workPlace(ownerRow, { session: sessionId });
    if (place !== null && place.commands.cd !== null && place.commands.log !== null) {
      const onBranch = shell(root, `${place.commands.cd} && git rev-parse --abbrev-ref HEAD`);
      if (onBranch !== branchOf(sessionId)) failures.push(`a:cd — the copied cd lands on ${onBranch}`);
      const logged = shell(root, `${place.commands.cd} && ${place.commands.log} --format=%s`).split("\n").reverse();
      if (JSON.stringify(logged) !== JSON.stringify(fixture.sessionSubjects)) {
        failures.push(`a:log — the copied git log lists ${JSON.stringify(logged)}, wanted ${JSON.stringify(fixture.sessionSubjects)}`);
      }
      if (place.attachedTo !== null) failures.push(`a:attached — the owner's own view says attached to ${place.attachedTo}`);
      evidence.push(`a: ${place.commits} commits on ${place.branch} ("${place.name}"); \`${place.commands.log}\` lists the session's subjects`);
    } else if (!failures.some((f) => f.startsWith("a:recorded"))) {
      failures.push(`a:commands — workPlace gave ${JSON.stringify(place)}`);
    }
    // A second session attached to the same worktree reads the same row, and says whose it is.
    if (ownerRow !== undefined) {
      const guest = await http.open(SESSION_KIND, { model: "stub-model", start: { worktreeOf: sessionId } });
      await http.act(SESSION_KIND, guest, "turn", { prompt: "look" });
      const guestRow = await rowOf(guest);
      const guestPlace = workPlace(guestRow, { session: guest });
      if (guestRow?.key !== ownerRow.key || guestPlace?.attachedTo !== sessionId || guestPlace.commits !== 2) {
        failures.push(`a:attached — the attached session reads ${JSON.stringify(guestPlace)} from ${JSON.stringify(guestRow)}`);
      } else {
        evidence.push(`a: an attached session reads the same row, attached to ${sessionId}`);
      }
    }
    rmSync(root, { recursive: true, force: true });
  }

  // ── b · a board task, its output read as a row carries it ──────────────────
  if (legs.has("b")) {
    const { root, repo } = scratchRepo();
    const stub = harnessStub({ duringRun: (run) => commit(run.cwd, fixture.taskSubject) });
    const phase: PhaseSpec = { phase: fixture.phase, buildPrompt: () => "make the change", isDone: () => true };
    const built = harnessGoalFlow({
      epic: fixture.epic,
      workspace: { root: join(root, "checkouts"), sourceRepo: repo, baseRef: "main" },
      maxAttempts: 1,
      phase,
      slot: stub.slot,
    });
    const app = createFlowState({
      flows: { [HARNESS_GOAL_FLOW_KIND]: built.flow },
      modelResolver,
      stores: { prod: { primary: inMemoryStores() } },
      defaultProfile: "prod",
      dispatchDrainTimeoutMs: built.drainBudgetMs,
      logger: silentLogger,
    } as never);
    // The goal host is called as `answered-run-continues-its-session` calls it: its actions, in process.
    const runtime = await (app as unknown as { getRuntime(): Promise<{ stores: never; runtimeConfig: object }> }).getRuntime();
    const sessionId = `sess_where_the_work_went_${Date.now()}`;
    const call = async <T,>(action: string, input: unknown): Promise<T> => {
      const result = (await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: built.flow as never,
        actionName: action as never,
        input: input as never,
        userId: USER,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig } as never,
      })) as { output?: unknown; error?: unknown };
      if (result.error != null) throw new Error(`${action} failed: ${JSON.stringify(result.error)}`);
      return result.output as T;
    };
    await call("seed", { issue: fixture.issue, phase: fixture.phase });
    await untilIdle(runtime.stores);
    const { rows } = await call<{ rows: Array<{ status: string; output: unknown }> }>("status", { issue: fixture.issue });
    const row = rows[0];
    if (row?.status !== "completed") {
      failures.push(`b:completed — the task is ${row?.status ?? "missing"}: ${JSON.stringify(row)}`);
    } else {
      const place = workPlace(row.output);
      if (place === null || place.commits !== 1 || place.path === null) {
        failures.push(`b:output — the output reads as ${JSON.stringify(place)} from ${JSON.stringify(row.output)}`);
      } else if (place.commands.log === null) {
        failures.push(`b:log — the output names no base, so there is no git log to copy: ${JSON.stringify(row.output)}`);
      } else {
        const logged = shell(root, `${place.commands.cd} && ${place.commands.log} --format=%s`);
        if (logged !== fixture.taskSubject) failures.push(`b:log — the copied git log lists ${JSON.stringify(logged)}`);
        const onBranch = shell(root, `${place.commands.cd} && git rev-parse --abbrev-ref HEAD`);
        if (onBranch !== place.branch) failures.push(`b:cd — the copied cd lands on ${onBranch}, not ${place.branch}`);
        evidence.push(`b: ${place.commits} commit on ${place.branch}; \`${place.commands.log}\` lists "${logged}"`);
      }
    }
    rmSync(root, { recursive: true, force: true });
  }

  return { failures, evidence: evidence.join("\n") };
});
