/**
 * Goal check: the prompt Kitchen Sink and Shift Manager hand a coding agent
 * names the check the app will run after it, by a command drawn fresh each
 * run. Model-free: each app's own wiring, with only the agent swapped for one
 * that records its prompt (`kitchen-sink.probe.mts`, `shift-manager.probe.mts`).
 *
 * Each probe runs inside the tree it grades, so `GOAL_COMMIT` grades another
 * commit's own code: the control is the merge base, where the brief names no
 * check, and must FAIL.
 *
 * Run:  pnpm tsx goals/harness-manager/a-coding-brief-names-the-checks/run.mts
 *       GOAL_COMMIT=<sha> (another tree) · GOAL_APPS=kitchen-sink (a subset)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, runGoal } from "../../lib/index.mts";
import { placeProbe } from "./place-probe.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = ["kitchen-sink", "shift-manager"] as const;
type App = (typeof APPS)[number];

/** This checkout, or a commit's own tree and install, kept across runs. */
function treeFor(commit: string): { root: string; label: string } {
  const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
  if (commit === "") return { root: REPO_ROOT, label: `this checkout, ${git("rev-parse", "--short=9", "HEAD")}` };
  const sha = git("rev-parse", `${commit}^{commit}`);
  const root = join(tmpdir(), "fsd-goal-closure-trees", sha.slice(0, 12));
  if (!existsSync(join(root, "package.json"))) {
    mkdirSync(root, { recursive: true });
    execFileSync("sh", ["-c", `git -C "${REPO_ROOT}" archive --format=tar ${sha} | tar -x -C "${root}"`]);
  }
  if (!existsSync(join(root, "node_modules"))) {
    const installed = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, encoding: "utf8", timeout: 900_000 });
    if (installed.status !== 0) throw new Error(`setup: ${sha} did not install: ${(installed.stdout + installed.stderr).slice(-1500)}`);
  }
  return { root, label: `${sha.slice(0, 9)} (GOAL_COMMIT=${commit}), its own tree` };
}

/** A git repository at `dir` holding `files`, committed once on `main`. */
function gitRepository(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args]);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return dir;
}

/** Run `app`'s probe inside `root`; the prompts its agent was handed. */
function promptsOf(app: App, root: string, scratch: string, check: { command: string; file: string }): string[] {
  // Copied to the same depth in another tree, so its relative imports reach that tree's code.
  const { path: placed, cleanup } = placeProbe(join(HERE, `${app}.probe.mts`), REPO_ROOT, root);
  const env: Record<string, string> = { ...(process.env as Record<string, string>), GOAL_CHECK: check.command, GOAL_CHECK_FILE: check.file };
  if (app === "kitchen-sink") {
    env.KITCHEN_SINK_HARNESS_WORKSPACE = gitRepository(join(scratch, "repo"), { [check.file]: "console.log('ok');\n", ".gitignore": ".fsdev/\n" });
    env.KITCHEN_SINK_HARNESS_CHECKS = check.command;
    env.XDG_STATE_HOME = join(scratch, "state");
  }
  try {
    const ran = spawnSync(join(root, "node_modules", ".bin", "tsx"), [placed], { cwd: root, env, encoding: "utf8", timeout: 600_000 });
    const line = ran.stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
    if (line === undefined) throw new Error(`setup: ${app}'s probe printed no result (exit ${ran.status}):\n${(ran.stderr ?? "").slice(-2000)}`);
    const out = JSON.parse(line) as { prompts: string[]; error: string | null };
    if (out.error !== null) throw new Error(`setup: ${app}'s turn failed: ${out.error}`);
    return out.prompts;
  } finally {
    cleanup();
  }
}

const tree = treeFor(process.env.GOAL_COMMIT ?? "");
const asked = (process.env.GOAL_APPS ?? APPS.join(",")).split(",").map((a) => a.trim()) as App[];

await runGoal(async (failures, tell) => {
  const seen: string[] = [];
  for (const app of asked) {
    if (!APPS.includes(app)) throw new Error(`setup: GOAL_APPS names "${app}"; known: ${APPS.join(", ")}`);
    // Held out: a check drawn fresh each run, so a brief can only name it by reading the app's own list.
    const token = `brief${Math.random().toString(36).slice(2, 10)}`;
    const check = { file: `check-${token}.mjs`, command: `node check-${token}.mjs` };
    const scratch = mkdtempSync(join(tmpdir(), `coding-brief-${app}-`));
    const prompts = promptsOf(app, tree.root, scratch, check);
    tell.over(`${app}: prompts the agent was handed`, prompts);
    const first = prompts[0];
    if (first === undefined) failures.push(`${app}: the agent was never handed a prompt`);
    else if (!first.includes(check.command)) failures.push(`${app}: the prompt lacks the check \`${check.command}\` the app runs after the agent`);
    else seen.push(`${app}: the prompt names \`${check.command}\``);
  }
  return { failures, evidence: `${tree.label} · ${seen.join(" · ")}` };
});
