/**
 * Goal check: the Claude Code-style lab's session mode, end to end, on a real
 * model, in a browser, against `fsdev dev --app`.
 *
 * It starts the lab from its own config, makes a `file://` project repository,
 * and drives the page the way a person does: New project, pick it, type a
 * line, ask to stop a task, ask for a code change. Each signal is graded from
 * the rendered page and from the server's own records (requests, `listTasks`,
 * the run's clone), never from the adapter or the lab's React state.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command):
 *   - `answer-again-off`: the lab with `CLAUDE_CODE_STYLE_ANSWER_AGAIN=off`. Must FAIL signal 4.
 *   - `planted-glue`: a planted `src/glue.ts` in the lab. The inventory must FAIL.
 *   - `no-project`: a session made with no project. Must FAIL signals 0 and 6, with the
 *     composer closed and no run anywhere.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/session-mode-script/run.mts
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import type { Page } from "playwright";
import {
  goalAttempts,
  goalTmpDir,
  loadFixture,
  REPO_ROOT,
  runGoal,
  RUN_STAMP,
  stopProcessGroup,
  type Tell,
} from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { clonesUnder, git, LAB, labCheckout, makeRepository, sleep, startLab } from "../lab.mts";

const fixture = loadFixture<{ project: string; ask: string; stop: string; change: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
const MAIN = "desk.main";

/** What a poll of the page saw: the thread's entries, the working indicator, the task rows. */
type Snapshot = {
  at: number;
  entries: { kind: string; req: string | null; text: string }[];
  indicator: string | null | undefined;
  tasks: { title: string; status: string }[];
  header: string;
};

async function snapshot(page: Page): Promise<Snapshot> {
  return {
    at: Date.now(),
    ...(await page.evaluate(() => {
      const thread = document.querySelector('main[aria-label="Main thread"]');
      const entries = [...(thread?.querySelectorAll("[data-entry]") ?? [])].map((el) => ({
        kind: el.getAttribute("data-entry") ?? "",
        req: el.closest("[data-request-id]")?.getAttribute("data-request-id") ?? null,
        text: (el.textContent ?? "").trim(),
      }));
      const status = thread?.querySelector('[role="status"]');
      const tasks = [...document.querySelectorAll('aside[aria-label="Background tasks"] [data-task-status]')].map((el) => ({
        title: (el.querySelector(".font-semibold")?.textContent ?? "").trim(),
        status: el.getAttribute("data-task-status") ?? "",
      }));
      return {
        entries,
        indicator: status === null || status === undefined ? undefined : status.getAttribute("data-request-id"),
        tasks,
        header: (thread?.querySelector("header")?.textContent ?? "").trim(),
      };
    })),
  };
}

/** Words of a title worth matching: four letters or more, lower case. */
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** One attempt: a fresh lab, a fresh project, the five steps and the harness leg. */
async function attempt(n: number, failures: string[], notes: string[], tell: Tell): Promise<"retry" | "graded"> {
  const scratch = goalTmpDir(`claude-code-style-${n}`);
  // A retry is for a model that gave nothing to grade, never a way past a signal that already failed.
  const before = failures.length;
  const retry = (why: string): "retry" | "graded" => {
    if (failures.length > before) {
      failures.push(`${why}, so the later signals went ungraded`);
      return "graded";
    }
    notes.push(`${why}; retrying`);
    return "retry";
  };
  const data = join(scratch, "data");
  const repo = makeRepository(join(scratch, "repo"));
  const repoHead = git(repo, "rev-parse", "HEAD");
  const labBefore = labCheckout();
  const marker = `Goal ${RUN_STAMP}`;
  const lab = await startLab(data, USER, CONTROL === "answer-again-off" ? { CLAUDE_CODE_STYLE_ANSWER_AGAIN: "off" } : {});
  const fsd = createClient({ userId: USER, baseUrl: lab.origin });
  /** A session's tasks, as its board's `listTasks` answers them: the package's read, not the page's. */
  const rowsOf = async (sessionId: string): Promise<any[]> => {
    const sent = await fsd.flow("agent").send("listTasks_tasks", {}, { sessionId });
    await sent.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 20 })).find((r) => r.id === sent.id);
    return ((found?.result?.output as { tasks?: any[] } | undefined)?.tasks ?? []) as any[];
  };
  // The server is running from here on, so a browser that fails to launch still stops it.
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(lab.origin);
    await page.getByRole("region", { name: "Choose a project" }).waitFor();

    // ── Signal 0: New session asks for a project, and the header names the one you pick.
    let sessionId: string;
    if (CONTROL === "no-project") {
      // A session made with no project: the screen must keep its composer closed.
      sessionId = (await fsd.flow("agent").createSession({ state: { workerId: MAIN } })).id;
      await page.reload();
      await page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /New session/ }).waitFor();
      await page.getByRole("navigation", { name: "Sessions" }).locator("li button").first().click({ timeout: 30_000 });
    } else {
      const form = page.getByRole("form", { name: "New project" });
      await form.getByLabel("Project name").fill(fixture.project);
      await form.getByLabel("Repository").fill(`file://${repo}`);
      await form.getByRole("button", { name: "Create project" }).click();
      await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.project }).click();
      await page.getByRole("textbox", { name: "Message the main session" }).waitFor();
      const listed = await fsd.sessions.list({ flowKind: "agent", userId: USER });
      sessionId = listed.sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;
    }
    const header = (await snapshot(page)).header;
    if (!header.includes(`in project: ${fixture.project}`)) failures.push(`0: the header reads ${JSON.stringify(header)}, not the project picked`);

    if (CONTROL === "no-project") {
      const composer = await page.getByRole("textbox", { name: "Message the main session" }).count();
      const note = await page.getByRole("note").filter({ hasText: "Choose a project" }).count();
      if (composer !== 0 || note !== 1) failures.push(`no-project: the composer is ${composer === 0 ? "closed" : "open"} and the ask shows ${note} time(s)`);
      // Ask for a change straight at the door: nothing may run anywhere.
      const sent = await fsd.flow("agent").send("respond", { message: fixture.change.replace("{marker}", marker) }, { sessionId });
      await sent.wait();
      // Give a run that should never start the time one would take to clone.
      await sleep(90_000);
      const clones = clonesUnder(join(data, "runs"));
      if (clones.length === 0) failures.push("6: no coding run started (a session with no project runs nothing)");
      else failures.push(`6: a run cloned ${clones.join(", ")} for a session with no project`);
      if (labCheckout() !== labBefore) failures.push("6: the lab's own checkout changed");
      return "graded";
    }

    // ── Signal 1: your line shows.
    const box = page.getByRole("textbox", { name: "Message the main session" });
    await box.fill(fixture.ask);
    await box.press("Enter");
    await page.locator('[data-entry="user"]').first().waitFor();
    const mine = (await snapshot(page)).entries.find((e) => e.kind === "user");
    if (mine === undefined || !mine.text.includes(fixture.ask.slice(0, 40))) failures.push("1: your line never showed in the thread");

    // Poll the page through the first turn, and a little past it.
    const timeline: Snapshot[] = [];
    let ended: number | undefined;
    for (let waited = 0; waited < 10 * 60_000; waited += 400) {
      const now = await snapshot(page);
      timeline.push(now);
      if (now.indicator === undefined && now.entries.some((e) => e.kind === "assistant")) ended ??= now.at;
      if (ended !== undefined && now.at - ended > 3_000) break;
      await sleep(400);
    }
    tell.over("page polls in the first turn", timeline);
    const requests = await fsd.sessions.requests(sessionId, { limit: 50 });
    const first = requests.filter((r) => r.actionName === "respond").sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0))[0];
    if (first === undefined) throw new Error("setup: no respond request was recorded for your line");
    const filed = await rowsOf(sessionId);

    // ── Signal 2: the main session's own text shows before any task row.
    const firstText = timeline.find((s) => s.entries.some((e) => e.kind === "assistant"));
    const firstRow = timeline.find((s) => s.tasks.length > 0);
    if (firstText === undefined) failures.push("2: the main session wrote no text");
    else if (firstRow !== undefined && firstRow.at < firstText.at) failures.push("2: a task row showed before the main session's own text");
    else if (firstText.tasks.length > 0) notes.push("2: text and the first row arrived in the same poll");

    // ── Signal 3: two task rows show, both filed by this session.
    const shownRows = timeline.at(-1)!.tasks;
    if (shownRows.length < 2 || filed.length < 2) {
      return retry(`3: the model filed ${filed.length} task(s)`);
    }
    tell.over("task rows shown", shownRows);
    const unknown = shownRows.filter((row) => !filed.some((task) => (task.title ?? task.goal) === row.title));
    if (unknown.length > 0) failures.push(`3: rows not on this session's board: ${unknown.map((r) => r.title).join(", ")}`);

    // ── Signal 4: a result card while the indicator is on, all in your first respond.
    const during = timeline.find((s) => s.indicator === first.id && s.entries.some((e) => e.kind === "result" && e.req === first.id));
    // A settle is recorded as a request when it happens, even while it queues behind the turn.
    const turnEnd = first.completedAtMs ?? Infinity;
    const settledInTurn = requests.filter((r) => r.actionName === "onTaskSettled" && (r.startedAtMs ?? Infinity) < turnEnd);
    if (during === undefined) {
      if (settledInTurn.length === 0) {
        return retry("4: no task settled before the turn ended (the model ended its turn early)");
      }
      failures.push(`4: a task settled while your first turn ran, but no result card showed inside it with the indicator on`);
    } else {
      const card = during.entries.find((e) => e.kind === "result" && e.req === first.id)!;
      const last = timeline.at(-1)!.entries;
      const at = last.findIndex((e) => e.kind === "result" && e.req === first.id);
      const after = last.slice(at + 1).filter((e) => e.kind === "assistant" && e.req === first.id);
      const title = filed.find((t) => card.text.includes(t.title ?? t.goal))?.title ?? card.text;
      const named = after.some((e) => [...wordsOf(title)].some((w) => e.text.toLowerCase().includes(w)));
      if (!named) failures.push(`4: no text after the card in the same turn names it (${after.length} later line(s))`);
    }

    // ── Signal 5: ask to stop the other task; its row reads cancelled through listTasks.
    const open = filed.filter((task) => task.status !== "completed" && task.status !== "cancelled" && task.status !== "errored");
    if (open.length === 0) {
      const turn = Math.round(((first.completedAtMs ?? 0) - (first.startedAtMs ?? 0)) / 1000);
      return retry(`5: both tasks had finished before the ask to stop (the turn took ${turn}s)`);
    }
    await box.fill(fixture.stop);
    await box.press("Enter");
    let cancelled: any;
    for (let waited = 0; waited < 5 * 60_000 && cancelled === undefined; waited += 3_000) {
      await sleep(3_000);
      cancelled = (await rowsOf(sessionId)).find((task) => open.some((o) => o.id === task.id) && task.status === "cancelled");
    }
    if (cancelled === undefined) failures.push(`5: ${open.map((t) => t.title).join(", ")} never read cancelled through listTasks`);
    else await page.locator('[data-task-status="cancelled"]').first().waitFor({ timeout: 15_000 }).catch(() => failures.push("5: the cancelled row never showed in the pane"));

    // ── Signal 6, the harness leg: a one-line change runs through Claude Code in the project's clone.
    await page.locator('[role="status"]').waitFor({ state: "detached", timeout: 5 * 60_000 }).catch(() => undefined);
    await box.fill(fixture.change.replace("{marker}", marker));
    await box.press("Enter");
    let coding: any;
    for (let waited = 0; waited < 25 * 60_000; waited += 5_000) {
      await sleep(5_000);
      coding = (await rowsOf(sessionId)).find((task) => task.assignee === "desk.coder");
      if (coding !== undefined && ["completed", "errored", "cancelled"].includes(coding.status)) break;
    }
    if (coding === undefined) failures.push("6: no coding task was filed to desk.coder");
    else {
      if (coding.status !== "completed") failures.push(`6: the coding task ended ${coding.status}: ${coding.statusNote ?? ""}`);
      const row = page.locator('aside[aria-label="Background tasks"] [data-task-status]').filter({ hasText: "desk.coder" }).first();
      await row.click();
      const work = page.locator('section[aria-label^="Work:"] [data-entry]');
      await work.first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      const steps = await work.count();
      if (steps === 0) failures.push("6: the coding task's work view shows no harness steps");
      else notes.push(`6: the work view shows ${steps} harness entr${steps === 1 ? "y" : "ies"}`);
    }
    const clones = clonesUnder(join(data, "runs"));
    const committed = clones.filter((clone) => {
      try {
        return execFileSync("git", ["--git-dir", clone, "log", "--all", "-p", "--", "README.md"], { encoding: "utf8" }).includes(`+# ${marker}`);
      } catch {
        return false;
      }
    });
    if (committed.length === 0) failures.push(`6: no branch of the run's clone holds the change (${clones.length} clone(s) under the data folder)`);
    if (git(repo, "rev-parse", "HEAD") !== repoHead || git(repo, "status", "--porcelain") !== "") failures.push("6: the project's own repository changed");
    if (labCheckout() !== labBefore) failures.push("6: the lab's own checkout changed");
    if (errors.length > 0) failures.push(`page errors: ${errors.join(" | ")}`);
    notes.push(`first respond ${first.id}; ${filed.length} tasks; clone ${committed[0] ?? "none"}`);
    return "graded";
  } finally {
    await browser?.close();
    stopProcessGroup(lab.child);
  }
}

await runGoal(async (failures, tell) => {
  if (CONTROL === "planted-glue") {
    const glue = join(LAB, "src", "glue.ts");
    writeFileSync(glue, "export const glue = 1;\n");
    try {
      execFileSync("node", [join(LAB, "scripts", "inventory.mjs"), "--wired"], { cwd: LAB, stdio: "pipe" });
      return { failures, evidence: "the inventory passed with src/glue.ts planted" };
    } catch (error) {
      failures.push(`inventory refused the planted file: ${String((error as { stderr?: Buffer }).stderr ?? error).trim()}`);
      return { failures, evidence: "" };
    } finally {
      rmSync(glue);
    }
  }
  // The pages `--app` serves are the lab's built ones.
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
    // A retried run's grades so far are kept as notes, not failures.
    notes.push(...failures.splice(before).map((failure) => `attempt ${n}: ${failure}`));
  }
  failures.push(`the model never gave a gradable run in ${attempts} attempts: ${notes.join("; ")}`);
  return { failures, evidence: "" };
});
