/**
 * Goal check — two seats work one channel's board, a person answers a parked
 * row through the owning seat's own action, the work changes hands, and a
 * reader can say what happened from the DevTool's own screens.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * The server is the shipped `fsdev dev` over the lab's `fsdev.config.mts`, and
 * Chromium loads the shipped DevTool bundle, so what is graded is what a person
 * running the dev server sees — not a harness assembled around the pieces.
 *
 * Legs (every failure line is tagged with its leg, so a control can prove it
 * went red where it says it does and nowhere else):
 *
 *   V0  the tree declares the board by NAME, and the minted id is in no file
 *   V1  one row per piece, both directions; a row for nobody settles loudly
 *   V2  each row ran on the seat whose OWN FILE answers for its desk
 *   V3  the owning seat parks with the drain returning; the answer lands
 *       through that seat's action and the same seat finishes; a second
 *       delivery is declined
 *   V4  every claim belongs to a seat; an answer sent as a second person
 *       does not land
 *   V5  the finishing seat files a second row, for the other desk, naming the
 *       first; another seat runs it; the assignee is never moved
 *   V6  `TaskStatus` has gained no value
 *   VB  three screens, on the DevTool's own navigation, in a real browser
 *
 * Run:      pnpm tsx goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view/run.mts
 * Controls: GOAL_CONTROL=swapped-desks | ignore-the-answer | second-principal |
 *           silent-park | one-seat  (each must FAIL, at the legs goal.md names)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { LAB_USER_ID, readLabTree } from "../lab/host.mts";
import { Scenario, actionOutputOf, serveLab, terminationReasonOf, type ActResult } from "../lab/run-scenario.mts";
import { DRAIN_ENTRY, type WorkLine } from "../lab/workforce/flows/workers/worker.mts";

type Fixture = {
  piece: { goal: string; desk: string; asks: string; then: { goal: string; desk: string } };
  answer: string;
  secondAnswer: string;
  otherPrincipal: string;
  orphan: string;
};

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** Every file this proof ships — the lab and this goal — for V0's scan. */
const PROOF_DIR = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = goalTmpDir("multi-seat-collab");

/**
 * The legs each control must redden, and only those. `one-seat` is the one
 * that reddens two, and must redden BOTH: widening one seat's eligibility is
 * what puts a review row on a build seat (PLAN → Checks).
 */
const EXPECTED: Record<string, readonly string[]> = {
  "swapped-desks": ["V2"],
  "ignore-the-answer": ["V3"],
  "second-principal": ["V4"],
  "silent-park": ["VB"],
  "one-seat": ["V2", "V5"],
};

/**
 * `TaskStatus`, written out. **Pinned** — BR-20: a later widening (for
 * *handed-off*, *notified* or *waiting on you*) must fail here rather than pass.
 */
const TASK_STATUSES = ["pending", "in_progress", "blocked", "parked", "completed", "errored", "cancelled"];

/** How long a second person's delivery gets to land before it is judged not to have. */
const SECOND_PRINCIPAL_WINDOW_MS = 3_000;

const failures: string[] = [];
const notes: string[] = [];
function fail(leg: string, line: string): void {
  failures.push(`[${leg}] ${line}`);
}

function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

/** A Chromium already on the machine, when the pinned build is not. See `flow-instances`. */
function preinstalledChromium(): string | undefined {
  const pool = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pool === undefined || !existsSync(pool)) return undefined;
  for (const entry of readdirSync(pool)) {
    if (!entry.startsWith("chromium-")) continue;
    const binary = join(pool, entry, "chrome-linux", "chrome");
    if (existsSync(binary)) return binary;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The browser half: the DevTool's own navigation, nothing else
// ---------------------------------------------------------------------------

/** Open one session from the navigator: kind, then instance, then the session row. */
async function openSession(page: Page, kind: string, instance: string, sessionId: string): Promise<void> {
  const kindRow = page.locator(`[data-kind="${kind}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const instanceRow = page.locator(`[data-instance-id="${instance}"]`);
  if ((await instanceRow.getAttribute("aria-expanded")) !== "true") await instanceRow.click();
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await waitForBadge(page, sessionId);
}

async function waitForBadge(page: Page, sessionId: string): Promise<void> {
  await page.waitForFunction(
    (id) => [...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(id)),
    sessionId,
    { timeout: 15_000 },
  );
}

async function openBadgeSession(page: Page): Promise<string | undefined> {
  const title = await page.getByTitle(/^Session ID: /).getAttribute("title");
  return /^Session ID: (\S+)/.exec(title ?? "")?.[1];
}

/** One row of the Tasks tab, cell by column heading, or `undefined` if it never appeared. */
async function taskRow(
  page: Page,
  taskId: string,
  until: (cells: Record<string, string>) => boolean = () => true,
): Promise<
  { cells: Record<string, string>; hasLink: boolean; reasonClipped: boolean; reasonTitle: string | null } | undefined
> {
  const tab = page.getByRole("tab", { name: "Tasks" });
  await tab.click();
  await page.waitForFunction(
    () => document.querySelector("[role='tab'][aria-selected='true']")?.textContent?.trim() === "Tasks",
    undefined,
    { timeout: 10_000 },
  );
  for (let waited = 0; waited < 10_000; waited += 250) {
    const read = await page.evaluate((id) => {
      // Only the Tasks tab's own panel — never a table some other view drew.
      for (const table of document.querySelectorAll("main [role='tabpanel'][data-state='active'] table")) {
        const heads = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
        for (const tr of table.querySelectorAll("tbody tr")) {
          const tds = [...tr.querySelectorAll("td")];
          if ((tds[0]?.textContent ?? "").trim() !== id) continue;
          const cells: Record<string, string> = {};
          heads.forEach((head, i) => (cells[head] = (tds[i]?.textContent ?? "").trim()));
          const hasLink = tr.querySelector("button[title^='Open dispatch run']") !== null;
          const reasonCell = tds[heads.indexOf("Reason")];
          // A long note is clamped to the column and carries its whole text on
          // the cell's title — the DevTool's own design. Read both, so a clamp
          // is graded on the title rather than passed on text nobody can see.
          const reasonClipped = reasonCell !== undefined && reasonCell.scrollWidth > reasonCell.clientWidth;
          return { cells, hasLink, reasonClipped, reasonTitle: reasonCell?.getAttribute("title") ?? null };
        }
      }
      return undefined;
    }, taskId);
    if (read !== undefined && until(read.cells)) return read;
    await page.waitForTimeout(250);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
    return { failures: [`unknown control ${JSON.stringify(CONTROL)}`], evidence: "" };
  }
  const tree = await readLabTree();
  const seats = tree.workerIds;
  const desks = new Set(Object.values(tree.declaredDesks));

  // The fixture's desks have to be desks the TREE declares, or every leg below
  // grades a routing key nobody answers for.
  for (const desk of [fixture.piece.desk, fixture.piece.then.desk]) {
    if (!desks.has(desk)) {
      return { failures: [`the fixture names desk "${desk}", which no WORKER.md answers for`], evidence: "" };
    }
  }

  // ---- V0. the board by name, and the mint in no file ----------------------
  const files = treeFiles(PROOF_DIR);
  const declaring = files.filter((path) => path.endsWith("CHANNEL.md") && readFileSync(path, "utf8").includes(tree.boardName));
  if (declaring.length === 0) fail("V0", `no CHANNEL.md under the proof declares the board "${tree.boardName}" by name`);
  for (const path of files) {
    if (readFileSync(path, "utf8").includes(tree.boardId)) {
      fail("V0", `${path} writes the minted ledger id; a file declares a NAME`);
    }
  }

  // ---- V6. no new status --------------------------------------------------
  const statuses = [...taskStatusSchema.options];
  if (statuses.length === 0 || statuses.join(",") !== TASK_STATUSES.join(",")) {
    fail("V6", `TaskStatus is [${statuses.join(", ")}], not the written [${TASK_STATUSES.join(", ")}]`);
  }

  // The bundle the server hands out, built here so the run cannot grade a stale one.
  try {
    execFileSync("pnpm", ["--filter", "@flow-state-dev/devtool", "build:assets"], { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {
    throw new Error(
      "could not build the DevTool bundle. On a clean checkout build the package first:\n" +
        "  pnpm --filter @flow-state-dev/devtool build\n  pnpm --filter @flow-state-dev/devtool build:assets",
    );
  }

  const served = await serveLab({ control: CONTROL, workDir: join(SHOTS, "server") });
  const lab = new Scenario(served, tree);
  let browser: Browser | undefined;
  try {
    await lab.open();
    browser = await chromium.launch({ headless: true, ...(preinstalledChromium() === undefined ? {} : { executablePath: preinstalledChromium() }) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(served.origin, { waitUntil: "networkidle" });

    // ---- V1. the planner files one row ------------------------------------
    const filed = await lab.file({
      goal: fixture.piece.goal,
      desk: fixture.piece.desk,
      asks: fixture.piece.asks,
      then: fixture.piece.then,
    });
    if (filed.status !== "completed") fail("V1", `the planner's file request ended ${filed.status ?? filed.refusal}`);
    const first = await lab.waitForRow((row) => row.goal.includes(fixture.piece.goal));
    const rowsAfterFiling = await lab.rows();
    if (first === undefined) {
      // Nothing downstream can be graded against a row that does not exist.
      return { failures: [...failures, "[V1] no row carrying the piece of work ever reached the board"], evidence: "" };
    }
    const firstId = String(first.id);
    if (rowsAfterFiling.length !== 1) {
      fail("V1", `${rowsAfterFiling.length} rows landed for one piece of work (the channel has ${(tree.channel.declared.members as unknown[] | undefined)?.length ?? 0} members)`);
    }
    for (const row of rowsAfterFiling) {
      if (row.goal !== fixture.piece.goal) fail("V1", `row ${row.id} does not carry the piece verbatim: ${JSON.stringify(row.goal)}`);
      if (!desks.has(String(row.assignee))) fail("V1", `row ${row.id} is for "${row.assignee}", a desk no WORKER.md declares`);
    }

    // ---- V3 (BR-6). the owning seat parks, and the park holds no drain open --
    // The seats hand rows off, so the drain that claims the row returns as
    // soon as the row is running in its own child session ("handed-off") and
    // the park happens there, after. What BR-6 asks of a drain is therefore
    // asked of the NEXT one: run over a parked row, it must return rather than
    // wait on a person, name the park as why, and leave the row parked.
    const drain1 = await lab.drainAll();
    const parkedLines = () => lab.workLines().filter((line) => line.taskId === firstId && line.event === "parked");
    const parked = await lab.waitForRow((row) => row.id === firstId && row.status === "parked");
    const parkedLine = parkedLines()[0];
    if (parkedLine === undefined || parked === undefined) {
      return {
        failures: [...failures, `[V3] the first row never parked (lines: ${parkedLines().length}, status: ${(await lab.rows()).find((row) => row.id === firstId)?.status})`],
        evidence: "",
      };
    }
    const owner = parkedLine.seat;
    notes.push(`the claiming drain on ${owner} ended "${drain1.find((drain) => drain.seat === owner)?.terminationReason}"`);
    const overParked = await lab.act(owner, lab.seatSession(owner), DRAIN_ENTRY, {}, LAB_USER_ID, 10_000);
    const overParkedReason = terminationReasonOf(overParked.items);
    if (overParked.status !== "completed" || overParkedReason !== "parked-for-review") {
      fail("V3", `${owner}'s drain over the parked row ended ${overParked.status} / "${overParkedReason}", not completed / parked-for-review`);
    }
    const stillParked = (await lab.rows()).find((row) => row.id === firstId);
    if (stillParked?.status !== "parked") fail("V3", `after that drain returned the first row is "${stillParked?.status}", not parked`);

    // ---- VB (1). the seat's Tasks tab: the row, and its dispatch-run link --
    await page.locator('[data-kind="worker"]').click();
    const listed = await page.locator("[data-instance-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-instance-id")));
    for (const seat of seats) {
      if (!listed.includes(seat)) fail("VB", `the navigator has no row for seat ${seat} (listed: ${listed.join(", ")})`);
    }
    await openSession(page, "worker", owner, lab.seatSession(owner));
    const screen1 = await taskRow(page, firstId);
    await page.screenshot({ path: join(SHOTS, "1-seat-tasks.png") });
    if (screen1 === undefined) {
      fail("VB", `screen 1: ${owner}'s Tasks tab never showed row ${firstId}`);
    } else {
      if (screen1.cells.Goal !== fixture.piece.goal) fail("VB", `screen 1: the row's goal reads ${JSON.stringify(screen1.cells.Goal)}`);
      if (screen1.cells.Assignee !== fixture.piece.desk) fail("VB", `screen 1: the row's assignee reads ${JSON.stringify(screen1.cells.Assignee)}`);
      if (!screen1.hasLink) fail("VB", `screen 1: the row carries no link to the session it ran in`);
    }

    // ---- VB (2a). follow the link: the reason, with nothing expanded ------
    let childSession: string | undefined;
    if (screen1?.hasLink) {
      await page.locator("main tr", { hasText: firstId }).locator("button[title^='Open dispatch run']").click();
      await page.waitForFunction(
        (seatSession) => ![...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(seatSession)),
        lab.seatSession(owner),
        { timeout: 15_000 },
      );
      childSession = await openBadgeSession(page);
      if (childSession !== parkedLine.session) {
        fail("VB", `screen 2: the link opened ${childSession}, not ${parkedLine.session}, where the row ran`);
      }
      const screen2 = await taskRow(page, firstId, (cells) => cells.Status === "parked");
      await page.screenshot({ path: join(SHOTS, "2a-child-parked.png") });
      const expanded = await page.locator("main details[open]").count();
      if (expanded !== 0) fail("VB", `screen 2: ${expanded} expander(s) open; the reason must be legible without one`);
      if (screen2 === undefined) {
        fail("VB", `screen 2: the child session never showed row ${firstId} parked`);
      } else if (screen2.cells.Reason === undefined || screen2.cells.Reason.length === 0 || screen2.cells.Reason === "—") {
        fail("VB", `screen 2: the parked row shows no reason — a reader cannot say what it waits for`);
      } else if (screen2.cells.Reason !== (parked?.feedback ?? "")) {
        fail("VB", `screen 2: the reason reads ${JSON.stringify(screen2.cells.Reason)}, the row holds ${JSON.stringify(parked?.feedback)}`);
      } else if (screen2.reasonClipped) {
        if (screen2.reasonTitle !== parked?.feedback) {
          fail("VB", `screen 2: the reason is clamped on screen and its title reads ${JSON.stringify(screen2.reasonTitle)}`);
        } else {
          notes.push("the reason is clamped to its column on screen and whole on hover");
        }
      }
    }

    // ---- V4 (BR-9). a second person's answer does not land ----------------
    const beforeOther = JSON.stringify((await lab.rows()).find((row) => row.id === firstId));
    let otherPerson: ActResult | undefined;
    try {
      otherPerson = await lab.answer(
        owner,
        firstId,
        fixture.answer,
        CONTROL === "second-principal" ? LAB_USER_ID : fixture.otherPrincipal,
        SECOND_PRINCIPAL_WINDOW_MS,
      );
    } catch (error) {
      fail("V4", `the second person's delivery never reached the server: ${error instanceof Error ? error.message : String(error)}`);
    }
    // The positive record first: the delivery reached the server, either as a
    // request on the owning seat or as an explicit refusal at the door. Only
    // then is its fate judged. An explicit 401/403 is the loud refusal FIX-1511
    // would give — stronger than today's hang, so it counts. Anything else
    // that is not a 202 with a request id proves nothing about the fence.
    if (otherPerson !== undefined) {
      if (otherPerson.httpStatus === 401 || otherPerson.httpStatus === 403) {
        notes.push(`the second person's delivery was refused at the door (${otherPerson.httpStatus} ${otherPerson.refusal})`);
      } else if (otherPerson.httpStatus !== 202 || otherPerson.requestId === undefined) {
        fail("V4", `the second person's delivery came back ${otherPerson.httpStatus} ${otherPerson.refusal ?? "with no request id"} — neither an explicit refusal nor a request the fence was exercised on`);
      } else {
        notes.push(`the second person's delivery was admitted as ${otherPerson.requestId} and ${otherPerson.status === "in_progress" ? `was still in_progress after ${SECOND_PRINCIPAL_WINDOW_MS} ms` : `ended ${otherPerson.status}`}`);
      }
    }
    const afterOther = JSON.stringify((await lab.rows()).find((row) => row.id === firstId));
    if (afterOther !== beforeOther) {
      fail("V4", `an answer sent as a second person moved the row: ${beforeOther} -> ${afterOther}`);
    }

    // ---- V3 (BR-7). the person answers through the owning seat's action ----
    const answered = await lab.answer(owner, firstId, fixture.answer);
    if (answered.status !== "completed") fail("V3", `the answer request ended ${answered.status ?? answered.refusal}`);    const afterAnswer = (await lab.rows()).find((row) => row.id === firstId);
    const finishedFirst = lab.workLines().filter((line) => line.taskId === firstId && line.event === "finished");
    if (afterAnswer?.status !== "completed") fail("V3", `after the answer the first row is "${afterAnswer?.status}", not completed`);
    if (afterAnswer?.feedback !== fixture.answer) fail("V3", `after the answer the row carries ${JSON.stringify(afterAnswer?.feedback)}, not the answer`);
    if (parkedLines().length !== 1) fail("V3", `the first row parked ${parkedLines().length} times; the answered attempt must finish, not ask again`);
    if (finishedFirst.length !== 1) {
      fail("V3", `the first row finished ${finishedFirst.length} times`);
    } else {
      if (finishedFirst[0]!.seat !== owner) fail("V3", `the row parked on ${owner} and finished on ${finishedFirst[0]!.seat}`);
      if (finishedFirst[0]!.answer !== fixture.answer) fail("V3", `the finishing attempt read ${JSON.stringify(finishedFirst[0]!.answer)} as its answer`);
      // The answer ran the work in the answering request itself: the claim the
      // finishing attempt ran under was made by an `answer` request on the
      // owning seat's own session — not by a later drain that happened by.
      const claimer = (await lab.requests(lab.seatSession(owner))).find(
        (request) => request.id === finishedFirst[0]!.claimedByRequest,
      );
      if (claimer?.actionName !== "answer") {
        fail("V3", `the finishing attempt ran under a claim made by ${finishedFirst[0]!.claimedByRequest} (${claimer?.actionName ?? "not on " + owner}), not by the answer`);
      }
    }

    // ---- the other seat drains --------------------------------------------
    await lab.drainAll();

    // ---- V3 (BR-10). one park, one answer ---------------------------------
    const beforeSecond = JSON.stringify((await lab.rows()).find((row) => row.id === firstId));
    const linesBeforeSecond = lab.workLines().length;
    const second = await lab.answer(owner, firstId, fixture.secondAnswer);
    // Completed is the positive record: an id the ledger did not hold would
    // have thrown, so this delivery found the row — and wrote nothing to it.
    if (second.status !== "completed") fail("V3", `the second delivery ended ${second.status ?? second.refusal}, so it never reached the row`);
    // The answer door's own verdict, not just its silence: one park takes one
    // answer, so the second must come back declined — the row is settled, so
    // `terminal`. An `unchanged` or an accepted no-op would leave the row and
    // the work file exactly as a decline does, and only this catches it.
    const secondOutcome = actionOutputOf(String(second.requestId), second.items) as
      | { outcome?: string; reason?: string }
      | undefined;
    if (secondOutcome?.outcome !== "declined" || secondOutcome.reason !== "terminal") {
      fail("V3", `the second delivery was not declined as terminal: ${JSON.stringify(secondOutcome)}`);
    }
    const afterSecond = JSON.stringify((await lab.rows()).find((row) => row.id === firstId));
    if (afterSecond !== beforeSecond) fail("V3", `a second delivery changed the answered row: ${afterSecond}`);
    if (lab.workLines().length !== linesBeforeSecond) fail("V3", `a second delivery ran the work again`);

    // ---- VB (2b, 3). the answer in its place; both rows on the ledger ------
    const ledgerNow = await lab.rows();
    const firstNow = ledgerNow.find((row) => row.id === firstId);
    if (childSession !== undefined) {
      // Re-selected through the navigator, the way a person comes back to it.
      await openSession(page, "worker", owner, lab.seatSession(owner));
      await page.locator(`[data-session-id="${childSession}"]`).click();
      await waitForBadge(page, childSession);
      const screen2b = await taskRow(page, firstId, (cells) => cells.Status === firstNow?.status);
      await page.screenshot({ path: join(SHOTS, "2b-child-answered.png") });
      if (screen2b === undefined) {
        fail("VB", `screen 2: after the answer the child session never showed the row as "${firstNow?.status}"`);
      } else if ((screen2b.cells.Reason ?? "") !== (firstNow?.feedback ?? "")) {
        fail("VB", `screen 2: after the answer the row reads ${JSON.stringify(screen2b.cells.Reason)}, the row holds ${JSON.stringify(firstNow?.feedback)}`);
      }
    }
    // Screen 3: the ledger collection, on the Resources panel of the session
    // open now — any session whose flow declares the ledger will do.
    const aside = page.locator("aside").last();
    await page.getByTitle("Refresh debug resources").click();
    await aside.getByRole("button", { name: new RegExp(`^\\s*${tree.boardId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
    for (const row of ledgerNow) {
      const topic = aside.getByRole("button", { name: String(row.id), exact: true });
      try {
        await topic.waitFor({ timeout: 10_000 });
        await topic.click();
      } catch {
        fail("VB", `screen 3: the ledger collection does not list row ${row.id}`);
      }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SHOTS, "3-resources.png"), fullPage: true });
    const byRow = await Promise.all(
      ledgerNow.map(async (row) => {
        const box = aside.locator("div", { has: page.getByRole("button", { name: String(row.id), exact: true }) }).last();
        return { row, text: (await box.count()) > 0 ? await box.innerText() : "" };
      }),
    );
    const workLines = lab.workLines();
    for (const { row, text } of byRow) {
      // A listed row whose body shows nothing is a screen a person cannot read,
      // and must fail here — skipping it would pass screen 3 on no data at all.
      if (!text.includes(`"id": "${row.id}"`)) {
        fail("VB", `screen 3: row ${row.id} is listed but its expanded body shows none of it`);
        continue;
      }
      const shown = (field: string) => new RegExp(`"${field}":\\s*"([^"]*)"`).exec(text)?.[1];
      if (shown("status") !== row.status) fail("VB", `screen 3: row ${row.id} reads "${shown("status")}", the ledger holds "${row.status}"`);
      if (shown("assignee") !== row.assignee) fail("VB", `screen 3: row ${row.id}'s assignee reads "${shown("assignee")}", the ledger holds "${row.assignee}"`);
      const ranOn = workLines.find((line) => line.taskId === row.id && line.event === "finished")?.seat;
      if (ranOn !== undefined && shown("seat") !== ranOn) {
        fail("VB", `screen 3: row ${row.id} does not say it ran on ${ranOn} (reads "${shown("seat")}")`);
      }
    }

    // ---- V1 (BR-5). a row for nobody, loudly --------------------------------
    await lab.file({ goal: fixture.orphan, maxAttempts: 1 });
    const orphan: Record<string, any> | undefined = await lab.waitForRow((row) => row.goal === fixture.orphan);
    if (orphan === undefined) {
      fail("V1", `the row for nobody never reached the board`);
    } else {
      if (orphan.assignee !== undefined) fail("V1", `the row for nobody was filed for "${orphan.assignee}"`);
      await lab.drainAll();
      const settled = (await lab.rows()).find((row) => row.id === orphan.id);
      if (settled?.status !== "errored") {
        fail("V1", `the row for nobody is "${settled?.status}"; it must be refused where it would have run, not wait`);
      } else if (!String(settled.error ?? "").includes(String(orphan.id))) {
        fail("V1", `the refusal does not name the row: ${JSON.stringify(settled.error)}`);
      }
      if (lab.workLines().some((line) => line.taskId === orphan.id)) fail("V1", `the row for nobody ran anyway`);
    }

    // ---- V2. each row against the file of the seat that ran it ---------------
    const rowsNow = await lab.rows();
    const ran: WorkLine[] = lab.workLines();
    if (ran.length === 0) fail("V2", `no row ran at all`);
    for (const line of ran) {
      const row = rowsNow.find((candidate) => candidate.id === line.taskId);
      const oracle = tree.declaredDesks[line.seat];
      if (row?.assignee !== oracle) {
        fail("V2", `row ${line.taskId} is for "${row?.assignee}" and ran on ${line.seat}, whose own file answers for "${oracle}"`);
      }
      if (line.declaredDesk !== oracle) {
        fail("V2", `${line.seat} reported answering for "${line.declaredDesk}" from inside its run; its file says "${oracle}"`);
      }
    }

    // ---- V4 (BR-8). every claim belongs to a seat ----------------------------
    const changes = await lab.changes();
    const claims = changes.filter((change) => change.kind === "claimed");
    for (const id of [...new Set(ran.map((line) => line.taskId))]) {
      if (!claims.some((claim) => claim.taskId === id)) fail("V4", `row ${id} ran with no claim on record`);
    }
    for (const claim of claims) {
      if (!seats.includes(claim.flowId) || claim.sessionId !== lab.seatSession(claim.flowId)) {
        fail("V4", `row ${claim.taskId} was claimed from ${claim.flowId} session ${claim.sessionId}, not from a seat's own session`);
      }
      if (claim.action !== "drain" && claim.action !== "answer") fail("V4", `row ${claim.taskId} was claimed by a "${claim.action}" request`);
      if (claim.userId !== LAB_USER_ID) fail("V4", `row ${claim.taskId} was claimed as ${claim.userId}`);
    }
    // Every claim that reached a worker left its coordinate on the row, and the
    // row's own record is read from inside the attempt: it must be the own
    // session of the seat that ran it. A claim that reached no worker — the row
    // for nobody — settled in the request that claimed it, so its change is
    // there, and that request must be a seat's too.
    for (const line of ran) {
      if (line.claimedBySession !== lab.seatSession(line.seat)) {
        fail("V4", `row ${line.taskId} ran on ${line.seat} under a claim made from ${line.claimedBySession}`);
      }
    }
    for (const settled of changes.filter((change) => change.kind === "errored")) {
      if (!seats.includes(settled.flowId) || settled.sessionId !== lab.seatSession(settled.flowId)) {
        fail("V4", `row ${settled.taskId} was taken and refused from ${settled.flowId} session ${settled.sessionId}`);
      }
    }
    // And the row for nobody must HAVE such a record: an errored row with no
    // seat-originated claim or refusal behind it could have been settled by
    // anything, and the loop above passes on nothing at all.
    if (orphan !== undefined) {
      const takenBySeat = changes.filter(
        (change) =>
          change.taskId === orphan.id &&
          (change.kind === "claimed" || change.kind === "errored") &&
          seats.includes(change.flowId) &&
          change.sessionId === lab.seatSession(change.flowId) &&
          (change.action === "drain" || change.action === "answer") &&
          change.userId === LAB_USER_ID,
      );
      if (takenBySeat.length === 0) {
        fail("V4", `the row for nobody (${orphan.id}) has no claim or refusal on record from a seat's own drain`);
      }
    }

    // ---- V5. the handoff ----------------------------------------------------
    const finishedFirstLine = ran.find((line) => line.taskId === firstId && line.event === "finished");
    if (finishedFirstLine === undefined) {
      notes.push("V5 not graded: the first row never finished, which is V3's failure");
    } else {
      const secondId = finishedFirstLine.filed;
      const secondRow = rowsNow.find((row) => row.id === secondId);
      if (secondId === null || secondRow === undefined) {
        fail("V5", `the seat that finished the first row filed nothing for the next desk`);
      } else {
        if (secondRow.input?.follows !== firstId) fail("V5", `the second row does not name the first (follows: ${secondRow.input?.follows})`);
        if (secondRow.assignee !== fixture.piece.then.desk) fail("V5", `the second row is for "${secondRow.assignee}", not "${fixture.piece.then.desk}"`);
        if (secondRow.assignee === first.assignee) fail("V5", `both rows are for "${secondRow.assignee}"; nothing changed hands`);
        const secondRan = ran.find((line) => line.taskId === secondId && line.event === "finished");
        if (secondRan === undefined) {
          fail("V5", `the second row never ran`);
        } else {
          if (secondRan.seat === finishedFirstLine.seat) {
            fail("V5", `both rows ran on ${secondRan.seat}; one seat instance did the whole thing and nothing changed hands`);
          }
          const session = (await lab.sessions()).find((candidate) => candidate.id === secondRan.session);
          if (session?.parentSessionId !== lab.seatSession(secondRan.seat)) {
            fail("V5", `the second row ran in ${secondRan.session}, not a child of ${secondRan.seat}'s own session`);
          }
          if (secondRow.status !== "completed") fail("V5", `the second row is "${secondRow.status}"`);
        }
      }
      if (finishedFirstLine.reassign?.outcome !== "declined" || finishedFirstLine.reassign.reason !== "immutable-assignee") {
        fail("V5", `moving the first row's assignee was not refused as immutable-assignee: ${JSON.stringify(finishedFirstLine.reassign)}`);
      }
      const firstFinal = rowsNow.find((row) => row.id === firstId);
      if (firstFinal?.assignee !== first.assignee) fail("V5", `the first row's assignee moved to "${firstFinal?.assignee}"`);
    }
  } finally {
    await browser?.close().catch(() => {});
    served.stop();
  }

  // ---- the controls grade THEMSELVES --------------------------------------
  // A control certifies that THIS check fails when THIS thing breaks, so it
  // must go red at the legs it names and at no other.
  if (CONTROL !== "") {
    const expected = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((line) => /^\[(\w+)\]/.exec(line)?.[1]));
    const offLeg = failures.filter((line) => !expected.some((leg) => line.startsWith(`[${leg}]`)));
    const missing = expected.filter((leg) => !legs.has(leg));
    if (failures.length === 0) {
      failures.push(`the ${CONTROL} control did not go red at all; ${expected.join(" and ")} do not grade what they claim`);
    } else if (offLeg.length > 0 || missing.length > 0) {
      failures.push(
        `the ${CONTROL} control must redden ${expected.join(" and ")} and nothing else` +
          (missing.length > 0 ? `; never reddened: ${missing.join(", ")}` : "") +
          (offLeg.length > 0 ? `; reddened elsewhere: ${offLeg.join(" | ")}` : ""),
      );
    }
  }

  return {
    failures,
    evidence:
      `the shipped \`fsdev dev\` served a hire read from ${tree.roster.workers.length} WORKER.md files and one CHANNEL.md ` +
      `declaring board "${tree.boardName}" (its minted id appears in no file). The planner filed one row for "${fixture.piece.desk}"; ` +
      `the seat whose own file answers for it parked it with the question, and its drain returned; a second person's answer did not land; ` +
      `the person's answer through that seat's own action did, and the same seat finished the row and filed the next one for ` +
      `"${fixture.piece.then.desk}", which the other seat ran in its own child session; moving the assignee was refused; ` +
      `a row for nobody was refused by name; every claim came from a seat's own session. In Chromium on the shipped bundle: the seat's ` +
      `Tasks tab showed the row and its link, the child session showed the reason with nothing expanded and then the answer, and ` +
      `the ledger collection showed both rows with their assignees and the seat that ran each. ` +
      (notes.length > 0 ? `Notes: ${notes.join("; ")}. ` : "") +
      `Screenshots: ${SHOTS}`,
  };
}

mkdirSync(SHOTS, { recursive: true });
void runGoal(async () => {
  const result = await main();
  // Notes travel with a failure too — a control's red state is read with them.
  if (result.failures.length > 0 && notes.length > 0) {
    return { ...result, failures: [...result.failures, ...notes.map((note) => `(note) ${note}`)] };
  }
  return result;
});
