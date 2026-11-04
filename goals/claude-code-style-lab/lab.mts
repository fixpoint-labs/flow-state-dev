/**
 * What the Claude Code-style lab's goal checks share: the lab served from its
 * own config on a fresh data folder, a `file://` project repository, the
 * clones a coding run leaves under the data folder, and, for the browser
 * checks, a control planted in the lab's source, the session's board read
 * through the public client, and a session opened on a new project.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@flow-state-dev/client";
import { taskActionName } from "@flow-state-dev/orchestration/inbox";
import type { Page } from "playwright";
import { intentFreeEnv, onClosed, refuseIfAnswering, repoPath, REPO_ROOT, sleep, stopProcessGroup } from "../lib/index.mts";

export const LAB = repoPath("labs", "claude-code-style");
export { sleep };
export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
/** The lab checkout's state outside the goal's own scratch: a run must leave it as it was. */
export const labCheckout = () => git(REPO_ROOT, "status", "--porcelain", "--", "labs/claude-code-style");

/**
 * The lab, served for `user` from a fresh data folder; `app` is what `--app` serves (default: the
 * package's built pages), and `port` the port to serve on (default: a random one; pass the last one
 * to serve again where an open page still looks).
 */
export async function startLab(
  data: string,
  user: string,
  env: Record<string, string>,
  app = "@flow-state-dev/claude-code-style",
  port = 45_000 + Math.floor(Math.random() * 10_000),
): Promise<{ origin: string; child: ChildProcess; log: () => string }> {
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


// A control's change to the lab's source, and its planting, are shared with other labs' goals.
export { plant, type Plant } from "../lib/plant.mts";

/** Build the lab's pages, which `--app` serves: after a control's plant, and again once it is put back. */
export const buildPages = () => execFileSync("pnpm", ["--filter", "@flow-state-dev/claude-code-style", "build"], { cwd: REPO_ROOT, stdio: "ignore" });

/** Poll `check` every `everyMs` until it answers, or `forMs` passes. Hands back the answer and when it came. */
export async function until<T>(check: () => Promise<T | undefined>, forMs: number, everyMs = 500): Promise<{ value: T; afterMs: number } | undefined> {
  const started = Date.now();
  while (Date.now() - started < forMs) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return { value, afterMs: Date.now() - started };
    await sleep(everyMs);
  }
  return undefined;
}

/** The lab's main worker's flow, which holds the session's board, and the board's name. */
export const MAIN_FLOW = "agent";
export const BOARD = "tasks";

/** A session's board through the public client: its rows (`listTasks`), one task whole, a filing, and any other board action. */
export function boardOf(fsd: Client) {
  const rows = async (sessionId: string): Promise<any[]> => {
    const listed = await fsd.flow(MAIN_FLOW).read<{ ok: boolean; tasks: any[] }>(taskActionName("listTasks", BOARD), {}, { sessionId });
    return listed.ok ? listed.tasks : [];
  };
  const send = async (sessionId: string, tool: "getTask" | "createTask" | "updateTask" | "retryTask", input: Record<string, unknown>): Promise<any> => {
    const sent = await fsd.flow(MAIN_FLOW).send(taskActionName(tool, BOARD), input, { sessionId });
    await sent.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 50 })).find((r) => r.id === sent.id);
    return found?.result?.output;
  };
  return {
    rows,
    send,
    row: async (sessionId: string, id: string) => (await rows(sessionId)).find((t) => t.id === id),
    task: async (sessionId: string, id: string): Promise<any> => (await send(sessionId, "getTask", { id }))?.task,
    /** File a coding task for `desk.coder`, as the main session files one; its id. */
    file: async (sessionId: string, title: string, goal: string): Promise<string> => {
      const out = await send(sessionId, "createTask", { title, goal, assignee: "desk.coder" });
      if (typeof out?.taskId !== "string") throw new Error(`setup: the board didn't file "${title}": ${JSON.stringify(out)}`);
      return out.taskId;
    },
  };
}

/** A new session-mode session on a new project named `name` over `repository`, opened in the page; its id. */
export async function openSessionOn(page: Page, fsd: Client, user: string, name: string, repository: string): Promise<string> {
  const known = new Set((await fsd.sessions.list({ flowKind: MAIN_FLOW, userId: user })).map((s) => s.id));
  const picker = page.getByRole("region", { name: "Choose a project" });
  if (!(await picker.isVisible())) await page.getByRole("button", { name: "+ New session" }).click();
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Project name").fill(name);
  await form.getByLabel("Repository").fill(`file://${repository}`);
  await form.getByRole("button", { name: "Create project" }).click();
  await picker.getByRole("button", { name }).click();
  await page.getByRole("textbox", { name: "Message the main session" }).waitFor();
  const opened = await until(async () => (await fsd.sessions.list({ flowKind: MAIN_FLOW, userId: user })).find((s) => !known.has(s.id))?.id, 10_000);
  if (opened === undefined) throw new Error(`setup: no session opened on ${name}`);
  return opened.value;
}
