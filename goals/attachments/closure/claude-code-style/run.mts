/**
 * The closure's legs in the Claude Code-style lab (FIX-2565): its main
 * session, walked by `../legs.mts` → `walkSurface` in a real browser against
 * the lab served by `fsdev dev` on its built pages.
 *
 *   Host:  `goals/claude-code-style-lab/lab.mts` → `startLab`, its SQLite data
 *          folder in scratch, a scratch repository as the project. The
 *          restart stops the lab's process group and serves it again on the
 *          same data folder and port.
 *   Model: the lab's own (`CLAUDE_CODE_STYLE_MODEL`, through the AI Gateway);
 *          coding runs on Claude Code's own sign-in. Not run, and a FAIL,
 *          when either can't run here.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/closure/claude-code-style/run.mts
 *       GOAL_CONTROL=strip-file-parts
 */
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import type { Browser, Page } from "playwright";
import { goalTmpDir, runGoal, stopProcessGroup } from "../../../lib/index.mts";
import { launchChromium } from "../../../lib/playwright.mts";
import { buildPages, makeRepository, openSessionOn, sleep, startLab } from "../../../claude-code-style-lab/lab.mts";
import { controlName, draw, harnessReadiness, missingModel, plantControl, refuseStubs, walkCodingHandOff, walkSurface, type Surface } from "../legs.mts";

refuseStubs();
const CONTROL = controlName();
const USER = "u_closure";
const SCRATCH = goalTmpDir(`attachments-closure-cc-style-${Date.now()}`);
const MODEL = process.env.CLAUDE_CODE_STYLE_MODEL ?? "openai/gpt-5.4";

const putBack = plantControl(CONTROL);
await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const blocked = [missingModel(MODEL), (await harnessReadiness())["claude-code"]].filter((r): r is string => r !== undefined);
  if (blocked.length > 0) return { failures: blocked.map((r) => `[cc-style:host] not run: ${r}`), evidence: "" };
  const d = draw();
  const data = join(SCRATCH, "data");
  const repo = makeRepository(join(SCRATCH, "repo"), { "NOTES.md": "# Notes\n" });
  const port = 45_000 + Math.floor(Math.random() * 10_000);
  const env = { CLAUDE_CODE_STYLE_REPOSITORIES: repo };
  let browser: Browser | undefined;
  buildPages();
  let lab = await startLab(data, USER, env, undefined, port);
  try {
    const fsd = () => createClient({ userId: USER, baseUrl: lab.origin });
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    let opened = 0;
    const box = (p: Page) => p.getByRole("textbox", { name: "Message the main session" });
    const surface: Surface = {
        tag: "cc-style",
        label: "Claude Code-style lab",
        box,
        origin: () => lab.origin,
        async open(p) {
          await p.goto(lab.origin);
          opened += 1;
          await openSessionOn(p, fsd(), USER, `closure-${opened}`, repo);
        },
        // The task's card in the Background tasks pane opens its sheet, which draws the run's work.
        async openCodingTask(p, timeout) {
          const card = p.getByRole("complementary", { name: "Background tasks" }).locator("button[data-task-status]").first();
          if (!(await card.waitFor({ timeout }).then(() => true, () => false))) return null;
          await card.click();
          return p.getByRole("dialog", { name: /^Work: / });
        },
        async restart() {
          stopProcessGroup(lab.child);
          for (let i = 0; i < 100 && (await fetch(lab.origin).then(() => true, () => false)); i += 1) await sleep(200);
          lab = await startLab(data, USER, env, undefined, port);
        },
    };
    await walkSurface(page, surface, d, failures, tell, evidence);
    // The main session hands the line's images to a Claude Code run (`desk.coder`).
    const words = await walkCodingHandOff(page, surface, "the coder", failures, tell, d.words);
    evidence.push(`cc-style:coding ${words.join("/")}`);
  } finally {
    await browser?.close();
    stopProcessGroup(lab.child);
    putBack();
  }
  return { failures, evidence: evidence.join(" · ") };
});
