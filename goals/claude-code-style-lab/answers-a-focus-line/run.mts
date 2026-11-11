/**
 * Goal check: in the Claude Code-style lab's threads mode, the main session
 * answers a line that only sets the focus itself, and starts a thread only for
 * a line that asks for work. On a real model, in a browser, against
 * `fsdev dev --app`.
 *
 * One lab, one project. The focus line goes in first: the lead's board must
 * stay empty, the line must not be marked *Sent to a task*, a short reply must
 * show under it, and the session must get a title of its own. Then an ask for
 * work: a thread for `desk.thread` must be filed. Every signal reads the
 * rendered page or the server's own records (the board's `listTasks`, the
 * session's title); never the adapter or React state.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command). Each plants its change for
 * the run and puts it back:
 *   - `files-everything`: the lead's instructions go back to splitting every
 *     message into threads. Must FAIL signal 1.
 *   - `no-title`: the threads-mode flow runs no title generator. Must FAIL signal 3.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/answers-a-focus-line/run.mts
 */
import { join } from "node:path";
import { ClientHttpError, createClient } from "@flow-state-dev/client";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";
import { goalTmpDir, loadFixture, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { LAB, labCheckout, makeRepository, plant, sleep, startLab, until, type Plant } from "../lab.mts";

const fixture = loadFixture<{ project: string; focus: string; ask: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
const FLOW = "coordinator";
const THREAD = "desk.thread";
const LEAD_FILE = join(LAB, "workforce", "teams", "desk", "workers", "lead", "WORKER.md");
/** The longest reply that still reads as an acknowledgement, not a piece of work. */
const SHORT_REPLY_CHARS = 600;

const PLANTS: Record<string, Plant[]> = {
  // One change, since the two new paragraphs sit together: the lead's opening as it read before.
  "files-everything": [
    {
      file: LEAD_FILE,
      from:
        "A message that asks for nothing to be done gets no thread. When the user sets the focus, gives\n" +
        "background, or says what you'll be working on, answer it yourself in a sentence or two: say what\n" +
        "you've taken in, and that you'll start threads when they ask for work. When you can't tell\n" +
        "whether the user wants work started, ask them in one line instead of starting a thread.\n\n" +
        "A message that asks for work gets threads, however small the work: anything to write, find out,\n" +
        "plan or change is a thread's, never yours to do here. Split it into pieces",
      to: "Split each request into pieces",
    },
  ],
  "no-title": [
    {
      file: join(LAB, "fsdev.config.mts"),
      from: "agent: { model, afterAnswer: titler() }",
      to: "agent: { model }",
    },
  ],
};

/** The main thread as the page draws it: each line's whole entry (its mark sits beside it), and the thread cards. */
async function mainThread(page: import("playwright").Page) {
  return page.evaluate(() => {
    const thread = document.querySelector('main[aria-label="Main thread"]');
    return {
      user: [...(thread?.querySelectorAll('[data-entry="user"]') ?? [])].map((el) => (el.parentElement?.textContent ?? "").trim()),
      replies: [...(thread?.querySelectorAll('[data-entry="assistant"]:not([data-incomplete])') ?? [])].map((el) => (el.textContent ?? "").trim()),
      cards: [...(thread?.querySelectorAll('[data-entry="thread"]') ?? [])].length,
      rows: [...document.querySelectorAll('aside[aria-label="Tasks"] [data-task-id]')].length,
      selectedRow: (document.querySelector('nav[aria-label="Sessions"] button[aria-current="true"]')?.textContent ?? "").trim(),
    };
  });
}

await runGoal(async (failures, tell) => {
  const labBefore = labCheckout();
  const unplant = plant(PLANTS, CONTROL);
  const scratch = goalTmpDir("claude-code-style-focus-line");
  const notes: string[] = [];
  let lab: Awaited<ReturnType<typeof startLab>> | undefined;
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    const repo = makeRepository(join(scratch, "repo"));
    lab = await startLab(join(scratch, "data"), USER, { CLAUDE_CODE_STYLE_REPOSITORIES: repo });
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });
    // The board's task-list view; a board it refuses (none yet) has no rows.
    const rowsOf = async (sessionId: string): Promise<any[]> => {
      try {
        return (await fsd.view(taskListViewRef(FLOW, "tasks"), {}, { sessionId })).value;
      } catch (error) {
        if (error instanceof ClientHttpError && error.status === 422) return [];
        throw error;
      }
    };
    /** Whether a turn of the session is still running. */
    const busy = async (sessionId: string) => (await fsd.sessions.requests(sessionId, { status: "in_progress", limit: 20 })).length > 0;

    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(lab.origin);
    await page.getByRole("tab", { name: "Projects" }).click();
    await page.getByRole("region", { name: "Choose a project" }).waitFor();
    const form = page.getByRole("form", { name: "New project" });
    await form.getByLabel("Project name").fill(fixture.project);
    await form.getByLabel("Repository").fill(`file://${repo}`);
    await form.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.project }).click();
    const box = page.getByRole("textbox", { name: "Message the main session" });
    await box.waitFor();
    const sessionId = (await fsd.sessions.list({ flowKind: FLOW, userId: USER })).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;

    // ── The focus line, and the lead's turn on it to its end.
    await box.fill(fixture.focus);
    await box.press("Enter");
    const replied = await until(async () => ((await mainThread(page)).replies.length > 0 ? true : undefined), 5 * 60_000, 1_000);
    await until(async () => ((await busy(sessionId)) ? undefined : true), 5 * 60_000, 2_000);
    // A thread filed on the turn shows on the board within moments of its end.
    await sleep(5_000);
    const afterFocus = await mainThread(page);
    const filed = await rowsOf(sessionId);
    tell.over("tasks filed on the focus line", filed.map((t) => `${t.assignee}: ${t.title}`), { emptyIs: "signal 1's claim" });

    // ── Signal 1: no thread for a line that asks for nothing.
    const marked = afterFocus.user.some((line) => line.includes("Sent to a task"));
    if (filed.length > 0 || afterFocus.cards > 0 || afterFocus.rows > 0 || marked) {
      failures.push(
        `1: the focus line started work: ${filed.length} task(s) on the board (${filed.map((t) => `${t.assignee} "${t.title}"`).join("; ")}), ` +
          `${afterFocus.cards} thread card(s), ${afterFocus.rows} board row(s), line ${marked ? "" : "not "}marked Sent to a task`,
      );
    } else notes.push("1: no task, no card, no row");

    // ── Signal 2: a short reply of the lead's own under it.
    const reply = tell.over("the reply to the focus line", afterFocus.replies)[0] ?? "";
    if (replied === undefined || reply === "") failures.push("2: no reply showed under the focus line");
    else if (reply.length > SHORT_REPLY_CHARS) failures.push(`2: the reply is ${reply.length} characters, a piece of work rather than an answer: ${JSON.stringify(reply.slice(0, 160))}`);
    else notes.push(`2: replied ${JSON.stringify(reply.slice(0, 120))}`);

    // ── Signal 3: the session is titled, and its row shows the title (not the line's first 60 characters).
    const titled = await until(async () => {
      const title = (await fsd.sessions.get(sessionId)).title?.trim() ?? "";
      return title !== "" ? title : undefined;
    }, 90_000, 2_000);
    if (titled === undefined) failures.push("3: the session got no title of its own");
    else {
      const shows = await until(async () => ((await mainThread(page)).selectedRow.includes(titled.value) ? true : undefined), 30_000, 1_000);
      if (shows === undefined) failures.push(`3: the session is titled ${JSON.stringify(titled.value)}, but its row reads ${JSON.stringify((await mainThread(page)).selectedRow)}`);
      else notes.push(`3: titled ${JSON.stringify(titled.value)}`);
    }

    // ── Signal 4: an ask for work still starts a thread.
    await box.fill(fixture.ask);
    await box.press("Enter");
    const thread = await until(async () => (await rowsOf(sessionId)).find((t) => t.assignee === THREAD), 5 * 60_000, 3_000);
    if (thread === undefined) failures.push(`4: the ask for work started no thread for ${THREAD}`);
    else notes.push(`4: filed "${thread.value.title}" for ${THREAD}`);

    if (errors.length > 0) failures.push(`page errors: ${errors.join(" | ")}`);
    return { failures, evidence: notes.join("; ") };
  } finally {
    await browser?.close();
    if (lab !== undefined) stopProcessGroup(lab.child);
    unplant();
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
  }
});
