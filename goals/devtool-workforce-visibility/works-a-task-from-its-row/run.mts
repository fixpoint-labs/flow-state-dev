/**
 * Goal check: a developer opens a task in the DevTool's Tasks tab, reads its
 * whole record in place, changes it from the same row through the flow's own
 * actions, and sees the result on the row without a reload.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * The subject is the `multi-seat-collab` hire, served by the ordinary
 * `fsdev dev` over that lab's own config, and read in Chromium on the shipped
 * DevTool bundle at 1280x800. The lab's driver files and drains over HTTP to
 * make the subject rows; every change this goal grades is made from a row on
 * screen.
 *
 * Legs (every failure line is tagged with its leg, so a control can prove it
 * went red where it says it does and nowhere else):
 *
 *   read    collapsed, the parked row's status and 40px of its reason are in
 *           view; opened, every field the ledger holds is in the row and
 *           nothing overflows the pane
 *   answer  the seat's own `answer` action is offered on the row with the
 *           task id filled; after it runs the ledger row has left `parked`
 *           and the row on screen says so
 *   tool    on the mailbox's session, a board task tool run from a row
 *           changes the ledger and the row
 *   refuse  the same tool on the now-settled row shows the refusal on the
 *           row, and the ledger is unchanged
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/works-a-task-from-its-row/run.mts
 * Controls: GOAL_CONTROL=mailbox-actions-off (must FAIL at tool and refuse only)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Locator, Page } from "playwright";
import { SERVER_ONLY_TASK_FIELDS, taskToolSuffix } from "@flow-state-dev/orchestration";
import { MAILBOX_KIND } from "@flow-state-dev/workforce";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { readLabTree } from "../../../packages/shift-manager/test/fixtures/multi-seat-collab/host.mts";
import { Scenario, actionOutputOf, serveLab } from "../../multi-seat-collab/run-scenario.mts";
import { ANSWER_ENTRY, WORKER_KIND } from "../../../packages/shift-manager/test/fixtures/multi-seat-collab/workforce/flows/workers/worker.mts";

type Fixture = {
  piece: { goal: string; desk: string; asks: string };
  answer: string;
  spare: { goal: string };
  cancelReason: string;
};

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SHOTS = goalTmpDir("works-a-task-from-its-row");

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, readonly string[]> = {
  "mailbox-actions-off": ["tool", "refuse"],
};

/** The window the whole check runs at: a laptop, where the reason used to fall off screen. */
const VIEWPORT = { width: 1280, height: 800 };

/** The smallest visible area that counts as legible: 40px wide, one line tall. */
const MIN_VISIBLE_WIDTH = 40;
const MIN_VISIBLE_HEIGHT = 10;

/** How long a change made from a row gets to reach the ledger and the screen. */
const SETTLE_MS = 15_000;

/**
 * Ledger field -> the label the open row gives it. A ledger field outside this
 * map is shown under its own raw key (see {@link labelOf}).
 */
const FIELD_LABELS: Record<string, string> = {
  id: "Id",
  goal: "Goal",
  title: "Title",
  context: "Context",
  status: "Status",
  attempts: "Attempts",
  assignee: "Assignee",
  priority: "Priority",
  labels: "Labels",
  deps: "Deps",
  feedback: "Reason",
  error: "Error",
  input: "Input",
  output: "Output",
  metadata: "Metadata",
  revision: "Revision",
  createdAt: "Created",
  updatedAt: "Updated",
  startedAt: "Started",
  completedAt: "Completed",
  leaseUntil: "Lease until",
};

/** The label the open row gives a ledger field: its own, or its raw key. */
function labelOf(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** Fields the ledger keeps and never sends to a client, so no screen can show them. */
const SERVER_ONLY = new Set<string>(SERVER_ONLY_TASK_FIELDS);

const failures: string[] = [];
const notes: string[] = [];
function fail(leg: string, line: string): void {
  failures.push(`[${leg}] ${line}`);
}

// ---------------------------------------------------------------------------
// The DevTool's own navigation
// ---------------------------------------------------------------------------

async function waitForBadge(page: Page, sessionId: string): Promise<void> {
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(id)),
    sessionId,
    { timeout: 15_000 },
  );
}

/** Open a session from the navigator: the kind, the instance when the rail shows one, then the session. */
async function openSession(page: Page, kind: string, instance: string, sessionId: string): Promise<void> {
  const kindRow = page.locator(`[data-kind="${kind}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const instanceRow = page.locator(`[data-instance-id="${instance}"]`);
  if ((await instanceRow.count()) > 0 && (await instanceRow.getAttribute("aria-expanded")) !== "true") {
    await instanceRow.click();
  }
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await waitForBadge(page, sessionId);
}

async function openTasksTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.waitForFunction(
    () => document.querySelector("[role='tab'][aria-selected='true']")?.textContent?.trim() === "Tasks",
    undefined,
    { timeout: 10_000 },
  );
}

/** The row for one task in the active Tasks panel, by its id and nothing else. */
function rowLocator(page: Page, taskId: string): Locator {
  return page.locator(`main [role='tabpanel'][data-state='active'] [data-task-id="${taskId}"]`).first();
}

/** What a collapsed row shows, slot by slot, and how much of its reason a reader can see. */
interface CollapsedRead {
  status: string;
  reason: string | null;
  reasonTitle: string | null;
  reasonVisiblePx: number;
  reasonVisibleHeightPx: number;
  reasonHeightPx: number;
  open: boolean;
}

/** Read the row by task id, waiting until `until` holds, or `undefined` if it never did. */
async function readCollapsed(
  page: Page,
  taskId: string,
  until: (read: CollapsedRead) => boolean = () => true,
  ms = 10_000,
): Promise<CollapsedRead | undefined> {
  let last: CollapsedRead | undefined;
  for (let waited = 0; waited <= ms; waited += 250) {
    last = await page.evaluate((id) => {
      const panel = document.querySelector("main [role='tabpanel'][data-state='active']");
      const row = [...(panel?.querySelectorAll("[data-task-id]") ?? [])].find(
        (el) => el.getAttribute("data-task-id") === id,
      );
      if (row === undefined) return undefined;
      const status = (row.querySelector("[data-slot='status']")?.textContent ?? "").trim();
      const reasonEl = row.querySelector<HTMLElement>("[data-slot='reason']");
      let visiblePx = 0;
      let visibleHeightPx = 0;
      let heightPx = 0;
      if (reasonEl !== null) {
        // The slot's box, cut on both axes by every ancestor that clips and by
        // the window: what a reader can actually see of it.
        const box = reasonEl.getBoundingClientRect();
        heightPx = box.height;
        let left = Math.max(box.left, 0);
        let right = Math.min(box.right, window.innerWidth);
        let top = Math.max(box.top, 0);
        let bottom = Math.min(box.bottom, window.innerHeight);
        for (let el = reasonEl.parentElement; el !== null; el = el.parentElement) {
          const style = getComputedStyle(el);
          const clip = el.getBoundingClientRect();
          if (style.overflowX !== "visible") {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (style.overflowY !== "visible") {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        visibleHeightPx = Math.max(0, bottom - top);
        visiblePx = visibleHeightPx === 0 ? 0 : Math.max(0, right - left);
      }
      return {
        status,
        reason: reasonEl === null ? null : (reasonEl.textContent ?? "").trim(),
        reasonTitle: reasonEl?.getAttribute("title") ?? null,
        reasonVisiblePx: visiblePx,
        reasonVisibleHeightPx: visibleHeightPx,
        reasonHeightPx: heightPx,
        open: row.querySelector("button[aria-expanded='true']") !== null,
      };
    }, taskId);
    if (last !== undefined && until(last)) return last;
    await page.waitForTimeout(250);
  }
  return undefined;
}

/**
 * Open the row in place. Returns `false` when the row has no disclosure to
 * open, or opening it put nothing below it.
 */
async function openRow(page: Page, taskId: string): Promise<boolean> {
  const row = rowLocator(page, taskId);
  const toggle = row.locator("button[aria-expanded]").first();
  if ((await toggle.count()) === 0) return false;
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const controls = await toggle.getAttribute("aria-controls");
  if (controls === null) return false;
  return (await row.locator(`[id="${controls}"]`).count()) > 0;
}

/** The open row's field list, label -> text, and whether anything in it overflows the pane. */
async function readOpen(
  page: Page,
  taskId: string,
): Promise<{ fields: Record<string, string>; overflow: string[] }> {
  return await page.evaluate((id) => {
    const panel = document.querySelector<HTMLElement>("main [role='tabpanel'][data-state='active']");
    const row = [...(panel?.querySelectorAll("[data-task-id]") ?? [])].find(
      (el) => el.getAttribute("data-task-id") === id,
    );
    const fields: Record<string, string> = {};
    const overflow: string[] = [];
    if (panel === null || row === undefined) return { fields, overflow: ["the row is gone"] };
    for (const dt of row.querySelectorAll("dt")) {
      fields[(dt.textContent ?? "").trim()] = (dt.nextElementSibling?.textContent ?? "").trim();
    }
    // Nothing in the row may reach past the pane's right edge, and the pane
    // must not have grown a horizontal scroll to hold it.
    const pane = panel.getBoundingClientRect();
    const edge = Math.min(pane.right, window.innerWidth);
    for (const el of row.querySelectorAll<HTMLElement>("dt, dd, [data-slot]")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > edge + 1) {
        overflow.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ends at ${Math.round(box.right)}px, the pane at ${Math.round(edge)}px`);
      }
    }
    if (panel.scrollWidth > panel.clientWidth + 1) {
      overflow.push(`the pane scrolls sideways (${panel.scrollWidth}px of content in ${panel.clientWidth}px)`);
    }
    return { fields, overflow };
  }, taskId);
}

/** How one ledger value should read on the open row. */
function expectedText(key: string, value: unknown): string {
  if (!(key in FIELD_LABELS)) {
    // Shown under its raw key: a scalar as text, anything else as JSON.
    return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  }
  if (key.endsWith("At") || key === "leaseUntil") {
    return typeof value === "number" ? new Date(value).toISOString() : String(value);
  }
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

/** Whether the open row's text for one field shows the ledger's value. */
function shows(key: string, shown: string, value: unknown): boolean {
  if (key === "attempts") return shown.split("/")[0]!.trim() === String(value);
  // The caller skips null, so an "object" here is a record or an array. A
  // labelled list reads joined; every other structured value is
  // pretty-printed JSON, so compare it without whitespace.
  if (typeof value === "object" && (!Array.isArray(value) || !(key in FIELD_LABELS))) {
    return shown.replace(/\s+/g, "") === JSON.stringify(value).replace(/\s+/g, "");
  }
  return shown === expectedText(key, value);
}

/** The Actions strip of an open row: the buttons it offers, by name. */
async function offeredActions(page: Page, taskId: string): Promise<string[]> {
  const group = rowLocator(page, taskId).getByRole("group", { name: "Actions" });
  if ((await group.count()) === 0) return [];
  return await group.getByRole("button").allTextContents();
}

/**
 * Pick one action on the row, check its form carries the row's id, fill what
 * the caller asks, and run it. Returns why it could not, or the outcome the
 * row reports once it stops saying "Running".
 */
async function runFromRow(
  page: Page,
  taskId: string,
  action: string,
  fill: Record<string, string>,
): Promise<{ problem?: string; outcome?: string; text?: string }> {
  const row = rowLocator(page, taskId);
  const group = row.getByRole("group", { name: "Actions" });
  const button = group.getByRole("button", { name: action, exact: true });
  if ((await button.count()) === 0) return { problem: `the row does not offer "${action}"` };
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  const idField = row.locator('[data-field="taskId"] input').first();
  if ((await idField.count()) === 0) return { problem: `"${action}"'s form has no taskId field` };
  const idValue = await idField.inputValue();
  const locked = (await idField.getAttribute("readonly")) !== null || (await idField.isDisabled());
  if (idValue !== taskId || !locked) {
    return { problem: `"${action}"'s form carries taskId ${JSON.stringify(idValue)} (${locked ? "locked" : "editable"}), not the row's ${taskId}, locked` };
  }
  for (const [field, value] of Object.entries(fill)) {
    const input = row.locator(`[data-field="${field}"] input, [data-field="${field}"] textarea`).first();
    if ((await input.count()) === 0) return { problem: `"${action}"'s form has no ${field} field` };
    await input.fill(value);
  }
  const outcome = row.locator("[data-outcome]").first();
  const previous = (await outcome.count()) > 0 ? await outcome.getAttribute("data-outcome") : null;
  // A settled answer on screen from an earlier run is not this run's. Watch
  // the row from before the click, so a new answer is told apart from the old
  // one even when it arrives too fast to catch it running, or reads the same.
  await row.evaluate((el) => {
    const w = window as unknown as { __goalOutcomeMoved?: boolean };
    w.__goalOutcomeMoved = false;
    // Only a change to the outcome itself counts: its state, its text, or the
    // outcome being added or removed. (No named helpers in here: the page
    // does not have the bundler's name shim.)
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of [record.target, ...record.addedNodes, ...record.removedNodes]) {
          const element = node instanceof Element ? node : node.parentElement;
          if (element === null) continue;
          if (element.hasAttribute("data-outcome") || element.querySelector("[data-outcome]") !== null) w.__goalOutcomeMoved = true;
          if (record.type !== "childList" && element.closest("[data-outcome]") !== null) w.__goalOutcomeMoved = true;
        }
      }
    }).observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-outcome"] });
  });
  await row.getByRole("button", { name: /^run$/i }).click();
  if (previous !== null && previous !== "pending") {
    const moved = await page
      .waitForFunction(() => (window as unknown as { __goalOutcomeMoved?: boolean }).__goalOutcomeMoved === true, undefined, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!moved) return { problem: `the row kept showing the previous run's "${previous}" after "${action}" was run again` };
    // Past the old answer; what settles next is this run's.
    await page.waitForTimeout(250);
  }
  for (let waited = 0; waited <= SETTLE_MS; waited += 250) {
    const state = (await outcome.count()) > 0 ? await outcome.getAttribute("data-outcome") : null;
    if (state !== null && state !== "pending") {
      return { outcome: state, text: (await outcome.textContent()) ?? "" };
    }
    await page.waitForTimeout(250);
  }
  return { problem: `"${action}" run from the row never reported an outcome` };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main(): Promise<{ failures: string[]; evidence: string }> {
  if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) throw new Error(`unknown control "${CONTROL}"`);
  // The bundle the shell serves, built here so a stale one cannot be graded.
  execFileSync("pnpm", ["--filter", "@flow-state-dev/devtool", "build:assets"], { cwd: REPO_ROOT, stdio: "inherit" });

  const tree = await readLabTree();
  const owners = Object.entries(tree.declaredDesks).filter(([, desk]) => desk === fixture.piece.desk);
  if (owners.length !== 1) {
    throw new Error(`the fixture's desk "${fixture.piece.desk}" must be answered for by exactly one seat; the tree declares ${JSON.stringify(tree.declaredDesks)}`);
  }
  const [owner] = owners[0]!;
  const tool = `cancelTask_${taskToolSuffix(tree.boardId)}`;

  const served = await serveLab({ control: CONTROL, workDir: join(SHOTS, "server") });
  const lab = new Scenario(served, tree);
  let browser: Browser | undefined;
  const evidence: string[] = [];
  try {
    await lab.open();

    // ---- the subject: a row the hire parks on its own ------------------------
    const filed = await lab.file({ goal: fixture.piece.goal, desk: fixture.piece.desk, asks: fixture.piece.asks });
    if (filed.status !== "completed") throw new Error(`filing the piece ended ${filed.status ?? filed.refusal}`);
    await lab.drainAll();
    const parked = await lab.waitForRow((row) => row.goal === fixture.piece.goal && row.status === "parked");
    const parkLine = lab.workLines().find((line) => line.taskId === parked?.id && line.event === "parked");
    // The positive record before anything on screen is judged: without a parked
    // row carrying a reason, in a known run, there is nothing for the screen
    // to show and blaming the view would blame it for the subject.
    if (parked === undefined || parkLine === undefined || typeof parked.feedback !== "string" || parked.feedback.length === 0) {
      throw new Error(`the hire never parked the row with a reason (ledger: ${JSON.stringify((await lab.rows()).map((r) => [r.id, r.status, r.feedback]))})`);
    }
    const parkedId = String(parked.id);

    browser = await launchChromium();
    const page = await browser.newPage({ viewport: VIEWPORT });
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await page.goto(served.origin, { waitUntil: "networkidle" });

    // ---- read: collapsed, then open, in the run the row parked in ------------
    // A seat has no copy of its own: its session is on the one copy of the worker flow (a copy's id is its kind).
    await openSession(page, WORKER_KIND, WORKER_KIND, lab.seatSession(owner));
    await page.locator(`[data-session-id="${parkLine.session}"]`).click();
    await waitForBadge(page, parkLine.session);
    await openTasksTab(page);
    const collapsed = await readCollapsed(page, parkedId, (read) => read.status === "parked");
    await page.screenshot({ path: join(SHOTS, "read-collapsed.png") });
    if (collapsed === undefined) {
      fail("read", `the run ${parkLine.session} never showed row ${parkedId} as parked, found by its task id`);
    } else {
      if (collapsed.open) fail("read", `row ${parkedId} was already open when read collapsed`);
      if (collapsed.reason === null) {
        fail("read", `the collapsed row has no reason slot`);
      } else if (collapsed.reason !== parked.feedback && collapsed.reasonTitle !== parked.feedback) {
        fail("read", `the reason reads ${JSON.stringify(collapsed.reason)}; the ledger holds ${JSON.stringify(parked.feedback)}`);
      } else if (collapsed.reasonVisibleHeightPx < Math.min(MIN_VISIBLE_HEIGHT, collapsed.reasonHeightPx)) {
        fail("read", `the reason is out of view vertically at ${VIEWPORT.width}x${VIEWPORT.height}`);
      } else if (collapsed.reasonVisiblePx < MIN_VISIBLE_WIDTH) {
        fail("read", `only ${Math.round(collapsed.reasonVisiblePx)}px of the reason is in view at ${VIEWPORT.width}px`);
      } else if (collapsed.reasonTitle !== parked.feedback) {
        fail("read", `the reason is clamped and its title reads ${JSON.stringify(collapsed.reasonTitle)}`);
      } else {
        evidence.push(`read: row ${parkedId} collapsed shows "parked" and ${Math.round(collapsed.reasonVisiblePx)}px of its reason at ${VIEWPORT.width}px`);
      }
    }

    if (collapsed !== undefined && !(await openRow(page, parkedId))) {
      fail("read", `row ${parkedId} does not open in place`);
    } else if (collapsed !== undefined) {
      const ledgerNow = (await lab.rows()).find((row) => row.id === parkedId) ?? {};
      const open = await readOpen(page, parkedId);
      await page.screenshot({ path: join(SHOTS, "read-open.png") });
      const missing: string[] = [];
      const wrong: string[] = [];
      const serverOnly: string[] = [];
      let checked = 0;
      for (const [key, value] of Object.entries(ledgerNow)) {
        if (value === undefined || value === null) continue;
        if (SERVER_ONLY.has(key)) {
          serverOnly.push(key);
          continue;
        }
        // Every field the ledger carries is on the open row (BR-4): a listed
        // one under its label, any other under its raw key.
        const label = labelOf(key);
        checked += 1;
        const shown = open.fields[label];
        if (shown === undefined) missing.push(`${key} (${label})`);
        else if (!shows(key, shown, value)) wrong.push(`${label} reads ${JSON.stringify(shown.slice(0, 80))}, the ledger ${JSON.stringify(expectedText(key, value).slice(0, 80))}`);
      }
      if (missing.length > 0) fail("read", `the open row does not show ${missing.join(", ")}, which the ledger holds`);
      if (wrong.length > 0) fail("read", `the open row disagrees with the ledger: ${wrong.join("; ")}`);
      if (open.overflow.length > 0) fail("read", `the open row overflows the pane: ${open.overflow.join("; ")}`);
      if (serverOnly.length > 0) notes.push(`server-only ledger fields no client is sent, so not graded on screen: ${serverOnly.join(", ")}`);
      if (missing.length === 0 && wrong.length === 0 && open.overflow.length === 0) {
        evidence.push(`read: open, all ${checked} ledger fields a client is sent shown and matching, nothing past the pane`);
      }
    }

    // ---- answer: the seat's own action, from the row on the seat's session --
    await page.locator(`[data-session-id="${lab.seatSession(owner)}"]`).click();
    await waitForBadge(page, lab.seatSession(owner));
    await openTasksTab(page);
    const onSeat = await readCollapsed(page, parkedId);
    if (onSeat === undefined) {
      fail("answer", `${owner}'s own session never showed row ${parkedId}`);
    } else if (!(await openRow(page, parkedId))) {
      fail("answer", `row ${parkedId} on ${owner}'s session does not open, so it offers no actions`);
    } else {
      const offered = await offeredActions(page, parkedId);
      if (!offered.includes(ANSWER_ENTRY)) {
        fail("answer", `the parked row offers [${offered.join(", ")}], not the seat's own "${ANSWER_ENTRY}"`);
      } else {
        const ran = await runFromRow(page, parkedId, ANSWER_ENTRY, { feedback: fixture.answer });
        await page.screenshot({ path: join(SHOTS, "answer.png") });
        if (ran.problem !== undefined) {
          fail("answer", ran.problem);
        } else if (ran.outcome !== "ok") {
          fail("answer", `the answer run from the row reports ${ran.outcome}: ${ran.text}`);
        } else {
          const moved = await lab.waitForRow((row) => row.id === parkedId && row.status !== "parked", SETTLE_MS);
          if (moved === undefined) {
            fail("answer", `after the answer the ledger row is still parked`);
          } else {
            // The seats hand rows off: the answer's own request claims the row
            // on this session and the attempt that finishes it runs in a child
            // session of its own. So the row here shows the answer's claim, and
            // the row's run link is where the finish shows. Both are read on
            // screen, by following the row's own link, never by a typed URL.
            const here = await readCollapsed(page, parkedId, (read) => read.status !== "parked", SETTLE_MS);
            const final = (await lab.waitForRow((row) => row.id === parkedId && row.status === "completed", SETTLE_MS)) ?? moved;
            if (here === undefined) {
              fail("answer", `the ledger row is now "${final.status}"; the row on screen still reads "parked"`);
            } else if (here.status === final.status) {
              evidence.push(`answer: "${ANSWER_ENTRY}" run from the row with ${parkedId} locked in; ledger and row both "${final.status}"`);
            } else {
              const link = rowLocator(page, parkedId).locator("[data-slot='run'] button[title^='Open dispatch run']").first();
              if ((await link.count()) === 0) {
                fail("answer", `the row reads "${here.status}", the ledger "${final.status}", and the row has no link to the run that finished it`);
              } else {
                await link.click();
                await page.waitForFunction(
                  (seatSession) =>
                    ![...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(seatSession)),
                  lab.seatSession(owner),
                  { timeout: 15_000 },
                );
                await openTasksTab(page);
                const there = await readCollapsed(page, parkedId, (read) => read.status === final.status, SETTLE_MS);
                await page.screenshot({ path: join(SHOTS, "answer-run.png") });
                if (there === undefined) {
                  fail("answer", `the row reads "${here.status}"; the run its link opens never showed the ledger's "${final.status}"`);
                } else {
                  evidence.push(
                    `answer: "${ANSWER_ENTRY}" run from the row with ${parkedId} locked in; the row left parked ("${here.status}", the answer's claim) ` +
                      `and the run its link opens shows the ledger's "${final.status}"`,
                  );
                }
              }
            }
          }
        }
      }
    }

    // ---- tool: a board task tool, from a row on the mailbox's session --------
    // The row is filed through the mailbox's own `fileTask`, which every
    // mailbox with a board has whether or not it opted in to task actions, so
    // the mailbox's Tasks tab has it in both runs. Filed after the answer,
    // whose drain would otherwise take it.
    const mailboxSession = tree.mailbox.id;
    const spare = await lab.act(MAILBOX_KIND, mailboxSession, "fileTask", {
      board: tree.boardName,
      goal: fixture.spare.goal,
    });
    const spareId = (actionOutputOf(String(spare.requestId), spare.items) as { taskId?: string } | undefined)?.taskId;
    if (spare.status !== "completed" || spareId === undefined) {
      throw new Error(`filing the spare row on the mailbox ended ${spare.status ?? spare.refusal}`);
    }
    await openSession(page, MAILBOX_KIND, MAILBOX_KIND, mailboxSession);
    await openTasksTab(page);
    let settled: Record<string, unknown> | undefined;
    let toolRowOpen = false;
    if ((await readCollapsed(page, spareId)) === undefined) {
      fail("tool", `the mailbox's session never showed row ${spareId}, found by its task id`);
    } else if (!(await openRow(page, spareId))) {
      fail("tool", `row ${spareId} does not open, so it offers no actions`);
    } else {
      toolRowOpen = true;
      const offered = await offeredActions(page, spareId);
      if (!offered.includes(tool)) {
        fail("tool", `the mailbox's row offers [${offered.join(", ")}], not the board's "${tool}"`);
      } else {
        const ran = await runFromRow(page, spareId, tool, { reason: fixture.cancelReason });
        await page.screenshot({ path: join(SHOTS, "tool.png") });
        if (ran.problem !== undefined) {
          fail("tool", ran.problem);
        } else if (ran.outcome !== "ok") {
          fail("tool", `"${tool}" run from the row reports ${ran.outcome}: ${ran.text}`);
        } else {
          settled = await lab.waitForRow((row) => row.id === spareId && row.status === "cancelled", SETTLE_MS);
          if (settled === undefined) {
            fail("tool", `after "${tool}" the ledger row is "${(await lab.rows()).find((row) => row.id === spareId)?.status}", not cancelled`);
          } else if ((await readCollapsed(page, spareId, (read) => read.status === "cancelled", SETTLE_MS)) === undefined) {
            fail("tool", `the ledger row is cancelled; the row on screen still reads "${(await readCollapsed(page, spareId))?.status}"`);
          } else {
            evidence.push(`tool: "${tool}" run from the mailbox's row; ledger and row both "cancelled"`);
          }
        }
      }
    }

    // ---- refuse: the same tool on the row it just settled --------------------
    if (!toolRowOpen) {
      notes.push("refuse not graded: the mailbox's row never opened, which is the tool leg's failure");
    } else {
      const before = JSON.stringify((await lab.rows()).find((row) => row.id === spareId));
      const offered = await offeredActions(page, spareId);
      if (!offered.includes(tool)) {
        fail("refuse", `the mailbox's row offers [${offered.join(", ")}], so "${tool}" cannot be tried on it`);
      } else if (settled === undefined) {
        fail("refuse", `the row never settled, so there is no settled row to refuse on`);
      } else {
        const ran = await runFromRow(page, spareId, tool, { reason: fixture.cancelReason });
        await page.screenshot({ path: join(SHOTS, "refuse.png") });
        await page.waitForTimeout(500);
        const after = JSON.stringify((await lab.rows()).find((row) => row.id === spareId));
        if (ran.problem !== undefined) {
          fail("refuse", ran.problem);
        } else if (ran.outcome !== "refused") {
          fail("refuse", `"${tool}" on the settled row reports ${ran.outcome} (${ran.text}), not a refusal`);
        } else if (after !== before) {
          fail("refuse", `the refusal changed the ledger row: ${before} -> ${after}`);
        } else {
          evidence.push(`refuse: "${tool}" again on the cancelled row shows "${(ran.text ?? "").trim()}", ledger unchanged`);
        }
      }
    }

    // One load, at the start. A reload anywhere would let a stale screen pass.
    if (navigations !== 1) fail("reload", `the page navigated ${navigations} times; the check allows the one initial load`);
  } finally {
    await browser?.close().catch(() => {});
    served.stop();
  }

  // ---- the controls grade themselves --------------------------------------------
  if (CONTROL !== "") {
    const expected = EXPECTED[CONTROL]!;
    const graded = [...failures];
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

  notes.push(`screenshots: ${SHOTS}`);
  return failures.length > 0
    ? { failures: [...failures, ...notes.map((note) => `(note) ${note}`)], evidence: "" }
    : { failures, evidence: [...evidence, ...notes].join("; ") };
}

mkdirSync(SHOTS, { recursive: true });
void runGoal(main);
