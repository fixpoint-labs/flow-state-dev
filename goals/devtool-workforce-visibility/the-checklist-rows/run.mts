/**
 * Goal check: ER-Devtool checklist rows 4 and 6, read off the shipped DevTool
 * on a live hire.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Row 4 (a parked row says why, with nothing expanded) is read on the
 * `multi-seat-collab` hire, whose builder seat parks on a question by design.
 * The hire is served by the ordinary `fsdev dev` over that lab's own config and
 * driven through that lab's own driver, so nothing here stands a workforce up
 * or shapes one for the inspection. This file only reads the screen.
 *
 * Row 6 (a sealed document is told apart from a writable one) is not graded.
 * No live hire in the repository declares a sealed document yet, and ER-3 rules
 * out adding one only so this check has something to look at. The run says so
 * as a failure line rather than passing without it, so a green verdict here can
 * only ever mean both rows were read.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/the-checklist-rows/run.mts
 * Controls: GOAL_CONTROL=silent-park (must FAIL at row 4 only)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { readLabTree } from "../../multi-seat-collab/lab/host.mts";
import { Scenario, serveLab } from "../../multi-seat-collab/lab/run-scenario.mts";
import { WORKER_KIND } from "../../multi-seat-collab/lab/kinds.mts";

type Fixture = {
  row4: { piece: { goal: string; desk: string; asks: string } };
};

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SHOTS = goalTmpDir("checklist-rows");

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, readonly string[]> = {
  "silent-park": ["row 4"],
};

/**
 * The failure line row 6 carries until it has a subject. Kept out of a
 * control's self-grade: it is the same with every control, so it says nothing
 * about which leg a control reddened.
 */
const ROW6_NOT_GRADED =
  "[row 6] not graded: no live hire in the repository declares a sealed document (a `references/` " +
  "file or an `ro` grant), so there is nothing on screen to tell apart from a writable one. Pending an " +
  "owner decision on the subject; not a failure of the row-6 code. See goal.md.";

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
 * Open a session the way a person does: the kind, then the seat, then the
 * seat's own session, then the run it spawned.
 */
async function openRun(page: Page, seat: string, seatSession: string, run: string): Promise<void> {
  const kindRow = page.locator(`[data-kind="${WORKER_KIND}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const seatRow = page.locator(`[data-instance-id="${seat}"]`);
  if ((await seatRow.getAttribute("aria-expanded")) !== "true") await seatRow.click();
  await page.locator(`[data-session-id="${seatSession}"]`).click();
  await waitForBadge(page, seatSession);
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
  /** True when the cell runs past the edge of what its pane shows. */
  reasonCutByPane: boolean;
  /** True when every pane that cuts it scrolls, so the rest is a scroll away. */
  paneScrolls: boolean;
}

/**
 * Read one row of the Tasks tab by column heading, or `undefined` if it never
 * appeared in the state `until` asks for.
 *
 * Reads the DOM as it stands, so it is only a fair reading when nothing has
 * been clicked open. The count of open expanders is taken in the same read and
 * graded, rather than assumed.
 */
async function readTaskRow(
  page: Page,
  taskId: string,
  until: (cells: Record<string, string>) => boolean,
): Promise<RowOnScreen | undefined> {
  await page.getByRole("tab", { name: "Tasks" }).click();
  for (let waited = 0; waited < 10_000; waited += 250) {
    const read = await page.evaluate((id) => {
      const panel = document.querySelector("main [role='tabpanel'][data-state='active']");
      if (panel === null) return undefined;
      for (const table of panel.querySelectorAll("table")) {
        const headers = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
        for (const tr of table.querySelectorAll("tbody tr")) {
          const tds = [...tr.querySelectorAll("td")];
          if ((tds[0]?.textContent ?? "").trim() !== id) continue;
          const cells: Record<string, string> = {};
          headers.forEach((head, i) => (cells[head] = (tds[i]?.textContent ?? "").trim()));
          const reasonCell = tds[headers.indexOf("Reason")];
          // What a reader can see of the cell: its box, cut by every ancestor
          // that clips overflow, and by the window.
          let visiblePx = 0;
          let cutByPane = false;
          let paneScrolls = true;
          if (reasonCell !== undefined) {
            const box = reasonCell.getBoundingClientRect();
            let left = Math.max(box.left, 0);
            let right = Math.min(box.right, window.innerWidth);
            for (let el = reasonCell.parentElement; el !== null; el = el.parentElement) {
              const style = getComputedStyle(el);
              if (style.overflowX === "visible") continue;
              const clip = el.getBoundingClientRect();
              if (clip.right < box.right) {
                cutByPane = true;
                if (style.overflowX !== "auto" && style.overflowX !== "scroll") paneScrolls = false;
              }
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
            visiblePx = Math.max(0, right - left);
          }
          return {
            headers,
            cells,
            reasonTitle: reasonCell?.getAttribute("title") ?? null,
            openExpanders: panel.querySelectorAll("details[open]").length,
            reasonVisiblePx: visiblePx,
            reasonCutByPane: cutByPane,
            paneScrolls,
          };
        }
      }
      return undefined;
    }, taskId);
    if (read !== undefined && until(read.cells)) return read;
    await page.waitForTimeout(250);
  }
  return undefined;
}

/** Open the row's own expander and return the JSON it shows. */
async function expanderText(page: Page, taskId: string): Promise<string> {
  const row = page.locator("main [role='tabpanel'][data-state='active'] tbody tr", { hasText: taskId });
  await row.locator("summary").click();
  return await row.locator("details").innerText();
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main(): Promise<{ failures: string[]; evidence: string }> {
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
      `the fixture's desk "${piece.desk}" must be answered for by exactly one seat's own file; ` +
        `the tree declares ${JSON.stringify(tree.declaredDesks)}`,
    );
  }
  const [owner] = owners[0]!;

  const served = await serveLab({ control: CONTROL, workDir: join(SHOTS, "server") });
  let browser: Browser | undefined;
  let row4Evidence = "";
  try {
    browser = await launchChromium();
    const lab = new Scenario(served, tree);
    await lab.open();

    // ---- the subject: a row the hire parks on its own ---------------------
    const filed = await lab.file({ goal: piece.goal, desk: piece.desk, asks: piece.asks });
    if (filed.status !== "completed") {
      throw new Error(`filing the piece ended ${filed.status ?? filed.refusal}`);
    }
    await lab.drainAll();
    const parked = await lab.waitForRow(
      (row) => String(row.goal).includes(piece.goal) && row.status === "parked",
    );
    const parkLine = lab
      .workLines()
      .find((line) => line.taskId === parked?.id && line.event === "parked");

    // The positive record, before anything on screen is judged: the hire parked
    // the row, the row carries a reason, and we know which run it parked in.
    // Without all three there is no row 4 to read, and saying the screen was
    // wrong would blame the view for the subject.
    if (parked === undefined || parkLine === undefined) {
      fail("row 4", `the hire never parked the row it was given (ledger: ${JSON.stringify((await lab.rows()).map((r) => [r.id, r.status]))})`);
    } else if (typeof parked.feedback !== "string" || parked.feedback.length === 0) {
      fail("row 4", `the hire parked row ${parked.id} with no reason on it, so there is no reason for the screen to show`);
    } else if (parkLine.seat !== owner) {
      fail("row 4", `row ${parked.id} parked on ${parkLine.seat}, not ${owner}, whose own file answers for "${piece.desk}"`);
    } else {
      const reason = parked.feedback;

      // ---- the screen ------------------------------------------------------
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.goto(served.origin, { waitUntil: "networkidle" });
      await openRun(page, owner, lab.seatSession(owner), parkLine.session);
      const onScreen = await readTaskRow(page, parked.id, (cells) => cells.Status === "parked");
      await page.screenshot({ path: join(SHOTS, "row4-parked.png") });

      if (onScreen === undefined) {
        fail("row 4", `the run ${parkLine.session} never showed row ${parked.id} as parked in its Tasks tab`);
      } else {
        if (onScreen.openExpanders !== 0) {
          fail("row 4", `${onScreen.openExpanders} expander(s) were open when the row was read; the reason has to be legible without one`);
        }
        // Waiting on a person is parked plus a reason, never a status of its own.
        const statuses: readonly string[] = taskStatusSchema.options;
        if (!statuses.includes(onScreen.cells.Status ?? "")) {
          fail("row 4", `the row's status reads ${JSON.stringify(onScreen.cells.Status)}, which is not a task status`);
        }
        const shown = onScreen.cells.Reason;
        if (shown === undefined) {
          // Tell "only in the expander" apart from "nowhere", so the red state
          // names what a reader would actually have to do.
          const inExpander = (await expanderText(page, parked.id)).includes(reason);
          fail(
            "row 4",
            `the parked row has no Reason column (columns: ${onScreen.headers.join(", ")}); ` +
              (inExpander
                ? "the reason is only inside the row's expander"
                : "the reason is not on screen at all, not even in the expander"),
          );
        } else if (shown !== reason) {
          fail("row 4", `the Reason cell reads ${JSON.stringify(shown)}; the row holds ${JSON.stringify(reason)}`);
        } else if (onScreen.reasonVisiblePx < 40) {
          fail("row 4", `the Reason cell is on the row but only ${Math.round(onScreen.reasonVisiblePx)}px of it can be seen`);
        } else if (onScreen.reasonTitle !== reason) {
          fail("row 4", `the Reason cell is clamped and its title reads ${JSON.stringify(onScreen.reasonTitle)}, so the whole reason is nowhere a reader can see it`);
        } else {
          if (onScreen.reasonCutByPane) {
            notes.push(
              `the Reason cell starts on screen but runs past the edge of the workspace pane at a 1600px window ` +
                `(${Math.round(onScreen.reasonVisiblePx)}px visible); the whole reason is on its title`,
            );
          }
          row4Evidence =
            `row 4 read on the multi-seat-collab hire: ${owner} parked row ${parked.id} on its own, and its run ` +
            `${parkLine.session}, opened from the navigator, showed it \`parked\` with "${reason}" in the Reason column, ` +
            `nothing expanded`;
        }
      }
      // Narrower windows, measured and noted rather than graded. Only when the
      // row has a Reason cell to measure.
      for (const width of onScreen?.cells.Reason === undefined ? [] : [1440, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300);
        const narrow = await readTaskRow(page, parked.id, (cells) => cells.Status === "parked");
        await page.screenshot({ path: join(SHOTS, `row4-parked-${width}.png`) });
        notes.push(
          `at a ${width}px window ${Math.round(narrow?.reasonVisiblePx ?? 0)}px of the Reason cell is visible` +
            (narrow?.reasonCutByPane === true
              ? narrow.paneScrolls
                ? "; the rest is a horizontal scroll away, not behind an expander"
                : "; the pane that cuts it does not scroll"
              : ""),
        );
      }
      await page.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    served.stop();
  }

  // ---- row 6 ---------------------------------------------------------------
  failures.push(ROW6_NOT_GRADED);

  // ---- the controls grade themselves ---------------------------------------
  if (CONTROL !== "") {
    const expected = EXPECTED[CONTROL];
    if (expected === undefined) throw new Error(`unknown control "${CONTROL}"`);
    const graded = failures.filter((line) => line !== ROW6_NOT_GRADED);
    const offLeg = graded.filter((line) => !expected.some((leg) => line.startsWith(`[${leg}]`)));
    const missing = expected.filter((leg) => !graded.some((line) => line.startsWith(`[${leg}]`)));
    if (missing.length > 0 || offLeg.length > 0) {
      failures.push(
        `the ${CONTROL} control must redden ${expected.join(" and ")} and nothing else` +
          (missing.length > 0 ? `; never reddened: ${missing.join(", ")}` : "") +
          (offLeg.length > 0 ? `; reddened elsewhere: ${offLeg.join(" | ")}` : ""),
      );
    }
  }

  if (row4Evidence !== "") notes.unshift(`row 4 PASS: ${row4Evidence}`);
  notes.push(`screenshots: ${SHOTS}`);
  // Notes ride along with a red verdict so a failure is read with them; on a
  // green one they are the evidence. Never failures on their own.
  return failures.length > 0
    ? { failures: [...failures, ...notes.map((note) => `(note) ${note}`)], evidence: "" }
    : { failures, evidence: notes.join("; ") };
}

mkdirSync(SHOTS, { recursive: true });
void runGoal(main);
