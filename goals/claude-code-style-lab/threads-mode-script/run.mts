/**
 * Goal check: the Claude Code-style lab's threads mode, end to end, on a real
 * model, in a browser, against `fsdev dev --app`.
 *
 * It starts the lab from its own config on a durable store, makes a `file://`
 * project repository, and drives the Projects view the way a person does: New
 * project, pick it, ask for three pieces of research, answer the thread that
 * asks, resolve the one ready for review, then ask for a code change and
 * resolve its review. Each signal is graded from the rendered page and from
 * the board's own records (`listTasks_tasks`, `getTask_tasks`, the project
 * repository's worktrees and branches), never from the adapter or the lab's React state. Answers and
 * reviews are typed and clicked, never sent through a package call.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command). Each plants a change for the
 * run and puts it back after:
 *   - `no-delegates`: the lead's `WORKER.md` with no delegates. Must FAIL signal 2.
 *   - `ongoing`: the lead told to file each thread with `session: "ongoing"`. Must FAIL signal 2.
 *   - `no-review`: the thread worker's `WORKER.md` without its review line. Must FAIL signal 4.
 *   - `no-project`: a lead session made with no project. Must FAIL signal 6, with the
 *     composer closed and no run anywhere.
 *   - `no-mapping`: the lab started with no repository to cut worktrees from, so the run
 *     works in a clone. Must FAIL signal 6's worktree check.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/threads-mode-script/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import type { Page } from "playwright";
import { goalAttempts, goalTmpDir, loadFixture, REPO_ROOT, runGoal, RUN_STAMP, stopProcessGroup, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { clonesUnder, git, LAB, labCheckout, makeRepository, sleep, startLab } from "../lab.mts";

const fixture = loadFixture<{ project: string; ask: string; answer: string; change: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
const LEAD = "desk.lead";
const THREAD = "desk.thread";
const CODER = "desk.thread-coder";
const WORKERS = join(LAB, "workforce", "teams", "desk", "workers");

/** What a control changes in a worker file for its run: the text it replaces, and with what. */
const PLANTS: Record<string, { file: string; from: string; to: string }> = {
  "no-delegates": { file: "lead/WORKER.md", from: `delegates: [${THREAD}, ${CODER}]`, to: "delegates: []" },
  ongoing: {
    file: "lead/WORKER.md",
    from: "leave session and resultTo out, so each piece runs in a new session of\nits own",
    to: 'give session: "ongoing" and leave resultTo out, so every piece runs in the\ndelegate\'s one ongoing session',
  },
  "no-review": {
    file: "thread/WORKER.md",
    from: 'When the work is ready, call waitForUser({ kind: "review", prompt })',
    to: "When the work is ready, finish with it as your answer. Never call waitForUser",
  },
};

/** A thread card or a board row as the page shows it. */
type Shown = { taskId: string; column: string; text: string };
type Snapshot = { at: number; user: string[]; cards: Shown[]; rows: Shown[]; header: string };

async function snapshot(page: Page): Promise<Snapshot> {
  return {
    at: Date.now(),
    ...(await page.evaluate(() => {
      // No named helper in here: the bundler would wrap it in a `__name` call the page doesn't have.
      const thread = document.querySelector('main[aria-label="Main thread"]');
      return {
        // A line's mark (*Sent to a thread*) sits beside it, so its whole entry is read.
        user: [...(thread?.querySelectorAll('[data-entry="user"]') ?? [])].map((el) => (el.parentElement?.textContent ?? "").trim()),
        cards: [...(thread?.querySelectorAll('[data-entry="thread"]') ?? [])].map((el) => ({
          taskId: el.getAttribute("data-task-id") ?? "",
          column: el.getAttribute("data-column") ?? "",
          text: (el.textContent ?? "").trim(),
        })),
        rows: [...document.querySelectorAll('aside[aria-label="Threads"] [data-task-id]')].map((el) => ({
          taskId: el.getAttribute("data-task-id") ?? "",
          column: el.closest("section[data-column]")?.getAttribute("data-column") ?? "",
          text: (el.textContent ?? "").trim(),
        })),
        header: (thread?.querySelector("header")?.textContent ?? "").trim(),
      };
    })),
  };
}

/** Plant a control's change, and hand back what puts the file back. */
function plant(control: string): () => void {
  const change = PLANTS[control];
  if (change === undefined) return () => undefined;
  const path = join(WORKERS, change.file);
  const before = readFileSync(path, "utf8");
  if (!before.includes(change.from)) throw new Error(`setup: ${change.file} no longer holds the text the ${control} control replaces`);
  writeFileSync(path, before.replace(change.from, change.to));
  return () => writeFileSync(path, before);
}

const OPEN = new Set(["pending", "in_progress", "held"]);

/** One attempt: a fresh lab, a fresh project, the six steps. */
async function attempt(n: number, failures: string[], notes: string[], tell: Tell): Promise<"retry" | "graded"> {
  const scratch = goalTmpDir(`claude-code-style-threads-${n}`);
  const before = failures.length;
  // A retry is for a model that gave nothing to grade, never a way past a signal that already failed.
  const retry = (why: string): "retry" | "graded" => {
    if (failures.length > before || CONTROL !== "") {
      failures.push(`${why}, so the later signals went ungraded`);
      return "graded";
    }
    notes.push(`${why}; retrying`);
    return "retry";
  };
  const data = join(scratch, "data");
  const repo = makeRepository(join(scratch, "repo"), { "CHANGELOG.md": "# Changelog\n\n- Started the status page project.\n" });
  const repoHead = git(repo, "rev-parse", "HEAD");
  const labBefore = labCheckout();
  const marker = `Picked a status page vendor (${RUN_STAMP})`;
  // The lab cuts worktrees from the project's repository; `no-mapping` names none, so it clones.
  const lab = await startLab(data, USER, { CLAUDE_CODE_STYLE_REPOSITORIES: CONTROL === "no-mapping" ? "" : repo });
  /** The project repository's worktrees other than its own, by their real paths. */
  const worktrees = () =>
    git(repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((path) => path !== realpathSync(repo));
  const fsd = createClient({ userId: USER, baseUrl: lab.origin });
  /** Run one board action in the lead's session, as the person, and hand back its output. */
  const board = async (sessionId: string, action: string, input: unknown): Promise<any> => {
    const sent = await fsd.flow("coordinator").send(action, input, { sessionId });
    await sent.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 20 })).find((r) => r.id === sent.id);
    return found?.result?.output;
  };
  const rowsOf = async (sessionId: string): Promise<any[]> => ((await board(sessionId, "listTasks_tasks", {}))?.tasks ?? []) as any[];
  const taskOf = async (sessionId: string, id: string): Promise<any> => (await board(sessionId, "getTask_tasks", { id }))?.task;
  /** Wait until `check` answers, polling every `everyMs`, or give up at `forMs`. */
  const until = async <T,>(check: () => Promise<T | undefined>, forMs: number, everyMs = 3_000): Promise<T | undefined> => {
    for (let waited = 0; waited < forMs; waited += everyMs) {
      const found = await check();
      if (found !== undefined) return found;
      await sleep(everyMs);
    }
    return undefined;
  };

  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(lab.origin);
    await page.getByRole("tab", { name: "Projects" }).click();
    await page.getByRole("region", { name: "Choose a project" }).waitFor();
    const box = page.getByRole("textbox", { name: "Message the main session" });
    /** The open thread's view, in place of the board. */
    const threadView = () => page.locator('aside[aria-label^="Thread: "]');
    const back = () => page.getByRole("button", { name: "Back to threads" }).click().catch(() => undefined);
    const rowFor = (taskId: string) => page.locator(`aside[aria-label="Threads"] [data-task-id="${taskId}"]`);
    const cardFor = (taskId: string) => page.locator(`main[aria-label="Main thread"] [data-entry="thread"][data-task-id="${taskId}"]`);
    /** The column a task's board row is under now, opening a collapsed group to look. */
    const columnOf = async (taskId: string): Promise<string | undefined> => {
      for (const shut of await page.locator('aside[aria-label="Threads"] button[aria-expanded="false"]').all()) await shut.click();
      return (await snapshot(page)).rows.find((row) => row.taskId === taskId)?.column;
    };

    // ── Setup: New session in the Projects view asks for a project, and the header names it.
    let sessionId: string;
    if (CONTROL === "no-project") {
      sessionId = (await fsd.flow("coordinator").createSession({ state: { workerId: LEAD } })).id;
      await page.reload();
      await page.getByRole("tab", { name: "Projects" }).click();
      await page.getByRole("navigation", { name: "Sessions" }).locator("li button").first().click({ timeout: 30_000 });
      const composer = await box.count();
      const note = await page.getByRole("note").filter({ hasText: "Choose a project" }).count();
      if (composer !== 0 || note !== 1) failures.push(`no-project: the composer is ${composer === 0 ? "closed" : "open"} and the ask shows ${note} time(s)`);
      // Ask for the change straight at the door: nothing may run anywhere.
      await (await fsd.flow("coordinator").send("respond", { message: fixture.change.replace("{marker}", marker) }, { sessionId })).wait();
      await sleep(90_000);
      const clones = clonesUnder(join(data, "runs"));
      const coding = (await rowsOf(sessionId)).filter((task) => task.assignee === CODER);
      if (clones.length === 0 && worktrees().length === 0) failures.push(`6: no coding run made a checkout (${coding.length} coding task(s), ${coding.map((t) => `${t.status}: ${t.statusNote ?? ""}`).join("; ")})`);
      else failures.push(`6: a run made a checkout (${[...clones, ...worktrees()].join(", ")}) for a session with no project`);
      if (labCheckout() !== labBefore) failures.push("6: the lab's own checkout changed");
      return "graded";
    }
    const form = page.getByRole("form", { name: "New project" });
    await form.getByLabel("Project name").fill(fixture.project);
    await form.getByLabel("Repository").fill(`file://${repo}`);
    await form.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.project }).click();
    await box.waitFor();
    sessionId = (await fsd.sessions.list({ flowKind: "coordinator", userId: USER })).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;
    const header = (await snapshot(page)).header;
    if (!header.includes(`in project: ${fixture.project}`)) failures.push(`setup: the header reads ${JSON.stringify(header)}, not the project picked`);

    // ── Signal 1: your line shows, marked *Sent to a thread*.
    await box.fill(fixture.ask);
    await box.press("Enter");
    // ── Signal 2: three cards and three rows; on the board, three tasks running side by side.
    const timeline: Snapshot[] = [];
    let together: any[] | undefined;
    let filed: any[] = [];
    for (let waited = 0; waited < 6 * 60_000 && together === undefined; waited += 2_000) {
      await sleep(2_000);
      const now = await snapshot(page);
      timeline.push(now);
      filed = (await rowsOf(sessionId)).filter((task) => task.assignee === THREAD);
      const sessions = new Set(filed.map((task) => task.run?.sessionId).filter(Boolean));
      // Side by side: three open at once, none waiting in line, each in a run session of its own.
      if (filed.length >= 3 && filed.every((task) => OPEN.has(task.status) && task.status !== "pending") && sessions.size === filed.length) together = filed;
    }
    tell.over("page polls while the threads start", timeline);
    const last = await snapshot(page);
    const mine = last.user.find((text) => text.includes(fixture.ask.slice(0, 40)));
    if (mine === undefined) failures.push("1: your line never showed in the thread");
    else if (!mine.includes("Sent to a thread")) failures.push("1: your line isn't marked Sent to a thread");
    if (filed.length === 0) return retry("2: the lead filed no thread");
    if (together === undefined) {
      const states = filed.map((task) => `${task.title ?? task.goal}: ${task.status}, run ${task.run?.sessionId ?? "none"}`).join("; ");
      failures.push(`2: three threads never ran side by side, each in its own session (${filed.length} filed: ${states})`);
      return "graded";
    }
    // The page reads the board on its own clock: give it a little while to draw what the board holds.
    const drawn = (await until(async () => {
      const now = await snapshot(page);
      const cards = now.cards.filter((card) => together!.some((task) => task.id === card.taskId));
      const rows = now.rows.filter((row) => together!.some((task) => task.id === row.taskId));
      return cards.length >= 3 && rows.length >= 3 ? { cards, rows } : undefined;
    }, 30_000, 2_000)) ?? { cards: last.cards, rows: last.rows };
    const shownCards = drawn.cards.filter((card) => together!.some((task) => task.id === card.taskId));
    const shownRows = drawn.rows.filter((row) => together!.some((task) => task.id === row.taskId));
    if (shownCards.length < 3) failures.push(`2: ${shownCards.length} thread card(s) show for the ${together.length} threads`);
    if (shownRows.length < 3) failures.push(`2: ${shownRows.length} board row(s) show for the ${together.length} threads`);

    // ── Signal 3: a row waits on you with its question; you answer it in its thread.
    const asking = await until(async () => {
      for (const task of await rowsOf(sessionId)) {
        if (task.assignee !== THREAD) continue;
        const hold = (task.questions ?? []).find((h: any) => h.ask?.kind === "question");
        if (hold !== undefined && (await columnOf(task.id)) === "waiting") return { task, hold };
      }
      return undefined;
    }, 5 * 60_000);
    if (asking === undefined) return retry("3: no thread asked you a question");
    const { task: asked, hold: question } = asking;
    await rowFor(asked.id).click();
    const say = threadView().getByRole("textbox", { name: "Message this thread" });
    await say.fill(fixture.answer);
    await threadView().getByRole("button", { name: "Answer", exact: true }).click();
    const answered = await until(async () => {
      const read = await taskOf(sessionId, asked.id);
      const open = (read?.questions ?? []).some((h: any) => h.id === question.id);
      return !open && read.attempts === asked.attempts ? read : undefined;
    }, 2 * 60_000);
    if (answered === undefined) failures.push(`3: the question on "${asked.title}" was never answered on its attempt`);
    else {
      const steer = (answered.steers ?? []).find((s: any) => s.answers === question.id);
      if (answered.steers !== undefined && steer === undefined) failures.push("3: no steer on the task answers its question");
      else if (steer !== undefined && !String(steer.message ?? "").includes(fixture.answer.slice(0, 20))) failures.push("3: the steer that answers it doesn't carry your words");
    }
    await back();
    const moved = await until(async () => {
      const column = await columnOf(asked.id);
      return column !== undefined && column !== "waiting" ? column : undefined;
    }, 60_000, 2_000);
    if (moved === undefined) failures.push(`3: "${asked.title}" stayed under Waiting on you after your answer`);

    // ── Signal 4: that thread becomes ready for review; the board holds it on a review.
    const ready = await until(async () => {
      const read = await taskOf(sessionId, asked.id);
      if (read === undefined || !OPEN.has(read.status)) return read?.status === undefined ? undefined : { ended: read };
      const review = (read.questions ?? []).find((h: any) => h.ask?.kind === "review");
      return review !== undefined && (await columnOf(asked.id)) === "review" ? { review } : undefined;
    }, 8 * 60_000);
    if (ready === undefined || "ended" in ready) {
      failures.push(`4: "${asked.title}" never waited on your review${ready !== undefined && "ended" in ready ? ` (it ended ${ready.ended.status})` : ""}`);
      return "graded";
    }

    // ── Signal 5: Resolve on its card moves it under Resolved, and the task completes.
    await cardFor(asked.id).getByRole("button", { name: "Resolve" }).click();
    const completed = await until(async () => ((await taskOf(sessionId, asked.id))?.status === "completed" ? true : undefined), 3 * 60_000);
    if (completed === undefined) failures.push(`5: "${asked.title}" never read completed after Resolve`);
    const resolvedColumn = await until(async () => ((await columnOf(asked.id)) === "resolved" ? true : undefined), 30_000, 2_000);
    if (resolvedColumn === undefined) failures.push(`5: "${asked.title}" never showed under Resolved`);

    // ── Signal 6: a code change runs through Claude Code in a worktree of the project's repository, waits for review, and resolves.
    await box.fill(fixture.change.replace("{marker}", marker));
    await box.press("Enter");
    const coding = await until(async () => (await rowsOf(sessionId)).find((task) => task.assignee === CODER), 5 * 60_000);
    if (coding === undefined) {
      failures.push(`6: no coding thread was filed to ${CODER}`);
      return "graded";
    }
    const tagged = await until(async () => {
      const now = await snapshot(page);
      const card = now.cards.find((c) => c.taskId === coding.id);
      const row = now.rows.find((r) => r.taskId === coding.id);
      return card?.text.includes("Claude Code") && row?.text.includes("Claude Code") ? true : undefined;
    }, 3 * 60_000, 2_000);
    if (tagged === undefined) failures.push("6: the coding thread's card and row aren't both tagged Claude Code");
    // A run may ask first; it is answered in its thread, as a person does.
    let review: any;
    let reviewEnd: any;
    for (let waited = 0; waited < 25 * 60_000 && review === undefined && reviewEnd === undefined; waited += 5_000) {
      await sleep(5_000);
      const read = await taskOf(sessionId, coding.id);
      if (read === undefined) continue;
      if (!OPEN.has(read.status)) reviewEnd = read;
      review = (read.questions ?? []).find((h: any) => h.ask?.kind === "review");
      const asks = (read.questions ?? []).find((h: any) => h.ask?.kind === "question");
      if (asks !== undefined && review === undefined) {
        notes.push(`6: the run asked "${String(asks.ask.prompt).slice(0, 80)}"`);
        await rowFor(coding.id).click();
        await say.fill("Go ahead as you think best.");
        await threadView().getByRole("button", { name: "Answer", exact: true }).click();
        await back();
      }
    }
    if (review === undefined) {
      failures.push(`6: the coding thread never waited on your review (${reviewEnd === undefined ? "still open" : `${reviewEnd.status}: ${reviewEnd.statusNote ?? ""}`})`);
    } else {
      // The page reads the board every 2s, so it shows the wait a moment after the board holds it.
      const shown = await until(async () => ((await columnOf(coding.id)) === "review" ? true : undefined), 30_000, 2_000);
      if (shown === undefined) failures.push("6: the coding thread's row isn't under Ready for review");
      const card = (await snapshot(page)).cards.find((c) => c.taskId === coding.id);
      if (!/judge/i.test(card?.text ?? "")) failures.push(`6: the card doesn't show the judge's verdict: ${JSON.stringify(card?.text ?? "")}`);
      // What the run spent, read off the board's row: its model and a token count, never a 0 or a lab sum.
      const spend = ((await board(sessionId, "listTasks_tasks", {}))?.tasks ?? []).find((t: any) => t.id === coding.id)?.spend;
      if (spend?.harness !== "claude-code" || !spend.model) failures.push(`6: the board's row doesn't carry the run's harness and model: ${JSON.stringify(spend ?? null)}`);
      else if (!card?.text.includes(spend.model) || !/\d(\.\d)?[kM]? tokens/.test(card.text)) failures.push(`6: the card doesn't show the run's model and tokens: ${JSON.stringify(card?.text ?? "")}`);
      else notes.push(`6: the card shows ${spend.model}, ${(spend.inputTokens ?? 0) + (spend.outputTokens ?? 0)} tokens on the row`);
      await cardFor(coding.id).getByRole("button", { name: "Resolve" }).click();
      const done = await until(async () => {
        const read = await taskOf(sessionId, coding.id);
        return read !== undefined && !OPEN.has(read.status) ? read : undefined;
      }, 5 * 60_000);
      if (done?.status !== "completed") failures.push(`6: after Resolve the coding thread reads ${done?.status ?? "still open"}`);
      else if (done.output?.review !== "accepted") failures.push(`6: the coding thread completed with review ${JSON.stringify(done.output?.review)}, not accepted`);
      if ((await until(async () => ((await columnOf(coding.id)) === "resolved" ? true : undefined), 30_000, 2_000)) === undefined) {
        failures.push("6: the coding thread never showed under Resolved");
      }
    }
    // Where it worked: a worktree of the project's repository under the lab's data folder, its branch in
    // the repository, and the repository's own checked-out branch and files untouched.
    const runs = realpathSync(join(data, "runs"));
    const placed = worktrees().filter((path) => path.startsWith(runs + "/"));
    const committed = placed.filter((path) => git(path, "log", "-p", "--", "CHANGELOG.md").includes(marker));
    if (placed.length === 0) failures.push(`6: the run didn't work in a worktree of the project's repository (${clonesUnder(runs).length} clone(s) under the data folder)`);
    else if (committed.length === 0) failures.push(`6: no run worktree's branch holds the CHANGELOG line (${placed.join(", ")})`);
    else if (!git(repo, "log", "--all", "-p", "--", "CHANGELOG.md").includes(marker)) failures.push("6: the run's branch isn't in the project's repository");
    if (committed.some((path) => path.startsWith(LAB) || path.startsWith(REPO_ROOT + "/labs"))) failures.push("6: the run worked inside the lab's checkout");
    if (git(repo, "rev-parse", "HEAD") !== repoHead || git(repo, "status", "--porcelain") !== "") failures.push("6: the project's checked-out branch or files changed");
    if (labCheckout() !== labBefore) failures.push("6: the lab's own checkout changed");
    if (errors.length > 0) failures.push(`page errors: ${errors.join(" | ")}`);
    notes.push(`${together.length} threads side by side; answered "${asked.title}"; coding thread ${coding.id}; worktree ${committed[0] ?? "none"}`);
    return "graded";
  } finally {
    await browser?.close();
    stopProcessGroup(lab.child);
  }
}

await runGoal(async (failures, tell) => {
  // The pages `--app` serves are the lab's built ones.
  execFileSync("pnpm", ["--filter", "@flow-state-dev/claude-code-style", "build"], { cwd: REPO_ROOT, stdio: "ignore" });
  const unplant = plant(CONTROL);
  try {
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
  }
});
