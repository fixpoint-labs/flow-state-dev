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
 * absent or equal to this process's directory is refused at startup, because
 * either one silently aims the coding agent at the dispatcher's own repository.
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

/**
 * The repository checkouts are cut from. **Absent is a configuration error, not
 * a default.**
 *
 * Falling back to `process.cwd()` aims the coding agent at whatever directory
 * the dispatcher happens to run in — which, run from this package, is Flow State
 * itself. The agent would then get a worktree of the dispatcher's own repository
 * and could commit and open a pull request against the wrong project, and the
 * first symptom would be a PR nobody asked for.
 *
 * The same directory is also refused explicitly: a host that sets
 * `CONDUCTOR_REPO` to the process's own directory has made the same mistake
 * deliberately rather than by omission, and it is the same harm.
 */
function requireSourceRepo(): string {
  const repo = process.env.CONDUCTOR_REPO;
  if (repo === undefined || repo === "") {
    throw new Error(
      "[conductor] CONDUCTOR_REPO is not set. It names the repository the coding agent " +
        "works on, and there is no safe default: falling back to this process's directory " +
        "would point the agent at the dispatcher's own repository.",
    );
  }
  if (path.resolve(repo) === path.resolve(process.cwd())) {
    throw new Error(
      `[conductor] CONDUCTOR_REPO is this process's own directory (${repo}). The point is a ` +
        "run driving THAT repository rather than editing the thing that dispatched it.",
    );
  }
  return repo;
}

const RUN_TIMEOUT_MS = Number(process.env.CONDUCTOR_RUN_TIMEOUT_MS ?? 1_800_000);
const root = path.join(process.cwd(), ".fsdev");

const { flow } = conductorFlow({
  epic: process.env.CONDUCTOR_EPIC ?? "harness-manager",
  workspace: {
    root: process.env.CONDUCTOR_CHECKOUTS ?? path.join(root, "checkouts"),
    sourceRepo: requireSourceRepo(),
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
