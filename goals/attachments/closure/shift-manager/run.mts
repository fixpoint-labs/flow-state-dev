/**
 * The closure's legs in Shift Manager (FIX-2565), over the DevTeam Lab:
 *
 * - the Shift Coordinator's conversation (a generator worker), legs a, b and
 *   c by `../legs.mts` → `walkSurface`;
 * - the team that files a task with a screenshot: two fresh images sent to
 *   the Shift Coordinator with a line asking it to file a task for the Coder
 *   (a Claude Code run). The task's page shows the run naming both words;
 *   Retry runs it again, and the re-run names both too (ER-7: a task's files
 *   are its brief's, for every run). Failures are `sm:task-run` and
 *   `sm:re-run`.
 *
 * Not walked here: deleting the task (its file's read 404, a sibling's files
 * kept). Nothing deletes a task; the sweeps name it as blocked.
 *
 *   Host:  Shift Manager's own command over `teams/devteam/fsdev.config.mts`,
 *          its pages built with Vite, `DEVTEAM_STORE` a scratch SQLite file,
 *          `DEVFORCE_LAB_HARNESS=claude-code`. The restart stops the command's
 *          process group and starts it again from the same working directory
 *          (the default blob folder) on the same store; the page reopens the
 *          conversation at the new origin.
 *   Model: the Shift Coordinator's own (its `WORKER.md`), the Coder on Claude
 *          Code's own sign-in. Not run, and a FAIL, when either can't run here.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/closure/shift-manager/run.mts
 *       GOAL_CONTROL=strip-file-parts
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Browser, Locator, Page } from "playwright";
import { goalTmpDir, runGoal, sleep } from "../../../lib/index.mts";
import { launchChromium } from "../../../lib/playwright.mts";
import {
  SHIFT_MANAGER,
  buildShiftManagerPages,
  devteamShiftCoordinatorModel,
  openShiftManager,
  startShiftManager,
  type ServedShiftManager,
} from "../../../lib/shift-manager.mts";
import { controlName, draw, drawWords, harnessReadiness, missingModel, paste, pick, plantControl, readUntilNamed, refuseStubs, TURN_MS, walkSurface, type Surface } from "../legs.mts";
import { wordPng } from "../../reach-the-model/png.mts";

refuseStubs();
const CONTROL = controlName();
const SCRATCH = goalTmpDir(`attachments-closure-shift-manager-${Date.now()}`);
const CONFIG = join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts");
const ENV = { DEVTEAM_STORE: join(SCRATCH, "devteam.sqlite"), DEVFORCE_LAB_HARNESS: "claude-code" };

const say = (s: string) => console.error(`[closure shift-manager ${new Date().toISOString().slice(11, 19)}] ${s}`);
const box = (page: Page) => page.locator('[data-testid$="-composer-input"]:visible').first();

/** How often `word` occurs in `text`. */
const count = (text: string, word: string) => text.split(word.toUpperCase()).length - 1;

/** Poll `scope` until each of `words` occurs more often than in `before`, or {@link TURN_MS} passes; the words that did. */
async function readUntilAdded(scope: Locator, words: readonly string[], before: string): Promise<string[]> {
  let added: string[] = [];
  for (const end = Date.now() + TURN_MS; Date.now() < end; await sleep(1_000)) {
    const text = (await scope.innerText().catch(() => "")).toUpperCase();
    added = words.filter((w) => count(text, w) > count(before, w));
    if (added.length === words.length) break;
  }
  return added;
}

const putBack = plantControl(CONTROL);
await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const blocked = [missingModel(devteamShiftCoordinatorModel()), (await harnessReadiness())["claude-code"]].filter((r): r is string => r !== undefined);
  if (blocked.length > 0) return { failures: blocked.map((r) => `[sm:host] not run: ${r}`), evidence: "" };
  const d = draw();
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  let served: ServedShiftManager = await startShiftManager({ scratch: SCRATCH, label: "devteam", config: CONFIG, pages, env: ENV });
  const workDir = served.workDir;
  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    const surface: Surface = {
      tag: "sm",
      label: "Shift Manager",
      box,
      origin: () => served.origin,
      reopenPath: () => "/shift-coordinator",
      async open(p) {
        await openShiftManager(p, served.origin, "/shift-coordinator");
        await box(p).waitFor({ timeout: 60_000 });
      },
      async restart() {
        await served.stop();
        served = await startShiftManager({ scratch: SCRATCH, label: "devteam", config: CONFIG, pages, env: ENV, workDir });
      },
    };
    say("the Shift Coordinator: legs a, b, c");
    await walkSurface(page, surface, d, failures, tell, evidence);

    // ---- a task filed with two images: its run names both. A second task is cancelled mid-run and Retried:
    // the board offers Retry only on a failed or cancelled task, so that is the re-run a person has.
    say("a task filed with two images: its run, then a cancelled task's Retry");
    const fileTask = async (marker: string, words: readonly string[]) => {
      await surface.open(page);
      await paste(box(page), "bug-1.png", "image/png", wordPng(words[0]));
      await pick(page, [{ name: "bug-2.png", mimeType: "image/png", buffer: Buffer.from(wordPng(words[1])) }]);
      await box(page).fill(`File a task for the Coder titled "${marker}" with the two attached images. The task: report the word written on each image, and change no file.`);
      await box(page).press("Enter");
      await openShiftManager(page, served.origin, "/tasks");
      const row = page.getByText(marker).first();
      if (!(await row.waitFor({ timeout: 300_000 }).then(() => true, () => false))) return false;
      await row.click();
      return true;
    };
    const status = page.getByTestId("task-action-row");
    const reaches = (state: string, timeout: number) =>
      page.locator(`[data-testid="task-action-row"][data-status="${state}"]`).waitFor({ timeout }).then(() => true, () => false);

    const words = drawWords(d.words);
    const marker = `closure-${randomBytes(3).toString("hex")}`;
    if (!(await fileTask(marker, words))) failures.push(`[sm:task-run] no task "${marker}" was filed from the line`);
    else {
      const first = await readUntilNamed(page.locator("body"), words);
      const named = tell.over("sm:task-run", words).filter((w) => first.includes(w));
      if (named.length !== 2) failures.push(`[sm:task-run] the task's run names ${named.length} of ${words.join(", ")}: ${JSON.stringify(first.slice(-300))}`);
      evidence.push(`sm:task ${marker} ${words.join("/")}`);
    }

    const again = drawWords(d.words);
    const second = `closure-${randomBytes(3).toString("hex")}`;
    if (!(await fileTask(second, again))) failures.push(`[sm:re-run] no task "${second}" was filed from the line`);
    else if (!(await reaches("in_progress", 300_000))) failures.push(`[sm:re-run] "${second}" never started running (status ${await status.getAttribute("data-status").catch(() => "none")})`);
    else {
      await page.getByTestId("task-action-cancel").click();
      await page.getByTestId("task-action-confirm-yes").click();
      if (!(await reaches("cancelled", 60_000))) failures.push(`[sm:re-run] "${second}" didn't end as cancelled`);
      else {
        // Each word must be drawn in the task's session more times than before Retry, so what the cancelled
        // run already wrote can't pass the re-run, wherever the page draws it.
        const session = page.getByTestId("task-slot");
        const before = (await session.innerText()).toUpperCase();
        await page.getByTestId("task-action-retry").click();
        if (!(await reaches("in_progress", 60_000))) failures.push("[sm:re-run] Retry never started a second run");
        else {
          const added = await readUntilAdded(session, again, before);
          const renamed = tell.over("sm:re-run", again).filter((w) => added.includes(w));
          if (renamed.length !== 2) failures.push(`[sm:re-run] the Retry names ${renamed.length} of ${again.join(", ")}: its brief's images didn't reach it`);
        }
      }
      evidence.push(`sm:re-run ${second} ${again.join("/")}`);
    }
  } finally {
    await browser?.close();
    await served.stop();
    putBack();
  }
  return { failures, evidence: evidence.join(" · ") };
});
