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
 * - `desk.coder` is on the lab's one coding flow, `harness-thread`.
 * - `projects` lists and creates the projects a session works in.
 *
 * Settings, all optional: `CLAUDE_CODE_STYLE_MODEL` (default
 * `openai/gpt-5.4`, through the AI Gateway), `CLAUDE_CODE_STYLE_DATA`
 * (default `.fsdev/claude-code-style` under the working directory: the
 * SQLite file and each coding run's clone), `CLAUDE_CODE_STYLE_USER` (default
 * `u_lab`). `CLAUDE_CODE_STYLE_ANSWER_AGAIN=off` leaves `answerAgain` off the
 * main worker's flow: the goal check's control.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createWorkerInstallation, defineAgentWorkerFlow, defineCoordinatorFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { defineHarnessThreadFlow } from "./workforce/flows/harness-thread.mts";
import { defineProjectsFlow } from "./workforce/flows/projects.mts";

const model = process.env.CLAUDE_CODE_STYLE_MODEL ?? "openai/gpt-5.4";
const data = resolve(process.env.CLAUDE_CODE_STYLE_DATA ?? ".fsdev/claude-code-style");
const userId = process.env.CLAUDE_CODE_STYLE_USER ?? "u_lab";
const answerAgain = process.env.CLAUDE_CODE_STYLE_ANSWER_AGAIN === "off" ? {} : { answerAgain: true as const };
mkdirSync(data, { recursive: true });

const tree = await readWorkforce(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.errors.length > 0) throw new Error(`workforce/ did not load: ${tree.errors.map((e) => e.error.message).join("; ")}`);

let flows = {};
const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
flows = {
  agent: defineAgentWorkerFlow({ installation, model, ...answerAgain }),
  coordinator: defineCoordinatorFlow({ installation, routeModel: model, agent: { model } }),
  "harness-thread": { flow: defineHarnessThreadFlow({ installation, root: join(data, "runs") }), roles: ["contributor"] },
};
const workers = hireWorkforce(installation) as { id: string }[];
const projects = defineProjectsFlow()({ id: "projects" }) as { id: string };

export default createFlowState({
  flows: Object.fromEntries([...workers, projects].map((copy) => [copy.id, copy])),
  stores: { default: { primary: sqliteStores({ filename: join(data, "lab.db") }) } },
  devtool: { userId },
} as never);
