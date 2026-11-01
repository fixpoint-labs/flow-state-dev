/**
 * What the Claude Code-style lab's goal checks share: the lab served from its
 * own config on a fresh data folder, a `file://` project repository, and the
 * clones a coding run leaves under the data folder.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intentFreeEnv, onClosed, refuseIfAnswering, repoPath, REPO_ROOT, stopProcessGroup } from "../lib/index.mts";

export const LAB = repoPath("labs", "claude-code-style");
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
/** The lab checkout's state outside the goal's own scratch: a run must leave it as it was. */
export const labCheckout = () => git(REPO_ROOT, "status", "--porcelain", "--", "labs/claude-code-style");

/** The lab, served for `user` from a fresh data folder; `app` is what `--app` serves (default: the package's built pages). */
export async function startLab(data: string, user: string, env: Record<string, string>, app = "@flow-state-dev/claude-code-style"): Promise<{ origin: string; child: ChildProcess; log: () => string }> {
  const port = 45_000 + Math.floor(Math.random() * 10_000);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  let log = "";
  const child = spawn(
    repoPath("node_modules", ".bin", "tsx"),
    ["packages/cli/src/bin.ts", "dev", "--config", join(LAB, "fsdev.config.mts"), "--app", app, "--port", String(port), "--no-open"],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: intentFreeEnv(process.env, {
        GOAL_CONTROL: "",
        CLAUDE_CODE_STYLE_DATA: data,
        CLAUDE_CODE_STYLE_USER: user,
        ...(process.env.ANTHROPIC_API_KEY === undefined && process.env.MY_ANTHROPIC_API_KEY !== undefined
          ? { ANTHROPIC_API_KEY: process.env.MY_ANTHROPIC_API_KEY }
          : {}),
        ...env,
      }),
    },
  );
  // Kept beside the data folder, so a run that loses its server can be read afterwards.
  const keep = (d: unknown) => {
    log += String(d);
    appendFileSync(join(data, "..", "server.log"), String(d));
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  let gone = false;
  onClosed(child, () => (gone = true));
  for (let waited = 0; waited < 120_000 && !gone; waited += 500) {
    if (/Data:/.test(log)) {
      const answered = await fetch(origin).then((r) => r.status, () => 0);
      if (answered === 200) return { origin, child, log: () => log };
    }
    await sleep(500);
  }
  stopProcessGroup(child);
  throw new Error(`setup: the lab never served. Log tail:\n${log.slice(-2000)}`);
}

/** A bare-bones `file://` project repository that ignores `.fsdev/`, as the lab requires, holding `files` too. */
export function makeRepository(dir: string, files: Record<string, string> = {}): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# Goal notes\n\nA project for the lab's goal check.\n");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, ".gitignore"), ".fsdev/\n");
  git(dir, "add", ".");
  git(dir, "-c", "user.email=goal@example.com", "-c", "user.name=goal", "commit", "-q", "-m", "start");
  return dir;
}

/** Every git directory a run's clone left under the lab's data folder. */
export function clonesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name.endsWith(".git") || existsSync(join(path, "HEAD")) && existsSync(join(path, "objects"))) found.push(path);
      else if (depth < 6) walk(path, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

