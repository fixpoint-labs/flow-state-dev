/**
 * Repo-anchored paths and per-run scratch names.
 *
 * Goal runners reach into sibling workspaces (`apps/kitchen-sink`,
 * `labs/trading-desk`, `examples/hello-chat`). Each used to spell that as
 * `fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url))` — a
 * hardcoded `../../../` that silently breaks the third nesting level the README
 * explicitly allows. These resolve from the workspace root instead, so a goal's
 * depth doesn't matter.
 *
 * Also here: unique scratch paths. Fixed `/tmp/<name>.json` captures and a
 * hardcoded session id collide when two goals run at once, which the `goal:all`
 * sweep does by design.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Walk up from this file to the directory holding `pnpm-workspace.yaml`. */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("goals/lib/paths: could not locate the workspace root (no pnpm-workspace.yaml above goals/lib)");
}

/** Absolute path to the monorepo root. */
export const REPO_ROOT: string = findRepoRoot();

/** Join path segments onto the repo root. */
export function repoPath(...segments: string[]): string {
  return join(REPO_ROOT, ...segments);
}

/** `apps/kitchen-sink` — the app whose node_modules resolve `@flow-state-dev/*` + `@/*`. */
export const KITCHEN_SINK: string = repoPath("apps", "kitchen-sink");
/** `labs/trading-desk` — the desk app; `fsdev` config search is cwd-only, so run from here. */
export const TRADING_DESK: string = repoPath("labs", "trading-desk");
/** `examples/hello-chat` — the chat harness example. */
export const HELLO_CHAT: string = repoPath("examples", "hello-chat");

/** Monotonic-enough run stamp, unique per process. Used to name sessions and scratch dirs. */
export const RUN_STAMP = `${Date.now()}_${process.pid}`;

/**
 * A session id for a goal run: `goal_<slug>_<stamp>`. Unique per process, so
 * concurrent goals never share a session or land in each other's history.
 */
export function goalSessionId(slug: string): string {
  return `goal_${slug}_${RUN_STAMP}`;
}

/**
 * A scratch directory unique to this run, created if absent. Replaces the fixed
 * `/tmp/<name>.json` capture paths that collided between concurrent goals.
 */
export function goalTmpDir(slug: string): string {
  const dir = join("/tmp", `fsd-goal-${slug}-${RUN_STAMP}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
