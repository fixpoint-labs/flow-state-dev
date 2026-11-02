/**
 * Goal check: the Claude Code-style lab's *Coder* chip picks who makes a code
 * change, on a real model, in a browser, against `fsdev dev --app`.
 *
 * One lab, one `file://` project repository the lab may cut worktrees from.
 * Session mode: the chip on *Codex* and a change, then *Plan first* and
 * another change. Threads mode: the chip on *Codex* and a change. Each signal
 * is read from the rendered page and the board's own records (`listTasks`),
 * and the plan from the repository's and the clones' git history; never from
 * the adapter or React state. The Codex runs are graded on where they were
 * filed and how they are tagged, not on how they end, so no Codex sign-in is
 * needed.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command). Each plants its change for
 * the run and puts it back:
 *   - `no-hint`: the composer sends what you typed without the chip's line. Must FAIL signals 1 and 3.
 *   - `no-delegates`: the new coders taken off `desk.main`'s and `desk.lead`'s delegates, the
 *     routing text kept. Must FAIL signals 1 and 3.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/picks-the-coder/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import type { Page } from "playwright";
import { goalAttempts, goalTmpDir, loadFixture, REPO_ROOT, runGoal, RUN_STAMP, stopProcessGroup, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { clonesUnder, git, LAB, labCheckout, makeRepository, sleep, startLab } from "../lab.mts";

const fixture = loadFixture<{ project: string; codex: string; plan: string; threads: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
const WORKERS = join(LAB, "workforce", "teams", "desk", "workers");
const SETTLED = new Set(["completed", "errored", "cancelled"]);

/** What a control changes for its run: in which file, the text it replaces, and with what. */
const PLANTS: Record<string, { file: string; from: string | RegExp; to: string }[]> = {
  "no-hint": [
    {
      file: join(LAB, "src", "components", "Composer.tsx"),
      from: 'return coder === "Auto" ? text : `${text}\\n\\nCoder: ${coder}`;',
      to: "return text;",
    },
  ],
  "no-delegates": [
    { file: join(WORKERS, "main", "WORKER.md"), from: ", desk.coder-plan, desk.coder-codex, desk.coder-cursor]", to: "]" },
    { file: join(WORKERS, "lead", "WORKER.md"), from: ", desk.thread-coder-plan, desk.thread-coder-codex, desk.thread-coder-cursor]", to: "]" },
  ],
};

/** Plant a control's changes, and hand back what puts the files back. */
function plant(control: string): () => void {
  const undo: (() => void)[] = [];
  for (const change of PLANTS[control] ?? []) {
    const before = readFileSync(change.file, "utf8");
    const after = before.replace(change.from, change.to);
    if (after === before) throw new Error(`setup: ${change.file} no longer holds the text the ${control} control replaces`);
    writeFileSync(change.file, after);
    undo.push(() => writeFileSync(change.file, before));
  }
  return () => undo.forEach((put) => put());
}

/** A thread card or a board row as threads mode shows it. */
type Shown = { taskId: string; text: string };

async function shown(page: Page): Promise<{ cards: Shown[]; rows: Shown[]; user: string[] }> {
  return page.evaluate(() => {
    const thread = document.querySelector('main[aria-label="Main thread"]');
    return {
      user: [...(thread?.querySelectorAll('[data-entry="user"]') ?? [])].map((el) => (el.textContent ?? "").trim()),
      cards: [...(thread?.querySelectorAll('[data-entry="thread"]') ?? [])].map((el) => ({ taskId: el.getAttribute("data-task-id") ?? "", text: (el.textContent ?? "").trim() })),
      rows: [...document.querySelectorAll('aside[aria-label="Tasks"] [data-task-id]')].map((el) => ({ taskId: el.getAttribute("data-task-id") ?? "", text: (el.textContent ?? "").trim() })),
    };
  });
}

/** One attempt: a fresh lab and project, the session-mode legs, then the threads-mode leg. */
async function attempt(n: number, failures: string[], notes: string[], tell: Tell): Promise<"retry" | "graded"> {
  const scratch = goalTmpDir(`claude-code-style-coder-${n}`);
  const before = failures.length;
  const retry = (why: string): "retry" | "graded" => {
    if (failures.length > before || CONTROL !== "") {
      failures.push(`${why}, so the later signals went ungraded`);
      return "graded";
    }
    notes.push(`${why}; retrying`);
    return "retry";
  };
  const data = join(scratch, "data");
  const repo = makeRepository(join(scratch, "repo"), { "CHANGELOG.md": "# Changelog\n\n- Started.\n" });
  const repoHead = git(repo, "rev-parse", "HEAD");
  const labBefore = labCheckout();
  const lab = await startLab(data, USER, { CLAUDE_CODE_STYLE_REPOSITORIES: repo });
  const fsd = createClient({ userId: USER, baseUrl: lab.origin });
  const rowsOf = async (flow: "agent" | "coordinator", sessionId: string): Promise<any[]> => {
    const sent = await fsd.flow(flow).send("listTasks_tasks", {}, { sessionId });
    await sent.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 30 })).find((r) => r.id === sent.id);
    return ((found?.result?.output as { tasks?: any[] } | undefined)?.tasks ?? []) as any[];
  };
  /** One task as the board's `getTask` reads it: unlike a listed row, it carries the task's output. */
  const taskOf = async (flow: "agent" | "coordinator", sessionId: string, id: string): Promise<any> => {
    const sent = await fsd.flow(flow).send("getTask_tasks", { id }, { sessionId });
    await sent.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 30 })).find((r) => r.id === sent.id);
    return (found?.result?.output as { task?: any } | undefined)?.task;
  };
  const until = async <T,>(check: () => Promise<T | undefined>, forMs: number, everyMs = 3_000): Promise<T | undefined> => {
    for (let waited = 0; waited < forMs; waited += everyMs) {
      const found = await check();
      if (found !== undefined) return found;
      await sleep(everyMs);
    }
    return undefined;
  };
  /** Every commit the project's repository and the clones under the data folder hold, with its patch. */
  const history = () =>
    [repo, ...clonesUnder(join(data, "runs"))]
      .map((dir) => {
        try {
          return execFileSync("git", dir === repo ? ["-C", dir, "log", "--all", "-p"] : ["--git-dir", dir, "log", "--all", "-p"], { encoding: "utf8" });
        } catch {
          return "";
        }
      })
      .join("\n");
  /** The first coding task on a session's board, whichever coder it went to. */
  const coderTask = (rows: any[], prefix: string, known: Set<string>) => rows.find((t) => String(t.assignee ?? "").startsWith(prefix) && !known.has(t.id));

  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(lab.origin);
    await page.getByRole("region", { name: "Choose a project" }).waitFor();
    const box = page.getByRole("textbox", { name: "Message the main session" });
    const chip = page.getByLabel("Coder");
    const idle = () => page.locator('main[aria-label="Main thread"] [role="status"]').waitFor({ state: "detached", timeout: 5 * 60_000 }).catch(() => undefined);

    // ── Session mode.
    const form = page.getByRole("form", { name: "New project" });
    await form.getByLabel("Project name").fill(fixture.project);
    await form.getByLabel("Repository").fill(`file://${repo}`);
    await form.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.project }).click();
    await box.waitFor();
    const session = (await fsd.sessions.list({ flowKind: "agent", userId: USER })).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;
    const seen = new Set<string>();

    // ── Signal 1: the chip on Codex files the change to the Codex coder.
    await chip.selectOption("Codex");
    await box.fill(fixture.codex.replace("{marker}", `Codex ${RUN_STAMP}`));
    await box.press("Enter");
    const codex = await until(async () => coderTask(await rowsOf("agent", session), "desk.coder", seen), 5 * 60_000);
    if (codex === undefined) return retry("1: no coding task was filed in session mode");
    seen.add(codex.id);
    tell.over("session-mode coding tasks", [codex.assignee]);
    if (codex.assignee !== "desk.coder-codex") failures.push(`1: the chip on Codex filed the change to ${codex.assignee}, not desk.coder-codex`);
    else notes.push("1: filed to desk.coder-codex");
    const line = (await shown(page)).user.at(-1) ?? "";
    if (CONTROL === "" && !line.includes("Coder: Codex")) failures.push(`1: your line doesn't show the chip's choice: ${JSON.stringify(line.slice(-80))}`);
    await idle();

    // ── Signal 2: Plan first goes to the plan coder, which changes nothing and answers with a plan.
    await chip.selectOption("Plan first");
    const planMarker = `Plan ${RUN_STAMP}`;
    await box.fill(fixture.plan.replace("{marker}", planMarker));
    await box.press("Enter");
    const plan = await until(async () => coderTask(await rowsOf("agent", session), "desk.coder", seen), 5 * 60_000);
    if (plan === undefined) failures.push("2: no coding task was filed for the Plan first change");
    else {
      seen.add(plan.id);
      if (plan.assignee !== "desk.coder-plan") failures.push(`2: Plan first filed the change to ${plan.assignee}, not desk.coder-plan`);
      const ended = await until(async () => {
        const read = await taskOf("agent", session, plan.id);
        return read !== undefined && SETTLED.has(read.status) ? read : undefined;
      }, 20 * 60_000, 5_000);
      if (ended === undefined) failures.push("2: the plan task never settled");
      else {
        const output = JSON.stringify(ended.output ?? "");
        if (ended.status !== "completed") failures.push(`2: the plan task ended ${ended.status}: ${ended.statusNote ?? ""}`);
        else if (output.length < 120 || !/readme/i.test(output)) failures.push(`2: the plan task's result holds no plan: ${output.slice(0, 200)}`);
        else notes.push(`2: ${ended.assignee} answered a ${output.length}-character plan`);
        if (history().includes(planMarker)) failures.push("2: a commit holds the line Plan first was asked to plan, not make");
      }
    }
    await idle();

    // ── Threads mode.
    await page.getByRole("tab", { name: "Projects" }).click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.project }).click();
    await box.waitFor();
    const lead = (await fsd.sessions.list({ flowKind: "coordinator", userId: USER })).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;

    // ── Signal 3: the chip on Codex files the thread to the Codex coder, and its card and row read Codex.
    await chip.selectOption("Codex");
    await box.fill(fixture.threads.replace("{marker}", `Thread ${RUN_STAMP}`));
    await box.press("Enter");
    const thread = await until(async () => coderTask(await rowsOf("coordinator", lead), "desk.thread-coder", new Set()), 5 * 60_000);
    if (thread === undefined) failures.push("3: no coding thread was filed in threads mode");
    else {
      if (thread.assignee !== "desk.thread-coder-codex") failures.push(`3: the chip on Codex filed the thread to ${thread.assignee}, not desk.thread-coder-codex`);
      const tagged = await until(async () => {
        const now = await shown(page);
        const card = now.cards.find((c) => c.taskId === thread.id);
        const row = now.rows.find((r) => r.taskId === thread.id);
        return card?.text.includes("Codex") && row?.text.includes("Codex") ? true : undefined;
      }, 2 * 60_000, 2_000);
      if (tagged === undefined) failures.push("3: the coding thread's card and row aren't both tagged Codex");
      else notes.push(`3: ${thread.assignee}, tagged Codex`);
    }

    if (git(repo, "rev-parse", "HEAD") !== repoHead || git(repo, "status", "--porcelain") !== "") failures.push("the project's own checkout changed");
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
    if (errors.length > 0) failures.push(`page errors: ${errors.join(" | ")}`);
    return "graded";
  } finally {
    await browser?.close();
    stopProcessGroup(lab.child);
  }
}

await runGoal(async (failures, tell) => {
  const unplant = plant(CONTROL);
  try {
    // The pages `--app` serves are the lab's built ones, built after a control's plant.
    execFileSync("pnpm", ["--filter", "@flow-state-dev/claude-code-style", "build"], { cwd: REPO_ROOT, stdio: "ignore" });
    const notes: string[] = [];
    const attempts = goalAttempts(3);
    for (let n = 1; n <= attempts; n += 1) {
      const before = failures.length;
      const outcome = await attempt(n, failures, notes, tell);
      if (outcome === "graded") {
        tell.over("attempts graded", [n]);
        return { failures, evidence: `attempt ${n} of ${attempts}: ${notes.join("; ")}` };
      }
      notes.push(...failures.splice(before).map((failure) => `attempt ${n}: ${failure}`));
    }
    failures.push(`the model never gave a gradable run in ${attempts} attempts: ${notes.join("; ")}`);
    return { failures, evidence: "" };
  } finally {
    unplant();
    // A control's pages are rebuilt from the restored source, so the next run serves the real ones.
    if (CONTROL === "no-hint") execFileSync("pnpm", ["--filter", "@flow-state-dev/claude-code-style", "build"], { cwd: REPO_ROOT, stdio: "ignore" });
  }
});
