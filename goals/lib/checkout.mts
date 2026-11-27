/**
 * The tree a goal run serves: this checkout, or another commit's own tree and
 * install (`GOAL_COMMIT`), so a before-state control runs that commit's code.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./paths.mts";

const say = (s: string) => console.error(`[checkout ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** The tree a run serves: this checkout, or another commit's own tree and install. */
export function checkoutFor(commit: string | undefined, cache: "coordinators" | "workers" | "messages"): { root: string; commit: string; describe: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === undefined || commit === "") {
    const head = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".", ":(exclude)goals").length > 0;
    return { root: REPO_ROOT, commit: head, describe: `this checkout, \`${head.slice(0, 9)}\`${dirty ? " with uncommitted changes outside goals/" : ""}` };
  }
  const sha = git("rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`);
  const root = join(tmpdir(), `fsd-goal-${cache}-trees`, sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("bash", ["-o", "pipefail", "-c", 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', "goal-checkout", REPO_ROOT, sha, root]);
  }
  if (!existsSync(join(root, "node_modules", ".modules.yaml"))) {
    say(`installing ${sha.slice(0, 9)} in ${root}`);
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${installed.error?.message ?? `${installed.stdout ?? ""}${installed.stderr ?? ""}`.slice(-1500)}`);
  }
  return { root, commit: sha, describe: `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit}), its own tree and install` };
}
