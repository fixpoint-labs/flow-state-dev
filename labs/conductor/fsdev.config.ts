/**
 * fsdev config for the conductor lab (LAB-138).
 *
 * Filesystem `dev` profile, zero generators — the coding run goes through the
 * Claude Code Agent SDK, which resolves its own model, so an explicit throwing
 * resolver skips the ambient `FSDEV_DEFAULT_MODEL` scan that would otherwise
 * fire on a model-using environment.
 *
 *   pnpm fsdev run conductor seed   -i '{"issue":"FIX-1219","phase":"implement"}'
 *   pnpm fsdev run conductor wake   -i '{}'
 *   pnpm fsdev run conductor status -i '{"issue":"FIX-1219"}'
 *
 * No `-s` needed. The CLI mints a fresh session per invocation, and both the
 * board row and the run record are `user`-scoped, so `status` answers with the
 * run's session, checkout, outcome and cost whichever session asks.
 *
 * `CONDUCTOR_REPO` names the repository checkouts are cut from. **Required** —
 * absent, or resolving to the repository this dispatcher itself runs from, is
 * refused at startup, because either one silently aims the coding agent at the
 * dispatcher's own code. Numeric settings are validated there too; see
 * `positiveIntFromEnv` for why an unchecked one is charged to a task.
 *
 * **`dispatchDrainTimeoutMs` is derived, not chosen.** Its default is tuned to a
 * serverless SIGTERM grace period, far shorter than a coding run, so an
 * in-process host that leaves it alone truncates a run on every shutdown. But
 * setting it to the agent's own deadline was barely better: a worker also waits
 * for the checkout lock, provisions, and probes for the pull request, and the
 * engine carves its cancellation reserve OUT of this budget — so the effective
 * wait was *less* than the agent deadline alone, and a valid near-deadline run
 * was cancelled before it could produce a verdict. `conductorFlow` derives the
 * number from all four terms; see `harnessDrainBudgetMs`. On a
 * queue-consuming host the setting does not apply at all and the platform's kill
 * timeout is the real ceiling — see the README.
 */
import path from "node:path";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "./src/flow";
import {
  assertBaseRefExists,
} from "@flow-state-dev/harness-manager";
import { positiveIntFromEnv, requireSourceRepo } from "./src/config-env";

function neverResolvesAModel(): never {
  throw new Error(
    "conductor declares no generator actions; the coding run resolves its own model.",
  );
}

const RUN_TIMEOUT_MS = positiveIntFromEnv("CONDUCTOR_RUN_TIMEOUT_MS", 1_800_000);
const root = path.join(process.cwd(), ".fsdev");

const sourceRepo = requireSourceRepo();
const baseRef = process.env.CONDUCTOR_BASE_REF ?? "main";
// Startup, not mid-run: a ref that does not resolve fails every `worktree add`.
assertBaseRefExists(sourceRepo, baseRef);

const { flow, drainBudgetMs } = conductorFlow({
  epic: process.env.CONDUCTOR_EPIC ?? "harness-manager",
  workspace: {
    root: process.env.CONDUCTOR_CHECKOUTS ?? path.join(root, "checkouts"),
    sourceRepo,
    baseRef,
  },
  maxAttempts: positiveIntFromEnv("CONDUCTOR_MAX_ATTEMPTS", 3),
  runTimeoutMs: RUN_TIMEOUT_MS,
});

export default createFlowState({
  flows: { [CONDUCTOR_FLOW_KIND]: flow },
  modelResolver: Object.assign(neverResolvesAModel, {
    resolveId: neverResolvesAModel,
  }) as ModelResolver,
  stores: { dev: { primary: filesystemStores({ rootDir: path.join(root, "data") }) } },
  defaultProfile: "dev",
  dispatchDrainTimeoutMs: drainBudgetMs,
});
