/**
 * What `fsdev dev --app @flow-state-dev/claude-code-style` serves beside the
 * pages: the lab's workers, read from `workforce/`, on a durable store.
 *
 *     fsdev dev --config labs/claude-code-style/fsdev.config.mts --app @flow-state-dev/claude-code-style
 *
 * - `desk.main`, the session-mode main worker, is on the built-in `agent`
 *   flow with `answerAgain: true`: a background result that settles while its
 *   turn runs is taken into that turn (epic D2). The lab writes no block for it.
 * - `desk.researcher` and `desk.thread` are on `agent` too; `desk.lead` is on
 *   the built-in `coordinator` flow.
 * - The `agent` flow carries `projectSourceCapability` over the same host the
 *   coding runs use, so a worker whose file names its `read` preset
 *   (`desk.main`, `desk.researcher`) reads the session's project itself, from
 *   the host's clone at the default branch, with no coding run.
 * - `desk.coder` and `desk.thread-coder` are on the lab's one coding flow,
 *   `harness-thread`; only `desk.thread-coder` waits for your review.
 * - `projects` lists and creates the projects a session works in, and `pins`
 *   keeps the threads you pinned.
 *
 * The host is durable: a thread's review or question waits on you, and a
 * coding run's review needs durable execution.
 *
 * A coding run works in a git worktree of its project's repository, on its
 * own branch, when that repository is one the lab may cut from: those named in
 * `CLAUDE_CODE_STYLE_REPOSITORIES` (paths, `:`-separated), or by default the
 * repository the lab is started in. The worktree lives under the data folder
 * and its branch in the repository. A project on any other repository runs in
 * a clone of it under the data folder.
 *
 * Settings, all optional: `CLAUDE_CODE_STYLE_MODEL` (default
 * `openai/gpt-5.4`, through the AI Gateway), `CLAUDE_CODE_STYLE_DATA`
 * (default `.fsdev/claude-code-style` under the working directory: the
 * SQLite file and each coding run's worktree or clone), `CLAUDE_CODE_STYLE_USER` (default
 * `u_lab`). `CLAUDE_CODE_STYLE_ANSWER_AGAIN=off` leaves `answerAgain` off the
 * main worker's flow: the goal check's control.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { consultSessionsCapability, createWorkerInstallation, defineAgentWorkerFlow, defineCoordinatorFlow, hireWorkforce, projectSourceCapability, projectWorkspace } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { defineHarnessThreadFlow, HARNESS_THREAD_FLOW } from "./workforce/flows/harness-thread.mts";
import { definePinsFlow, PINS_FLOW } from "./workforce/flows/pins.mts";
import { defineProjectsFlow, PROJECTS_FLOW } from "./workforce/flows/projects.mts";

const model = process.env.CLAUDE_CODE_STYLE_MODEL ?? "openai/gpt-5.4";
const data = resolve(process.env.CLAUDE_CODE_STYLE_DATA ?? ".fsdev/claude-code-style");
const userId = process.env.CLAUDE_CODE_STYLE_USER ?? "u_lab";
const answerAgain = process.env.CLAUDE_CODE_STYLE_ANSWER_AGAIN === "off" ? {} : { answerAgain: true as const };
mkdirSync(data, { recursive: true });

/** The repository the lab is started in, or none outside one. */
const startedIn = () => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
/** The repositories a run works in a worktree of, by their real paths. */
const repositories = (process.env.CLAUDE_CODE_STYLE_REPOSITORIES ?? startedIn()).split(delimiter).filter((path) => path !== "" && existsSync(path)).map((path) => realpathSync(path));
/** A project's repository as one of those, when it is one: a `file://` remote or a path. */
const listed = (repository: string) => {
  const path = repository.startsWith("file://") ? fileURLToPath(repository) : repository;
  const real = isAbsolute(path) && existsSync(path) ? realpathSync(path) : undefined;
  return real !== undefined && repositories.includes(real) ? real : undefined;
};
const source = projectWorkspace();
const workspace = localWorkspaceHost({
  root: join(data, "runs"),
  remotes: { allow: ["file"] },
  localRepositories: repositories,
  source: async (ctx) => {
    const answer = await source(ctx);
    const local = answer.kind === "repo" ? listed(answer.repo) : undefined;
    return answer.kind === "repo" && local !== undefined ? { ...answer, repo: local } : answer;
  },
});

const tree = await readWorkforce(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.errors.length > 0) throw new Error(`workforce/ did not load: ${tree.errors.map((e) => e.error.message).join("; ")}`);

let flows = {};
const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
flows = {
  agent: defineAgentWorkerFlow({ installation, model, ...answerAgain, uses: [projectSourceCapability({ workspace }), consultSessionsCapability(installation)] }),
  coordinator: defineCoordinatorFlow({ installation, routeModel: model, agent: { model } }),
  // Its runs work in the session's project: a task filed with none is refused at filing (FIX-2333).
  [HARNESS_THREAD_FLOW]: { flow: defineHarnessThreadFlow({ installation, workspace }), roles: ["contributor"], needsProject: true },
};
const workers = hireWorkforce(installation) as { id: string }[];
const projects = defineProjectsFlow()({ id: PROJECTS_FLOW }) as { id: string };
const pins = definePinsFlow()({ id: PINS_FLOW }) as { id: string };

export default createFlowState({
  flows: Object.fromEntries([...workers, projects, pins].map((copy) => [copy.id, copy])),
  stores: { default: { primary: sqliteStores({ filename: join(data, "lab.db") }) } },
  // A coding run's review and a thread's question wait on you across a restart.
  durable: true,
  devtool: { userId },
  // A consult of another conversation reads on `intent/utility`, a smaller model.
  models: { default: model, intents: { utility: [process.env.CLAUDE_CODE_STYLE_UTILITY_MODEL ?? "openai/gpt-6-luna"] } },
} as never);
