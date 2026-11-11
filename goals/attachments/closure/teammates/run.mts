/**
 * The closure's legs in the Teammates lab (FIX-2565): the Chief of Staff's
 * conversation (a generator teammate), walked by `../legs.mts` →
 * `walkSurface`, then a coding teammate: the Chief of Staff hands the line's
 * images to a Claude Code task, and the report the conversation draws names
 * both words. One real browser against the lab served by `fsdev dev` on its
 * built pages.
 *
 *   Host:  `goals/teammates-lab/lab.mts` → `startTeammates`, its SQLite store
 *          and an empty git checkout as the working folder in scratch. The
 *          restart stops the lab's process group and serves it again on the
 *          same store and port.
 *   Model: the lab's own (`TEAMMATES_MODEL`, through the AI Gateway); the
 *          coding teammate on Claude Code's own sign-in. Not run, and a FAIL,
 *          when either can't run here.
 *
 * A teammate holds one long conversation, so `open` returns to it: each leg
 * reads only what is drawn after its own line.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/closure/teammates/run.mts
 *       GOAL_CONTROL=strip-file-parts
 */
import { execFileSync } from "node:child_process";
import type { Browser, Page } from "playwright";
import { REPO_ROOT, goalTmpDir, runGoal, stopProcessGroup } from "../../../lib/index.mts";
import { launchChromium } from "../../../lib/playwright.mts";
import { sleep, startTeammates } from "../../../teammates-lab/lab.mts";
import { controlName, draw, harnessReadiness, missingModel, plantControl, refuseStubs, walkCodingHandOff, walkSurface, type Surface } from "../legs.mts";

refuseStubs();
const CONTROL = controlName();
const USER = "u_closure";
const LEAD = "teammates.chief-of-staff";
const LEAD_NAME = "Chief of Staff";
const SCRATCH = goalTmpDir(`attachments-closure-teammates-${Date.now()}`);
const MODEL = process.env.TEAMMATES_MODEL ?? "openai/gpt-6-luna";

const putBack = plantControl(CONTROL);
await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const blocked = [missingModel(MODEL), (await harnessReadiness())["claude-code"]].filter((r): r is string => r !== undefined);
  if (blocked.length > 0) return { failures: blocked.map((r) => `[teammates:host] not run: ${r}`), evidence: "" };
  const d = draw();
  execFileSync("pnpm", ["--filter", "@flow-state-dev/teammates", "build"], { cwd: REPO_ROOT, stdio: "ignore" });
  const port = 46_000 + Math.floor(Math.random() * 9_000);
  let lab = await startTeammates(SCRATCH, USER, {}, undefined, undefined, port);
  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const surface: Surface = {
      tag: "teammates",
      label: "Teammates lab",
      box: (p: Page) => p.getByLabel(`Message ${LEAD_NAME}`),
      replyScope: (p: Page) => p.getByRole("main", { name: "Conversation" }),
      // The task's card in the conversation opens its popup; only its Result box, never the title the filer wrote, counts.
      async openCodingTask(p, timeout) {
        const card = p.getByRole("main", { name: "Conversation" }).locator("button:has([data-task-status])").last();
        if (!(await card.waitFor({ timeout }).then(() => true, () => false))) return null;
        await card.click();
        const popup = p.getByRole("dialog").last();
        // The goal the filer wrote is drawn as the run's first step, not in the header.
        await popup.locator('[data-step="given"]').first().waitFor({ timeout }).catch(() => undefined);
        return { work: popup.locator('[data-step="result"]'), brief: popup.locator('header, [data-step="given"]') };
      },
      origin: () => lab.origin,
      async open(p) {
        if (!p.url().startsWith(lab.origin)) await p.goto(lab.origin);
        await p.locator(`nav[aria-label="Workers"] [data-worker="${LEAD}"]`).click();
        await p.getByLabel(`Message ${LEAD_NAME}`).waitFor({ timeout: 30_000 });
      },
      async restart() {
        stopProcessGroup(lab.child);
        for (let i = 0; i < 100 && (await fetch(lab.origin).then(() => true, () => false)); i += 1) await sleep(200);
        lab = await startTeammates(SCRATCH, USER, {}, undefined, undefined, port);
      },
    };
    await walkSurface(page, surface, d, failures, tell, evidence);
    const words = await walkCodingHandOff(page, surface, "Claude Code", failures, tell, d.words);
    evidence.push(`teammates:coding ${words.join("/")}`);
  } finally {
    await browser?.close();
    stopProcessGroup(lab.child);
    putBack();
  }
  return { failures, evidence: evidence.join(" · ") };
});

