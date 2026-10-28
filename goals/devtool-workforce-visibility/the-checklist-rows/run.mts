/**
 * Goal check: ER-Devtool checklist rows 4 and 5, graded on a live hire off the
 * shipped DevTool. Row 6's live read is deferred (below).
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Both rows are read on the `multi-seat-collab` hire, served by the ordinary
 * `fsdev dev` over that lab's own config, so nothing here stands a workforce
 * up or shapes one for the inspection.
 *
 * - Row 4 (a row waiting on a person says why, with nothing expanded): the
 *   planner files a row for the builder on its own conversation's board, and
 *   the builder holds it on a question by design (FIX-2131: a running row
 *   with an open question), driven through the lab's own driver.
 *   This file only reads the screen.
 * - Row 5 (the organization's workers, and a coordinator's delegates): read
 *   from the session the lab's boot wrote its inventory through, on a second
 *   serve of the same config with the debug endpoints off, so row 5 is green
 *   on the production read alone. See `row5.mts`.
 *
 * Row 6 (a sealed document is told apart from a writable one) is outside this
 * goal's claim. The owner deferred its live read until a real hire declares a
 * sealed document (epic FIX-1457 D11); FIX-1481's automated checks prove the
 * row-6 code. Every verdict says so as a note, not a failure.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/the-checklist-rows/run.mts
 * Controls: GOAL_CONTROL=silent-park (must FAIL at row 4 only)
 *           GOAL_CONTROL=no-inventory (must FAIL at row 5 only, at step 3)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { readLabTree, routesFor } from "../../../packages/shift-manager/test/fixtures/multi-worker-collab/host.mts";
import { Scenario, serveLab, type BoardRow } from "../../multi-seat-collab/run-scenario.mts";
import { WORKER_FLOW } from "../../../packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/workers/worker.mts";
import { gradeRow5 } from "./row5.mts";

type Fixture = {
  row4: { piece: { goal: string; desk: string; asks: string } };
};

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SHOTS = goalTmpDir("checklist-rows");

/**
 * The legs each control must redden, and only those — and, where a step is
 * named, every line it reddens on that leg must be at that step.
 */
const EXPECTED: Record<string, ReadonlyArray<{ leg: string; step?: string }>> = {
  "silent-park": [{ leg: "row 4" }],
  "no-inventory": [{ leg: "row 5", step: "step 3" }],
};

/**
 * What the run says about row 6 on every verdict, green or red. Not a failure:
 * the row is outside this goal's claim (epic FIX-1457 D11).
 */
const ROW6_STATUS =
  "row 6 not graded live: the owner deferred its live read until a real hire declares a sealed " +
  "document (epic FIX-1457 D11). FIX-1481's automated checks prove the row-6 code; not a failure";

/**
 * The smallest visible area that counts as legible: 40px of the cell's width,
 * and at least one line of text (or the whole cell, if it is shorter) tall.
 */
const MIN_VISIBLE_WIDTH = 40;
const MIN_VISIBLE_HEIGHT = 10;

const failures: string[] = [];
const notes: string[] = [];
function fail(leg: string, line: string): void {
  failures.push(`[${leg}] ${line}`);
}

// ---------------------------------------------------------------------------
// The DevTool's own navigation
// ---------------------------------------------------------------------------

/** Wait until the session badge names this session. */
async function waitForBadge(page: Page, sessionId: string): Promise<void> {
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll("[title^='Session ID: ']")].some((el) =>
        el.getAttribute("title")?.includes(id),
      ),
    sessionId,
    { timeout: 15_000 },
  );
}

/**
 * Open a run the way a person does: the kind, then its one copy (a worker
 * has none of its own; a copy's id is its kind), then the task session the
 * row ran in, which the navigator lists under that copy.
 */
async function openRun(page: Page, run: string): Promise<void> {
  const kindRow = page.locator(`[data-kind="${WORKER_FLOW}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const copyRow = page.locator(`[data-instance-id="${WORKER_FLOW}"]`);
  if ((await copyRow.getAttribute("aria-expanded")) !== "true") await copyRow.click();
  await page.locator(`[data-session-id="${run}"]`).click();
  await waitForBadge(page, run);
}

/** What one Tasks-tab row shows, read with nothing touched. */
interface RowOnScreen {
  headers: string[];
  cells: Record<string, string>;
  reasonTitle: string | null;
  /** Expanders open anywhere in the panel at the moment of reading. */
  openExpanders: number;
  /** How much of the reason cell's width a reader can actually see, in px. */
  reasonVisiblePx: number;
  /** How much of the reason cell's height a reader can actually see, in px. */
  reasonVisibleHeightPx: number;
  /** The cell's own height, so "one line tall" can be capped at the cell. */
  reasonHeightPx: number;
  /** True when the cell runs past the edge of what its pane shows. */
  reasonCutByPane: boolean;
  /** True when every pane that cuts it scrolls, so the rest is a scroll away. */
  paneScrolls: boolean;
}

/**
 * Read one row of the Tasks tab, found by its task id and read slot by slot
 * (status, goal, reason, assignee), or `undefined` if it never appeared in the
 * state `until` asks for.
 *
 * Reads the DOM as it stands, so it is only a fair reading when nothing has
 * been clicked open. The count of open rows is taken in the same read and
 * graded, rather than assumed.
 */
async function readTaskRow(
  page: Page,
  taskId: string,
  until: (cells: Record<string, string>) => boolean,
): Promise<RowOnScreen | undefined> {
  await page.getByRole("tab", { name: "Tasks" }).click();
  // The panel read below is only the Tasks panel once the tab has taken.
  await page.waitForFunction(
    () => document.querySelector("[role='tab'][aria-selected='true']")?.textContent?.trim() === "Tasks",
    undefined,
    { timeout: 10_000 },
  );
  for (let waited = 0; waited < 10_000; waited += 250) {
    const read = await page.evaluate((id) => {
      const panel = document.querySelector("main [role='tabpanel'][data-state='active']");
      if (panel === null) return undefined;
      for (const row of panel.querySelectorAll("[data-task-id]")) {
        if (row.getAttribute("data-task-id") !== id) continue;
        const headers: string[] = [];
        const cells: Record<string, string> = {};
        for (const [head, name] of [["Status", "status"], ["Goal", "goal"], ["Reason", "reason"], ["Assignee", "assignee"]]) {
          const el = row.querySelector(`[data-slot="${name}"]`);
          if (el === null) continue;
          headers.push(head!);
          cells[head!] = (el.textContent ?? "").trim();
        }
        const reasonCell = row.querySelector<HTMLElement>('[data-slot="reason"]') ?? undefined;
        // What a reader can see of the cell: its box, cut on BOTH axes by
        // every ancestor that clips overflow, and by the window. A row
        // scrolled above or below the pane is as unseen as one pushed off
        // its right edge.
        let visiblePx = 0;
        let visibleHeightPx = 0;
        let heightPx = 0;
        let cutByPane = false;
        let paneScrolls = true;
        if (reasonCell !== undefined) {
          const box = reasonCell.getBoundingClientRect();
          heightPx = box.height;
          let left = Math.max(box.left, 0);
          let right = Math.min(box.right, window.innerWidth);
          let top = Math.max(box.top, 0);
          let bottom = Math.min(box.bottom, window.innerHeight);
          for (let el = reasonCell.parentElement; el !== null; el = el.parentElement) {
            const style = getComputedStyle(el);
            const clipsX = style.overflowX !== "visible";
            const clipsY = style.overflowY !== "visible";
            if (!clipsX && !clipsY) continue;
            const clip = el.getBoundingClientRect();
            if (clipsX) {
              if (clip.right < box.right) {
                cutByPane = true;
                if (style.overflowX !== "auto" && style.overflowX !== "scroll") paneScrolls = false;
              }
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
            if (clipsY) {
              top = Math.max(top, clip.top);
              bottom = Math.min(bottom, clip.bottom);
            }
          }
          visiblePx = Math.max(0, right - left);
          visibleHeightPx = Math.max(0, bottom - top);
          // No visible height means no visible width either: nothing of the
          // cell is on screen.
          if (visibleHeightPx === 0) visiblePx = 0;
        }
        return {
          headers,
          cells,
          reasonTitle: reasonCell?.getAttribute("title") ?? null,
          openExpanders: panel.querySelectorAll("[data-task-id] button[aria-expanded='true']").length,
          reasonVisiblePx: visiblePx,
          reasonVisibleHeightPx: visibleHeightPx,
          reasonHeightPx: heightPx,
          reasonCutByPane: cutByPane,
          paneScrolls,
        };
      }
      return undefined;
    }, taskId);
    if (read !== undefined && until(read.cells)) return read;
    await page.waitForTimeout(250);
  }
  return undefined;
}

/** Open the row in place and return what its open half shows. */
async function expanderText(page: Page, taskId: string): Promise<string> {
  const row = page.locator(`main [role='tabpanel'][data-state='active'] [data-task-id="${taskId}"]`).first();
  await row.locator("button[aria-expanded]").first().click();
  return await row.innerText();
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main(tell: Tell): Promise<{ failures: string[]; evidence: string }> {
  // The bundle the shell serves, built here so a stale artifact from another
  // branch cannot be what gets graded.
  execFileSync("pnpm", ["--filter", "@flow-state-dev/devtool", "build:assets"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

  const tree = await readLabTree();
  const piece = fixture.row4.piece;
  const owners = Object.entries(tree.declaredDesks).filter(([, desk]) => desk === piece.desk);
  if (owners.length !== 1) {
    throw new Error(
      `the fixture's desk "${piece.desk}" must be answered for by exactly one worker's own file; ` +
        `the tree declares ${JSON.stringify(tree.declaredDesks)}`,
    );
  }
  const [owner] = owners[0]!;

  const served = await serveLab({ control: CONTROL, workDir: join(SHOTS, "server") });
  let browser: Browser | undefined;
  let row4Evidence = "";
  let row5Evidence = "";
  try {
    browser = await launchChromium();
    // The app's own desk -> delegate map; this goal's controls perturb the worker and the boot, not the filer.
    const lab = new Scenario(served, tree, routesFor(""));
    await lab.open();

    // ---- the subject: a row the hire holds on its question, on its own ----
    const filed = await lab.file({ goal: piece.goal, desk: piece.desk, asks: piece.asks });
    if (filed.status !== "completed" || filed.output?.ok !== true) {
      throw new Error(`filing the piece ended ${filed.status ?? filed.refusal}: ${JSON.stringify(filed.output)}`);
    }
    /** The row's open question: a row hold on a running row no steer answers yet. */
    const openQuestion = (row: BoardRow | undefined) => {
      const answered = new Set((row?.steers ?? []).flatMap((steer) => (steer.answers === undefined ? [] : [steer.answers])));
      return row?.status === "in_progress" ? row.questions?.find((hold) => hold.source.kind === "row" && !answered.has(hold.id)) : undefined;
    };
    const parked = await lab.waitForRow(
      (row) => String(row.goal).includes(piece.goal) && openQuestion(row) !== undefined,
    );
    const parkLine = lab
      .workLines()
      .find((line) => line.taskId === parked?.id && line.event === "asked");

    // The positive record, before anything on screen is judged: the hire held
    // the row on its question, the question says something, and we know which
    // run asked it. Without all three there is no row 4 to read, and saying
    // the screen was wrong would blame the view for the subject.
    const asked = openQuestion(parked);
    if (parked === undefined || parkLine === undefined || asked === undefined) {
      fail("row 4", `the hire never held the row it was given on a question (ledger: ${JSON.stringify((await lab.rows()).map((r) => [r.id, r.status]))})`);
    } else if (asked.ask.prompt.trim().length <= 1) {
      fail("row 4", `the hire held row ${parked.id} on a question that says nothing (${JSON.stringify(asked.ask.prompt)}), so there is no reason for the screen to show`);
    } else if (parkLine.worker !== owner) {
      fail("row 4", `row ${parked.id} asked on ${parkLine.worker}, not ${owner}, whose own file answers for "${piece.desk}"`);
    } else {
      const reason = asked.ask.prompt;

      // ---- the screen ------------------------------------------------------
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.goto(served.origin, { waitUntil: "networkidle" });
      await openRun(page, parkLine.session);
      const onScreen = await readTaskRow(page, parked.id, (cells) => cells.Status === "in_progress");
      await page.screenshot({ path: join(SHOTS, "row4-held.png") });

      if (onScreen === undefined) {
        fail("row 4", `the run ${parkLine.session} never showed row ${parked.id} as running in its Tasks tab`);
      } else {
        if (onScreen.openExpanders !== 0) {
          fail("row 4", `${onScreen.openExpanders} row(s) were open when the row was read; the reason has to be legible without opening one`);
        }
        // Waiting on a person is a running row plus a reason, never a status of its own.
        const statuses: readonly string[] = taskStatusSchema.options;
        if (!statuses.includes(onScreen.cells.Status ?? "")) {
          fail("row 4", `the row's status reads ${JSON.stringify(onScreen.cells.Status)}, which is not a task status`);
        }
        const shown = onScreen.cells.Reason;
        if (shown === undefined) {
          // Tell "only in the opened row" apart from "nowhere", so the red state
          // names what a reader would actually have to do.
          const inExpander = (await expanderText(page, parked.id)).includes(reason);
          fail(
            "row 4",
            `the held row has no reason slot (slots: ${onScreen.headers.join(", ")}); ` +
              (inExpander
                ? "the reason is only inside the opened row"
                : "the reason is not on screen at all, not even in the opened row"),
          );
        } else if (shown !== reason) {
          fail("row 4", `the reason slot reads ${JSON.stringify(shown)}; the row holds ${JSON.stringify(reason)}`);
        } else if (
          onScreen.reasonVisibleHeightPx < Math.min(MIN_VISIBLE_HEIGHT, onScreen.reasonHeightPx)
        ) {
          fail(
            "row 4",
            `the reason slot is on the row but out of view vertically: ${Math.round(onScreen.reasonVisibleHeightPx)}px ` +
              `of its ${Math.round(onScreen.reasonHeightPx)}px height can be seen (the row sits above or below what the pane shows)`,
          );
        } else if (onScreen.reasonVisiblePx < MIN_VISIBLE_WIDTH) {
          fail("row 4", `the reason slot is on the row but only ${Math.round(onScreen.reasonVisiblePx)}px of its width can be seen`);
        } else if (onScreen.reasonTitle !== reason) {
          fail("row 4", `the reason slot is clamped and its title reads ${JSON.stringify(onScreen.reasonTitle)}, so the whole reason is nowhere a reader can see it`);
        } else {
          if (onScreen.reasonCutByPane) {
            notes.push(
              `the reason slot starts on screen but runs past the edge of the workspace pane at a 1600px window ` +
                `(${Math.round(onScreen.reasonVisiblePx)}px visible); the whole reason is on its title`,
            );
          }
          row4Evidence =
            `row 4 read on the multi-seat-collab hire: ${owner} held row ${parked.id} on its question on its own, and its run ` +
            `${parkLine.session}, opened from the navigator, showed it \`in_progress\` with "${reason}" in the row's reason slot, ` +
            `nothing expanded`;
        }
      }
      // Narrower windows, measured and noted rather than graded. Only when the
      // row has a reason slot to measure.
      for (const width of onScreen?.cells.Reason === undefined ? [] : [1440, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300);
        const narrow = await readTaskRow(page, parked.id, (cells) => cells.Status === "in_progress");
        await page.screenshot({ path: join(SHOTS, `row4-held-${width}.png`) });
        notes.push(
          `at a ${width}px window ${Math.round(narrow?.reasonVisiblePx ?? 0)}px of the reason slot is visible` +
            (narrow?.reasonCutByPane === true
              ? narrow.paneScrolls
                ? "; the rest is a horizontal scroll away, not behind an expander"
                : "; the pane that cuts it does not scroll"
              : ""),
        );
      }
      await page.close();
    }

    // ---- row 5: its own serve of the same config, debug off (row5.mts) ----
    const row5 = await gradeRow5({
      browser,
      tree,
      control: CONTROL,
      workDir: join(SHOTS, "server-row5"),
      shots: SHOTS,
      tell,
    });
    failures.push(...row5.failures);
    notes.push(...row5.notes);
    row5Evidence = row5.evidence;
  } finally {
    await browser?.close().catch(() => {});
    served.stop();
  }

  // ---- row 6: outside the claim, its live read deferred (see the header) ----
  notes.push(ROW6_STATUS);

  // ---- the controls grade themselves ---------------------------------------
  if (CONTROL !== "") {
    const expected = EXPECTED[CONTROL];
    if (expected === undefined) throw new Error(`unknown control "${CONTROL}"`);
    const graded = [...failures];
    const at = ({ leg, step }: { leg: string; step?: string }) =>
      step === undefined ? `[${leg}]` : `[${leg}] ${step}`;
    const named = (want: { leg: string; step?: string }) =>
      want.step === undefined ? want.leg : `${want.leg} at ${want.step}`;
    const offLeg = graded.filter((line) => !expected.some((want) => line.startsWith(at(want))));
    const missing = expected.filter((want) => !graded.some((line) => line.startsWith(at(want))));
    if (missing.length > 0 || offLeg.length > 0) {
      failures.push(
        `the ${CONTROL} control must redden ${expected.map(named).join(" and ")} and nothing else` +
          (missing.length > 0 ? `; never reddened: ${missing.map(named).join(", ")}` : "") +
          (offLeg.length > 0 ? `; reddened elsewhere: ${offLeg.join(" | ")}` : ""),
      );
    }
  }

  if (row5Evidence !== "") notes.unshift(`row 5 PASS: ${row5Evidence}`);
  if (row4Evidence !== "") notes.unshift(`row 4 PASS: ${row4Evidence}`);
  notes.push(`screenshots: ${SHOTS}`);
  // Notes ride along with a red verdict so a failure is read with them; on a
  // green one they are the evidence. Never failures on their own.
  return failures.length > 0
    ? { failures: [...failures, ...notes.map((note) => `(note) ${note}`)], evidence: "" }
    : { failures, evidence: notes.join("; ") };
}

mkdirSync(SHOTS, { recursive: true });
void runGoal((_failures, tell) => main(tell));
