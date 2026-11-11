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
import type { Browser, Page } from "playwright";
import { goalTmpDir, runGoal } from "../../../lib/index.mts";
import { launchChromium } from "../../../lib/playwright.mts";
import {
  SHIFT_MANAGER,
  buildShiftManagerPages,
  devteamShiftCoordinatorModel,
  openShiftManager,
  startShiftManager,
  type ServedShiftManager,
} from "../../../lib/shift-manager.mts";
import { controlName, draw, drawWords, harnessReadiness, missingModel, paste, pick, plantControl, readUntilNamed, refuseStubs, walkSurface, type Surface } from "../legs.mts";
import { wordPng } from "../../reach-the-model/png.mts";

refuseStubs();
const CONTROL = controlName();
const SCRATCH = goalTmpDir(`attachments-closure-shift-manager-${Date.now()}`);
const CONFIG = join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts");
const ENV = { DEVTEAM_STORE: join(SCRATCH, "devteam.sqlite"), DEVFORCE_LAB_HARNESS: "claude-code" };

const say = (s: string) => console.error(`[closure shift-manager ${new Date().toISOString().slice(11, 19)}] ${s}`);
const box = (page: Page) => page.locator('[data-testid$="-composer-input"]:visible').first();

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

    // ---- a task filed with a screenshot: its run, then a re-run, each names both words
    say("a task filed with two images, its run and its re-run");
    const words = drawWords(d.words);
    const marker = `closure-${randomBytes(3).toString("hex")}`;
    await surface.open(page);
    await paste(box(page), "bug-1.png", "image/png", wordPng(words[0]));
    await pick(page, [{ name: "bug-2.png", mimeType: "image/png", buffer: Buffer.from(wordPng(words[1])) }]);
    await box(page).fill(`File a task for the Coder titled "${marker}" with the two attached images. The task: report the word written on each image, and change no file.`);
    await box(page).press("Enter");
    await openShiftManager(page, served.origin, "/tasks");
    const row = page.getByText(marker).first();
    if (!(await row.waitFor({ timeout: 300_000 }).then(() => true, () => false))) {
      failures.push(`[sm:task-run] no task "${marker}" was filed from the line`);
    } else {
      await row.click();
      const first = await readUntilNamed(page.locator("body"), words);
      const named = tell.over("sm:task-run", words).filter((w) => first.includes(w));
      if (named.length !== 2) failures.push(`[sm:task-run] the task's run names ${named.length} of ${words.join(", ")}: ${JSON.stringify(first.slice(-300))}`);
      const retry = page.getByTestId("task-action-retry");
      if (!(await retry.waitFor({ timeout: 300_000 }).then(() => true, () => false))) failures.push("[sm:re-run] the task never ended, so it can't be run again");
      else {
        await retry.click();
        // The re-run has started once Retry is gone, and ended once it is back: either wait running out fails the leg.
        const started = await retry.waitFor({ state: "hidden", timeout: 60_000 }).then(() => true, () => false);
        const ended = started && (await retry.waitFor({ timeout: 300_000 }).then(() => true, () => false));
        if (!ended) failures.push(`[sm:re-run] Retry ${started ? "started a second run that never ended" : "never started a second run"}`);
        else {
          // Only what is drawn past the first run's report counts, so its words still on the page can't pass the re-run.
          const again = await readUntilNamed(page.locator("body"), words, first.slice(-80));
          const renamed = tell.over("sm:re-run", words).filter((w) => again.includes(w));
          if (renamed.length !== 2) failures.push(`[sm:re-run] the re-run names ${renamed.length} of ${words.join(", ")}: its brief's images didn't reach it`);
        }
      }
      evidence.push(`sm:task ${marker} ${words.join("/")}`);
    }
  } finally {
    await browser?.close();
    await served.stop();
    putBack();
  }
  return { failures, evidence: evidence.join(" · ") };
});
