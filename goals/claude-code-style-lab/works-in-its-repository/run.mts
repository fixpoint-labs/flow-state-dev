/**
 * Goal check: in the Claude Code-style lab, a coding run works in its
 * session's repository. Two repositories are registered with the lab, each
 * dirty on a branch of its own; a session opened on the second files a coding
 * task through its lead; the run's worktree is in the second repository's
 * `git worktree list` and not the first's, and neither repository's own
 * checkout moves.
 *
 * One lab on `fsdev dev --app`, a fresh data folder, every coding task on
 * harness-manager's scripted coder (no model). The session is opened and the
 * task filed through the public client, as the page does; the verdict reads
 * git, never the lab's code.
 *
 * Control (`GOAL_CONTROL=<name>`, same command):
 *   - `first-repository`: the lab's run source answers the first registered
 *     repository, whatever the session's (`fsdev.config.mts` reads it). Must
 *     FAIL: the run's worktree is in the first repository.
 *
 * Run: cd goals && env -u FSDEV_DEFAULT_MODEL pnpm tsx claude-code-style-lab/works-in-its-repository/run.mts
 */
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { taskActionName } from "@flow-state-dev/orchestration/inbox";
import { SET_SESSION_FIELDS_ACTION } from "@flow-state-dev/workforce/browser";
import { NO_MODEL } from "../../lib/task-signals.mts";
import { goalTmpDir, loadFixture, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { git, labCheckout, makeRepository, startLab, until } from "../lab.mts";

type Repository = { name: string; branch: string; dirty: Record<string, string> };
const fixture = loadFixture<{ first: Repository; second: Repository; title: string; goal: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "first-repository") throw new Error(`setup: no control named ${CONTROL}`);
const USER = "u_goal";
/** The lab's threads-mode main worker, on the coordinator flow, and the coder its board hands a code change to. */
const LEAD = { worker: "desk.lead", flow: "coordinator", coder: "desk.thread-coder" };

/** A repository dirty on a branch of its own: committed on `main`, then a branch with uncommitted files. */
function dirtyRepository(dir: string, repository: Repository): string {
  makeRepository(dir);
  git(dir, "checkout", "-q", "-b", repository.branch);
  for (const [name, text] of Object.entries(repository.dirty)) writeFileSync(join(dir, name), text);
  return realpathSync(dir);
}

/** What a person sees of a repository's own checkout: its branch and its status. */
const checkoutOf = (dir: string) => `${git(dir, "branch", "--show-current")}\n${git(dir, "status", "--porcelain")}`;

/** The worktrees `git worktree list` names for `dir` that live under `runs`: a run's. */
const runWorktrees = (dir: string, runs: string) =>
  git(dir, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => path.startsWith(runs));

await runGoal(async (failures, tell) => {
  const labBefore = labCheckout();
  const scratch = goalTmpDir("claude-code-style-works-in-its-repository");
  const first = dirtyRepository(join(scratch, fixture.first.name), fixture.first);
  const second = dirtyRepository(join(scratch, fixture.second.name), fixture.second);
  const before = { first: checkoutOf(first), second: checkoutOf(second) };
  const data = join(scratch, "data");
  let lab: Awaited<ReturnType<typeof startLab>> | undefined;
  try {
    lab = await startLab(data, USER, {
      CLAUDE_CODE_STYLE_HARNESS: "stub",
      CLAUDE_CODE_STYLE_HARNESS_STEP_MS: "500",
      CLAUDE_CODE_STYLE_REPOSITORIES: [first, second].join(":"),
      GOAL_CONTROL: CONTROL,
      ...NO_MODEL,
    });
    const runs = realpathSync(data);
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const flow = fsd.flow(LEAD.flow);
    /** Run `action` in the session and hand back its output, or throw its error. */
    const act = async (sessionId: string, action: string, input: unknown): Promise<any> => {
      const sent = await flow.send(action, input, { sessionId });
      const { status, error, output } = await sent.result();
      if (status !== "completed") throw new Error(`${action} ended ${status}: ${error?.message ?? ""}`);
      return output;
    };

    // A session with the lead, opened on the second repository: the server writes it at open.
    const session = (await flow.createSession({ state: { workerId: LEAD.worker } })).id;
    await act(session, SET_SESSION_FIELDS_ACTION, { worker: LEAD.worker, fields: { repository: second } });

    // The lead's board files a code change, as the lead's turn does.
    const filed = await act(session, taskActionName("createTask", "tasks"), { title: fixture.title, goal: fixture.goal, assignee: LEAD.coder });
    if (typeof filed?.taskId !== "string") throw new Error(`setup: the lead's board didn't file the task: ${JSON.stringify(filed)}`);

    // The run's worktree, wherever git says it is.
    const found = await until(async () => {
      const where = { first: runWorktrees(first, runs), second: runWorktrees(second, runs) };
      return where.first.length + where.second.length > 0 ? where : undefined;
    }, 90_000);
    const where = found?.value ?? { first: [], second: [] };
    const worktrees = tell.over("run worktrees · git worktree list of both repositories", [...where.first, ...where.second]);
    if (where.second.length === 0) failures.push(`second: no run worktree in ${fixture.second.name}'s git worktree list (${worktrees.length} in all)`);
    if (where.first.length > 0) failures.push(`first: the run's worktree is in ${fixture.first.name}'s git worktree list: ${where.first.join(", ")}`);

    // Neither person's own checkout moved: same branch, same uncommitted files.
    for (const key of ["first", "second"] as const) {
      const dir = key === "first" ? first : second;
      if (checkoutOf(dir) !== before[key]) failures.push(`${key}: ${fixture[key].name}'s own checkout changed: ${JSON.stringify(checkoutOf(dir))}`);
    }
    return { failures, evidence: `task ${filed.taskId}; second: ${where.second.join(", ") || "none"}; first: ${where.first.join(", ") || "none"}` };
  } finally {
    if (lab !== undefined) stopProcessGroup(lab.child);
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
  }
});
