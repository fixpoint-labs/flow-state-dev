/**
 * Goal check: a person who asks `support.help` for a real person sees the case
 * appear in the escalations panel as a row with its status, in a list, with no
 * reload, in that tab and in any other tab open on the demo.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * Two tabs on the app's PRODUCTION build (built here, never assumed), on its
 * scripted model, keyless. Tab 2 is opened first and never picks anything.
 * Tab 1 opens `support.help` and posts two cases that need a person, each with
 * a fresh token, the second once the first has settled. Neither tab is
 * reloaded until the last leg. Five legs:
 *
 *   row        within 10 s of Send, tab 1's escalations panel holds a row
 *              carrying the case's token; the second case's row shows above
 *              the first's.
 *   other-tab  the same, in tab 2.
 *   status     every time a case's row is drawn, in either tab, open or after
 *              the reload, it reads `pending`, and the board draws no status
 *              column.
 *   once       no reading shows a case's row twice, and after the final
 *              reload each case is one row in each tab.
 *   no-poll    at most two board reads per tab between Send and the row, and
 *              none in a 10 s window once the first case has settled.
 *
 * Everything graded is read off the pages. The server is read only to know
 * when a case has settled, and nothing it says is graded.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/lists-a-filed-case-without-a-reload/run.mts
 * Controls: GOAL_CONTROL=no-live    (must FAIL at row and other-tab, and nothing else)
 *           GOAL_CONTROL=main       (the app before the list, from a checkout of it: row, other-tab and status)
 *           GOAL_CONTROL=no-filing  (every leg but no-poll)
 * Held-out: GOAL_SEAT=<another specialist>
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadFixture, runGoal } from "../../lib/index.mts";
import {
  buildKitchenSink,
  open,
  panel,
  readUntil,
  row,
  startKitchenSink,
  type KitchenSinkServer,
} from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Fixture {
  port: number;
  channel: { kind: string; id: string; board: string };
  seat: string;
  specialists: string[];
  /** What a post carries for the scripted specialist to file it. */
  marker: string;
  /** The status word every filed row shows: nothing works the board. */
  status: string;
  rowWithinMs: number;
  maxBoardReads: number;
  idleMs: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const SEAT = process.env.GOAL_SEAT ?? fixture.seat;
const CONTROL = process.env.GOAL_CONTROL ?? "";
const CHANNEL = fixture.channel.id;
const BOARD_REF = `${CHANNEL}.${fixture.channel.board}`;

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // The page's panels don't follow their session: no row until the reload,
  // where it shows as a list with its status, once.
  "no-live": ["row", "other-tab"],
  // The app before the list, run from a checkout of it with this directory
  // copied in: status columns, read once. The app knows no control by this
  // name; it tells this run which legs must fail.
  main: ["row", "other-tab", "status"],
  // The specialist says it filed and files nothing. No row anywhere, so the
  // "filed" line alone never passes; nothing changes, so nothing is read.
  "no-filing": ["row", "other-tab", "status", "once"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}
if (!fixture.specialists.includes(SEAT)) {
  throw new Error(`GOAL_SEAT "${SEAT}" is not one of the specialists: ${fixture.specialists.join(", ")}`);
}

/**
 * The page's query. `no-live` lives in the browser, and a client component
 * cannot read `GOAL_CONTROL`, so the page is opened with it instead; the app
 * honours it only in a test-mode build.
 */
const PAGE_QUERY = CONTROL === "no-live" ? "?goalControl=no-live" : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const secs = (from: number, to: number | undefined) => (to === undefined ? "never" : `+${((to - from) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// The pages, as a person uses them
// ---------------------------------------------------------------------------

/** Load the page, with the control's query, and wait until it can be used. */
async function openPage(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/${PAGE_QUERY}`);
  await page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });
}

/** Open the channel's panel. */
async function openChannel(page: Page, origin: string): Promise<void> {
  await openPage(page, origin);
  await open(page, fixture.channel.kind);
  await row(page, CHANNEL).click();
  await panel(page).getByTestId("channel-transcript").waitFor({ timeout: 15_000 });
}

/** The escalations board in the team panel. */
const boardPanel = (page: Page) => page.getByTestId(`board-${BOARD_REF}`);

/** Wait until a tab's board has been read: drawn, and no longer loading. Not graded. */
async function boardDrawn(page: Page): Promise<void> {
  await boardPanel(page).locator('[data-panel="board"]').first().waitFor({ timeout: 15_000 });
  await readUntil(() => boardPanel(page).locator('[data-state="loading"]').count(), (n) => n === 0, 10_000);
}

interface DrawnRow {
  text: string;
  /** The row's status word, or `null` when the row draws none. */
  status: string | null;
}

interface Reading {
  at: number;
  rows: DrawnRow[];
  /** How many status columns the board draws. */
  columns: number;
}

/** The board as drawn: each row, in order, and how many status columns. */
async function readBoard(page: Page): Promise<Reading> {
  const drawn = await boardPanel(page).evaluate((el) => ({
    rows: [...el.querySelectorAll("li[data-task-id]")].map((li) => ({
      text: li.textContent ?? "",
      status: li.querySelector("[data-task-status]")?.textContent ?? null,
    })),
    columns: el.querySelectorAll("[data-column]").length,
  }));
  return { at: Date.now(), ...drawn };
}

/** When a tab read the board, through whichever session (`GET …/sessions/<id>/resources/<board>`). */
function boardReads(page: Page): number[] {
  const at: number[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/flows/sessions/") && path.endsWith(`/resources/${BOARD_REF}`)) at.push(Date.now());
  });
  return at;
}

/** Post a line from the channel's panel once its composer is free. Returns when Send was pressed. */
async function send(page: Page, line: string): Promise<number> {
  const box = panel(page).getByLabel("Post to this channel");
  await readUntil(async () => (await box.isEnabled()) && (await box.inputValue()) === "", (free) => free, 10_000);
  await box.fill(line);
  await panel(page).getByRole("button", { name: "Send" }).click();
  return Date.now();
}

type Line = { author?: string; body: string };

/**
 * Wait until the case carrying `token` has settled: a seat's line follows the
 * person's, and the board keeps its row. Read off the server, never graded;
 * under a control that files nothing, it simply runs out.
 */
async function settled(page: Page, origin: string, token: string): Promise<void> {
  await readUntil(
    async () => {
      const res = await page.request.get(`${origin}/api/flows/sessions/${CHANNEL}/state?include_items=true&item_types=component&limit=1000`);
      const items = ((await res.json()) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
      return items.filter((item) => item.component === "channel-post").map((item) => item.data!);
    },
    (lines) => {
      const at = lines.findIndex((l) => l.author === undefined && l.body.includes(token));
      return at !== -1 && lines.slice(at + 1).some((l) => l.author !== undefined);
    },
    20_000,
  );
  await readUntil(
    async () => (await page.request.get(`${origin}/api/flows/sessions/${CHANNEL}/resources/${BOARD_REF}`)).text(),
    (body) => body.includes(token),
    10_000,
  );
}

// ---------------------------------------------------------------------------

interface Tab {
  /** The leg this tab's rows are graded under. */
  leg: "row" | "other-tab";
  name: string;
  page: Page;
  reads: number[];
  /** Full page loads since setup. */
  loads: number;
}

interface Case {
  token: string;
  line: string;
  sentAt: number;
  /** Per tab: when the row first showed, where it sat, and the most copies one reading held. */
  seen: Map<Tab, { rowAt?: number; order?: string[]; most: number }>;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const run = randomUUID().replace(/-/g, "").slice(0, 10);

  // Every status problem once, however many readings showed it.
  const statusProblems = new Set<string>();
  let statusRowsRead = 0;
  const checkStatus = (where: string, reading: Reading, token: string) => {
    for (const drawn of reading.rows.filter((r) => r.text.includes(token))) {
      statusRowsRead += 1;
      if (drawn.status !== fixture.status) {
        statusProblems.add(`${where}: the row carrying ${token} shows the status ${drawn.status === null ? "(none drawn)" : JSON.stringify(drawn.status)} (want "${fixture.status}")`);
      }
    }
    if (reading.columns > 0 && reading.rows.some((r) => r.text.includes(token))) {
      statusProblems.add(`${where}: the board draws ${reading.columns} status columns (want one list)`);
    }
  };

  const cases: Case[] = [
    "the charger caught fire and the desk smells of smoke",
    "the replacement charger is sparking too",
  ].map((ask, i) => {
    const token = `case-token-${"ab"[i]}${run}`;
    return { token, line: `[route:${SEAT}] ${fixture.marker} ${token} ${ask}`, sentAt: 0, seen: new Map() };
  });

  /** Fold one reading of a tab's board into what each sent case has seen. */
  const observe = (tab: Tab, reading: Reading) => {
    for (const c of cases) {
      if (c.sentAt === 0) continue;
      const mine = reading.rows.filter((r) => r.text.includes(c.token));
      const seen = c.seen.get(tab) ?? { most: 0 };
      seen.most = Math.max(seen.most, mine.length);
      if (mine.length > 0) {
        checkStatus(`${tab.name}, open`, reading, c.token);
        if (seen.rowAt === undefined) {
          seen.rowAt = reading.at;
          seen.order = reading.rows.map((r) => cases.find((k) => r.text.includes(k.token))?.token ?? "");
        }
      }
      c.seen.set(tab, seen);
    }
  };

  buildKitchenSink();

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    // Keyless: the scripted model answers, and no key is there to fall back on.
    server = await startKitchenSink(fixture.port, { AI_GATEWAY_API_KEY: "" });
    const origin = server.origin;

    // Tab 2 first, and it never picks anything.
    const otherPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const otherReads = boardReads(otherPage);
    await openPage(otherPage, origin);
    await boardDrawn(otherPage);

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageReads = boardReads(page);
    await openChannel(page, origin);
    await boardDrawn(page);

    const tabs: Tab[] = [
      { leg: "row", name: "tab 1", page, reads: pageReads, loads: 0 },
      { leg: "other-tab", name: "tab 2", page: otherPage, reads: otherReads, loads: 0 },
    ];
    for (const tab of tabs) tab.page.on("load", () => (tab.loads += 1));

    for (const [i, c] of cases.entries()) {
      c.sentAt = await send(page, c.line);
      const deadline = c.sentAt + fixture.rowWithinMs;
      while (Date.now() < deadline && tabs.some((t) => c.seen.get(t)?.rowAt === undefined)) {
        for (const tab of tabs) observe(tab, await readBoard(tab.page));
        await sleep(100);
      }

      const name = `case ${i + 1} (${c.token})`;
      for (const tab of tabs) {
        const seen = c.seen.get(tab) ?? { most: 0 };
        if (seen.rowAt === undefined || seen.rowAt > deadline) {
          fail(tab.leg, `${name}: ${tab.name}'s escalations panel showed no row carrying the token within ${fixture.rowWithinMs / 1000}s of Send, with no reload (seen ${secs(c.sentAt, seen.rowAt)})`);
        } else if (i > 0) {
          const order = seen.order ?? [];
          const mine = order.indexOf(c.token);
          const earlier = order.indexOf(cases[i - 1]!.token);
          if (earlier === -1) {
            fail(tab.leg, `${name}: ${tab.name} showed its row without the earlier case's`);
          } else if (mine > earlier) {
            fail(tab.leg, `${name}: ${tab.name} showed its row below the earlier case's (want newest first)`);
          }
        }
        const window = tab.reads.filter((at) => at >= c.sentAt && at <= (seen.rowAt ?? deadline)).length;
        if (window > fixture.maxBoardReads) {
          fail("no-poll", `${name}: ${tab.name} read the board ${window} times between Send and the row (at most ${fixture.maxBoardReads})`);
        }
        evidence.push(`${name}, ${tab.name}: row ${secs(c.sentAt, seen.rowAt)}, ${window} board reads`);
      }

      // Let the case settle before the next post, or the idle window, so the
      // route is free and nothing is still on its way. Not graded; readings
      // meanwhile still count for status and once.
      await settled(page, origin, c.token);
      for (const tab of tabs) observe(tab, await readBoard(tab.page));

      if (i === 0) {
        const from = Date.now();
        while (Date.now() < from + fixture.idleMs) {
          for (const tab of tabs) observe(tab, await readBoard(tab.page));
          await sleep(250);
        }
        for (const tab of tabs) {
          const idle = tab.reads.filter((at) => at >= from).length;
          if (idle > 0) {
            fail("no-poll", `${tab.name} read the board ${idle} times in ${fixture.idleMs / 1000}s with nothing changing (want none)`);
          }
        }
        evidence.push(`no board reads in either tab in ${fixture.idleMs / 1000}s idle`);
      }
    }

    // A reload or navigation before the last leg voids the run.
    for (const tab of tabs) {
      if (tab.loads > 0) fail("void", `${tab.name} reloaded or navigated ${tab.loads} times before the last leg`);
    }
    for (const c of cases) {
      for (const tab of tabs) {
        const most = c.seen.get(tab)?.most ?? 0;
        if (most > 1) fail("once", `${c.token}: while open, one reading of ${tab.name} showed its row ${most} times`);
      }
    }

    // ---- once, after the final reload of each tab ---------------------------
    for (const tab of tabs) {
      await tab.page.reload();
      await tab.page.locator('[data-testid="message-input"]:visible').waitFor({ state: "visible", timeout: 30_000 });
      await boardDrawn(tab.page);
      const reading = await readUntil(
        () => readBoard(tab.page),
        (r) => cases.every((c) => r.rows.some((drawn) => drawn.text.includes(c.token))),
        10_000,
      );
      for (const c of cases) {
        const count = reading.rows.filter((drawn) => drawn.text.includes(c.token)).length;
        if (count !== 1) {
          fail("once", `after the reload, ${tab.name}'s escalations panel holds ${count} rows carrying ${c.token} (want 1)`);
        }
        checkStatus(`${tab.name}, after the reload`, reading, c.token);
      }
    }
    evidence.push("after the reload, each case is one row in each tab");
  } finally {
    await browser.close();
    server?.stop();
  }

  if (statusRowsRead === 0) {
    fail("status", "no row carrying this run's tokens was drawn in either tab, open or after the reload, so no status could be read");
  }
  for (const problem of statusProblems) fail("status", problem);
  if (statusRowsRead > 0 && statusProblems.size === 0) {
    evidence.push(`every row drawn reads "${fixture.status}", in one list`);
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
