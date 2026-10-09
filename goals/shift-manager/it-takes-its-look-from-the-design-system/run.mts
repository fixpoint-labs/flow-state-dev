/**
 * Goal check: Shift Manager takes its light and dark look from the design-system
 * package's one import, the FSD parts it reuses are the registry's copies,
 * with that import removed no Shift Manager value shows on any of them, and
 * the sidebar's theme mark changes the look live, both ways.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Shift Manager is copied to a scratch directory, patched there (never in the
 * checkout), built with Vite, and served by its own command over the
 * run-lab (`packages/shift-manager/test/fixtures/run-lab/`), whose runs store
 * a message, a reasoning item and a tool call through the Claude Code harness's
 * emit path. Chromium opens a task from Tasks by clicking, opens its tool card,
 * and reads COMPUTED styles in a light pass and a dark pass, each over a Lab
 * started on that shift (day, then night; `SHIFT_MANAGER_SHIFT`, as `--shift`
 * sets it), which a browser that has picked nothing opens on.
 *
 * Builds:
 *   themed     Shift Manager as written
 *   no-theme   Shift Manager with its design-system import line removed (leg c's
 *              premise); setup fails if there is no such line
 *
 * Legs (each failure is tagged `<leg> [<build> <variant>]`):
 *   reach      each swept registry part (message, reasoning, tool, code block)
 *              is drawn at least once in the task's Session
 *   themed     on the themed build, every colour painted on the shell and on
 *              each swept part is one of Shift Manager's values for that variant,
 *              every font is one of its families, and the page holds a loaded
 *              face (`document.fonts`, status `loaded`) for every family and
 *              weight its text is set in: the family named but not loaded, or
 *              a weight the browser has to synthesize, fails
 *   neutral    leg c: on the no-theme build, no colour painted on the shell or
 *              on a swept part is any Shift Manager value (either variant), no
 *              font is one of its families, and the page declares no face of
 *              one, so the fonts arrive with the import and only with it
 *   switch     on the themed build, in a fresh browser, with the sidebar's theme
 *              mark (which replaced the Day / Night switch, 36bed1297 / #2825):
 *              over the Lab started on day, picking night paints the page's
 *              background with Shift Manager's dark value; over the one started
 *              on night, picking day paints its light value; the mark shows the
 *              theme the page is on each time, and each pick survives a reload
 *
 * Control:
 *   GOAL_CONTROL=hardcoded-accent  Shift Manager's quiet tool line paints its
 *                                  label with Shift Manager's accent as a
 *                                  literal, in both builds. `neutral` must FAIL
 *                                  naming `tool`, and nothing else may fail.
 *   GOAL_CONTROL=switch-ignored    the theme mark does nothing when clicked.
 *                                  `switch` must FAIL, and nothing else may
 *                                  fail.
 *   GOAL_CONTROL=fonts-not-loaded  the themed build imports the design-system
 *                                  stylesheet with its font imports blanked, so
 *                                  the families are named but no face is declared.
 *                                  `themed` must FAIL on the fonts, and
 *                                  nothing else may fail.
 *
 * Run:     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-takes-its-look-from-the-design-system/run.mts
 * Control: GOAL_CONTROL=hardcoded-accent PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-takes-its-look-from-the-design-system/run.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { declarations, hex, near, parseColour, readShiftManagerTheme, type Rgb } from "../../lib/colour.mts";
import { stripImportsAndComments } from "../../../labs/design-system/test/theme.ts";
import { REPO_ROOT, goalTmpDir, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerCopy, pickShift, startShiftManager, type Patch, type ServedShiftManager } from "../../lib/shift-manager.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["hardcoded-accent", "switch-ignored", "fonts-not-loaded"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const RUN_LAB = join(REPO_ROOT, "packages", "shift-manager", "test", "fixtures", "run-lab");
const SCRATCH = goalTmpDir("shift-manager-theme");
const THEME = readShiftManagerTheme();
/** The design-system stylesheet. Its only imports are its fonts (the package's test holds it to that). */
const SHIFT_MANAGER_CSS = join(REPO_ROOT, "labs", "design-system", "shift-manager.css");
/** Shift Manager's page background per variant, as the design-system package declares it. */
const BACKGROUND = (() => {
  const css = readFileSync(SHIFT_MANAGER_CSS, "utf8");
  const rgb = (value: string | undefined): Rgb => {
    if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`setup: shift-manager.css declares no #rrggbb --background (got ${value})`);
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
  };
  const both = { light: rgb(declarations(css, ":root")["--background"]), dark: rgb(declarations(css, ".dark")["--background"]) };
  // Equal backgrounds would let a switch that did nothing pass.
  if (near(both.light, both.dark)) throw new Error(`setup: the light and dark --background are the same colour (${hex(both.light)})`);
  return both;
})();
/** The one line leg c removes. */
const THEME_IMPORT = /^@import "@flow-state-dev\/design-system\/shift-manager\.css";\n/m;
/** The registry parts the Session must draw, by the selector that finds Shift Manager's copy of each. */
const SWEPT: Record<string, string> = {
  message: '[data-testid=session-item][data-item-type=message] [data-testid=message]',
  reasoning: '[data-testid=session-item][data-item-type=reasoning] [data-slot=collapsible]',
  tool: '[data-testid=session-item][data-item-type=tool_output] [data-slot=collapsible]',
  "code block": '[data-testid=session-item][data-item-type=tool_output] [data-language]',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- serving -----------------------------------------------------------------

/** The run-lab served on `shift`: the theme a browser that has picked nothing opens on (`SHIFT_MANAGER_SHIFT`, as `--shift` sets it). */
const startLab = (pages: string, shift: "day" | "night"): Promise<ServedShiftManager> =>
  startShiftManager({ scratch: SCRATCH, label: `run-lab-${shift}`, config: join(RUN_LAB, "fsdev.config.mts"), pages, env: { SHIFT_MANAGER_SHIFT: shift } });

/** A board row with a run, read through the Lab's own route. */
async function rowWithRun(origin: string): Promise<string> {
  const roster = await readDeclaredRoster(join(RUN_LAB, "workforce"));
  const mailbox = roster.mailboxes.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0)!;
  const board = `${mailbox.id}.${(mailbox.declared.boards as string[])[0]}`;
  const enc = encodeURIComponent;
  for (let waited = 0; waited < 30_000; waited += 250) {
    const response = await fetch(`${origin}/api/flows/sessions/${enc(mailbox.id)}/resources/${enc(board)}?limit=200`);
    const body = (await response.json()) as { items?: Array<{ clientData?: { id?: string; status?: string; run?: unknown } }> };
    const row = (body.items ?? []).map((i) => i.clientData ?? {}).find((r) => r.status === "in_progress" && r.run != null);
    if (row?.id !== undefined) return row.id;
    await sleep(250);
  }
  throw new Error("store: the run-lab's board never held a running row");
}

// ---- reading the page --------------------------------------------------------

type Sample = { part: string; el: string; prop: string; value: string; weight?: string };
/** One `document.fonts` entry: the family unquoted, its weight and its load status. */
type Face = { family: string; weight: string; status: string };
type PageRead = { counts: Record<string, number>; colours: Sample[]; fonts: Sample[]; faces: Face[]; probes: Record<string, string> };

/**
 * Runs in the page: every painted colour and font on the shell and inside each
 * swept part, plus how the page computes each probe value. The shell is App
 * Lab's own chrome, the Session's items left out (they are the parts).
 */
function readPage(args: { swept: Record<string, string>; probeValues: string[] }): PageRead {
  const colours: Sample[] = [];
  const fonts: Sample[] = [];
  const counts: Record<string, number> = {};
  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}${el.getAttribute("class") ? "." + el.getAttribute("class")!.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
  const sample = (part: string, el: Element) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility !== "visible" || rect.width === 0 || rect.height === 0) return false;
    const push = (prop: string, value: string) => colours.push({ part, el: describe(el), prop, value });
    // A colour set by an inline literal is content (syntax highlighting), not skin.
    const inlineLiteral = /(^|;)\s*(color|background(-color)?)\s*:\s*(#|rgb)/i.test(el.getAttribute("style") ?? "");
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
    if (!inlineLiteral) {
      if (hasText) push("color", cs.color);
      push("background-color", cs.backgroundColor);
    }
    if (el.tagName.toLowerCase() === "svg") {
      if (cs.stroke !== "none") push("stroke", cs.stroke);
      if (cs.fill !== "none") push("fill", cs.fill);
    }
    for (const side of ["top", "right", "bottom", "left"]) {
      const style = cs.getPropertyValue(`border-${side}-style`);
      if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && style !== "none" && style !== "hidden") {
        push(`border-${side}-color`, cs.getPropertyValue(`border-${side}-color`));
      }
    }
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) push("outline-color", cs.outlineColor);
    if (hasText) fonts.push({ part, el: describe(el), prop: "font-family", value: cs.fontFamily, weight: cs.fontWeight });
    return true;
  };
  const shell = document.querySelector("[data-testid=shell]");
  counts.shell = 0;
  for (const el of shell === null ? [] : [shell, ...Array.from(shell.querySelectorAll("*"))]) {
    if (el.closest("[data-testid=session-item]") !== null) continue;
    if (sample("shell", el)) counts.shell += 1;
  }
  for (const [part, selector] of Object.entries(args.swept)) {
    counts[part] = 0;
    for (const root of Array.from(document.querySelectorAll(selector))) {
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) if (sample(part, el)) counts[part] += 1;
    }
  }
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const probes: Record<string, string> = {};
  for (const value of args.probeValues) {
    probe.style.color = "";
    probe.style.color = value;
    probes[value] = getComputedStyle(probe).color;
  }
  probe.remove();
  const faces = Array.from(document.fonts).map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), weight: f.weight, status: f.status }));
  return { counts, colours, fonts, faces, probes };
}

/** Open the task from Tasks, open what its Session draws closed, and read one pass. */
async function readPass(page: Page, origin: string, taskId: string, dark: boolean): Promise<PageRead> {
  // The Lab was started on the pass's shift, which a browser that has picked nothing opens on.
  await page.goto(`${origin}/tasks`);
  await page.getByTestId("tasks-table").waitFor({ timeout: 20_000 });
  await page.locator(`[data-testid=task-row][data-task-id="${taskId}"]`).click();
  await page.getByTestId("session-items").waitFor({ timeout: 15_000 });
  await page.locator('[data-testid=session-item][data-item-type=tool_output]').first().waitFor({ timeout: 15_000 });
  // The tool card and the reasoning draw their bodies closed; open them so the code block is read too.
  for (const trigger of await page.locator("[data-testid=session-item] [data-slot=collapsible-trigger]").all()) {
    if ((await trigger.getAttribute("data-state")) === "closed") await trigger.click();
  }
  if ((await page.locator(SWEPT.tool!).count()) > 0) {
    await page.locator(SWEPT["code block"]!).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  }
  // Read once the page shows the variant and no finite transition or animation is still running.
  await page.waitForFunction(
    (wantDark) =>
      document.documentElement.classList.contains("dark") === wantDark &&
      document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    dark,
    { timeout: 10_000 },
  );
  // Faces load when text first needs them; read once every pending load has settled.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate(readPage, { swept: SWEPT, probeValues: [...THEME.light, ...THEME.dark] });
}

// ---- the theme mark -----------------------------------------------------------

/**
 * Half the switch leg, on the theme mark that replaced the Day / Night switch
 * (36bed1297 / #2825), over a Lab started on `started`: a fresh browser
 * (nothing picked yet) opens on that shift, the mark picks the other one, so
 * a page that ignored the click and kept the start fails, and the pick is
 * read again after a reload, where the start would put it back. Run once over
 * a Lab started on day and once over one started on night, it covers both ways.
 */
async function switchLeg(browser: Browser, origin: string, started: "day" | "night"): Promise<{ failures: string[]; evidence: string }> {
  const failures: string[] = [];
  const seen: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const mark = page.getByTestId("theme-mark");
  const ready = async () => {
    await mark.waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
  };
  const expect = async (step: string, want: "day" | "night") => {
    await ready();
    const variant = want === "night" ? "dark" : "light";
    const got = parseColour(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    if (got === null || !near(got.rgb, BACKGROUND[variant])) {
      failures.push(`switch [${step}] the page background is ${got === null ? "transparent" : hex(got.rgb)}, not Shift Manager's ${variant} ${hex(BACKGROUND[variant])}`);
    }
    const marked = await mark.getAttribute("data-theme");
    if (marked !== want) failures.push(`switch [${step}] the theme mark shows ${marked}, not ${want}`);
    seen.push(`${step}: ${got === null ? "transparent" : hex(got.rgb)}`);
  };
  const pick = async (step: string, want: "day" | "night") => {
    try {
      await pickShift(page, want);
    } catch (error) {
      failures.push(`switch [${step}] ${String((error as Error).message)}`);
    }
    await expect(step, want);
  };
  try {
    const want = started === "day" ? "night" : "day";
    await page.goto(`${origin}/tasks`);
    await expect(`started on ${started}, nothing picked`, started);
    await pick(`${want} picked, started on ${started}`, want);
    await page.reload();
    await expect(`reloaded after ${want}, started on ${started}`, want);
  } finally {
    await page.close();
  }
  return { failures, evidence: `switch: ${seen.join("; ")}` };
}

// ---- grading -------------------------------------------------------------------

const firstFamily = (value: string) => value.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
/** A font weight as a number string: computed styles and `FontFace` can spell 400 and 700 as keywords. */
const weight = (value: string | undefined) => (value === "normal" ? "400" : value === "bold" ? "700" : (value ?? ""));
const where = (s: Sample) => `${s.part}: ${s.el} ${s.prop}`;

/** At most `n` lines per part, then a count, so one broken part can't bury the rest. */
function capped(lines: Array<{ part: string; line: string }>, n = 4): string[] {
  const byPart = new Map<string, string[]>();
  for (const { part, line } of lines) byPart.set(part, [...(byPart.get(part) ?? []), line]);
  return [...byPart].flatMap(([part, all]) => [...all.slice(0, n), ...(all.length > n ? [`… and ${all.length - n} more on ${part}`] : [])]);
}

function gradeThemed(read: PageRead, variant: "light" | "dark", tag: string): string[] {
  const theme = THEME[variant].map((v) => parseColour(read.probes[v] ?? v)?.rgb).filter((v): v is Rgb => v !== undefined);
  const out: Array<{ part: string; line: string }> = [];
  for (const s of read.colours) {
    const c = parseColour(s.value);
    if (c !== null && !theme.some((t) => near(t, c.rgb))) out.push({ part: s.part, line: `themed [${tag}] ${where(s)} → ${hex(c.rgb)} is not a Shift Manager ${variant} value` });
  }
  for (const s of read.fonts) {
    if (!THEME.families.includes(firstFamily(s.value))) out.push({ part: s.part, line: `themed [${tag}] ${where(s)} → font ${firstFamily(s.value)} is not Shift Manager's` });
  }
  // The family string names the font whether or not it loaded; the loaded face is what paints it.
  // (`document.fonts.check()` won't do: it answers true when no face of the family is declared at all.)
  const faceOf = (f: Face) => `${f.family} ${weight(f.weight)}`;
  const loaded = new Set(read.faces.filter((f) => f.status === "loaded").map(faceOf));
  const unloaded = new Set<string>();
  for (const s of read.fonts) {
    const face = `${firstFamily(s.value)} ${weight(s.weight)}`;
    if (THEME.families.includes(firstFamily(s.value)) && !loaded.has(face)) unloaded.add(face);
  }
  for (const face of unloaded) {
    const declared = read.faces.filter((f) => faceOf(f) === face).map((f) => f.status);
    out.push({ part: "fonts", line: `themed [${tag}] text is set in ${face}, but no face of it loaded (document.fonts: ${declared.length === 0 ? "none declared" : declared.join(", ")})` });
  }
  return capped(out);
}

function gradeNeutral(read: PageRead, tag: string): string[] {
  const all = [...THEME.light, ...THEME.dark];
  const theme = all.map((v) => ({ v, rgb: parseColour(read.probes[v] ?? v)?.rgb })).filter((t): t is { v: string; rgb: Rgb } => t.rgb !== undefined);
  const out: Array<{ part: string; line: string }> = [];
  for (const s of read.colours) {
    const c = parseColour(s.value);
    const hit = c === null ? undefined : theme.find((t) => near(t.rgb, c.rgb));
    if (hit !== undefined) out.push({ part: s.part, line: `neutral [${tag}] ${where(s)} → ${hex(c!.rgb)} is Shift Manager's ${hit.v}` });
  }
  for (const s of read.fonts) {
    if (THEME.families.includes(firstFamily(s.value))) out.push({ part: s.part, line: `neutral [${tag}] ${where(s)} → font ${firstFamily(s.value)} is Shift Manager's` });
  }
  const faces = new Set(read.faces.filter((f) => THEME.families.includes(f.family)).map((f) => `${f.family} ${weight(f.weight)} (${f.status})`));
  for (const face of faces) out.push({ part: "fonts", line: `neutral [${tag}] the page still declares a face of ${face}` });
  return capped(out);
}

// ---- the goal ----------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const control: Patch[] =
    CONTROL === "hardcoded-accent"
      ? [
          {
            file: "src/components/ToolLine.tsx",
            from: "text-sm text-muted-foreground hover:text-foreground",
            to: `text-sm text-[${THEME.attentionLight}]`, // no hover colour: the sweep clicks the line open, so the pointer rests on it
            why: `the quiet tool line's label painted Shift Manager's accent ${THEME.attentionLight} as a literal`,
          },
        ]
      : CONTROL === "switch-ignored"
        ? [
            {
              file: "src/components/ShiftManagerMark.tsx",
              from: "onClick={look.cycle}",
              to: "onClick={() => undefined}",
              why: "the theme mark does nothing when clicked",
            },
          ]
        : [];

  // The families named and no face behind them: the design-system stylesheet with only its font imports blanked.
  const fontsNotLoaded: Patch[] = [];
  if (CONTROL === "fonts-not-loaded") {
    const sheet = readFileSync(SHIFT_MANAGER_CSS, "utf8");
    const blanked = stripImportsAndComments(sheet);
    if (!/@import/.test(sheet) || /@import/.test(blanked)) throw new Error("setup [control]: shift-manager.css has no font import to blank");
    const copy = join(SCRATCH, "shift-manager.no-fonts.css");
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(copy, blanked);
    fontsNotLoaded.push({ file: "src/styles.css", from: THEME_IMPORT, to: `@import ${JSON.stringify(copy)};\n`, why: "the design-system stylesheet imported with its font imports blanked" });
  }

  // Either build failing to set up is its own leg's failure; the other still runs.
  const builds: Array<{ name: "themed" | "no-theme"; pages: string }> = [];
  for (const [name, patches] of [
    ["themed", [...control, ...fontsNotLoaded]],
    ["no-theme", [{ file: "src/styles.css", from: THEME_IMPORT, to: "", why: "the design-system import line removed" }, ...control]],
  ] as const) {
    try {
      const built = await buildShiftManagerCopy(SCRATCH, name, patches as Patch[]);
      builds.push({ name, pages: built.pages });
      if (built.diff.length > 0) evidence.push(`${name} patches: ${built.diff.join("; ")}`);
    } catch (error) {
      failures.push(`${name === "themed" ? "themed" : "neutral"} [${name}] ${String((error as Error).message ?? error).split("\n")[0]}`);
    }
  }

  const browser = await launchChromium();
  try {
    for (const { name, pages } of builds) {
      // One Lab per pass, started on the pass's shift: the light pass on day, the dark pass on night.
      for (const variant of ["light", "dark"] as const) {
        const shift = variant === "dark" ? "night" : "day";
        const served = await startLab(pages, shift);
        try {
          const taskId = await rowWithRun(served.origin);
          const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          // tsx compiles this file with esbuild's keepNames, which wraps nested
          // functions in readPage with a `__name` helper the page lacks.
          await page.addInitScript("globalThis.__name = (fn) => fn;");
          const tag = `${name} ${variant}`;
          const read = await readPass(page, served.origin, taskId, variant === "dark");
          if (name === "themed" && variant === "light") {
            const missing = Object.keys(SWEPT).filter((part) => (read.counts[part] ?? 0) === 0);
            if (missing.length > 0) failures.push(`reach [${tag}] the Session drew no registry ${missing.join(", ")}`);
          }
          failures.push(...(name === "themed" ? gradeThemed(read, variant, tag) : gradeNeutral(read, tag)));
          const loadedFaces = read.faces.filter((f) => f.status === "loaded").map((f) => `${f.family} ${weight(f.weight)}`);
          evidence.push(
            `${tag}: ${Object.entries(read.counts).map(([p, n]) => `${p} ${n}`).join(", ")} elements; ${read.colours.length} colours, ${read.fonts.length} fonts; faces loaded: ${loadedFaces.length === 0 ? "none" : [...new Set(loadedFaces)].join(", ")}`,
          );
          if (process.env.GOAL_KEEP === "1") await page.screenshot({ path: join(SCRATCH, `${name}-${variant}.png`), fullPage: true });
          if (errors.length > 0) failures.push(`reach [${tag}] the page threw: ${errors.join(" | ")}`);
          await page.close();
          // Half the switch leg on each themed Lab, in a fresh browser: picked against the shift it started on.
          if (name === "themed") {
            const switched = await switchLeg(browser, served.origin, shift);
            failures.push(...switched.failures);
            evidence.push(switched.evidence);
          }
        } finally {
          served.child.kill("SIGTERM");
          await served.exited;
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (process.env.GOAL_KEEP === "1") console.log(`kept: ${SCRATCH}`);
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager copied to ${SCRATCH}, built twice (as written, and with its theme import removed), served over the run-lab, a running task opened from Tasks in Chromium. ${evidence.join("; ")}`,
  };
});
