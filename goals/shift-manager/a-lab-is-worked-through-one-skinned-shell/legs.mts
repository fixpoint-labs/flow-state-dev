/**
 * The closure's legs: a (DevForce, a real model on a4), b (pentest, keyless,
 * plus the org step), and c (no theme, light and dark). Each leg reports its
 * failures by signal (`a1`, `b:teams`, `c:tool` …) so the driver can grade a
 * control by which signals it reddened, and which it left green.
 *
 * Every row on the page is compared by id with what the running Lab's store
 * returns through its shipped routes, read with this script's own requests.
 * Nothing here reads Shift Manager's own state.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Browser, Page } from "playwright";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { hex, near, parseColour, readShiftManagerTheme, type Rgb } from "../../lib/colour.mts";
import { REPO_ROOT } from "../../lib/index.mts";
import { findThemeValues, themeValues } from "../../../labs/design-system/test/theme.ts";
import {
  SHIFT_MANAGER,
  attr,
  diff,
  injected,
  labApi,
  open,
  readPainted,
  readStore,
  readTree,
  resumed,
  same,
  sendAndWatch,
  settled,
  sleep,
  startShiftManager,
  visible,
  type LabApi,
  type PageRead,
  type Running,
  type Sample,
  type Store,
  type StoredRow,
  type Tree,
} from "./shell.mts";

/** The trees the epic pins, and the Labs each leg opens. */
export const TREES = {
  devforce: join(REPO_ROOT, "goals", "devforce-lab", "lab", "workforce"),
  pentest: join(REPO_ROOT, "goals", "pentest-lab", "lab", "workforce"),
  runLab: join(REPO_ROOT, "goals", "shift-manager", "it-shows-and-stops-a-task-run", "lab", "workforce"),
};
export const PENTEST_CONFIG = join(REPO_ROOT, "goals", "pentest-lab", "lab", "fsdev.config.mts");
const RUN_LAB_CONFIG = join(REPO_ROOT, "goals", "shift-manager", "it-shows-and-stops-a-task-run", "lab", "fsdev.config.mts");
const ASK_LAB_CONFIG = join(SHIFT_MANAGER, "test", "fixtures", "ask-lab", "fsdev.config.mts");

/** The model keys a keyless leg must not carry. */
const MODEL_KEYS = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"];
const KEYLESS = Object.fromEntries(MODEL_KEYS.map((k) => [k, ""]));

/** Where a leg reports to. `signal` is what a control is graded against. */
export type Report = { fail: (signal: string, why: string) => void; note: (line: string) => void };
/** What every leg is handed. */
export type LegCtx = { scratch: string; pages: string; browser: Browser; report: Report };

const token = (what: string) => `${what}-${randomBytes(4).toString("hex")}`;

async function newPage(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15_000);
  // tsx compiles with esbuild's keepNames, which wraps nested functions in an
  // in-page function with a `__name` helper the page lacks.
  await page.addInitScript("globalThis.__name = (fn) => fn;");
  return { page, errors };
}

const tabSelected = (page: Page, tab: string) => page.locator(`[role=tab][data-tab=${tab}][aria-selected=true]`).waitFor({ timeout: 10_000 }).then(
  () => true,
  () => false,
);

/** The documents under a tree's `resources/` folders that let a browser read them. */
function readableDocuments(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".md") && /[/\\]resources[/\\]/.test(full)) {
        const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(full, "utf8"))?.[1] ?? "";
        if (/client:\s*\n\s+content:\s*\n\s+read:\s*true/.test(front)) out.push(relative(root, full));
      }
    }
  };
  walk(root);
  return out;
}

// ---- a3 / b's reach: every surface, by clicking from the first screen ---------

/**
 * Walk every surface ER-1 names, by clicking from the first screen, and grade
 * each against the store. `reach` failures go to `signals.reach`, seat-list
 * failures to `signals.teams`. Returns what the org switcher names.
 */
export async function walkSurfaces(
  page: Page,
  origin: string,
  store: Store,
  tree: Tree,
  signals: { reach: string; teams: string },
  report: Report,
  options: { taskLevel: boolean } = { taskLevel: true },
): Promise<{ orgShown: string }> {
  const reach = (why: string) => report.fail(signals.reach, why);
  const teams = (why: string) => report.fail(signals.teams, why);
  const rows = Object.values(store.rows).flat();

  // The first screen.
  await open(page, origin, "/");
  if (!(await visible(page, "cos"))) reach("the first screen is not Chief of Staff");
  if ((await page.getByTestId("nav-cos").getAttribute("aria-current")) !== "page") reach("Chief of Staff's sidebar entry is not current on the first screen");
  if (!(await visible(page, "cos-summary"))) reach("Chief of Staff draws no shift summary");
  if (!(await visible(page, "cos-panel"))) reach("Chief of Staff has no right panel");

  // The org switcher: it names an org, and opens.
  const switcher = page.getByTestId("org-switcher");
  const orgShown = ((await switcher.locator("span.truncate").first().textContent().catch(() => null)) ?? "").trim();
  await switcher.locator("button[aria-haspopup=menu]").click();
  if (!(await page.locator("[data-testid=org-switcher] [role=menu]").isVisible().catch(() => false))) reach("the org switcher does not open");
  await switcher.locator("button[aria-haspopup=menu]").click();

  // Jump to: a workstream, a worker, a task and a declared document.
  const docs = readableDocuments(tree.root);
  const targets: Array<{ group: string; query: string; lands: string }> = [
    { group: "Workstreams", query: tree.channels[0]!.id, lands: `[data-testid=workstream][data-channel-id="${tree.channels[0]!.id}"]` },
    { group: "Workers", query: store.seats[0] ?? "", lands: "[data-testid=roster]" },
    ...(rows[0] === undefined ? [] : [{ group: "Tasks", query: rows[0].title.slice(0, 24), lands: `[data-testid=task-frame][data-task-id="${rows[0].id}"]` }]),
    ...(docs[0] === undefined ? [] : [{ group: "Resources", query: docs[0].split(/[/\\]/).at(-1)!.replace(/\.md$/, ""), lands: "[data-testid=resource]" }]),
  ];
  for (const target of targets) {
    await page.getByTestId("jump-to").click();
    await page.getByTestId("jump-input").fill(target.query);
    const hit = page.locator(`[data-testid=jump-dialog] section[aria-label="${target.group}"] [data-testid=jump-result]`).first();
    if (!(await hit.waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
      reach(`Jump to finds no ${target.group} entry for "${target.query}"`);
      await page.keyboard.press("Escape");
      continue;
    }
    await hit.click();
    if (!(await page.locator(target.lands).first().waitFor({ timeout: 10_000 }).then(() => true, () => false))) reach(`Jump to's ${target.group} entry "${target.query}" does not open its screen`);
  }
  if (docs.length === 0) report.note(`${tree.root}: no browser-readable document declared, so Jump to's Resources is not walked`);

  // Inbox.
  await page.getByTestId("nav-inbox").click();
  if (!(await visible(page, "inbox"))) reach("Inbox does not open");
  const listed = await attr(page, "inbox-item", "data-suspension-id");
  if (store.asks.length === 0) {
    if (!(await visible(page, "inbox-empty", 3_000))) reach("no ask is pending and Inbox's empty state is not named");
  } else if (!same(listed, store.asks.map((a) => a.suspensionId))) reach(`Inbox lists ${diff(store.asks.map((a) => a.suspensionId), listed)}`);

  // Tasks, in each grouping.
  await page.getByTestId("nav-tasks").click();
  if (!(await visible(page, "tasks"))) reach("Tasks does not open");
  const open_ = rows.filter((r) => r.status !== "completed" && r.status !== "cancelled").map((r) => `${r.ref}/${r.id}`);
  for (const grouping of ["state", "worker", "stream"]) {
    await page.locator(`[role=tab][data-grouping=${grouping}]`).click();
    if (!(await page.locator(`[role=tab][data-grouping=${grouping}][aria-selected=true]`).waitFor({ timeout: 5_000 }).then(() => true, () => false))) reach(`Tasks' ${grouping} grouping is not selected`);
    if (open_.length === 0) {
      if (!(await visible(page, "tasks-empty", 3_000))) reach("no open row and Tasks' empty state is not named");
      continue;
    }
    const shown = (await page.getByTestId("task-row").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`))) as string[];
    if (!same(shown, open_)) reach(`Tasks by ${grouping}: ${diff(open_, shown)}`);
  }

  // Roster, all teams.
  await page.getByTestId("nav-roster").click();
  if (!(await visible(page, "roster"))) reach("Roster does not open");
  else {
    await page.getByTestId("roster-worker").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    const all = await attr(page, "roster-worker", "data-seat-id");
    if (!same(all, store.seats)) teams(`Roster (all) lists ${diff(store.seats, all)}`);
  }

  // TEAMS: one row per team, a square per seat, and each row opens Roster for it.
  const teamRows = await attr(page, "team", "data-team");
  const wantTeams = [...new Set(store.seats.map((s) => (s.includes(".") ? s.split(".")[0]! : "Staff")))];
  if (!same(teamRows, wantTeams)) teams(`TEAMS rows: ${diff(wantTeams, teamRows)}`);
  const squares = await attr(page, "worker", "data-seat-id");
  if (!same(squares, store.seats)) teams(`TEAMS squares: ${diff(store.seats, squares)}`);
  for (const team of teamRows) {
    const want = store.seats.filter((s) => (s.includes(".") ? s.split(".")[0] : "Staff") === team);
    const under = (await page.locator(`[data-testid=team][data-team="${team}"] [data-testid=worker]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-seat-id") ?? ""))) as string[];
    if (!same(under, want)) teams(`team ${team}'s squares: ${diff(want, under)}`);
    await page.locator(`[data-testid=team][data-team="${team}"]`).click();
    if ((await page.locator(`[data-testid=team][data-team="${team}"]`).getAttribute("aria-current")) !== "page") reach(`team ${team}'s row is not current once opened`);
    const title = (await page.getByTestId("roster-title").textContent().catch(() => "")) ?? "";
    if (!title.includes(team)) reach(`Roster opened from team ${team} is titled "${title}"`);
    await sleep(300);
    const filtered = await attr(page, "roster-worker", "data-seat-id");
    if (!same(filtered, want)) teams(`Roster for team ${team} lists ${diff(want, filtered)}`);
  }

  // PROJECTS: the workstreams.
  const streams = (await page.locator("[data-testid^=nav-workstream-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""))).map((t) =>
    t.slice("nav-workstream-".length),
  );
  if (!same(streams, store.channels.map((c) => c.id))) reach(`PROJECTS lists ${diff(store.channels.map((c) => c.id), streams)}`);

  // The Day / Night switch: there, and each half marks itself when clicked.
  if (!(await visible(page, "shift-switch", 3_000))) reach("the Day / Night switch is not in the sidebar");
  else {
    const day = (await page.getByTestId("shift-day").getAttribute("aria-pressed")) === "true";
    const other = day ? "shift-night" : "shift-day";
    const back = day ? "shift-day" : "shift-night";
    await page.getByTestId(other).click();
    if ((await page.getByTestId(other).getAttribute("aria-pressed")) !== "true") reach(`the switch does not mark ${other} once clicked`);
    await page.getByTestId(back).click();
    if ((await page.getByTestId(back).getAttribute("aria-pressed")) !== "true") reach(`the switch does not mark ${back} once clicked back`);
  }

  // The project level: No project, then each of the store's projects, in four
  // tabs. A tab draws the store's content, or its named empty state when the
  // store holds none: No project has no room and no brief.
  const inProject = new Set(store.projects.flatMap((p) => p.workstreams));
  const levels = [
    { id: "unassigned", nav: "projects-heading", room: false, brief: null, workstreams: store.channels.map((c) => c.id).filter((id) => !inProject.has(id)) },
    ...store.projects.map((p) => ({ id: p.id, nav: `nav-project-${p.id}`, room: true, brief: p.brief, workstreams: p.workstreams })),
  ];
  const holdsBoard = new Set(tree.channels.filter((c) => c.boardRefs.length > 0).map((c) => c.id));
  for (const level of levels) {
    const where = level.id === "unassigned" ? "No project" : `project ${level.id}`;
    await page.getByTestId(level.nav).click();
    if (!(await page.locator(`[data-testid=project][data-project-id="${level.id}"]`).waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
      reach(`${where} does not open`);
      continue;
    }
    for (const tab of ["stream", "board", "workstreams", "brief"]) {
      await page.locator(`[role=tab][data-tab=${tab}]`).click();
      if (!(await tabSelected(page, tab))) reach(`${where}'s ${tab} tab is not selected`);
      if (tab === "stream") {
        // A project's room as this person reaches it: read, or Join, or members only. No project has none.
        const named = level.room ? "[data-testid=stream], [data-testid=project-stream-join], [data-testid=project-stream-members-only]" : "[data-testid=project-stream-none]";
        if (!(await page.locator(named).first().waitFor({ timeout: 10_000 }).then(() => true, () => false))) reach(`${where}'s Stream shows ${level.room ? "neither its room nor a named state" : "no named empty state"}`);
      } else if (tab === "board") {
        const lanesWanted = level.workstreams.filter((id) => holdsBoard.has(id));
        if (lanesWanted.length === 0) {
          if (!(await visible(page, "project-board-none"))) reach(`${where} holds no board and its Board shows no named empty state`);
        } else {
          await page.getByTestId("project-lane").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
          const lanes = await attr(page, "project-lane", "data-channel-id");
          if (!same(lanes, lanesWanted)) reach(`${where}'s Board lanes: ${diff(lanesWanted, lanes)}`);
          for (const id of lanesWanted) {
            const cards = (await page.locator(`[data-testid=project-lane][data-channel-id="${id}"] [data-testid=board-card]`).evaluateAll((els) => els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`))) as string[];
            const want = (store.rows[id] ?? []).map((r) => `${r.ref}/${r.id}`);
            if (!same(cards, want)) reach(`${where}'s ${id} lane: ${diff(want, cards)}`);
          }
        }
      } else if (tab === "workstreams") {
        if (level.workstreams.length === 0) {
          if (!(await visible(page, "project-workstreams-none"))) reach(`${where} lists no workstream and says nothing`);
        } else {
          await page.getByTestId("project-workstream").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
          const listed = await attr(page, "project-workstream", "data-channel-id");
          if (!same(listed, level.workstreams)) reach(`${where}'s Workstreams: ${diff(level.workstreams, listed)}`);
        }
      } else if (level.brief === null) {
        if (!(await visible(page, "project-brief-none"))) reach(`${where} has no brief and its Brief shows no named empty state`);
      } else {
        const shown = ((await page.getByTestId("project-brief").textContent({ timeout: 10_000 }).catch(() => null)) ?? "").trim();
        if (shown !== level.brief.trim()) reach(`${where}'s Brief reads "${shown.slice(0, 80)}", the row's is "${level.brief.slice(0, 80)}"`);
      }
    }
  }

  // Each workstream: four tabs, the right panel, the board, and the task level from a card.
  for (const channel of tree.channels) {
    await page.getByTestId(`nav-workstream-${channel.id}`).click();
    await page.locator(`[data-testid=workstream][data-channel-id="${channel.id}"]`).waitFor();
    if (!(await visible(page, "workstream-panel"))) reach(`${channel.id} has no right panel`);
    const members = await attr(page, "panel-member", "data-seat-id");
    if (!same(members, channel.members)) reach(`${channel.id}'s panel team: ${diff(channel.members, members)}`);
    if (!(await tabSelected(page, "stream"))) reach(`${channel.id} does not open on its Stream tab`);
    if (!(await visible(page, "composer", 5_000))) reach(`${channel.id}'s Stream has no composer`);

    await page.locator("[role=tab][data-tab=board]").click();
    if (!(await tabSelected(page, "board"))) reach(`${channel.id}'s Board tab is not selected`);
    const here = store.rows[channel.id] ?? [];
    if (channel.boardRefs.length === 0) {
      if (!(await visible(page, "board-none"))) reach(`${channel.id} attaches no board and its Board tab doesn't say so`);
    } else if (!(await visible(page, "board"))) {
      reach(`${channel.id}'s Board tab shows no board`);
    } else {
      const cards = (await page.getByTestId("board-card").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`))) as string[];
      const want = here.map((r) => `${r.ref}/${r.id}`);
      if (!same(cards, want)) reach(`${channel.id}'s Board: ${diff(want, cards)}`);
    }
    await page.locator("[role=tab][data-tab=brief]").click();
    if (!(await tabSelected(page, "brief"))) reach(`${channel.id}'s Brief tab is not selected`);
    if (!(await visible(page, "brief", 5_000)) && !(await visible(page, "empty-state", 1_000))) reach(`${channel.id}'s Brief shows neither a charter nor a named empty state`);
    await page.locator("[role=tab][data-tab=results]").click();
    if (!(await tabSelected(page, "results"))) reach(`${channel.id}'s Results tab is not selected`);
    if (!(await visible(page, "empty-state"))) reach(`${channel.id}'s Results shows no named empty state`);

    const first = here[0];
    if (first !== undefined) {
      await page.locator("[role=tab][data-tab=board]").click();
      await page.locator(`[data-testid=board-card][data-task-id="${first.id}"]`).click();
      await page.locator(`[data-testid=task-frame][data-task-id="${first.id}"]`).waitFor();
      if (!(await visible(page, "task-panel-slot"))) reach(`the task frame for ${first.id} has no right panel`);
      for (const tab of ["session", "diff", "checks", "brief"]) {
        await page.locator(`[role=tab][data-tab=${tab}]`).click();
        if (!(await tabSelected(page, tab))) reach(`the task frame's ${tab} tab is not selected`);
        if (!(await visible(page, "task-slot"))) reach(`the task frame's ${tab} tab shows nothing`);
      }
    }
  }
  if (options.taskLevel && rows.length === 0) reach("no board holds a row, so the task level was never reached");
  return { orgShown };
}

// ---- leg a: DevForce, a real model on a4 --------------------------------------

/** How long the real harness may take to start a run once the ask is approved. */
const RUN_STARTS_MS = 4 * 60_000;
/** a4's window for the seat's answer in its running task session. Never retried (QR-9). */
const ANSWER_MS = 10 * 60_000;
/** How long a4 lets a running task's harness confirm its session before the turn goes in. */
const A4_SETTLE_MS = 15_000;
/** How long a2 waits for the store to hold an item the Session drew while the run streamed it. */
const STORED_BY_MS = 5 * 60_000;

/** The DevForce Lab served as Shift Manager's DevTeam profile. */
async function startDevTeam(ctx: LegCtx, label: string, harness: "claude-code" | "stub", shift?: "day" | "night"): Promise<Running> {
  return startShiftManager(ctx.scratch, label, {
    team: "devteam",
    pages: ctx.pages,
    shift,
    env: harness === "stub" ? { ...KEYLESS, DEVFORCE_LAB_HARNESS: "stub" } : { DEVFORCE_LAB_HARNESS: "claude-code" },
  });
}

/** The first row on the store that is running and linked to its run. */
async function runningRow(api: LabApi, tree: Tree, userId: string, withinMs: number): Promise<StoredRow | undefined> {
  for (const until = Date.now() + withinMs; Date.now() < until; await sleep(500)) {
    const store = await readStore(api, tree, userId);
    const row = Object.values(store.rows).flat().find((r) => r.status === "in_progress" && r.run !== null);
    if (row !== undefined) return row;
  }
  return undefined;
}

/** The Inbox journey: select the ask, see the stream's card, approve it. Returns the ask approved. */
async function inboxJourney(page: Page, api: LabApi, store: Store, tree: Tree, signal: string, report: Report): Promise<boolean> {
  const fail = (why: string) => report.fail(signal, why);
  const ask = store.asks[0];
  if (ask === undefined) {
    fail("no ask is pending in the store, so there is nothing to answer");
    return false;
  }
  const workstream = tree.channels.find((c) => c.members.includes(ask.seat))?.id;
  await page.getByTestId("nav-inbox").click();
  const item = page.locator(`[data-testid=inbox-item][data-suspension-id="${ask.suspensionId}"]`);
  if (!(await item.waitFor({ timeout: 15_000 }).then(() => true, () => false))) {
    fail(`Inbox does not list ${ask.suspensionId}, pending in the store`);
    return false;
  }
  const kind = (await item.getByTestId("inbox-item-kind").textContent()) ?? "";
  const shownStream = (await item.getByTestId("inbox-item-workstream").textContent()) ?? "";
  if (kind.trim() === "") fail("the ask's Inbox item names no kind");
  if (workstream !== undefined && shownStream.trim() !== workstream) fail(`the ask's Inbox item names workstream "${shownStream}", the asking seat's is ${workstream}`);
  await item.click();
  const detailCard = page.locator(`[data-testid=inbox-detail] [data-testid=ask-card][data-suspension-id="${ask.suspensionId}"]`);
  if (!(await detailCard.waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
    fail("the detail pane draws no ask card for the selected ask");
    return false;
  }
  const detailText = ((await detailCard.textContent()) ?? "").trim();
  if (workstream !== undefined) {
    await page.getByTestId(`nav-workstream-${workstream}`).click();
    const streamCard = page.locator(`[data-testid=stream-asks] [data-testid=ask-card][data-suspension-id="${ask.suspensionId}"]`);
    if (!(await streamCard.waitFor({ timeout: 10_000 }).then(() => true, () => false))) fail(`${workstream}'s stream shows no card for the ask`);
    else if (((await streamCard.textContent()) ?? "").trim() !== detailText) fail("the detail pane's card and the stream's card differ");
    await page.getByTestId("nav-inbox").click();
    await item.click();
  }
  await page.locator("[data-testid=inbox-detail]").getByRole("button", { name: "Approve" }).click();
  let gone = false;
  let stored = false;
  for (const until = Date.now() + 30_000; Date.now() < until && !(gone && stored); await sleep(250)) {
    gone = (await item.count()) === 0;
    stored = await resumed(api, ask.sessionId, ask.suspensionId);
  }
  if (!stored) fail(`after Approve the seat's session ${ask.sessionId} holds no resume for ${ask.suspensionId}`);
  if (!gone) fail("after Approve the ask is still listed in Inbox");
  if (workstream !== undefined) {
    await page.getByTestId(`nav-workstream-${workstream}`).click();
    await page.getByTestId("stream-asks").waitFor({ timeout: 10_000 }).catch(() => undefined);
    await sleep(500);
    if ((await page.locator(`[data-testid=stream-asks] [data-testid=ask-card][data-suspension-id="${ask.suspensionId}"] button:not([disabled])`).count()) > 0) {
      fail(`${workstream}'s stream still offers an answer on the approved ask`);
    }
  }
  report.note(`${signal}: ${kind.trim()} ask ${ask.suspensionId} from ${ask.seat} on ${shownStream.trim()}, approved; resume stored ${stored}, gone from Inbox ${gone}`);
  return stored;
}

/** a2's reading of a task frame: its Session draws the run session's items, by id, and its inspector links the trace. */
async function taskJourney(page: Page, api: LabApi, row: StoredRow, devtool: string | null, signal: string, report: Report, from: string): Promise<void> {
  const fail = (why: string) => report.fail(signal, `[from ${from}] ${why}`);
  await page.locator(`[data-testid=task-frame][data-task-id="${row.id}"]`).waitFor({ timeout: 15_000 });
  if (!(await tabSelected(page, "session"))) fail("the task does not open on its Session tab");
  const drawnIds = async () => (await page.locator("[data-testid=session-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id") ?? ""))) as string[];
  let drawn: string[] = [];
  for (const until = Date.now() + 30_000; Date.now() < until && drawn.length === 0; await sleep(500)) drawn = await drawnIds();
  let stored = new Set((await api.items(row.run!.sessionId)).map((i) => String(i.id)));
  if (drawn.length === 0) fail(`the Session draws nothing while the run session ${row.run!.sessionId} holds ${stored.size} items`);
  let strays = drawn.filter((id) => !stored.has(id));
  // A live run's items are drawn as they stream; the store may keep them later.
  // A drawn item is a stray only if the store never comes to hold it.
  const early = strays.length;
  for (const until = Date.now() + STORED_BY_MS; strays.length > 0 && Date.now() < until; await sleep(2_000)) {
    stored = new Set((await api.items(row.run!.sessionId)).map((i) => String(i.id)));
    strays = drawn.filter((id) => !stored.has(id));
  }
  if (early > 0) report.note(`${signal} [from ${from}]: ${early} drawn item(s) were not yet in the store when drawn${strays.length === 0 ? "; the store held them later" : ""}`);
  if (strays.length > 0) fail(`the Session draws ${strays.length} item(s) the run session ${row.run!.sessionId} doesn't hold (${strays.slice(0, 3).join(", ")})`);
  if (!(await visible(page, "task-inspector"))) {
    fail("the right panel holds no task inspector");
    return;
  }
  const href = await page.getByTestId("inspector-trace-link").getAttribute("href").catch(() => null);
  const wanted = devtool === null ? null : `${devtool}?session=${encodeURIComponent(row.run!.sessionId)}`;
  if (wanted === null) fail("Shift Manager served no devtool, so there is no trace link to follow");
  else if (href !== wanted) fail(`the trace link is ${href}, wanted ${wanted}`);
  else if (from === "Tasks") {
    const [opened] = await Promise.all([page.context().waitForEvent("page", { timeout: 10_000 }), page.getByTestId("inspector-trace-link").click()]);
    try {
      const badge = opened.locator(`button[title^="Session ID: ${row.run!.sessionId}"]`);
      if (!(await badge.waitFor({ timeout: 20_000 }).then(() => true, () => false))) fail(`following Open trace did not open session ${row.run!.sessionId} in the devtool`);
    } finally {
      await opened.close();
    }
  }
  report.note(`${signal} [from ${from}]: ${drawn.length} items drawn, all held by ${row.run!.sessionId} (${stored.size} stored); trace ${href === wanted ? "linked and followed" : href}`);
}

/**
 * Leg a. DevForce as the DevTeam profile on the real harness. a1 the Inbox
 * journey, a4 the `@worker` turn into the running task session (the one step
 * graded on the model), a2 the task journey from Tasks and from the Board,
 * a3 every surface. Also b's org step on this tree: the switcher names the
 * store's org.
 */
export async function legA(ctx: LegCtx): Promise<void> {
  const { report } = ctx;
  const keys = MODEL_KEYS.filter((k) => (process.env[k] ?? "") !== "");
  if (keys.length === 0) {
    report.fail("a4", "blocked: no model key in the environment, and a4 rests on a real model");
    return;
  }
  const tree = await readTree(TREES.devforce);
  const served = await startDevTeam(ctx, "a-devforce", "claude-code");
  const { page, errors } = await newPage(ctx.browser);
  try {
    await open(page, served.origin, "/");
    const { userId, bearer } = await injected(page);
    const api = labApi(served.origin, bearer);
    const before = await readStore(api, tree, userId);
    report.note(`a: DevForce served as --team devteam on the claude-code harness, ${keys.length} model key(s) set; org ${before.orgs.join(", ")}`);

    // a1: from the first screen, Inbox.
    const approved = await inboxJourney(page, api, before, tree, "a1", report);

    // a4: the `@worker` turn, while the approved task runs.
    const row = approved ? await runningRow(api, tree, userId, RUN_STARTS_MS) : undefined;
    if (row === undefined) {
      report.fail("a2", approved ? `no row was running with a run link within ${RUN_STARTS_MS / 60_000} min of Approve` : "no ask was approved, so no task runs");
      report.fail("a4", "no task of the coder's is running, so there is nothing to talk to");
    } else {
      const channel = tree.channels.find((c) => c.boardRefs.includes(row.ref))!;
      const assignee = String(row.raw.assignee ?? "");
      const seat = tree.seats.find((s) => s === assignee || s.endsWith(`.${assignee}`)) ?? assignee;
      // The turn goes in mid-run: once the harness has had A4_SETTLE_MS to open and
      // confirm its coding session (the door refuses a run whose session is not yet
      // confirmed), and long before a real coding run ends. The run session's own
      // items are counted to say whether the person could see the run working.
      await sleep(A4_SETTLE_MS);
      const working = (await api.items(row.run!.sessionId)).filter((i) => i.requestId === row.run!.requestId && (i.type === "tool_output" || i.type === "reasoning" || (i.type === "message" && i.role === "assistant"))).length;
      const line = token("a4");
      await page.getByTestId(`nav-workstream-${channel.id}`).click();
      await page.locator("[role=tab][data-tab=stream]").click();
      await page.getByTestId("composer-input").fill(`@${seat.split(".").at(-1)} ${line}`);
      const picker = page.getByTestId("composer-task-picker");
      if (await picker.isVisible().catch(() => false)) await picker.selectOption(row.id);
      const sent = await sendAndWatch(page, "composer", () => api.holds(row.run!.sessionId, "user", line));
      if (sent.state !== "delivered") report.fail("a4", `the composer never read delivered: ${sent.state}${sent.error === null ? "" : `, "${sent.error}"`}`);
      else if (sent.heldAtDelivered !== true) report.fail("a4", `the composer read delivered while ${seat}'s running task session ${row.run!.sessionId} held no person's turn with the token`);
      // The seat answers in that session: an assistant message, after the person's turn, from the next
      // attempt (the one handed the line), not the stopped attempt's work going on.
      let answer: Record<string, any> | undefined;
      let turnAt = -1;
      let nextRequest: string | undefined;
      for (const until = Date.now() + ANSWER_MS; Date.now() < until && answer === undefined; await sleep(2_000)) {
        const messages = await api.items(row.run!.sessionId, ["message"]);
        turnAt = messages.findIndex((m) => m.role === "user" && JSON.stringify(m.content ?? m.text ?? m).includes(line));
        const linked = (await readStore(api, tree, userId)).rows[channel.id]?.find((r) => r.id === row.id)?.run;
        if (linked != null && linked.requestId !== row.run!.requestId) nextRequest = linked.requestId;
        if (turnAt >= 0 && nextRequest !== undefined) answer = messages.slice(turnAt + 1).find((m) => m.role === "assistant" && m.requestId === nextRequest);
        if (sent.state !== "delivered") break;
      }
      if (turnAt < 0) report.fail("a4", `${seat}'s running task session ${row.run!.sessionId} never held a person's turn with the token`);
      else if (sent.state === "delivered" && nextRequest === undefined) report.fail("a4", `no next attempt took the line within ${ANSWER_MS / 60_000} min (not retried)`);
      else if (sent.state === "delivered" && answer === undefined) report.fail("a4", `the next attempt ${nextRequest} did not answer in ${row.run!.sessionId} within ${ANSWER_MS / 60_000} min of the turn (not retried)`);
      const answerText = answer === undefined ? "" : JSON.stringify(answer.content ?? answer.text ?? "").slice(0, 160);
      report.note(`a4: @${seat.split(".").at(-1)} ${line} sent after ${working} harness item(s) in the attempt → ${sent.state}${sent.heldAtDelivered === true ? " (held when drawn)" : ""}${sent.error === null ? "" : ` "${sent.error}"`} in ${row.run!.sessionId}; next attempt ${nextRequest ?? "none"}; answer ${answer === undefined ? "none" : `${String(answer.id)}: ${answerText}`}`);

      // a2: the task, from Tasks and again from the workstream's Board.
      const current = (await readStore(api, tree, userId)).rows[channel.id]!.find((r) => r.id === row.id) ?? row;
      const linked = current.run === null ? row : current;
      await page.getByTestId("nav-tasks").click();
      await page.locator(`[data-testid=task-row][data-task-id="${row.id}"]`).click();
      await taskJourney(page, api, linked, served.devtool, "a2", report, "Tasks");
      await page.getByTestId(`nav-workstream-${channel.id}`).click();
      await page.locator("[role=tab][data-tab=board]").click();
      await page.locator(`[data-testid=board-card][data-task-id="${row.id}"]`).click();
      await taskJourney(page, api, linked, served.devtool, "a2", report, "Board");
    }

    // a3: every surface, against the store as it stands now.
    const store = await readStore(api, tree, userId);
    const { orgShown } = await walkSurfaces(page, served.origin, store, tree, { reach: "a3", teams: "a3" }, report);
    if (store.orgs.length !== 1) report.fail("b:org", `[devforce] the person's sessions sit in ${store.orgs.length} orgs (${store.orgs.join(", ")})`);
    else if (orgShown !== store.orgs[0]) report.fail("b:org", `[devforce] the org switcher names "${orgShown}", the store's org is ${store.orgs[0]}`);
    if (errors.length > 0) report.fail("a3", `the page threw: ${errors.join(" | ")}`);
    const rows = Object.values(store.rows).flat();
    report.note(`a3: ${store.seats.length} seats [${store.seats.join(", ")}], ${store.channels.length} workstream(s), ${rows.length} row(s) [${rows.map((r) => r.status).join(", ")}], ${store.asks.length} ask(s) pending; org switcher "${orgShown}"`);
  } finally {
    await page.close();
    await served.stop();
  }
}

// ---- leg b: pentest, keyless, and every Lab under an org ------------------------

/**
 * Names a pentest seat, team or channel: a full id anywhere, or a bare name
 * as a whole string literal. A bare name in prose ("an audit note", "the
 * findings") is English, not the tree.
 */
function pentestNames(tree: Tree): RegExp {
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ids = [...tree.seats, ...tree.channels.map((c) => c.id)];
  const bare = new Set<string>();
  for (const id of ids) for (const part of id.split(".")) bare.add(part);
  return new RegExp(`(?<![\\w.-])(${ids.map(esc).join("|")})(?![\\w-])|["'\`](${[...bare].map(esc).join("|")})["'\`]`);
}

/** Every Shift Manager file a pentest name could hide in; the registry copies are FSD's, unedited (the drift check's). */
function shiftManagerFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (/src[/\\]components[/\\](flow-state|ui)$/.test(full)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(SHIFT_MANAGER);
  return out;
}

/** Leg b: the same reach on the pentest tree, its post, the fence, and the org step. */
export async function legB(ctx: LegCtx): Promise<void> {
  const { report } = ctx;
  const tree = await readTree(TREES.pentest);
  const served = await startShiftManager(ctx.scratch, "b-pentest", { config: PENTEST_CONFIG, pages: ctx.pages, env: KEYLESS });
  const { page, errors } = await newPage(ctx.browser);
  try {
    await open(page, served.origin, "/");
    const { userId, bearer } = await injected(page);
    const api = labApi(served.origin, bearer);
    const store = await readStore(api, tree, userId);
    if (!same(store.seats, tree.seats)) report.fail("b:reach", `the store's seats are not the tree's: ${diff(tree.seats, store.seats)}`);
    const { orgShown } = await walkSurfaces(page, served.origin, store, tree, { reach: "b:reach", teams: "b:teams" }, report, {
      // The pentest channel attaches no board, so no task exists to reach; its Board tab names that (PLAN: b).
      taskLevel: false,
    });
    if (store.orgs.length !== 1) report.fail("b:org", `[pentest] the person's sessions sit in ${store.orgs.length} orgs (${store.orgs.join(", ")})`);
    else if (orgShown !== store.orgs[0]) report.fail("b:org", `[pentest] the org switcher names "${orgShown}", the store's org is ${store.orgs[0]}`);

    // The post: in the stored transcript before the stream shows it.
    const channel = tree.channels[0]!;
    const line = token("b-post");
    await page.getByTestId(`nav-workstream-${channel.id}`).click();
    await page.locator("[role=tab][data-tab=stream]").click();
    await page.getByTestId("composer-input").fill(line);
    await page.getByTestId("composer-send").click();
    const drawn = page.getByTestId("transcript-line-body").filter({ hasText: line });
    const keptNow = async () => (await api.items(channel.id, ["component"])).filter((i) => i.component === "channel-post" && i.data?.body === line).length;
    let atDrawn: number | null = null;
    for (const until = Date.now() + 30_000; Date.now() < until && atDrawn === null; await sleep(50)) {
      if ((await drawn.count()) > 0) atDrawn = await keptNow();
    }
    if (atDrawn === null) report.fail("b:post", `"${line}" was never drawn (${(await page.getByTestId("composer-status").textContent().catch(() => "")) ?? ""})`);
    else if (atDrawn !== 1) report.fail("b:post", `the stream drew the post while the channel's stored transcript held ${atDrawn} copies of it`);
    await open(page, served.origin, `/w/${encodeURIComponent(channel.id)}/stream`);
    await page.getByTestId("transcript").waitFor().catch(() => undefined);
    await sleep(1_000);
    if ((await drawn.count()) !== 1) report.fail("b:post", `after a reload "${line}" is drawn ${await drawn.count()} times`);
    if (errors.length > 0) report.fail("b:reach", `the page threw: ${errors.join(" | ")}`);
    report.note(
      `b: pentest served from its committed config, keyless; ${store.seats.length} seats [${store.seats.join(", ")}] in teams [${[...new Set(store.seats.map((s) => s.split(".")[0]))].join(", ")}], workstreams [${store.channels.map((c) => c.id).join(", ")}]; post held ${atDrawn ?? "never drawn"} when drawn; org switcher "${orgShown}", store org ${store.orgs.join(", ")}`,
    );
  } finally {
    await page.close();
    await served.stop();
  }

  // The fence: Shift Manager untouched, and naming nothing of the pentest tree.
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "labs/shift-manager"], { cwd: REPO_ROOT });
  } catch {
    report.fail("b:fence", "labs/shift-manager differs from the commit");
  }
  const names = pentestNames(tree);
  const hits = shiftManagerFiles().flatMap((file) => {
    const m = names.exec(readFileSync(file, "utf8"));
    return m === null ? [] : [`${relative(REPO_ROOT, file)}: ${m[1] ?? m[2]}`];
  });
  if (hits.length > 0) report.fail("b:fence", `Shift Manager names the pentest tree: ${hits.slice(0, 5).join("; ")}`);
  report.note(`b:fence: git diff of labs/shift-manager empty; no Shift Manager file (registry copies aside) names a pentest id [${[...tree.seats, ...tree.channels.map((c) => c.id)].join(", ")}] or quotes a bare name of one`);

  // Every Lab opens under an org: a Lab with no resolver opens under the dev org.
  const askLab = await startShiftManager(ctx.scratch, "b-no-resolver", { config: ASK_LAB_CONFIG, pages: ctx.pages, env: KEYLESS });
  const second = await newPage(ctx.browser);
  try {
    await open(second.page, askLab.origin, "/");
    const { userId } = await injected(second.page);
    const listing = await labApi(askLab.origin, undefined).get(`/sessions?userId=${encodeURIComponent(userId)}&limit=500`);
    const orgs = [...new Set(((listing.sessions ?? []) as Array<{ orgId?: string }>).map((s) => s.orgId).filter(Boolean))];
    const shown = ((await second.page.getByTestId("org-switcher").locator("span.truncate").first().textContent().catch(() => null)) ?? "").trim();
    if (!same(orgs as string[], [DEFAULT_ORG_ID])) report.fail("b:org", `[no resolver] the Lab's sessions sit in [${orgs.join(", ")}], wanted the dev org ${DEFAULT_ORG_ID}`);
    if (shown !== DEFAULT_ORG_ID) report.fail("b:org", `[no resolver] the org switcher names "${shown}", wanted ${DEFAULT_ORG_ID}`);
    if ((await second.page.getByTestId("refusal").count()) + (await second.page.getByTestId("unreachable").count()) > 0) report.fail("b:org", "[no resolver] the Lab opens on a refusal, not the app");
    if (!(await visible(second.page, "cos", 5_000))) report.fail("b:org", "[no resolver] the Lab opens as an empty app, with no Chief of Staff");
    report.note(`b:org [no resolver]: ask-lab with no bearer; sessions in [${orgs.join(", ")}], switcher "${shown}"`);
  } finally {
    await second.page.close();
    await askLab.stop();
  }
}

// ---- leg c: no theme, light then dark -----------------------------------------

const THEME = readShiftManagerTheme();
/** The registry parts and the devtool page, by the selector that finds each on its page. */
export const SWEPT = {
  message: "[data-testid=session-item][data-item-type=message] [data-testid=message]",
  reasoning: "[data-testid=session-item][data-item-type=reasoning] [data-slot=collapsible]",
  tool: "[data-testid=session-item][data-item-type=tool_output] [data-slot=collapsible]",
  "code block": "[data-testid=session-item][data-item-type=tool_output] [data-language]",
  ask: "[data-testid=ask-card]",
} as const;
const firstFamily = (value: string) => value.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

/** Every painted value on `read` that is a Shift Manager value (either variant) or one of its fonts. */
function themedHits(read: PageRead): Sample[] {
  const all = [...THEME.light, ...THEME.dark];
  const theme = all.map((v) => parseColour(read.probes[v] ?? v)?.rgb).filter((v): v is Rgb => v !== undefined);
  const hits: Sample[] = [];
  for (const s of read.colours) {
    const c = parseColour(s.value);
    if (c !== null && theme.some((t) => near(t, c.rgb))) hits.push({ ...s, value: hex(c.rgb) });
  }
  for (const s of read.fonts) if (THEME.families.includes(firstFamily(s.value))) hits.push(s);
  return hits;
}

/** Read painted values for the parts on screen now, and add them to the pass's tally. */
async function sweep(page: Page, parts: Record<string, string>, tally: Map<string, { elements: number; hits: Sample[] }>): Promise<void> {
  await settled(page);
  const read = await page.evaluate(readPainted, { parts, probeValues: [...THEME.light, ...THEME.dark] });
  for (const [part, n] of Object.entries(read.counts)) {
    const entry = tally.get(part) ?? { elements: 0, hits: [] };
    entry.elements += n;
    entry.hits.push(...themedHits({ ...read, colours: read.colours.filter((s) => s.part === part), fonts: read.fonts.filter((s) => s.part === part) }));
    tally.set(part, entry);
  }
}

/** Open every collapsed card in the task's Session, so the code block inside the tool card is drawn. */
async function expandSession(page: Page): Promise<void> {
  for (const trigger of await page.locator("[data-testid=session-item] [data-slot=collapsible-trigger]").all()) {
    if ((await trigger.getAttribute("data-state")) === "closed") await trigger.click().catch(() => undefined);
  }
  await page.locator(SWEPT["code block"]).first().waitFor({ timeout: 5_000 }).catch(() => undefined);
}

/**
 * Leg c. The no-theme build, started on `--shift day` then `--shift night`.
 * Per pass: DevForce (scripted harness) for every surface a3 reaches, the ask
 * card in Inbox and in the stream, a run's Session and the devtool page its
 * trace link opens; and the run-lab, whose runs store the reasoning, tool and
 * code block cards DevForce's scripted run never draws. Each swept part must
 * render at least once per pass (QR-13) and carry no Shift Manager value.
 * Then FIX-1655's static fence over `packages/`.
 */
export async function legC(ctx: LegCtx): Promise<void> {
  const { report } = ctx;
  for (const shift of ["day", "night"] as const) {
    const wantDark = shift === "night";
    const tally = new Map<string, { elements: number; hits: Sample[] }>();
    // DevForce.
    const tree = await readTree(TREES.devforce);
    const devforce = await startDevTeam(ctx, `c-devforce-${shift}`, "stub", shift);
    const { page, errors } = await newPage(ctx.browser);
    try {
      await open(page, devforce.origin, "/");
      const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (dark !== wantDark) report.fail("c:reach", `[${shift}] --shift ${shift} started the page ${dark ? "dark" : "light"}`);
      const { userId, bearer } = await injected(page);
      const api = labApi(devforce.origin, bearer);
      const before = await readStore(api, tree, userId);
      // The ask card, in Inbox's detail pane and in the stream.
      const ask = before.asks[0];
      if (ask !== undefined) {
        await page.getByTestId("nav-inbox").click();
        await page.locator(`[data-testid=inbox-item][data-suspension-id="${ask.suspensionId}"]`).click();
        await page.locator("[data-testid=inbox-detail] [data-testid=ask-card]").waitFor();
        await sweep(page, { ask: `[data-testid=inbox-detail] ${SWEPT.ask}` }, tally);
        const workstream = tree.channels.find((c) => c.members.includes(ask.seat))!.id;
        await page.getByTestId(`nav-workstream-${workstream}`).click();
        await page.locator("[data-testid=stream-asks] [data-testid=ask-card]").waitFor().catch(() => undefined);
        await sweep(page, { ask: `[data-testid=stream-asks] ${SWEPT.ask}` }, tally);
        // Approve, so a run's Session and its trace page can be read.
        await page.getByTestId("nav-inbox").click();
        await page.locator(`[data-testid=inbox-item][data-suspension-id="${ask.suspensionId}"]`).click();
        await page.locator("[data-testid=inbox-detail]").getByRole("button", { name: "Approve" }).click();
        const row = await runningRow(api, tree, userId, 60_000);
        if (row !== undefined) {
          await page.getByTestId("nav-tasks").click();
          await page.locator(`[data-testid=task-row][data-task-id="${row.id}"]`).click();
          await page.locator("[data-testid=session-item]").first().waitFor({ timeout: 30_000 }).catch(() => undefined);
          await expandSession(page);
          await sweep(page, SWEPT, tally);
          const link = page.getByTestId("inspector-trace-link");
          if ((await link.count()) > 0) {
            const [trace] = await Promise.all([page.context().waitForEvent("page", { timeout: 10_000 }), link.click()]);
            await trace.addInitScript("globalThis.__name = (fn) => fn;");
            await trace.locator(`button[title^="Session ID: ${row.run!.sessionId}"]`).waitFor({ timeout: 20_000 }).catch(() => undefined);
            await trace.evaluate("globalThis.__name = (fn) => fn;");
            await sweep(trace, { devtool: "body" }, tally);
            await trace.close();
          }
        } else report.fail("c:reach", `[${shift}] DevForce's approved row never ran on the scripted harness`);
      } else report.fail("c:reach", `[${shift}] DevForce raised no ask, so the ask card could not be swept`);
      // Every surface a3 reaches, now that a row exists, on this shift's look.
      await walkSurfaces(page, devforce.origin, await readStore(api, tree, userId), tree, { reach: "c:reach", teams: "c:reach" }, report);
      if (errors.length > 0) report.fail("c:reach", `[${shift}] the page threw: ${errors.join(" | ")}`);
    } finally {
      await page.close();
      await devforce.stop();
    }
    // The run-lab, for the cards DevForce's scripted run never draws.
    const runLab = await startShiftManager(ctx.scratch, `c-run-lab-${shift}`, { config: RUN_LAB_CONFIG, pages: ctx.pages, shift, env: KEYLESS });
    const second = await newPage(ctx.browser);
    try {
      const lab = await readTree(TREES.runLab);
      await open(second.page, runLab.origin, "/tasks");
      const { userId, bearer } = await injected(second.page);
      const row = await runningRow(labApi(runLab.origin, bearer), lab, userId, 30_000);
      if (row === undefined) report.fail("c:reach", `[${shift}] the run-lab's board never held a running row`);
      else {
        await second.page.getByTestId("nav-tasks").click();
        await second.page.locator(`[data-testid=task-row][data-task-id="${row.id}"]`).click();
        await second.page.locator("[data-testid=session-item][data-item-type=tool_output]").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
        await expandSession(second.page);
        await sweep(second.page, SWEPT, tally);
      }
    } finally {
      await second.page.close();
      await runLab.stop();
    }
    // Grade the pass.
    const parts = [...Object.keys(SWEPT), "devtool"];
    for (const part of parts) {
      const entry = tally.get(part);
      if (entry === undefined || entry.elements === 0) report.fail("c:sweep", `[${shift}] ${part} never rendered in this pass (QR-13)`);
      for (const hit of (entry?.hits ?? []).slice(0, 4)) report.fail(`c:${part}`, `[${shift}] ${hit.el} ${hit.prop} → ${hit.value} is a Shift Manager value`);
      if ((entry?.hits.length ?? 0) > 4) report.fail(`c:${part}`, `[${shift}] … and ${entry!.hits.length - 4} more on ${part}`);
    }
    report.note(`c [${shift}]: ${parts.map((p) => `${p} ${tally.get(p)?.elements ?? 0}`).join(", ")} elements; ${parts.reduce((n, p) => n + (tally.get(p)?.hits.length ?? 0), 0)} Shift Manager values`);
  }
  report.note(`c theme values: ${THEME.light.length} light and ${THEME.dark.length} dark colours, families [${THEME.families.join(", ")}], read from labs/design-system/shift-manager.css`);
  staticFence(join(REPO_ROOT, "packages"), "c:static", report);
}

/** FIX-1655's static fence: no Shift Manager value anywhere under a `packages/` tree. */
export function staticFence(packages: string, signal: string, report: Report): void {
  const values = themeValues(readFileSync(join(REPO_ROOT, "labs", "design-system", "shift-manager.css"), "utf8"));
  const { walked, hits } = findThemeValues(packages, values);
  if (walked < 500) report.fail(signal, `the fence walked only ${walked} files under ${packages}`);
  if (hits.length > 0) report.fail(signal, `a Shift Manager value sits under packages/: ${hits.slice(0, 5).join("; ")}`);
  report.note(`${signal}: ${values.length} theme values, ${walked} files under ${relative(REPO_ROOT, packages) || packages}, ${hits.length} hit(s)`);
}
