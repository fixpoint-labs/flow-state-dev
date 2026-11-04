/**
 * Goal check: in the Claude Code-style lab, a person tells a background task
 * that is working from one whose run has stopped, and sees how long each
 * running task has worked on this attempt, from the tasks pane alone. The
 * legs, controls and grading are `goals/lib/task-signals.mts`, shared with the
 * Teammates lab; this file says how to serve this lab, open its page, file on
 * the session's board and read a card's words. See goal.md for the contract.
 *
 * Run:      pnpm tsx goals/claude-code-style-lab/tells-a-stopped-task-from-a-working-one/run.mts
 * Controls: GOAL_CONTROL=task-clock | quiet-from-age | never-quiet, same command.
 */
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import type { Page } from "playwright";
import { NO_MODEL, runTaskSignals, STEP_MS } from "../../lib/task-signals.mts";
import { goalTmpDir } from "../../lib/index.mts";
import { boardOf, buildPages, LAB, makeRepository, openSessionOn, startLab } from "../lab.mts";

const USER = "u_goal";
const repo = makeRepository(join(goalTmpDir("claude-code-style-task-signals-repo"), "repo"), { "NOTES.md": "# Notes\n" });
/** The session the tasks are filed on, and the page's address that reopens it, once opened. */
let opened: { session: string; search: string } | undefined;

await runTaskSignals({
  name: "claude-code-style",
  itemFile: join(LAB, "src", "components", "flow-state", "task-signals.tsx"),
  build: buildPages,
  serve: async (data) => {
    const lab = await startLab(data, USER, {
      CLAUDE_CODE_STYLE_HARNESS: "stub",
      CLAUDE_CODE_STYLE_HARNESS_STEP_MS: String(STEP_MS),
      CLAUDE_CODE_STYLE_REPOSITORIES: repo,
      ...NO_MODEL,
    });
    return { origin: lab.origin, child: lab.child };
  },
  open: async (page: Page, origin: string) => {
    const fsd = createClient({ userId: USER, baseUrl: origin });
    if (opened === undefined) {
      await page.goto(origin);
      const session = await openSessionOn(page, fsd, USER, "Task signals", repo);
      opened = { session, search: new URL(page.url()).search };
    } else {
      // After a restart: the same session, by its address, on the server's new origin.
      await page.goto(`${origin}/${opened.search}`);
    }
    const { session } = opened;
    const board = boardOf(fsd);
    const pane = page.getByRole("complementary", { name: "Background tasks" });
    return {
      rows: () => board.rows(session),
      file: (title, goal) => board.file(session, title, goal),
      act: (tool, input) => board.send(session, tool, input),
      words: async (title) => {
        const card = pane.locator("button[data-task-status]").filter({ hasText: title }).first();
        return (await card.count()) === 0 ? undefined : ((await card.textContent()) ?? undefined);
      },
    };
  },
});
