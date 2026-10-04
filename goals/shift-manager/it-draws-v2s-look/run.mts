/**
 * Goal check: every screen of Shift Manager is drawn in design v2's look, day
 * and night, at a wide and a narrow window, and the check names the element
 * and the v2 line the moment one drifts.
 *
 * Real path, no model key, out of CI. See goal.md for the contract.
 *
 * Shift Manager is built with Vite (or `GOAL_PAGES=<dir>` serves pages built
 * elsewhere) and served by its own start script over two Labs: DevTeam, with
 * its one ask pending and a filed row running, and this check's own desk Lab
 * (`lab/`), whose chief of staff answers one line from a scripted mock model.
 * Chromium walks every screen by clicking, toggles the sidebar's shift switch
 * and the window width in place, and reads the computed style of every
 * visible element in one `page.evaluate` per screen state. What it reads is
 * graded against the v2 look table below: each row a role, the elements that
 * play it, the computed values v2 gives it, and the v2 line it came from.
 *
 * Legs (each failure is tagged `<leg> [<screen> <shift> <width>]`):
 *   type     both fonts loaded, not only named: every text element's family
 *            and weight has a loaded face; each row's family, size, weight and
 *            tracking
 *   surface  each row's surface and border; radius 0 on every element outside
 *            the registry exceptions
 *   marks    the highlighter on every needs-you element and nothing else;
 *            v2's state squares; the tabs' underline
 *   layout   widths; the rail drops below 1180px; the 900px minimum
 *   content  what a row draws equals the Lab's store, read with this check's
 *            own requests
 *   totality every painting element inside a graded region is covered by a
 *            row or a named exception, and every row matches at least its
 *            expected number of elements, so a missing element fails as surely
 *            as an extra one
 *
 * Which regions are graded whole grows with the screens' slices: the sidebar,
 * the shared parts, Chief of Staff's centre, and the workstream, Board, task
 * and team strip. Each slice's rows, exceptions and regions live in a file of
 * their own (slice B's under `rows/`, slice C's in `look-c.mts`), spread into
 * the table here. The fonts, the radius and the highlighter are graded on
 * every element of every screen.
 *
 * Controls (scratch patches to a copy of Shift Manager, never the checkout):
 *   GOAL_CONTROL=drift         the sidebar's team row rounded, its Roster count
 *                              in the sans. Must FAIL at surface on that row and
 *                              type on that count, both shifts, nothing else.
 *   GOAL_CONTROL=unclassified  one visible element no row covers, in the
 *                              sidebar. Must FAIL at totality, naming it.
 *   GOAL_CONTROL=missing       the team rows' on-shift counts removed. Must FAIL
 *                              at that row's expected count, and nowhere else.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-draws-v2s-look/run.mts
 * Control:  GOAL_CONTROL=drift PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-draws-v2s-look/run.mts
 * Before:   GOAL_PAGES=<pages built from another commit> … serves those pages instead of building.
 * Shots:    GOAL_SHOTS=<dir> … saves one screenshot per screen state.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { RUN_STAMP, goalTmpDir, loadFixture, repoPath, runGoal } from "../../lib/index.mts";
import { EM_KIND } from "../../devforce-lab/lab/workforce/flows/workers/em.mts";
import { hex, parseColour, type Rgb } from "../../lib/colour.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerCopy, labApi, startShiftManager, type LabApi, type Patch } from "../../lib/shift-manager.mts";
import {
  SIDEBAR_AND_COS_EXCEPTIONS,
  SIDEBAR_AND_COS_ROWS,
  SIDEBAR_AND_COS_WHOLE,
  sidebarAndCosContent,
  type SidebarAndCosRead,
} from "./rows/sidebar-and-cos.mts";
import { SLICE_C_EXCEPTIONS, SLICE_C_ROWS, SLICE_C_WHOLE } from "./look-c.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["drift", "unclassified", "missing"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_PAGES !== undefined) {
  console.error("GOAL_CONTROL patches a build; it can't run over GOAL_PAGES");
  process.exit(2);
}

const fixture = loadFixture<{ devteam: { issue: string; text: string }; desk: { line: string; reply: string } }>(import.meta.url);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("shift-manager-v2-look");
const V2 = repoPath("specs", "epics", "FIX-1649", "assets", "design", "v2", "shift-manager-v2.dc.html");

const LABS = {
  devteam: {
    config: repoPath("labs", "shift-manager", "teams", "devteam", "fsdev.config.mts"),
    tree: repoPath("goals", "devforce-lab", "lab", "workforce"),
    // Long enough that the filed row is still running while the sweep reads it, short
    // enough to finish inside the scripted run's 60s limit.
    env: { DEVFORCE_LAB_STEP_MS: "11000" },
  },
  desk: { config: join(HERE, "lab", "fsdev.config.mts"), tree: join(HERE, "lab", "workforce"), env: {} },
} as const;
type LabName = keyof typeof LABS;

const SCREENS = ["workstream", "board", "task", "tasks", "cos", "inbox", "roster", "project"] as const;
export type Screen = (typeof SCREENS)[number];
const SHIFTS = ["day", "night"] as const;
type Shift = (typeof SHIFTS)[number];
const WIDTHS = [1600, 1100] as const;
type Width = (typeof WIDTHS)[number];
type Leg = "type" | "surface" | "marks" | "layout" | "content" | "totality";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- the v2 look table -----------------------------------------------------------

/** What the Lab's store holds that a row's expected count reads. */
export type Store = {
  /** The teams the seat inventory names, and its seats. */
  teams: number;
  seats: number;
  /** Rows per board status, across every board. */
  running: number;
  /** Whether the Lab has a chief-of-staff seat. */
  chiefOfStaff: boolean;
  /** Whether the person's conversation with it holds a reply: only the desk Lab's sweep sends a line. */
  replied: boolean;
  /** The person's pending asks, across the seats' sessions. */
  asks: number;
  /**
   * Per channel: its stored rows, the names of its members running one, how
   * many of its rows run, whether one of its members' asks waits on the
   * person, its kept transcript lines, and its members' pending asks.
   */
  channels: Record<string, { rows: number; live: string[]; running: number; needs: boolean; lines: number; asks: number }>;
};
export type Where = { screen: Screen; width: Width; store: Store; /** A line to the chief of staff is held in flight. */ working?: boolean };

/** The computed values a row's elements must have. Each is graded in its own leg. */
type Want = {
  /** type: the first family a text element is set in. */
  family?: "sans" | "mono";
  /** type: font size in px, one value or an inclusive range. */
  size?: number | [number, number];
  /** type: numeric font weight. */
  weight?: number;
  /** type: letter-spacing, in em of the element's own size. */
  tracking?: number;
  /** surface: the background is this token, or none is painted. */
  surface?: "sidebar" | "inspector" | "card" | "accent" | "foreground" | "info" | "none";
  /** surface: every side's border is this wide, in px, in this token (any alpha), solid unless named. */
  border?: { width: number; colour: "foreground"; style?: "dashed" };
  /** marks: the background is the highlighter, because what this is waits on a person. */
  highlight?: true;
  /** marks: the text is painted in this token. */
  colour?: "info";
  /** type: line height, in multiples of the element's own size. */
  lineHeight?: number;
  /** layout: padding top, right, bottom, left, in px. */
  padding?: [number, number, number, number];
  /** marks: the bottom border is 2px of `info`, or none painted. */
  underline?: "info" | "none";
  /** marks: v2's state square for this state (`NODE`). */
  square?: "needs" | "run" | "review" | "queued" | "done";
  /** layout: the element's own width, in px. */
  width?: number;
  /** layout: the computed `min-width`, in px. */
  minWidth?: number;
  /** layout: no element matching the row is visible. */
  absent?: true;
};

/** One row: a role, the elements that play it, what v2 gives it, and the v2 line it came from. */
export type Row = {
  id: string;
  /** The audit rows (`assets/GAPS.md`) it grades. */
  audit: string;
  /** The v2 line it cites, and text that line holds; setup fails when it doesn't. */
  v2: { line: number; has: string };
  select: string;
  /** Screens it applies on (default: every screen). */
  on?: readonly Screen[];
  /** Widths it applies at (default: both). */
  at?: readonly Width[];
  /** Elements it must match per screen state, at least. */
  min: number | ((where: Where) => number);
  want: Want;
};

const OFF_COS: readonly Screen[] = SCREENS.filter((s) => s !== "cos");
const WITH_RAIL: readonly Screen[] = ["cos", "workstream", "board", "task"];
const WITH_TABS: readonly Screen[] = ["workstream", "board", "task", "project"];
const COMPOSERS = "[data-testid=composer], [data-testid=task-composer], [data-testid=inbox-reply]";

const LOOK: Row[] = [
  // The frame.
  { id: "frame minimum", audit: "F8", v2: { line: 25, has: "min-width:900px" }, select: "[data-testid=shell]", min: 1, want: { minWidth: 900 } },
  { id: "sidebar width", audit: "F9", v2: { line: 25, has: "grid-template-columns:248px" }, select: "[data-testid=sidebar]", min: 1, want: { width: 248 } },
  { id: "sidebar surface", audit: "F3", v2: { line: 27, has: "background:var(--sidebar)" }, select: "[data-testid=sidebar]", min: 1, want: { surface: "sidebar" } },
  { id: "rail surface", audit: "F3", v2: { line: 183, has: "background:var(--inspector)" }, select: "[data-testid=right-panel]", on: WITH_RAIL, at: [1600], min: 1, want: { surface: "inspector" } },
  { id: "rail width", audit: "F8", v2: { line: 1219, has: "'minmax(0,1fr) 340px'" }, select: "[data-testid=right-panel]", on: WITH_RAIL, at: [1600], min: 1, want: { width: 340 } },
  { id: "rail drops below 1180px", audit: "F8", v2: { line: 1121, has: "S.vw >= 1180" }, select: "[data-testid=right-panel]", on: WITH_RAIL, at: [1100], min: 0, want: { absent: true } },
  { id: "Inbox detail surface", audit: "F3", v2: { line: 593, has: "background:var(--inspector)" }, select: "[data-testid=inbox-detail]", on: ["inbox"], min: 1, want: { surface: "inspector" } },

  // The sidebar, every element.
  { id: "Jump to field", audit: "F4", v2: { line: 34, has: "border:1px solid" }, select: "[data-testid=jump-to]", min: 1, want: {} },
  { id: "Jump to text", audit: "F2", v2: { line: 35, has: "font:500 12px 'IBM Plex Mono'" }, select: "[data-testid=jump-to] > [data-look=meta-control]", min: 1, want: { family: "mono", size: 12 } },
  { id: "Jump to key box", audit: "F2", v2: { line: 36, has: "border:1px solid" }, select: "[data-testid=jump-to] kbd", min: 1, want: {} },
  { id: "Jump to key", audit: "F2", v2: { line: 36, has: "font:500 10.5px 'IBM Plex Mono'" }, select: "[data-testid=jump-to] kbd > span", min: 1, want: { family: "mono", size: 10.5 } },
  { id: "nav label", audit: "F2", v2: { line: 59, has: "<span style=\"flex:1\">Inbox</span>" }, select: "[data-testid=sidebar] [data-testid^=nav-] > [data-look=nav-label]", min: 4, want: { family: "sans" } },
  { id: "nav count", audit: "F2", v2: { line: 60, has: "font:600 10.5px 'IBM Plex Mono'" }, select: "[data-testid=sidebar] [data-testid^=nav-][data-testid$=-count]", min: 3, want: { family: "mono", size: 10.5 } },
  { id: "current row", audit: "F4", v2: { line: 908, has: "NAVSEL" }, select: "[data-testid=sidebar] [aria-current=page]", min: 0, want: {} },
  { id: "section label", audit: "F2", v2: { line: 76, has: "font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.14em" }, select: "[data-testid=projects-heading] > [data-look=meta-label], [data-testid=teams-heading] > [data-look=meta-label]", min: 2, want: { family: "mono", size: 10, tracking: 0.14 } },
  { id: "team row", audit: "F4", v2: { line: 99, has: "padding:6px;font-size:13px" }, select: "[data-testid=team]", min: ({ store }) => store.teams, want: {} },
  { id: "team name", audit: "F2", v2: { line: 99, has: "<span style=\"flex:1\">{{ t.name }}</span>" }, select: "[data-testid=team] > span:first-child", min: ({ store }) => store.teams, want: { family: "sans" } },
  { id: "status square", audit: "F4", v2: { line: 99, has: "width:7px;height:7px" }, select: "[data-testid=sidebar] [data-mark]", min: ({ store }) => store.seats, want: {} },
  { id: "team on-shift count", audit: "F2", v2: { line: 99, has: "font:500 10.5px 'IBM Plex Mono'" }, select: "[data-testid=team-on-shift]", min: ({ store }) => store.teams, want: { family: "mono", size: 10.5 } },
  { id: "footer", audit: "F2", v2: { line: 107, has: "font:500 11px 'IBM Plex Mono'" }, select: "[data-testid=sidebar-footer], [data-testid=sidebar-footer] > p, [data-testid=sidebar-footer] span:not([data-mark]):not([data-look=avatar])", min: 1, want: { family: "mono", size: 11 } },
  // The sidebar's entries and Chief of Staff: slice B's rows.
  ...SIDEBAR_AND_COS_ROWS,
  { id: "shift switch", audit: "F2", v2: { line: 113, has: "border:1px solid var(--ink);font:500 11px 'IBM Plex Mono'" }, select: "[data-testid=shift-switch], [data-testid=shift-switch] > button", min: 3, want: { family: "mono", size: 11 } },

  // A screen's title.
  { id: "screen title", audit: "F5", v2: { line: 215, has: "font-size:18px;font-weight:700;letter-spacing:-.02em" }, select: "[data-look=screen-title]", on: OFF_COS, min: 1, want: { family: "sans", size: 18, weight: 700, tracking: -0.02 } },
  { id: "Chief of Staff title", audit: "F5", v2: { line: 127, has: "font-size:22px;font-weight:700;letter-spacing:-.03em" }, select: "[data-look=screen-title]", on: ["cos"], min: 1, want: { family: "sans", size: 22, weight: 700, tracking: -0.03 } },

  // Tabs.
  { id: "tab strip", audit: "W4", v2: { line: 220, has: "display:flex;gap:22px" }, select: "[role=tablist]", on: WITH_TABS, min: 1, want: {} },
  { id: "tab", audit: "W4", v2: { line: 220, has: "font:500 12px 'IBM Plex Mono'" }, select: "[role=tablist] > [role=tab], [role=tablist] > [role=tab] > span", on: WITH_TABS, min: 2, want: { family: "mono", size: 12 } },
  { id: "selected tab", audit: "W4", v2: { line: 221, has: "border-bottom:2px solid var(--blue)" }, select: "[role=tablist] > [role=tab][aria-selected=true]", on: WITH_TABS, min: 1, want: { underline: "info" } },
  { id: "other tab", audit: "W4", v2: { line: 222, has: "padding:8px 0;color:var(--ink3)" }, select: "[role=tablist] > [role=tab][aria-selected=false]", on: WITH_TABS, min: 1, want: { underline: "none" } },

  // The composers.
  { id: "composer box", audit: "W12", v2: { line: 306, has: "border:1px solid var(--ink);background:var(--card)" }, select: `:is(${COMPOSERS}) [data-look=composer]`, on: ["workstream", "task", "inbox"], min: 1, want: { border: { width: 1, colour: "foreground" } } },
  { id: "composer input", audit: "W12", v2: { line: 307, has: "padding:11px 12px;font-size:14px" }, select: `:is(${COMPOSERS}) [data-look=composer-input]`, on: ["workstream", "task", "inbox"], min: 1, want: { family: "sans", size: 14 } },
  { id: "composer footer", audit: "W12", v2: { line: 308, has: "font:500 11px 'IBM Plex Mono'" }, select: `:is(${COMPOSERS}, [data-testid=cos-composer]) [data-look=composer-footer], :is(${COMPOSERS}, [data-testid=cos-composer]) [data-look=composer-footer] :is(p, span, label, button)`, on: ["workstream", "task", "inbox", "cos"], min: ({ screen }) => (screen === "cos" ? 0 : 1), want: { family: "mono", size: 11 } },
  { id: "Chief of Staff composer box", audit: "C9", v2: { line: 175, has: "border:1.5px solid var(--ink);background:var(--card)" }, select: "[data-testid=cos-composer] [data-look=composer]", on: ["cos"], min: ({ store }) => (store.chiefOfStaff ? 1 : 0), want: { border: { width: 1.5, colour: "foreground" } } },
  { id: "Chief of Staff composer input", audit: "C9", v2: { line: 176, has: "padding:16px;font-size:16px" }, select: "[data-testid=cos-composer] [data-look=composer-input]", on: ["cos"], min: ({ store }) => (store.chiefOfStaff ? 1 : 0), want: { family: "sans", size: 16 } },
  { id: "Chief of Staff send", audit: "C9", v2: { line: 177, has: "font:500 12px 'IBM Plex Mono'" }, select: "[data-testid=cos-composer] [data-look=composer] > [data-look=composer-send]", on: ["cos"], min: ({ store }) => (store.chiefOfStaff ? 1 : 0), want: { family: "mono", size: 12 } },

  // A task's state, as v2's square.
  { id: "state square, needs you", audit: "F7", v2: { line: 894, has: "needs: { nb: Y, nbd: INK, nbs: 'solid' }" }, select: "[data-state-square=needs]", min: 0, want: { square: "needs" } },
  { id: "state square, running", audit: "F7", v2: { line: 894, has: "run: { nb: A, nbd: A, nbs: 'solid' }" }, select: "[data-state-square=run]", on: ["workstream", "tasks"], min: ({ screen, width, store }) => (screen === "tasks" || width === 1600 ? Math.min(store.running, 1) : 0), want: { square: "run" } },
  { id: "state square, in review", audit: "F7", v2: { line: 894, has: "review: { nb: 'transparent', nbd: A, nbs: 'solid' }" }, select: "[data-state-square=review]", min: 0, want: { square: "review" } },
  { id: "state square, queued", audit: "F7", v2: { line: 895, has: "queued: { nb: 'transparent', nbd: 'rgba(var(--inkrgb),.5)', nbs: 'dashed' }" }, select: "[data-state-square=queued]", min: 0, want: { square: "queued" } },
  { id: "state square, done", audit: "F7", v2: { line: 895, has: "done: { nb: INK, nbd: INK, nbs: 'solid' }" }, select: "[data-state-square=done]", min: 0, want: { square: "done" } },

  // ---- slice C: the workstream, its Board, the task screen, the team strip (look-c.mts) ----
  ...SLICE_C_ROWS,
  // ---- end slice C ----
];

/**
 * Elements v2 gives no row, each by name and why. A registry part's radius is
 * skipped only where the theme's radius can't reach it; everything else on
 * this list is still graded for its fonts, its radius and the highlighter.
 */
export type Exception = { id: string; select: string; why: string; radius?: "skip" };
const EXCEPTIONS: Exception[] = [
  { id: "organization switcher", select: "[data-testid=org-switcher], [data-testid=org-switcher] *", why: "kept by the epic (ER-1); v2's brand header waits on FIX-1650 for an organization's display name" },
  { id: "TEAMS unread note", select: "[data-testid=teams-roster-unread]", why: "says why TEAMS can't be read; v2 draws no failed state" },
  { id: "partial mark", select: "[data-testid=partial-mark]", why: "Shift Manager's mark for a partial status read; v2 draws no failed state" },
  { id: "section failure", select: "[data-testid$=-failure], [data-testid$=-failure] *", why: "a section's Retry; v2 draws no failed state" },
  { id: "also post to the workstream", select: "[data-testid=task-also-post]", why: "the task composer's also-post box waits on FIX-1474" },
  { id: "registry pill", select: "[data-slot=badge]", why: "a registry part whose `rounded-full` is a literal the theme's radius can't reach", radius: "skip" },
  ...SIDEBAR_AND_COS_EXCEPTIONS,
  // ---- slice C ----
  ...SLICE_C_EXCEPTIONS,
  // ---- end slice C ----
];

/** The regions every painting element of which must be covered by a row or an exception. */
const WHOLE = [
  "[data-testid=sidebar]",
  "[data-look=tabs]",
  "[data-look=composer]",
  "[data-look=composer-footer]",
  "[data-look=screen-title]",
  ...SIDEBAR_AND_COS_WHOLE,
  // ---- slice C ----
  ...SLICE_C_WHOLE,
  // ---- end slice C ----
];

// ---- reading the page ----------------------------------------------------------

/** One painting element, as the page computes it. */
type El = {
  el: string;
  text: boolean;
  rows: string[];
  exceptions: string[];
  whole: boolean;
  family: string;
  size: number;
  weight: number;
  tracking: number;
  bg: string;
  colour: string;
  lineHeight: number;
  padding: number[];
  radius: number[];
  border: Array<{ width: number; style: string; colour: string }>;
  width: number;
  minWidth: string;
};
type Sweep = {
  els: El[];
  /** Per row, the visible elements it matched. */
  matched: Record<string, number>;
  tokens: Record<string, string>;
  faces: Array<{ family: string; weight: string; status: string }>;
  mentions: string[] | null;
  boardCount: string | null;
  sidebarAndCos: SidebarAndCosRead;
};

/** Runs in the page: every visible element that paints anything, with what each row and exception matches. */
function sweep(args: { rows: Array<{ id: string; select: string }>; exceptions: Array<{ id: string; select: string }>; whole: string[]; tokens: string[] }): Sweep {
  const describe = (el: Element) => {
    const id = el.getAttribute("data-testid");
    const look = el.getAttribute("data-look");
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(" ").slice(0, 24);
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}${look ? `{${look}}` : ""}${text ? ` "${text}"` : ""}`;
  };
  const els: El[] = [];
  const matched: Record<string, number> = Object.fromEntries(args.rows.map((r) => [r.id, 0]));
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (["SCRIPT", "STYLE", "TEMPLATE", "OPTION", "BR"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    // A 1px box is a screen-reader-only label, not something drawn.
    if (cs.display === "none" || cs.visibility !== "visible" || box.width <= 1 || box.height <= 1) continue;
    const rows = args.rows.filter((r) => el.matches(r.select)).map((r) => r.id);
    for (const id of rows) matched[id] += 1;
    const text =
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0) || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const border = (["top", "right", "bottom", "left"] as const).map((side) => ({
      width: parseFloat(cs.getPropertyValue(`border-${side}-width`)),
      style: cs.getPropertyValue(`border-${side}-style`),
      colour: cs.getPropertyValue(`border-${side}-color`),
    }));
    const paintsBorder = border.some((b) => b.width > 0 && b.style !== "none" && b.style !== "hidden");
    const bgAlpha = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor)?.[1]?.split(/[\s,/]+/)[3];
    const paintsBg = cs.backgroundColor !== "transparent" && bgAlpha !== "0";
    if (!text && !paintsBorder && !paintsBg && !["svg", "SVG", "IMG", "INPUT"].includes(el.tagName) && rows.length === 0) continue;
    els.push({
      el: describe(el),
      text,
      rows,
      exceptions: args.exceptions.filter((x) => el.matches(x.select)).map((x) => x.id),
      whole: args.whole.some((w) => el.closest(w) !== null),
      family: cs.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, ""),
      size: parseFloat(cs.fontSize),
      weight: Number(cs.fontWeight === "normal" ? 400 : cs.fontWeight === "bold" ? 700 : cs.fontWeight),
      tracking: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing),
      bg: cs.backgroundColor,
      colour: cs.color,
      lineHeight: parseFloat(cs.lineHeight),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((p) => parseFloat(p)),
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((r) => parseFloat(r)),
      border,
      width: box.width,
      minWidth: cs.minWidth,
    });
  }
  // How the page paints each token, read off a probe so the grade compares like with like.
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const tokens: Record<string, string> = {};
  for (const token of args.tokens) {
    probe.style.backgroundColor = "";
    probe.style.backgroundColor = `var(--${token})`;
    tokens[token] = getComputedStyle(probe).backgroundColor;
  }
  probe.remove();
  const mentionEls = Array.from(document.querySelectorAll("[data-testid=composer] [data-testid=composer-mention]"));
  return {
    els,
    matched,
    tokens,
    faces: Array.from(document.fonts).map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), weight: f.weight, status: f.status })),
    mentions: document.querySelector("[data-testid=composer]") === null ? null : mentionEls.map((m) => m.getAttribute("data-name") ?? ""),
    boardCount: document.querySelector("[data-testid=tab-count-board]")?.textContent ?? null,
    sidebarAndCos: {
      inbox: ((el) => (el === null ? null : { text: el.textContent ?? "", waiting: el.getAttribute("data-waiting") }))(document.querySelector("[data-testid=nav-inbox-count]")),
      dots: Array.from(document.querySelectorAll("[data-testid^=nav-workstream-]:not([data-testid=nav-workstream-gone])")).map((el) => ({
        channel: el.getAttribute("data-testid")!.slice("nav-workstream-".length),
        dot: el.getAttribute("data-dot"),
      })),
      sub: document.querySelector("[data-testid=cos-sub]")?.textContent ?? null,
      watching: document.querySelector("[data-testid=cos-watching]")?.textContent ?? null,
      suggestions: document.querySelector("[data-testid=cos]") === null ? null : Array.from(document.querySelectorAll("[data-look=suggestion]")).map((el) => el.textContent ?? ""),
    },
  };
}

// ---- grading -------------------------------------------------------------------

const TOKENS = ["sidebar", "inspector", "attention", "info", "foreground", "card", "accent"] as const;
const FAMILY = { sans: "Space Grotesk", mono: "IBM Plex Mono" } as const;

/**
 * Failures keyed by what failed, each with the screen states it failed in, so
 * one drifted element reads as one line naming every state it drifted in.
 */
class Failures {
  private readonly byKey = new Map<string, Set<string>>();
  add(leg: Leg, what: string, tag: string) {
    const key = `${leg}\u0000${what}`;
    this.byKey.set(key, (this.byKey.get(key) ?? new Set()).add(tag));
  }
  lines(): string[] {
    return [...this.byKey].map(([key, tags]) => {
      const [leg, what] = key.split("\u0000");
      const all = [...tags];
      return `${leg} [${all.slice(0, 6).join(", ")}${all.length > 6 ? `, and ${all.length - 6} more` : ""}] ${what}`;
    });
  }
  legs(): Set<string> {
    return new Set([...this.byKey.keys()].map((k) => k.split("\u0000")[0]!));
  }
}

const rgbOf = (value: string): Rgb | null => parseColour(value)?.rgb ?? null;
const same = (a: Rgb | null, b: Rgb | null) => a !== null && b !== null && a.every((v, i) => Math.abs(v - b[i]!) <= 3);
const cite = (row: Row) => `(v2:${row.v2.line}, audit ${row.audit})`;
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function grade(read: Sweep, where: Where, tag: string, failures: Failures, lab: LabName): void {
  const token = Object.fromEntries(TOKENS.map((t) => [t, rgbOf(read.tokens[t] ?? "")])) as Record<(typeof TOKENS)[number], Rgb | null>;
  for (const t of ["sidebar", "inspector"] as const) {
    if (token[t] === null) failures.add("surface", `the page defines no --${t}, so v2's ${t} surface can't paint`, tag);
  }
  const rowsHere = LOOK.filter((r) => (r.on ?? SCREENS).includes(where.screen) && (r.at ?? WIDTHS).includes(where.width));
  const here = new Set(rowsHere.map((r) => r.id));

  // totality: every row matches its expected count, and every painting element in a whole region is covered.
  for (const row of rowsHere) {
    const min = typeof row.min === "function" ? row.min(where) : row.min;
    const got = read.matched[row.id] ?? 0;
    const leg: Leg = row.want.absent === true ? "layout" : "totality";
    if (row.want.absent === true) {
      if (got > 0) failures.add(leg, `${row.id}: ${got} visible, v2 draws none below 1180px ${cite(row)}`, tag);
    } else if (got < min) {
      failures.add(leg, `${row.id}: ${got} element(s) match, ${min} expected ${cite(row)}`, tag);
    }
  }
  for (const e of read.els) {
    const rows = e.rows.filter((id) => here.has(id));
    if (e.whole && rows.length === 0 && e.exceptions.length === 0) {
      failures.add("totality", `${e.el} is in a graded region and no look-table row or exception covers it`, tag);
    }
  }

  // type: the fonts are loaded, not only named.
  const loaded = new Set(read.faces.filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight === "normal" ? "400" : f.weight === "bold" ? "700" : f.weight}`));
  for (const family of Object.values(FAMILY)) {
    if (![...loaded].some((f) => f.startsWith(`${family} `))) failures.add("type", `no face of ${family} is loaded (document.fonts)`, tag);
  }
  const unloaded = new Set<string>();
  for (const e of read.els) {
    if (e.text && (e.family === FAMILY.sans || e.family === FAMILY.mono) && !loaded.has(`${e.family} ${e.weight}`)) unloaded.add(`${e.family} ${e.weight}`);
  }
  for (const face of unloaded) failures.add("type", `text is set in ${face}, and no face of it is loaded`, tag);

  // The rows' own values.
  const byId = new Map(LOOK.map((r) => [r.id, r]));
  for (const e of read.els) {
    for (const id of e.rows) {
      if (!here.has(id)) continue;
      const row = byId.get(id)!;
      const w = row.want;
      const at = `${row.id}: ${e.el}`;
      if (w.family !== undefined && e.text && e.family !== FAMILY[w.family]) failures.add("type", `${at} is set in ${e.family}, v2 sets it in ${FAMILY[w.family]} ${cite(row)}`, tag);
      if (w.size !== undefined && e.text) {
        const [lo, hi] = typeof w.size === "number" ? [w.size, w.size] : w.size;
        if (e.size < lo - 0.01 || e.size > hi + 0.01) failures.add("type", `${at} is ${px(e.size)}, v2 draws ${lo === hi ? px(lo) : `${px(lo)}–${px(hi)}`} ${cite(row)}`, tag);
      }
      if (w.weight !== undefined && e.text && e.weight !== w.weight) failures.add("type", `${at} weighs ${e.weight}, v2 ${w.weight} ${cite(row)}`, tag);
      if (w.tracking !== undefined && e.text && Math.abs(e.tracking - w.tracking * e.size) > 0.06) {
        failures.add("type", `${at} tracks ${px(e.tracking)}, v2 ${w.tracking}em (${px(w.tracking * e.size)}) ${cite(row)}`, tag);
      }
      if (w.surface === "none") {
        const alpha = parseColour(e.bg)?.alpha ?? 0;
        if (alpha > 0) failures.add("surface", `${at} paints ${e.bg}, v2 paints no fill there ${cite(row)}`, tag);
      } else if (w.surface !== undefined && token[w.surface] !== null && !same(rgbOf(e.bg), token[w.surface])) {
        const got = rgbOf(e.bg);
        failures.add("surface", `${at} paints ${got === null ? "no background" : hex(got)}, v2's ${w.surface} surface is ${hex(token[w.surface]!)} ${cite(row)}`, tag);
      }
      if (w.border !== undefined) {
        // Chromium computes a border width down to a whole pixel, so v2's 1.5px reads as 1px, in v2 as here.
        const painted = Math.floor(w.border.width);
        const style = w.border.style ?? "solid";
        const off = e.border.filter((b) => Math.abs(b.width - painted) > 0.01 || b.style !== style || !same(rgbOf(b.colour), token[w.border!.colour]));
        if (off.length > 0) failures.add("surface", `${at} has a ${e.border.map((b) => `${px(b.width)} ${b.style}`).join(" / ")} border, v2 a ${px(w.border.width)} ${style} ink one ${cite(row)}`, tag);
      }
      if (w.underline !== undefined) {
        const b = e.border[2]!;
        const painted = b.width > 0 && b.style !== "none" && rgbOf(b.colour) !== null;
        if (w.underline === "info" && !(Math.abs(b.width - 2) < 0.01 && same(rgbOf(b.colour), token.info))) {
          failures.add("marks", `${at} is underlined ${painted ? `${px(b.width)} ${hex(rgbOf(b.colour)!)}` : "with nothing"}, v2 2px blue ${cite(row)}`, tag);
        }
        if (w.underline === "none" && painted) failures.add("marks", `${at} is underlined ${px(b.width)} ${hex(rgbOf(b.colour)!)}, v2 draws none ${cite(row)}`, tag);
      }
      if (w.square !== undefined) {
        const fill = rgbOf(e.bg);
        const edge = e.border[0]!;
        const want = {
          needs: { fill: token.attention, edge: token.foreground, style: "solid" },
          run: { fill: token.info, edge: token.info, style: "solid" },
          review: { fill: null, edge: token.info, style: "solid" },
          queued: { fill: null, edge: null, style: "dashed" },
          done: { fill: token.foreground, edge: token.foreground, style: "solid" },
        }[w.square];
        const fillOk = want.fill === null ? fill === null : same(fill, want.fill);
        const edgeOk = edge.width > 0 && edge.style === want.style && (want.edge === null || same(rgbOf(edge.colour), want.edge));
        if (!fillOk || !edgeOk) failures.add("marks", `${at} is not v2's ${w.square} square (fill ${fill === null ? "none" : hex(fill)}, edge ${edge.style}) ${cite(row)}`, tag);
      }
      if (w.highlight === true && !same(rgbOf(e.bg), token.attention)) failures.add("marks", `${at} carries no highlighter, and it waits on a person ${cite(row)}`, tag);
      if (w.colour !== undefined && e.text && !same(rgbOf(e.colour), token[w.colour])) {
        failures.add("marks", `${at} is painted ${hex(rgbOf(e.colour) ?? [0, 0, 0])}, v2 paints it ${w.colour} ${hex(token[w.colour]!)} ${cite(row)}`, tag);
      }
      if (w.lineHeight !== undefined && e.text && Math.abs(e.lineHeight - w.lineHeight * e.size) > 0.1) {
        failures.add("type", `${at} sets a ${px(e.lineHeight)} line, v2 ${w.lineHeight} (${px(w.lineHeight * e.size)}) ${cite(row)}`, tag);
      }
      if (w.padding !== undefined && w.padding.some((p, i) => Math.abs(p - e.padding[i]!) > 0.5)) {
        failures.add("layout", `${at} is padded ${e.padding.map(px).join(" ")}, v2 ${w.padding.map(px).join(" ")} ${cite(row)}`, tag);
      }
      if (w.width !== undefined && Math.abs(e.width - w.width) > 0.5) failures.add("layout", `${at} is ${px(e.width)} wide, v2 ${px(w.width)} ${cite(row)}`, tag);
      if (w.minWidth !== undefined && e.minWidth !== `${w.minWidth}px`) failures.add("layout", `${at} holds a ${e.minWidth} minimum, v2 ${w.minWidth}px ${cite(row)}`, tag);
    }
  }

  // surface: square corners on everything but the registry parts the theme can't reach (v2 sets no radius).
  const skipRadius = new Set(EXCEPTIONS.filter((x) => x.radius === "skip").map((x) => x.id));
  for (const e of read.els) {
    if (e.radius.some((r) => r > 0) && !e.exceptions.some((x) => skipRadius.has(x))) {
      failures.add("surface", `${e.el} has a ${e.radius.map(px).join(" ")} radius; v2 draws no rounded corner`, tag);
    }
  }

  // marks: the highlighter on a needs-you element and nothing else.
  const needsYou = new Set(LOOK.filter((r) => r.want.square === "needs" || r.want.highlight === true).map((r) => r.id));
  for (const e of read.els) {
    if (token.attention !== null && same(rgbOf(e.bg), token.attention) && !e.rows.some((id) => needsYou.has(id))) {
      failures.add("marks", `${e.el} carries the highlighter, and nothing on it waits on a person`, tag);
    }
  }

  // content: what the sidebar and Chief of Staff draw from the store.
  for (const failure of sidebarAndCosContent(read.sidebarAndCos, where.store, where.screen, where.working)) failures.add("content", failure, tag);

  // content: what the shared parts draw from the store.
  if (where.screen === "workstream" && lab === "devteam") {
    const channel = Object.keys(where.store.channels)[0]!;
    const want = where.store.channels[channel]!;
    if (read.mentions === null) failures.add("content", "the workstream draws no composer", tag);
    else if (JSON.stringify(read.mentions) !== JSON.stringify(want.live)) {
      failures.add("content", `the composer offers [${read.mentions.map((m) => `@${m}`).join(", ")}], the store's running members are [${want.live.map((m) => `@${m}`).join(", ")}] (v2:308)`, tag);
    }
    if (read.boardCount !== String(want.rows)) failures.add("content", `the Board tab counts ${read.boardCount ?? "nothing"}, the store holds ${want.rows} row(s) (v2:222)`, tag);
  }
}

// ---- the store, read by this check ----------------------------------------------

/** Suspension reasons that are a person being asked something. */
const PERSON_REASONS = new Set(["human_approval", "human_input"]);

async function readStore(api: LabApi, tree: string, userId: string): Promise<Store> {
  const roster = await readDeclaredRoster(tree);
  const host = roster.channels[0]!.id;
  const manifest = await api.get(`/sessions/${encodeURIComponent(host)}/manifest`);
  const seatsRef = (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find(
    (r) => r.kind === "collection" && r.pattern === "inventory/seats/*",
  )?.ref;
  // A seat's name is its address after the team: `<team>.<name>` (the tree's convention).
  const seats =
    seatsRef === undefined
      ? []
      : (await api.collection(host, seatsRef)).map((r) => {
          const id = String(r.id);
          return { id, kind: r.kind == null ? null : String(r.kind), name: id.includes(".") ? id.slice(id.indexOf(".") + 1) : id };
        });
  const asks = await pendingAsksBySeat(api, userId, seats);
  const channels: Store["channels"] = {};
  let running = 0;
  for (const channel of roster.channels) {
    const members = (channel.declared.members as string[] | undefined) ?? [];
    const rows: Array<Record<string, any>> = [];
    for (const board of (channel.declared.boards as string[] | undefined) ?? []) rows.push(...(await api.collection(channel.id, `${channel.id}.${board}`)));
    const live = rows.filter((r) => r.status === "in_progress");
    running += live.length;
    const holds = (seat: { id: string; name: string }) => live.some((r) => r.assignee === seat.id || r.assignee === seat.name);
    channels[channel.id] = {
      rows: rows.length,
      running: live.length,
      needs: members.some((m) => (asks.get(m) ?? 0) > 0),
      live: members
        .map((m) => seats.find((s) => s.id === m))
        .filter((s): s is (typeof seats)[number] => s !== undefined && holds(s))
        .slice(0, 3)
        // A name two members share reaches neither, so that member is offered by its id.
        .map((s) => (members.filter((m) => seats.find((x) => x.id === m)?.name === s.name).length > 1 ? s.id : s.name)),
      lines: (await api.items(channel.id, ["component"])).filter((i) => i.component === "channel-post").length,
      asks: members.reduce((n, m) => n + (asks.get(m) ?? 0), 0),
    };
  }
  return {
    teams: new Set(seats.map((s) => (s.id.includes(".") ? s.id.split(".")[0] : "Staff"))).size,
    seats: seats.length,
    running,
    chiefOfStaff: seats.some((s) => s.name === "chief-of-staff"),
    replied: false,
    asks: [...asks.values()].reduce((a, b) => a + b, 0),
    channels,
  };
}

/** The flow kind the inventory registers a channel under: the flow its `post` action is on. */
async function channelKind(api: LabApi, channel: string): Promise<string> {
  const manifest = await api.get(`/sessions/${encodeURIComponent(channel)}/manifest`);
  const ref = (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find(
    (r) => r.kind === "collection" && r.pattern === "inventory/channels/*",
  )?.ref;
  const kind = ref === undefined ? undefined : (await api.collection(channel, ref)).find((r) => r.id === channel)?.kind;
  if (kind === undefined) throw new Error(`the inventory registers no channel ${channel}`);
  return String(kind);
}

/** The person's pending asks, across the seats' sessions. */
async function pendingAsks(api: LabApi, userId: string): Promise<number> {
  return [...(await pendingAsksBySeat(api, userId)).values()].reduce((a, b) => a + b, 0);
}

/**
 * The person's pending asks, by the flow (the seat) whose session each waits in. Given the
 * inventory's seats, only their sessions count, as Shift Manager reads asks: a session owned
 * by a seat, or one with no owner on a seat's kind (`labs/shift-manager/src/lib/reads.ts`).
 */
async function pendingAsksBySeat(api: LabApi, userId: string, seats?: ReadonlyArray<{ id: string; kind: string | null }>): Promise<Map<string, number>> {
  // Dispatch runs included: a seat woken by a channel post asks from one, and the app lists them.
  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&limit=500`);
  const ids = new Set(seats?.map((s) => s.id));
  const kinds = new Set(seats?.flatMap((s) => (s.kind === null ? [] : [s.kind])));
  const bySeat = new Map<string, number>();
  for (const session of (listing.sessions ?? []) as Array<Record<string, any>>) {
    if (seats !== undefined && !(session.flowId != null ? ids.has(String(session.flowId)) : kinds.has(String(session.flowKind)))) continue;
    const found = await api.items(String(session.id), ["suspension", "suspension_resume"]);
    const resumed = new Set(found.filter((i) => i.type === "suspension_resume").map((i) => String(i.suspensionId)));
    const pending = found.filter((i) => i.type === "suspension" && PERSON_REASONS.has(String(i.reason)) && !resumed.has(String(i.suspensionId))).length;
    const seat = String(session.flowId ?? "");
    if (pending > 0) bySeat.set(seat, (bySeat.get(seat) ?? 0) + pending);
  }
  return bySeat;
}

// ---- driving the page --------------------------------------------------------------

/** Wait until the page shows `shift` and nothing is still moving or loading. */
async function settle(page: Page, shift: Shift): Promise<void> {
  await page.waitForFunction(
    (dark) =>
      document.documentElement.classList.contains("dark") === dark &&
      document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    shift === "night",
    { timeout: 10_000 },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Open `screen` by clicking, the way a person reaches it, and wait for it to draw. */
async function open(page: Page, screen: Screen, ids: { channel: string; taskId: string | null }): Promise<void> {
  const ready = (testId: string) => page.getByTestId(testId).first().waitFor({ timeout: 20_000 });
  switch (screen) {
    case "workstream":
      await page.getByTestId(`nav-workstream-${ids.channel}`).click();
      await ready("workstream");
      await page.locator("[role=tab][data-tab=stream]").click();
      await ready("transcript-line");
      return;
    case "board":
      await page.getByTestId(`nav-workstream-${ids.channel}`).click();
      await ready("workstream");
      await page.locator("[role=tab][data-tab=board]").click();
      await ready("board");
      return;
    case "task":
      await page.getByTestId("nav-tasks").click();
      await page.locator(`[data-testid=task-row][data-task-id="${ids.taskId}"]`).click();
      await ready("task-frame");
      await ready("task-composer");
      return;
    case "tasks":
      await page.getByTestId("nav-tasks").click();
      await ready("tasks");
      return;
    case "cos":
      await page.getByTestId("nav-cos").click();
      await ready("cos");
      // The conversation, once read, or the named state in its place.
      await page.locator("[data-testid=cos-items], [data-testid=cos-conversation-empty], [data-testid=cos-none], [data-testid=cos-several]").first().waitFor({ timeout: 20_000 });
      return;
    case "inbox":
      await page.getByTestId("nav-inbox").click();
      await ready("inbox");
      await page.getByTestId("inbox-item").first().click();
      await ready("inbox-reply");
      return;
    case "roster":
      await page.getByTestId("nav-roster").click();
      await ready("roster");
      return;
    case "project":
      // ---- slice C: the project holding the workstream, on its Board, under the team strip ----
      await page.locator(`[data-testid=project-group]:has([data-testid="nav-workstream-${ids.channel}"]) [data-testid^=nav-project-]`).click();
      await ready("project");
      await page.locator("[role=tab][data-tab=board]").click();
      await ready("project-lane");
      // ---- end slice C ----
  }
}

// ---- one Lab -------------------------------------------------------------------

async function checkLab(lab: LabName, pages: string, failures: Failures, evidence: string[]): Promise<void> {
  const served = await startShiftManager({ scratch: SCRATCH, label: lab, config: LABS[lab].config, pages, env: LABS[lab].env });
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // tsx compiles this file with esbuild's keepNames, which wraps nested
    // functions in `sweep` with a `__name` helper the page lacks.
    await page.addInitScript("globalThis.__name = (fn) => fn;");
    await page.goto(served.origin);
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string; bearerToken?: string } | null;
    if (injected?.userId === undefined) throw new Error(`${lab}: the page was handed no userId`);
    const api = labApi(served.origin, injected.bearerToken);
    const roster = await readDeclaredRoster(LABS[lab].tree);
    const channel = roster.channels[0]!.id;

    let taskId: string | null = null;
    let screens: readonly Screen[];
    if (lab === "devteam") {
      // File one row through the channel's own post, and wait for it to run.
      const kind = await channelKind(api, channel);
      const posted = await api.call("POST", `/${encodeURIComponent(String(kind))}/${encodeURIComponent(channel)}/actions/post`, {
        userId: injected.userId,
        input: { body: `${fixture.devteam.issue}: ${fixture.devteam.text}` },
      });
      if (posted.status !== 202) throw new Error(`devteam: the filing post answered ${posted.status} ${JSON.stringify(posted.body)}`);
      const board = `${channel}.${((roster.channels[0]!.declared.boards as string[]) ?? [])[0]}`;
      // The EM seat runs the board when asked to drain it; in a session of its own, so its
      // ask, pending in the seat's session, stays pending.
      for (let waited = 0; waited < 30_000; waited += 250) {
        if ((await api.collection(channel, board)).length > 0) break;
        await sleep(250);
      }
      const em = roster.workers.find((w) => w.declared.flow === EM_KIND && ((roster.channels[0]!.declared.members as string[]) ?? []).includes(w.id));
      if (em === undefined) throw new Error("devteam: the channel has no EM member to drain its board");
      const drained = await api.call("POST", `/${encodeURIComponent(em.id)}/goal_look_drain_${RUN_STAMP}/actions/drain`, { userId: injected.userId, input: {} });
      if (drained.status !== 202) throw new Error(`devteam: the EM's drain answered ${drained.status} ${JSON.stringify(drained.body)}`);
      for (let waited = 0; waited < 30_000 && taskId === null; waited += 250) {
        const row = (await api.collection(channel, board)).find((r) => r.status === "in_progress" && r.run != null);
        if (row !== undefined) taskId = String(row.id);
        else await sleep(250);
      }
      if (taskId === null) {
        const rows = (await api.collection(channel, board)).map((r) => `${r.id} ${r.status} run=${r.run == null ? "none" : "yes"}`);
        throw new Error(`devteam: the filed row never ran, so the sweep has no live run to read (board ${board}: ${rows.join("; ") || "no rows"})`);
      }
      if ((await pendingAsks(api, injected.userId)) === 0) throw new Error("devteam: no ask is pending, so Inbox has nothing to select");
      screens = SCREENS;
    } else {
      // One exchange through the chief of staff's door, as a person sends it.
      await page.getByTestId("cos").waitFor({ timeout: 20_000 });
      await page.getByTestId("cos-composer-input").fill(fixture.desk.line);
      await page.getByTestId("cos-composer-send").click();
      await page.locator("[data-testid=cos-item]", { hasText: fixture.desk.reply }).first().waitFor({ timeout: 30_000 });
      screens = ["cos"];
    }
    // The page read the Lab before the row was filed; read it again.
    await page.reload();
    await page.getByTestId("shell").waitFor({ timeout: 20_000 });
    // The desk Lab's exchange above waited for the seat's reply to be drawn.
    const store = { ...(await readStore(api, LABS[lab].tree, injected.userId)), replied: lab === "desk" };
    evidence.push(`${lab}: ${store.teams} team(s), ${store.seats} seats, ${store.running} running, ${store.asks} ask(s) pending, chief of staff ${store.chiefOfStaff ? "yes" : "no"}`);

    const counts: string[] = [];
    for (const screen of screens) {
      await open(page, screen, { channel, taskId });
      for (const shift of SHIFTS) {
        await page.getByTestId(shift === "day" ? "shift-day" : "shift-night").click();
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 1000 });
          await settle(page, shift);
          const read = await page.evaluate(sweep, {
            rows: LOOK.map((r) => ({ id: r.id, select: r.select })),
            exceptions: EXCEPTIONS.map((x) => ({ id: x.id, select: x.select })),
            whole: WHOLE,
            tokens: [...TOKENS],
          });
          const tag = `${screen} ${shift} ${width}`;
          // The page drew from the Lab as it stood at the reload, so the store read then is what it must equal.
          grade(read, { screen, width, store }, lab === "devteam" ? tag : `${lab} ${tag}`, failures, lab);
          counts.push(`${screen} ${shift} ${width}: ${read.els.length}`);
          if (process.env.GOAL_SHOTS !== undefined) {
            mkdirSync(process.env.GOAL_SHOTS, { recursive: true });
            await page.screenshot({ path: join(process.env.GOAL_SHOTS, `${lab}-${screen}-${shift}-${width}.png`) });
          }
        }
      }
    }
    if (lab === "desk") {
      // Chief of Staff while it works: a line held in flight (its delivery check waits), so the
      // working dot, the sub line and the thinking line are graded drawn, not only absent.
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/requests/*/status", async (route) => {
        await held;
        await route.continue();
      });
      await page.setViewportSize({ width: WIDTHS[0], height: 1000 });
      await page.getByTestId("cos-composer-input").fill(fixture.desk.line);
      await page.getByTestId("cos-composer-send").click();
      await page.getByTestId("cos-working").waitFor({ timeout: 20_000 });
      for (const shift of SHIFTS) {
        await page.getByTestId(shift === "day" ? "shift-day" : "shift-night").click();
        await settle(page, shift);
        const read = await page.evaluate(sweep, {
          rows: LOOK.map((r) => ({ id: r.id, select: r.select })),
          exceptions: EXCEPTIONS.map((x) => ({ id: x.id, select: x.select })),
          whole: WHOLE,
          tokens: [...TOKENS],
        });
        grade(read, { screen: "cos", width: WIDTHS[0], store, working: true }, `${lab} cos working ${shift} ${WIDTHS[0]}`, failures, lab);
        counts.push(`cos working ${shift} ${WIDTHS[0]}: ${read.els.length}`);
        if (process.env.GOAL_SHOTS !== undefined) await page.screenshot({ path: join(process.env.GOAL_SHOTS, `${lab}-cos-working-${shift}-${WIDTHS[0]}.png`) });
      }
      release();
      await page.getByTestId("cos-working").waitFor({ state: "detached", timeout: 30_000 });
      await page.unroute("**/requests/*/status");
    }
    if (errors.length > 0) failures.add("totality", `the page threw: ${errors.join(" | ")}`, lab);
    evidence.push(`${lab} painting elements read: ${counts.join("; ")}`);
  } finally {
    await browser.close();
    await served.stop();
  }
}

// ---- the controls ----------------------------------------------------------------

function controlPatches(control: string): Patch[] {
  switch (control) {
    case "drift":
      return [
        {
          file: "src/surfaces/Sidebar.tsx",
          from: "className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] ${",
          to: "className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] ${",
          why: "the team row rounded",
        },
        {
          file: "src/surfaces/Sidebar.tsx",
          from: '<Meta role="count" className="ml-2 tabular-nums text-muted-foreground" testId={`${testId}-count`}>',
          to: '<Meta role="count" className="ml-2 font-sans tabular-nums text-muted-foreground" testId={`${testId}-count`}>',
          why: "the Roster count set in the sans",
        },
      ];
    case "unclassified":
      return [
        {
          file: "src/surfaces/Sidebar.tsx",
          from: '<div className="flex-1 overflow-y-auto p-3">',
          to: '<div className="flex-1 overflow-y-auto p-3"><p className="px-2 text-xs">A line no row covers</p>',
          why: "one visible element no look-table row covers, in the sidebar",
        },
      ];
    case "missing":
      return [
        {
          file: "src/surfaces/Sidebar.tsx",
          from: /<Meta role="count" className="w-8 text-right tabular-nums text-muted-foreground" testId="team-on-shift">[\s\S]*?<\/Meta>/,
          to: "",
          why: "the team rows' on-shift counts removed",
        },
      ];
    default:
      return [];
  }
}

// ---- SP-1: every row cites a v2 line that holds what it claims --------------------

function checkCitations(): string[] {
  const lines = readFileSync(V2, "utf8").split("\n");
  const problems: string[] = [];
  for (const row of LOOK) {
    const line = lines[row.v2.line - 1];
    if (line === undefined || !line.includes(row.v2.has)) problems.push(`setup: row "${row.id}" cites v2:${row.v2.line}, which doesn't hold ${JSON.stringify(row.v2.has)}`);
  }
  // The radius rule cites the whole file: v2 sets a radius nowhere.
  if (/radius/i.test(lines.join("\n"))) problems.push("setup: v2 sets a border-radius somewhere, so 'radius 0 everywhere' is no longer v2's rule");
  return problems;
}

// ---- the goal ----------------------------------------------------------------------

await runGoal(async () => {
  const setup = checkCitations();
  if (setup.length > 0) return { failures: setup, evidence: "" };
  const evidence: string[] = [];
  let pages = process.env.GOAL_PAGES;
  if (pages === undefined) {
    const built = await buildShiftManagerCopy(SCRATCH, CONTROL === "" ? "as-written" : CONTROL, controlPatches(CONTROL));
    pages = built.pages;
    if (built.diff.length > 0) evidence.push(`patches: ${built.diff.join("; ")}`);
  }
  const failures = new Failures();
  for (const lab of Object.keys(LABS) as LabName[]) await checkLab(lab, pages, failures, evidence);
  const lines = failures.lines();
  const legs = [...failures.legs()].sort().join(", ");
  return {
    failures: (lines.length === 0 ? [] : [`legs failing: ${legs}`, ...lines]).map((f) => (CONTROL === "" ? f : `[control ${CONTROL}] ${f}`)),
    evidence: `Shift Manager ${process.env.GOAL_PAGES === undefined ? "built" : `served from ${pages}`}, every screen read in Chromium, day and night, at ${WIDTHS.join(" and ")}px, against ${LOOK.length} look-table rows and ${EXCEPTIONS.length} exceptions. ${evidence.join("; ")}`,
  };
});
