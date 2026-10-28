/**
 * Goal check: a coding run for a shared project the host config maps to a
 * checkout works in a fresh worktree of that checkout, installs and builds
 * there, and leaves its branch in it; a project the config doesn't map, in
 * another organization or private, never gets one; and a settled run
 * continues in the same worktree (FIX-1906). See goal.md.
 *
 * In process, on the real engine: a harness manager whose workspace is
 * `localWorkspaceHost` over this repository's checkout (in
 * `localRepositories`, no remote allowed) with `projectWorkspace({ checkouts
 * })` as its source. Projects are real rows, made through the project blocks
 * as their owner, in two organizations. Each row's task session is filed from
 * its project, as a project conversation's hand-over files it. The harness is
 * scripted: attempt 1 installs, builds, keeps a note in `project/`, leaves
 * uncommitted work and asks a question, so the task is held on it; answering it is
 * the second turn.
 *
 * Every grade reads the checkout itself (`git worktree list`, `git branch`),
 * the run's directory, and the organization's stored project files; never
 * the source's answer or what the host returned.
 *
 * Run:      pnpm tsx goals/projects/a-mapped-project-works-in-your-checkout/run.mts
 * Controls: GOAL_CONTROL=no-mapping   (must fail a:in-checkout)
 *           GOAL_CONTROL=ignore-org   (must fail b:other-org-not-in-checkout)
 *           GOAL_CONTROL=detach       (must fail c:continues)
 * Input:    GOAL_CHECKOUT (default this repository's root), GOAL_BUILD (default
 *           `pnpm --filter @flow-state-dev/workspace... build`)
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { taskSettledEntry } from "@flow-state-dev/orchestration";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { defineFlow, dispatcher, handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, openRowQuestions, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, harnessTaskInputSchema, runOwnerDispatcher, type HarnessFeeds } from "@flow-state-dev/harness-manager";
import { defineProjectBlocks, projectWorkspace, projectWorkspaceCapability, type ProjectCheckout } from "@flow-state-dev/workforce";
import { hashContent, localWorkspaceHost } from "@flow-state-dev/workspace";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, silentLogger, type ModulePatch } from "../../lib/index.mts";

const CONTROLS = {
  "no-mapping": { assertion: "a:in-checkout", does: "projectWorkspace() is built with no checkouts" },
  "ignore-org": { assertion: "b:other-org-not-in-checkout", does: "the mapping's match ignores the organization (a module patch)" },
  detach: { assertion: "c:continues", does: "the run's branch is detached in its worktree after it settles" },
} as const;
type ControlName = keyof typeof CONTROLS;

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(controlName in CONTROLS)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = controlName === "" ? undefined : (controlName as ControlName);

/** `ignore-org`'s patch: the organization drops out of the match, everything else stays. */
const IGNORE_ORG: ModulePatch[] = [
  { module: "packages/workforce/src/projects/project-workspace.ts", from: "named\\.orgId === orgId && ", to: "" },
];

const say = (s: string) => console.error(`[mapped-checkout ${new Date().toISOString().slice(11, 19)}] ${s}`);

// ---- ignore-org runs the check in a child process that loads the patch ----
if (control === "ignore-org" && process.env.GOAL_MODULE_PATCH === undefined) {
  const scratch = goalTmpDir("mapped-checkout");
  mkdirSync(scratch, { recursive: true });
  const mark = join(scratch, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  say(`control ignore-org: ${CONTROLS["ignore-org"].does}; patch:\n${describePatches(IGNORE_ORG, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(IGNORE_ORG, REPO_ROOT, mark) },
  });
  assertPatched(IGNORE_ORG, REPO_ROOT, mark);
  say(`the patch reached ${IGNORE_ORG[0]!.module}`);
  process.exit(child.status ?? 1);
}

const execFileAsync = promisify(execFile);

/** The checkout runs are mapped to: this repository, unless another is named. */
const CHECKOUT = realpathSync(process.env.GOAL_CHECKOUT ?? REPO_ROOT);
/** What a run builds in its worktree: a package with workspace dependencies. */
const BUILD = (process.env.GOAL_BUILD ?? "pnpm --filter @flow-state-dev/workspace... build").split(" ");
/** The remote the projects' rows name. A label the host never reaches: it allows no remote. */
const REMOTE = process.env.GOAL_REMOTE ?? "https://example.com/goal/mapped-checkout.git";
const ORG_A = "goal-org-a";
const ORG_B = "goal-org-b";
const OWNER = "goal-owner";
const PROJECT = "mapped";
const NOTE = { path: "notes/run.md", body: `kept beside the worktree ${RUN_STAMP}\n` };
const WIP = { path: `goal-wip-${RUN_STAMP}.txt`, body: "uncommitted work from the first turn\n" };
const PHASE = "implement";
const BOARD_ID = "goal.mapped.work";
const SETTLE_MS = 600_000;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

/** The worktrees git lists for the checkout, by real path. */
function worktrees(): string[] {
  return git(CHECKOUT, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** What one attempt saw and did, in the directory the manager handed it. */
interface Attempt {
  issue: string;
  attempt: number;
  cwd: string;
  branch: string;
  install?: { code: number; tail: string };
  build?: { code: number; tail: string };
  wip?: string | null;
  note?: string | null;
}
const attempts: Attempt[] = [];

async function runIn(cwd: string, command: string[]): Promise<{ code: number; tail: string }> {
  try {
    await execFileAsync(command[0]!, command.slice(1), { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 540_000 });
    return { code: 0, tail: "" };
  } catch (error) {
    const e = error as { code?: number; stderr?: string; stdout?: string; message?: string };
    return { code: typeof e.code === "number" ? e.code : 1, tail: String(e.stderr || e.stdout || e.message).slice(-600) };
  }
}

/**
 * The scripted harness. Attempt 1 of an `a` row installs, builds, keeps a
 * note in `project/`, leaves uncommitted work, and asks, so the row parks.
 * Every later attempt, and every other row, records what it found and ends.
 */
function scriptedHarness(feeds: HarnessFeeds): HarnessBlock {
  return handler({
    name: "goal-scripted-harness",
    inputSchema: harnessRunInputSchema,
    outputSchema: harnessRunHandleSchema,
    execute: async (input, ctx) => {
      const cwd = await feeds.cwd(ctx as never);
      const issue = /^Work on (\S+), attempt (\d+)\./.exec(input.prompt);
      const seen: Attempt = {
        issue: issue?.[1] ?? "?",
        attempt: Number(issue?.[2] ?? 0),
        cwd,
        branch: existsSync(cwd) ? git(cwd, "rev-parse", "--abbrev-ref", "HEAD") : "",
      };
      attempts.push(seen);
      const project = join(dirname(cwd), "project");
      // The row's first run asks; the answer's run, on the same attempt, reads what it left.
      if (seen.issue.startsWith("goal-a-") && attempts.filter((t) => t.issue === seen.issue).length === 1) {
        seen.install = await runIn(cwd, ["pnpm", "install", "--frozen-lockfile", "--offline"]);
        if (seen.install.code === 0) seen.build = await runIn(cwd, BUILD);
        mkdirSync(dirname(join(project, NOTE.path)), { recursive: true });
        writeFileSync(join(project, NOTE.path), NOTE.body);
        writeFileSync(join(cwd, WIP.path), WIP.body);
        const marker = /write it as the entire contents of this file:\n {2}(\S+)/.exec(input.prompt)?.[1];
        if (marker === undefined) throw new Error("the prompt named no ask marker");
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, "Carry on?");
      } else {
        seen.wip = existsSync(join(cwd, WIP.path)) ? readFileSync(join(cwd, WIP.path), "utf8") : null;
        seen.note = existsSync(join(project, NOTE.path)) ? readFileSync(join(project, NOTE.path), "utf8") : null;
      }
      return {
        source: "goal/scripted",
        status: "completed" as const,
        sessionId: `goal_${attempts.length}`,
        url: null,
        dispatchedAt: Date.now(),
        outcome: "finished" as const,
        finalMessage: null,
        usage: null,
        cost: null,
      };
    },
  }) as unknown as HarnessBlock;
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string) => failures.push(`${assertion} — ${why}`);
  const scratch = goalTmpDir("mapped-checkout");
  const root = join(scratch, `places-${RUN_STAMP}`);
  mkdirSync(root, { recursive: true });
  say(`checkout ${CHECKOUT}; places under ${root}${control === undefined ? "" : `; control ${control}: ${CONTROLS[control].does}`}`);

  const checkouts: ProjectCheckout[] = [{ remote: REMOTE, checkout: CHECKOUT, projects: [{ orgId: ORG_A, id: PROJECT }] }];
  const host = localWorkspaceHost({
    root,
    remotes: { allow: [] },
    localRepositories: [CHECKOUT],
    source: control === "no-mapping" ? projectWorkspace() : projectWorkspace({ checkouts }),
  });

  const ledger = defineTaskCollection({ id: BOARD_ID, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const manager = harnessManager({
    boardCollectionId: BOARD_ID,
    boardCollection: ledger,
    tenant: undefined,
    phase: {
      phase: PHASE,
      buildPrompt: (run) =>
        [`Work on ${run.issue}, attempt ${run.attempt}.`, "To ask, write it as the entire contents of this file:", `  ${run.askMarkerPath}`].join("\n"),
      isDone: () => true,
    },
    workspace: host,
    runTimeoutMs: SETTLE_MS,
    ownership: { pollMs: 50 },
    harness: scriptedHarness,
    uses: [projectWorkspaceCapability],
  });
  // Each row's task session is filed from its project, as a project
  // conversation's hand-over files it: the assignee names which.
  const filedFrom = (projectRef: string) =>
    dispatcher({ name: `goal-hand-off-${projectRef.replace("/", "-")}`, action: "work", session: "per-task", state: { filingProjectId: projectRef } });
  const board = taskBoard({
    name: "goal-board",
    boardId: "goal-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    dispatcher: runOwnerDispatcher(),
    workers: { shared: filedFrom(`shared/${PROJECT}`), private: filedFrom(`private/${PROJECT}`) },
  });
  const seed = handler({
    name: "goal-seed",
    inputSchema: z.object({ issue: z.string(), assignee: z.enum(["shared", "private"]) }),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["goal-board"];
      const id = `${input.issue}--${PHASE}`;
      await tasks.createTask({ id, goal: input.issue, input: { issue: input.issue, phase: PHASE }, assignee: input.assignee, maxAttempts: 3 });
      return { id };
    },
  });
  // The person's answer to each question the task is held on: it owes the task its next turn. The drain is the next action.
  const answer = handler({
    name: "goal-answer",
    inputSchema: z.object({ issue: z.string() }),
    outputSchema: z.object({ answered: z.number() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const tasks = await (ctx as { cap: Record<string, any> }).cap["goal-board"].tasks();
      const id = `${input.issue}--${PHASE}`;
      const row = tasks.get(id) as Task | undefined;
      let answered = 0;
      for (const hold of row === undefined ? [] : openRowQuestions(row)) {
        await tasks.answer(id, { questionId: hold.id, message: "Yes, carry on.", from: "user", by: OWNER });
        answered += 1;
      }
      return { answered };
    },
  });
  const projects = defineProjectBlocks();
  // The board hands rows out, so the flow hears each ending (FIX-2078); this goal grades something else.
  const heard = taskSettledEntry({ block: handler({ name: "goal-heard", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => ({}) }) });
  const flow = defineFlow({
    kind: "goal-mapped",
    internal: { actions: { onTaskSettled: heard } },
    actions: { ...projects.actions, seed: { block: seed }, drain: { block: board.drain }, answer: { block: answer } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "goal-mapped" } as never);
  const state = createFlowState({
    flows: { "goal-mapped": flow },
    stores: { goal: { primary: inMemoryStores() } },
    defaultProfile: "goal",
    dispatchDrainTimeoutMs: SETTLE_MS,
  } as never);
  const runtime = async () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();
  // `createFlowState` takes no logger: quiet the runtime's own, as the labs do.
  ((await runtime()).runtimeConfig as { logger?: unknown }).logger = silentLogger;

  const act = async (orgId: string, action: string, input: unknown): Promise<{ output?: unknown; error?: unknown }> => {
    const rt = await runtime();
    return (await runAction({
      flow,
      actionName: action,
      input,
      userId: OWNER,
      orgId,
      sessionId: `s_${orgId}_${RUN_STAMP}`,
      requestId: `req_${action}_${Math.random().toString(36).slice(2)}`,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig },
    } as never)) as { output?: unknown; error?: unknown };
  };
  const mustAct = async (orgId: string, action: string, input: unknown) => {
    const result = await act(orgId, action, input);
    if (result.error !== undefined) throw new Error(`setup: ${action} in ${orgId} was refused: ${JSON.stringify(result.error)}`);
    return result.output;
  };
  /** The row for `issue` in `orgId`, once it reaches one of `statuses`. */
  const rowWhen = async (orgId: string, issue: string, statuses: readonly string[], minAttempts = 1): Promise<Task | undefined> => {
    const deadline = Date.now() + SETTLE_MS;
    let row: Task | undefined;
    while (Date.now() < deadline) {
      const rt = await runtime();
      row = (await rt.stores.resourceState.get("org", orgId, `${BOARD_ID}/${issue}--${PHASE}`))?.state as Task | undefined;
      if (row !== undefined && row.attempts >= minAttempts && statuses.includes(stateOf(row))) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    return row;
  };
  /** A row's status, with a running row held on a question read as `held`. */
  const stateOf = (row: Task): string => (row.status === "in_progress" && openRowQuestions(row).length > 0 ? "held" : row.status);
  const SETTLED = ["held", "completed", "errored", "failed", "cancelled"] as const;
  /** File `issue` for `assignee` in `orgId`, drain, and wait until it settles. */
  const runRow = async (orgId: string, issue: string, assignee: "shared" | "private") => {
    await mustAct(orgId, "seed", { issue, assignee });
    await act(orgId, "drain", {});
    return rowWhen(orgId, issue, SETTLED);
  };
  /** The organization's stored note, by content hash. */
  const storedNote = async (orgId: string): Promise<string | null> => {
    const rt = await runtime();
    const rows = (await rt.stores.resourceState.getByPrefix("org", orgId, "")) as Record<string, { state?: { hash?: string } }>;
    const key = Object.keys(rows).find((k) => k.endsWith(`project-files/${PROJECT}/${NOTE.path}`));
    return key === undefined ? null : (rows[key]?.state?.hash ?? null);
  };

  const branchesBefore = new Set(git(CHECKOUT, "branch", "--format=%(refname:short)").split("\n"));
  try {
    // ---- the projects, made by their owner -------------------------------
    await mustAct(ORG_A, "createProject", { id: PROJECT, title: "Mapped", repository: REMOTE });
    await mustAct(ORG_A, "createProject", { id: PROJECT, title: "Mine", repository: REMOTE, visibility: "private" });
    await mustAct(ORG_B, "createProject", { id: PROJECT, title: "Another org's", repository: REMOTE });

    // ---- (a) the mapped project's run, in a worktree of the checkout -----
    const issueA = `goal-a-${RUN_STAMP}`.replace(/_/g, "-");
    const a = await runRow(ORG_A, issueA, "shared");
    const a1 = attempts.find((t) => t.issue === issueA && t.attempt === 1);
    if (a1 === undefined || !worktrees().includes(a1.cwd)) {
      note(
        "a:in-checkout",
        a1 === undefined
          ? `the row ended ${a?.status ?? "unfiled"} before its harness ran${a?.error ? `: ${String(a.error).slice(0, 300)}` : ""}`
          : `the run worked in ${a1.cwd}, which \`git worktree list\` in ${CHECKOUT} does not name`,
      );
    }
    if (a1?.install === undefined || a1.install.code !== 0) note("a:installs", `pnpm install --frozen-lockfile --offline ${a1?.install ? `exited ${a1.install.code}: ${a1.install.tail}` : "never ran"}`);
    if (a1?.build === undefined || a1.build.code !== 0) note("a:builds", `\`${BUILD.join(" ")}\` ${a1?.build ? `exited ${a1.build.code}: ${a1.build.tail}` : "never ran"}`);
    if (a1 === undefined || a1.branch === "" || git(CHECKOUT, "branch", "--list", a1.branch) === "") {
      note("a:branch-in-checkout", `the run's branch ${JSON.stringify(a1?.branch ?? null)} is not in ${CHECKOUT}'s \`git branch\``);
    }
    const stored = await storedNote(ORG_A);
    const status = a1 !== undefined && existsSync(a1.cwd) ? git(a1.cwd, "status", "--porcelain", "--untracked-files=all") : "";
    if (stored !== hashContent(NOTE.body) || status.includes(NOTE.path)) {
      note("a:note-saved", `project-files/${PROJECT}/${NOTE.path} holds ${JSON.stringify(stored)}${status.includes(NOTE.path) ? ", and git status shows the note" : ""}`);
    }
    if (a === undefined || stateOf(a) !== "held") say(`a: the row ended ${a?.status ?? "unfiled"}, not held on its question`);
    if (!failures.some((f) => f.startsWith("a:"))) {
      evidence.push(
        `a: the run worked in ${a1!.cwd} (listed by git worktree list in the checkout) on ${a1!.branch}, installed and built there, and its note is saved, absent from git status`,
      );
    }

    // ---- (b) the same id and remote, another org or private: no worktree --
    for (const [assertion, orgId, assignee, label] of [
      ["b:other-org-not-in-checkout", ORG_B, "shared", "another organization's shared project"],
      ["b:private-not-in-checkout", ORG_A, "private", "a private project"],
    ] as const) {
      const before = new Set(worktrees());
      const issue = `goal-${assertion.slice(2, 7)}-${RUN_STAMP}`.replace(/_/g, "-");
      const row = await runRow(orgId, issue, assignee);
      const ran = attempts.find((t) => t.issue === issue);
      const added = worktrees().filter((w) => !before.has(w));
      if (added.length > 0 || (ran !== undefined && worktrees().includes(ran.cwd))) {
        note(assertion, `${label} with the same id and remote got a worktree of the checkout: ${[...new Set([...added, ran?.cwd].filter(Boolean))].join(", ")}`);
      } else {
        evidence.push(`b: ${label} got no worktree (row ${row?.status ?? "unfiled"}${ran === undefined ? ", harness never ran" : `, worked in ${ran.cwd}`})`);
      }
    }

    // ---- (c) the settled run continues in place --------------------------
    if (a1 === undefined || a === undefined || stateOf(a) !== "held") {
      note("c:continues", `leg a's run never settled on its question (row ${a?.status ?? "unfiled"}), so there is no turn to continue`);
    } else {
      if (control === "detach") git(a1.cwd, "switch", "--quiet", "--detach");
      await mustAct(ORG_A, "answer", { issue: issueA });
      await act(ORG_A, "drain", {});
      // Settled, or back to pending for a retry the second turn's failure earned.
      const c = await rowWhen(ORG_A, issueA, ["completed", "errored", "failed", "cancelled", "pending"]);
      const a2 = attempts.filter((t) => t.issue === issueA)[1];
      const wrong: string[] = [];
      const why = c?.error ?? c?.feedback;
      if (a2 === undefined) wrong.push(`the second turn never ran (row ${c?.status ?? "?"}${why ? `: ${String(why).slice(0, 300)}` : ""})`);
      else {
        if (a2.cwd !== a1.cwd) wrong.push(`it worked in ${a2.cwd}, not ${a1.cwd}`);
        if (a2.branch !== a1.branch) wrong.push(`it was on ${JSON.stringify(a2.branch)}, not ${a1.branch}`);
        if (a2.wip !== WIP.body) wrong.push(`the first turn's uncommitted ${WIP.path} was ${a2.wip === null ? "gone" : "changed"}`);
        if (a2.note !== NOTE.body) wrong.push(`project/${NOTE.path} was ${a2.note === null ? "gone" : "changed"}`);
      }
      if (c?.status !== "completed") wrong.push(`the row ended ${c?.status ?? "?"}, not completed`);
      if (wrong.length > 0) note("c:continues", wrong.join("; "));
      else evidence.push(`c: the second turn ran in ${a2!.cwd} on ${a2!.branch}, with its uncommitted work and its note, and the row completed`);
    }
  } finally {
    // The check writes into a real checkout: remove its worktrees and branches, pass or fail.
    const ours = git(CHECKOUT, "worktree", "list", "--porcelain")
      .split("\n\n")
      .map((block) => ({
        path: /^worktree (.+)$/m.exec(block)?.[1] ?? "",
        branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1],
      }))
      .filter((w) => w.path.startsWith(`${realpathSync(root)}${sep}`));
    for (const w of ours) execFileSync("git", ["worktree", "remove", "--force", w.path], { cwd: CHECKOUT, stdio: "pipe" });
    git(CHECKOUT, "worktree", "prune");
    const runBranches = new Set([...ours.map((w) => w.branch), ...attempts.map((t) => t.branch)].filter((b): b is string => !!b && b !== "HEAD"));
    for (const branch of runBranches) {
      if (!branchesBefore.has(branch) && git(CHECKOUT, "branch", "--list", branch) !== "") git(CHECKOUT, "branch", "-D", branch);
    }
    rmSync(root, { recursive: true, force: true });
    say(`removed ${ours.length} worktree(s) and ${runBranches.size} branch(es) from ${CHECKOUT}`);
  }

  if (control !== undefined) {
    const { assertion } = CONTROLS[control];
    const named = failures.some((f) => f.startsWith(`${assertion} `));
    const others = [...new Set(failures.map((f) => f.split(" — ")[0]!).filter((x) => x !== assertion))];
    failures.unshift(
      named
        ? `control ${control}: failed on ${assertion}, as it must${others.length === 0 ? ", and on nothing else" : `; also on ${others.join(", ")}`}`
        : `control ${control}: did NOT fail on ${assertion}, so the check can't see what the control removes`,
    );
  }
  return { failures, evidence: `${CHECKOUT}: ${evidence.join("; ")}` };
});
