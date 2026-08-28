/**
 * fsdev config for the conductor lab (LAB-138).
 *
 * Filesystem `dev` profile. The coding run goes through the Claude Code Agent
 * SDK (its own model). `steer` is the one generator action — the coordinator
 * talk turn — and uses `createModelResolver` like every other `fsdev` host.
 *
 *   pnpm conductor                  # live board
 *   pnpm conductor seed FIX-1219
 *   pnpm conductor status FIX-1219
 *   pnpm fsdev run conductor seed   -i '{"issue":"FIX-1219","phase":"implement"}'
 *
 * No `-s` needed. The operator surface reuses session `conductor-operator`
 * so the board stays one conversation; both the board row and the run record
 * are `user`-scoped, so `status` answers with the run's session, checkout,
 * outcome and cost whichever session asks.
 *
 * `CONDUCTOR_REPO` names the repository checkouts are cut from. **Required** —
 * absent, or resolving to the repository this dispatcher itself runs from, is
 * refused at startup, because either one silently aims the coding agent at the
 * dispatcher's own code. Numeric settings are validated there too; see
 * `positiveIntFromEnv` for why an unchecked one is charged to a task.
 *
 * **`detachedDrainTimeoutMs` is derived, not chosen.** Its default is tuned to a
 * serverless SIGTERM grace period, far shorter than a coding run, so an
 * in-process host that leaves it alone truncates a run on every shutdown. But
 * setting it to the agent's own deadline was barely better: a worker also waits
 * for the checkout lock, provisions, and probes for the pull request, and the
 * engine carves its cancellation reserve OUT of this budget — so the effective
 * wait was *less* than the agent deadline alone, and a valid near-deadline run
 * was cancelled before it could produce a verdict. `conductorFlow` derives the
 * number from all four terms; see `conductorDrainBudgetMs`. On a
 * queue-consuming host the setting does not apply at all and the platform's kill
 * timeout is the real ceiling — see the README.
 */
import path from "node:path";
import { createFlowState, createModelResolver, filesystemStores } from "@flow-state-dev/engine";
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "./src/flow";
import { assertBaseRefExists, positiveIntFromEnv, requireSourceRepo } from "./src/config-env";

const RUN_TIMEOUT_MS = positiveIntFromEnv("CONDUCTOR_RUN_TIMEOUT_MS", 1_800_000);
const root = path.join(process.cwd(), ".fsdev");

const sourceRepo = requireSourceRepo();
const baseRef = process.env.CONDUCTOR_BASE_REF ?? "main";
// Startup, not mid-run: a ref that does not resolve fails every `worktree add`.
assertBaseRefExists(sourceRepo, baseRef);

const agentModel = process.env.CONDUCTOR_AGENT_MODEL;

const { flow, drainBudgetMs } = conductorFlow({
  epic: process.env.CONDUCTOR_EPIC ?? "harness-manager",
  workspace: {
    root: process.env.CONDUCTOR_CHECKOUTS ?? path.join(root, "checkouts"),
    sourceRepo,
    baseRef,
  },
  maxAttempts: positiveIntFromEnv("CONDUCTOR_MAX_ATTEMPTS", 3),
  runTimeoutMs: RUN_TIMEOUT_MS,
  // Coding-run model. Default is the Agent SDK's own. `CONDUCTOR_COORDINATOR_MODEL`
  // is only the talk turn.
  ...(agentModel !== undefined && agentModel !== ""
    ? { agent: { model: agentModel } }
    : {}),
});

export default createFlowState({
  flows: { [CONDUCTOR_FLOW_KIND]: flow },
  modelResolver: createModelResolver(),
  stores: { dev: { primary: filesystemStores({ rootDir: path.join(root, "data") }) } },
  defaultProfile: "dev",
  detachedDrainTimeoutMs: drainBudgetMs,
});
