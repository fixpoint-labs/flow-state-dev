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
 * `CONDUCTOR_REPO` names the repository checkouts are cut from. It must not be
 * the directory this process runs in: the point is a run driving *that*
 * repository rather than editing the thing that dispatched it.
 *
 * **`detachedDrainTimeoutMs` is raised deliberately.** Its default is tuned to a
 * serverless SIGTERM grace period, far shorter than a coding run, so an
 * in-process host that leaves it alone truncates a run on every shutdown. On a
 * queue-consuming host the setting does not apply at all and the platform's kill
 * timeout is the real ceiling — see the README.
 */
import path from "node:path";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "./src/flow";

function neverResolvesAModel(): never {
  throw new Error(
    "conductor declares no generator actions; the coding run resolves its own model.",
  );
}

const RUN_TIMEOUT_MS = Number(process.env.CONDUCTOR_RUN_TIMEOUT_MS ?? 1_800_000);
const root = path.join(process.cwd(), ".fsdev");

const { flow } = conductorFlow({
  epic: process.env.CONDUCTOR_EPIC ?? "harness-manager",
  workspace: {
    root: process.env.CONDUCTOR_CHECKOUTS ?? path.join(root, "checkouts"),
    sourceRepo: process.env.CONDUCTOR_REPO ?? process.cwd(),
    baseRef: process.env.CONDUCTOR_BASE_REF ?? "main",
  },
  maxAttempts: Number(process.env.CONDUCTOR_MAX_ATTEMPTS ?? 3),
  runTimeoutMs: RUN_TIMEOUT_MS,
});

export default createFlowState({
  flows: { [CONDUCTOR_FLOW_KIND]: flow },
  modelResolver: Object.assign(neverResolvesAModel, {
    resolveId: neverResolvesAModel,
  }) as ModelResolver,
  stores: { dev: { primary: filesystemStores({ rootDir: path.join(root, "data") }) } },
  defaultProfile: "dev",
  detachedDrainTimeoutMs: RUN_TIMEOUT_MS,
});
