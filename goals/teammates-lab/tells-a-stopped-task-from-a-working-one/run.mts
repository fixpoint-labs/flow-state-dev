/**
 * Goal check: in the Teammates lab, a person tells a task that is working from
 * one whose run has stopped, and sees how long each running task has worked
 * on this attempt, from the teammate's panel alone. The legs, controls and
 * grading are `goals/lib/task-signals.mts`, shared with the Claude Code-style
 * lab; this file says how to serve this lab, open its page, file on Chief of
 * Staff's board and read a panel row's words. See goal.md for the contract.
 *
 * Run:      pnpm tsx goals/teammates-lab/tells-a-stopped-task-from-a-working-one/run.mts
 * Controls: GOAL_CONTROL=task-clock | quiet-from-age | never-quiet, same command.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { taskActionName } from "@flow-state-dev/orchestration/inbox";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import type { Page } from "playwright";
import { goalTmpDir, REPO_ROOT, repoPath } from "../../lib/index.mts";
import { NO_MODEL, runTaskSignals, STEP_MS } from "../../lib/task-signals.mts";
import { startTeammates } from "../lab.mts";

const USER = "u_goal";
/** The teammate whose conversation files the tasks, its name in the list, and the coding worker they go to. */
const FILER = { id: "teammates.chief-of-staff", name: "Chief of Staff" };
const CODER = "teammates.cursor";
const BOARD = "tasks";

// A checkout with one commit, so a run has a HEAD to cut its branch from, that ignores `.fsdev/`.
const workdir = join(goalTmpDir("teammates-task-signals-workdir"), "workdir");
mkdirSync(workdir, { recursive: true });
writeFileSync(join(workdir, "README.md"), "# Team\n");
writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
git("init", "-q", "-b", "main");
git("add", ".");
git("commit", "-q", "-m", "Start the README");

await runTaskSignals({
  name: "teammates",
  itemFile: repoPath("labs", "teammates", "src", "components", "flow-state", "task-signals.tsx"),
  build: () => execFileSync("pnpm", ["--filter", "@flow-state-dev/teammates", "build"], { cwd: REPO_ROOT, stdio: "ignore" }),
  serve: async (data, port) => {
    mkdirSync(data, { recursive: true });
    const env = { GOAL_HARNESS: "stub", GOAL_HARNESS_STEP_MS: String(STEP_MS), ...NO_MODEL };
    return port === undefined ? startTeammates(data, USER, env, workdir) : startTeammates(data, USER, env, workdir, undefined, port);
  },
  open: async (page: Page, origin: string) => {
    const fsd = createClient({ userId: USER, baseUrl: origin });
    const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker: FILER.id });
    const flow = session.flowId ?? session.flowKind;
    const act = async (action: "createTask" | "updateTask" | "retryTask", input: Record<string, unknown>) => {
      const sent = await fsd.flow(flow).send(taskActionName(action, BOARD), input, { sessionId: session.id });
      await sent.wait({ timeoutMs: 60_000 });
      const requests = (await fsd.sessions.requests(session.id, { limit: 100, includeResultOutput: true })) as Array<{ id: string; result?: { output?: any } }>;
      return requests.find((request) => request.id === sent.id)?.result?.output;
    };
    await page.goto(origin);
    await page.locator(`nav[aria-label="Workers"] button[data-worker="${FILER.name}"]`).click();
    const panel = page.locator(`aside[aria-label="${FILER.name}'s panel"]`);
    await panel.waitFor();
    return {
      rows: async () => {
        const listed = await fsd.flow(flow).read<{ ok: boolean; error?: string; tasks: any[] }>(taskActionName("listTasks", BOARD), {}, { sessionId: session.id });
        // A conversation nothing was ever filed on has no board yet: it holds no rows.
        if (!listed.ok && listed.error?.startsWith("no_delegation_board")) return [];
        if (!listed.ok) throw new Error(`listTasks refused: ${listed.error}`);
        return listed.tasks;
      },
      file: async (title, goal) => {
        const out = await act("createTask", { assignee: CODER, title, goal });
        if (typeof out?.taskId !== "string") throw new Error(`setup: the board didn't file "${title}": ${JSON.stringify(out)}`);
        return out.taskId;
      },
      act: (tool, input) => act(tool, input),
      words: async (title) => {
        const row = panel.locator("li button").filter({ hasText: title }).first();
        return (await row.count()) === 0 ? undefined : ((await row.textContent()) ?? undefined);
      },
      // The panel greys a row's words (the registry's STALE_CLASS) while its feed has lost the server.
      stale: async (title) => {
        const words = panel.locator("li button").filter({ hasText: title }).first().locator("[data-status]");
        return (await words.count()) > 0 && /\bgrayscale\b/.test((await words.getAttribute("class")) ?? "");
      },
    };
  },
});
