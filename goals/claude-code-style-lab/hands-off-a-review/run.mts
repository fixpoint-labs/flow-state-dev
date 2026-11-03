/**
 * Goal check: the Claude Code-style lab hands a review to a thread with what
 * it needs, the thread starts on it without asking about a region, and the
 * finished thread comes back to the main thread as one collapsed line the
 * lead doesn't repeat. Real model, in a browser, against `fsdev dev --app`.
 *
 * It starts the lab from its own config on a durable store, makes a project,
 * and in the Projects view asks the lead to review a pull request. It grades
 * the thread goals the board filed, the questions the threads held, the
 * result lines in the main thread, the task views' tool lines, and what the
 * lead wrote after the results came back. Reviews are resolved by clicking
 * *Resolve*; a question that isn't about a region is answered in the thread's
 * view, as a person would.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command). Each plants a change in a
 * worker file for the run and puts it back after:
 *   - `region-line`: the thread worker told to ask which region matters before it starts. Must FAIL 2.
 *   - `thin-handoff`: the lead told to give each thread a goal of five words or fewer. Must FAIL 1.
 *   - `restate`: the lead told to restate each thread's result in full. Must FAIL 5.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/hands-off-a-review/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { goalAttempts, goalTmpDir, loadFixture, REPO_ROOT, runGoal, stopProcessGroup, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { LAB, makeRepository, sleep, startLab } from "../lab.mts";

const fixture = loadFixture<{ project: string; ask: string; ids: string[]; detail: string; done: string; goAhead: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
const THREAD = "desk.thread";
const WORKERS = join(LAB, "workforce", "teams", "desk", "workers");
const OPEN = new Set(["pending", "in_progress", "held"]);
/** A run this many words long, written again, counts as repeated. */
const RUN_WORDS = 8;
/**
 * The most of a thread's reply the lead may write again after it. A takeaway that quotes one
 * finding stays under it; the whole reply written out again, as the lab did, is near all of it.
 */
const MOST_REPEATED = 0.3;
/** The most the lead may write after one result, in characters: a sentence or two, never the findings again. */
const LONGEST_ANSWER = 300;

/**
 * What a control changes in a worker file for its run: the text it replaces, and with what. Each
 * replaces the line this change added with its opposite, so the check sees the lab without it.
 */
const PLANTS: Record<string, { file: string; from: string; to: string }> = {
  "region-line": { file: "thread/WORKER.md", from: "and start on it at once.", to: "and before you start, ask which region matters (holdTaskForUser)." },
  "thin-handoff": {
    file: "lead/WORKER.md",
    from: "A thread sees only its goal, so write each goal so it can be done with nothing else",
    to: "Give each thread a goal of five words or fewer, and nothing else",
  },
  restate: {
    file: "lead/WORKER.md",
    from: "So your answer to a result is one short sentence, never a list: what happens next, or the one\nthing you need from the user. Don't list, quote, paraphrase or summarize what the thread found, not\neven its main points.",
    to: "Restate the whole result for the user, word for word.",
  },
};

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

/** A text's words, lower case, for comparing what was written twice. */
const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** How much of `source`, as a share of its words, `text` holds again in runs of `RUN_WORDS` words or more. */
function repeatedShare(source: string, text: string): number {
  const words = wordsOf(source);
  const haystack = ` ${wordsOf(text).join(" ")} `;
  const covered = new Set<number>();
  for (let i = 0; i + RUN_WORDS <= words.length; i += 1) {
    if (haystack.includes(` ${words.slice(i, i + RUN_WORDS).join(" ")} `)) for (let k = i; k < i + RUN_WORDS; k += 1) covered.add(k);
  }
  return words.length === 0 ? 0 : covered.size / words.length;
}

/** One attempt: a fresh lab and project, the ask, its threads to the end, and the lead's words after. */
async function attempt(n: number, failures: string[], notes: string[], tell: Tell): Promise<"retry" | "graded"> {
  const scratch = goalTmpDir(`claude-code-style-review-${n}`);
  const repo = makeRepository(join(scratch, "repo"));
  const lab = await startLab(join(scratch, "data"), USER, { CLAUDE_CODE_STYLE_REPOSITORIES: repo });
  const fsd = createClient({ userId: USER, baseUrl: lab.origin });
  const board = async (sessionId: string, action: string, input: unknown): Promise<any> => {
    const sent = await fsd.flow("coordinator").send(action, input, { sessionId });
    await sent.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 20 })).find((r) => r.id === sent.id);
    return found?.result?.output;
  };
  const rowsOf = async (sessionId: string): Promise<any[]> => (((await board(sessionId, "listTasks_tasks", {}))?.tasks ?? []) as any[]).filter((t) => t.assignee === THREAD);

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
    const form = page.getByRole("form", { name: "New project" });
    await form.getByLabel("Project name").fill(fixture.project);
    await form.getByLabel("Repository").fill(`file://${repo}`);
    await form.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.project }).click();
    const box = page.getByRole("textbox", { name: "Message the main session" });
    await box.waitFor();
    const sessionId = (await fsd.sessions.list({ flowKind: "coordinator", userId: USER })).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;
    const main = page.locator('main[aria-label="Main thread"]');
    const cardFor = (taskId: string) => main.locator(`[data-entry="thread"][data-task-id="${taskId}"]`);
    const threadView = () => page.locator('aside[aria-label^="Task: "]');
    const back = () => page.getByRole("button", { name: "Back to tasks" }).click().catch(() => undefined);

    await box.fill(fixture.ask);
    await box.press("Enter");

    // ── Signal 1: each thread the lead filed carries the ask's ids; together they carry what it is and what done means.
    let filed: any[] = [];
    for (let waited = 0; waited < 5 * 60_000 && filed.length === 0; waited += 3_000) {
      await sleep(3_000);
      filed = await rowsOf(sessionId);
    }
    if (filed.length === 0) {
      if (CONTROL !== "") failures.push("1: the lead filed no thread");
      else notes.push(`attempt ${n}: the lead filed no thread; retrying`);
      return CONTROL !== "" ? "graded" : "retry";
    }
    // Let the turn finish filing before the goals are read.
    await main.locator('[role="status"]').waitFor({ state: "detached", timeout: 5 * 60_000 }).catch(() => undefined);
    filed = tell.over("1 · threads filed for the ask", await rowsOf(sessionId));
    for (const task of filed) {
      const missing = fixture.ids.filter((id) => !String(task.goal).includes(id));
      if (missing.length > 0) failures.push(`1: "${task.title ?? task.goal}"'s goal doesn't carry ${missing.join(", ")}: ${JSON.stringify(task.goal)}`);
    }
    const goals = filed.map((task) => String(task.goal)).join("\n");
    if (!goals.includes(fixture.detail)) failures.push(`1: no thread's goal says what the change does (${fixture.detail})`);
    if (!goals.toLowerCase().includes(fixture.done)) failures.push(`1: no thread's goal says what done means (${fixture.done})`);

    // ── Signals 2 and 3: no thread asks about a region; each waits on your review, and Resolve completes it.
    const asked: string[] = [];
    const resolved = new Set<string>();
    for (let waited = 0; waited < 15 * 60_000 && resolved.size < filed.length; waited += 4_000) {
      await sleep(4_000);
      for (const task of await rowsOf(sessionId)) {
        if (!filed.some((f) => f.id === task.id) || resolved.has(task.id)) continue;
        if (!OPEN.has(task.status)) {
          resolved.add(task.id);
          if (task.status !== "completed") failures.push(`3: "${task.title ?? task.goal}" ended ${task.status}: ${task.statusNote ?? ""}`);
          continue;
        }
        const question = (task.holds ?? []).find((h: any) => h.ask?.kind === "question");
        if (question !== undefined && !asked.includes(question.id)) {
          asked.push(question.id);
          const prompt = String(question.ask.prompt ?? "");
          if (/region/i.test(prompt)) failures.push(`2: "${task.title ?? task.goal}" asked about a region: ${JSON.stringify(prompt)}`);
          else notes.push(`"${task.title ?? task.goal}" asked ${JSON.stringify(prompt.slice(0, 100))}`);
          await cardFor(task.id).getByRole("button", { name: "Answer" }).click();
          await threadView().getByRole("textbox", { name: "Message this task" }).fill(fixture.goAhead);
          await threadView().getByRole("button", { name: "Answer", exact: true }).click();
          await back();
          continue;
        }
        if ((task.holds ?? []).some((h: any) => h.ask?.kind === "review")) {
          const resolve = cardFor(task.id).getByRole("button", { name: "Resolve" });
          if ((await resolve.count()) > 0) await resolve.click();
        }
      }
    }
    if (resolved.size < filed.length) {
      failures.push(`3: ${filed.length - resolved.size} of ${filed.length} thread(s) never finished after review`);
      return "graded";
    }

    // The lead takes each result in a turn of its own: wait for them all to end.
    for (let waited = 0; waited < 5 * 60_000; waited += 3_000) {
      const settles = (await fsd.sessions.requests(sessionId, { limit: 50 })).filter((r) => r.actionName === "onTaskSettled");
      if (settles.length >= filed.length && settles.every((r) => r.completedAtMs != null)) break;
      await sleep(3_000);
    }
    await main.locator('[role="status"]').waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
    await sleep(4_000);

    // ── Signal 4: each result is one collapsed line that opens to the thread's reply.
    const replies: string[] = [];
    // A thread filed with `resultTo: "conversation"` lands its answer as written, which names no task: its line has no task id.
    let landed = 0;
    for (const task of filed) {
      const routed = String(task.id).startsWith("routed:");
      if (routed) notes.push(`"${task.title ?? task.goal}" answered into the conversation`);
      const line = routed
        ? main.locator('section[data-entry="result"][data-task-id=""]').nth(landed++)
        : main.locator(`section[data-entry="result"][data-task-id="${task.id}"]`).last();
      if ((await line.count()) === 0) {
        failures.push(`4: no result line for "${task.title ?? task.goal}" in the main thread`);
        continue;
      }
      const button = line.getByRole("button");
      const shut = await line.textContent();
      if ((await button.getAttribute("aria-expanded")) !== "false") failures.push(`4: "${task.title ?? task.goal}"'s result line isn't collapsed`);
      await button.click();
      const opened = (await line.textContent()) ?? "";
      const reply = opened.slice((shut ?? "").length).trim();
      if (reply.length === 0) failures.push(`4: "${task.title ?? task.goal}"'s result line opens to nothing`);
      else if ((shut ?? "").includes(reply.slice(0, 40))) failures.push(`4: "${task.title ?? task.goal}"'s collapsed line already shows its reply`);
      replies.push(reply);
      await button.click();
    }
    tell.over("4 · result replies read from opened lines", replies);
    // A task's work view says what happened in words: no tool names, task ids or null.
    const toolLines: string[] = [];
    for (const task of filed) {
      await cardFor(task.id).getByRole("button", { name: "View task" }).click();
      await threadView().waitFor();
      await sleep(2_500);
      toolLines.push(...(await threadView().locator('[data-entry="tool"]').allTextContents()));
      await back();
    }
    tell.over("4 · tool lines in the task views", toolLines);
    const raw = toolLines.filter((text) => /\b[a-z]+[A-Z]\w*\b|task_|\bnull\b/.test(text));
    if (raw.length > 0) failures.push(`4: task views show raw tool lines: ${raw.slice(0, 3).join(" | ")}`);

    // ── Signal 5: what the lead wrote after the results doesn't write a result out again.
    const { after, listItems } = await page.evaluate(() => {
      const found = [...document.querySelectorAll('main[aria-label="Main thread"] [data-entry]')];
      const first = found.findIndex((el) => el.getAttribute("data-entry") === "result");
      const said = first < 0 ? [] : found.slice(first + 1).filter((el) => el.getAttribute("data-entry") === "assistant");
      // The lead's Markdown is drawn: a list it wrote is list items on the page.
      return { after: said.map((el) => el.textContent ?? ""), listItems: said.reduce((n, el) => n + el.querySelectorAll("li").length, 0) };
    });
    // Only a result the lead takes in a turn of its own can be written out again; an answer that landed as written can't.
    const taken = filed.filter((task) => !String(task.id).startsWith("routed:"));
    if (taken.length === 0) {
      // Signal 5 had nothing to grade: try a fresh run, keeping what this one failed.
      notes.push(`attempt ${n}: every thread answered into the conversation, so no result reached the lead; retrying`);
      return "retry";
    }
    tell.over("5 · threads whose result the lead took in a turn", taken);
    tell.over("5 · the lead's words after the results", after, { emptyIs: "the claim: the lead adds nothing the result line already holds" });
    for (const reply of replies) {
      const share = repeatedShare(reply, after.join("\n"));
      notes.push(`5: the lead wrote ${Math.round(share * 100)}% of a reply again`);
      if (share > MOST_REPEATED) failures.push(`5: the lead wrote ${Math.round(share * 100)}% of a thread's reply out again`);
    }
    // Paraphrase counts too: the answer to a result is a short sentence, never a list of what it found.
    const said = after.join("\n");
    if (listItems > 0) failures.push(`5: the lead listed the result again, in ${listItems} list item(s)`);
    else if (said.length > LONGEST_ANSWER * taken.length) failures.push(`5: the lead wrote ${said.length} characters after ${taken.length} result(s), more than a short answer`);
    if (errors.length > 0) failures.push(`page errors: ${errors.join(" | ")}`);
    notes.push(`${filed.length} thread(s): ${filed.map((t) => JSON.stringify(t.goal).slice(0, 160)).join(" / ")}; lead after: ${after.join(" ").length} chars`);
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
      if ((await attempt(n, failures, notes, tell)) === "graded") {
        // A failing run prints its notes too: they are what a reader needs to see why.
        if (failures.length > 0) console.error(`notes: ${notes.join("; ")}`);
        return { failures, evidence: `attempt ${n} of ${attempts}: ${notes.join("; ")}` };
      }
    }
    failures.push(`the model never gave a gradable run in ${attempts} attempts: ${notes.join("; ")}`);
    return { failures, evidence: "" };
  } finally {
    unplant();
  }
});
