/**
 * DevTeam, served for this goal: the DevForce lab's tree and `openLab`,
 * with this goal's recording harness in the `coder` kind's slot
 * (`recording-harness.mts`) and two rows already running on the coder seat.
 *
 * What it adds over `packages/shift-manager/teams/devteam/fsdev.config.mts`, and nothing
 * else:
 *
 * - **The harness.** Every attempt records what it was handed to the file
 *   `TURN_GOAL_RUNS` names, and holds until it is stopped.
 *   `TURN_GOAL_CONTROL=fresh-session` drops the resume id it was offered.
 * - **The store**, a SQLite file at `TURN_GOAL_STORE`, so the check can read
 *   a row's retry counters where they are stored. The board's browser view
 *   doesn't carry them.
 * - **Two rows, filed at boot** through the EM worker's own `file` action,
 *   on its own session's board, which starts each on the coder by itself:
 *   one for the task composer, and a second the line must not reach.
 * - **A scripted EM turn**, so the EM's door answers with no model: it says
 *   it filed nothing for the line it was handed.
 *
 * The EM worker's ask is raised as DevTeam raises it, so Inbox shows an ask
 * whose reply reaches the EM's door. Which worker is which is read off the
 * tree: the EM by the kind its `WORKER.md` names, the coder as its first
 * delegate on the coder kind.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import type { AskFeature } from "../../../../packages/shift-manager/teams/devteam/ask.mts";
import { LAB_TREE, openLab } from "../../../../packages/shift-manager/teams/devteam/host.mts";
import { BASE_REF, createScratchRepo } from "../../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { CODER_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { EM_FLOW, EM_TURN } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";
import { recordingHarness } from "./recording-harness.mts";
import { EM_ANSWER, ROWS, STORE_ENV } from "./rows.mts";

/** How long one held attempt may run before the manager gives up on it. */
const RUN_TIMEOUT_MS = 15 * 60_000;

const ASK_FEATURE = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../devforce-lab/it-waits-for-a-person-before-it-files/fixtures/input.json", import.meta.url)), "utf8"),
  ) as { feature: AskFeature }
).feature;

const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const ems = roster.workers.filter((w) => w.declared.flow === EM_FLOW);
if (ems.length !== 1) throw new Error(`wanted one EM worker in the DevTeam tree, found ${ems.length}`);
const emSeatId = ems[0]!.id;
const coderWorkerId = ((ems[0]!.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error(`the DevTeam's EM "${emSeatId}" names no delegate on the coder kind`);

/** The EM's turn, scripted: one answer, no tool call. Every other model is left unresolved. */
const scriptedEm: GeneratorModel = {
  modelId: "turn-goal/em",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep() {
    return { text: EM_ANSWER, finishReason: "stop" };
  },
} as unknown as GeneratorModel;
const modelResolver = Object.assign((_id: string, block?: string) => (block === EM_TURN ? scriptedEm : undefined), {
  resolveId: (id: string) => id,
}) as unknown as ModelResolver;

const storeFile = process.env[STORE_ENV];
if (storeFile === undefined || storeFile === "") throw new Error(`${STORE_ENV} names no file for the store`);

const scratch = createScratchRepo("shift-manager-turn");
const lab = await openLab({
  stores: sqliteStores({ filename: storeFile }),
  harness: recordingHarness,
  runTimeoutMs: RUN_TIMEOUT_MS,
  // The recording harness's abort ends its run at once, so a steer may stop it.
  stopsOnAbort: true,
  workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
  coderWorkerId,
  modelResolver,
  inventory: true,
  ask: ASK_FEATURE,
  devtool: true,
});

// Filing starts the board by itself. No drain: it waits for the rows to settle,
// and these hold until a turn stops them.
for (const row of ROWS) {
  const filed = await lab.file(emSeatId, row);
  if (filed.error !== undefined) throw new Error(`filing ${row.issue}: ${filed.error}`);
}

export default lab.state;
