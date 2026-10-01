/**
 * Goal check: shift-manager takes its light and dark look from the design-system
 * package's one import, the FSD parts it reuses are the registry's copies,
 * and with that import removed no shift-manager value shows on any of them.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * shift-manager is copied to a scratch directory, patched there (never in the
 * checkout), built with Vite, and served by its own start script over the
 * run-lab (`goals/shift-manager/it-shows-and-stops-a-task-run/lab/`), whose runs store
 * a message, a reasoning item and a tool call through the Claude Code harness's
 * emit path. Chromium opens a task from Tasks by clicking, opens its tool card,
 * and reads COMPUTED styles in a light pass and a dark pass, set through the browser's colour-scheme setting.
 *
 * Builds:
 *   themed     shift-manager as written
 *   no-theme   shift-manager with its design-system import line removed (leg c's
 *              premise); setup fails if there is no such line
 *
 * Legs (each failure is tagged `<leg> [<build> <variant>]`):
 *   reach      each swept registry part (message, reasoning, tool, code block)
 *              is drawn at least once in the task's Session
 *   themed     on the themed build, every colour painted on the shell and on
 *              each swept part is one of shift-manager's values for that variant, and
 *              every font is one of its families
 *   neutral    leg c: on the no-theme build, no colour painted on the shell or
 *              on a swept part is any shift-manager value (either variant), and no
 *              font is one of its families
 *
 * Control:
 *   GOAL_CONTROL=hardcoded-accent  shift-manager's copy of the tool card paints its
 *                                  completed icon with shift-manager's accent as a
 *                                  literal, in both builds. `neutral` must FAIL
 *                                  naming `tool`, and nothing else may fail.
 *
 * Run:     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-takes-its-look-from-the-design-system/run.mts
 * Control: GOAL_CONTROL=hardcoded-accent PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-takes-its-look-from-the-design-system/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { hex, near, parseColour, readAppLabTheme, type Rgb } from "../../lib/colour.mts";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["hardcoded-accent"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const SHIFT_MANAGER = join(REPO_ROOT, "labs", "shift-manager");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const RUN_LAB = join(REPO_ROOT, "goals", "shift-manager", "it-shows-and-stops-a-task-run", "lab");
const SCRATCH = goalTmpDir("shift-manager-theme");
const THEME = readAppLabTheme();
/** The one line leg c removes. */
const THEME_IMPORT = /^@import "@flow-state-dev\/design-system\/shift-manager\.css";\n/m;
/** The registry parts the Session must draw, by the selector that finds shift-manager's copy of each. */
const SWEPT: Record<string, string> = {
  message: '[data-testid=session-item][data-item-type=message] [data-testid=message]',
  reasoning: '[data-testid=session-item][data-item-type=reasoning] [data-slot=collapsible]',
  tool: '[data-testid=session-item][data-item-type=tool_output] [data-slot=collapsible]',
  "code block": '[data-testid=session-item][data-item-type=tool_output] [data-language]',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- building ----------------------------------------------------------------

type Patch = { file: string; from: string | RegExp; to: string; why: string };

/**
 * shift-manager copied to scratch with `patches` applied, then built. Tailwind reads
 * class names off the files on disk, so a patch has to land in a copy rather
 * than in the bundler. A patch that matches nothing fails the setup: a build
 * that "removed" a line that was never there proves nothing.
 */
async function build(name: string, patches: Patch[]): Promise<{ pages: string; diff: string[] }> {
  const root = join(SCRATCH, name, "shift-manager");
  cpSync(SHIFT_MANAGER, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist)$/.test(src) });
  symlinkSync(join(SHIFT_MANAGER, "node_modules"), join(root, "node_modules"));
  // The copy sits outside the workspace; its tsconfig still extends the workspace's.
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  const diff: string[] = [];
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup [${name}]: ${patch.why}, but ${patch.file} has nothing to patch (looked for ${String(patch.from)})`);
    writeFileSync(path, after);
    diff.push(`${patch.file}: ${patch.why}`);
  }
  const vite = (await import(pathToFileURL(createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite")).href)) as {
    build(config: Record<string, unknown>): Promise<unknown>;
  };
  const pages = join(SCRATCH, name, "pages");
  await vite.build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir: pages, emptyOutDir: true } });
  return { pages, diff };
}

// ---- serving -----------------------------------------------------------------

type Running = { origin: string; child: ChildProcess; exited: Promise<void> };

async function startLab(pages: string): Promise<Running> {
  mkdirSync(join(SCRATCH, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(SCRATCH, "labs", "run-lab-"));
  let log = "";
  const child = spawn(TSX, [join(SHIFT_MANAGER, "bin", "start.mts"), "--config", join(RUN_LAB, "fsdev.config.mts"), "--port", "0", "--assets", pages], {
    cwd: workDir,
    env: intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.on("exit", () => {
      gone = true;
      resolve();
    }),
  );
  for (let waited = 0; waited < 90_000; waited += 250) {
    const match = /shift-manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) return { origin: match[1]!, child, exited };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`shift-manager's start script never served the run-lab. Log tail:\n${log.slice(-2000)}`);
}

/** A board row with a run, read through the Lab's own route. */
async function rowWithRun(origin: string): Promise<string> {
  const roster = await readDeclaredRoster(join(RUN_LAB, "workforce"));
  const channel = roster.channels.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0)!;
  const board = `${channel.id}.${(channel.declared.boards as string[])[0]}`;
  const enc = encodeURIComponent;
  for (let waited = 0; waited < 30_000; waited += 250) {
    const response = await fetch(`${origin}/api/flows/sessions/${enc(channel.id)}/resources/${enc(board)}?limit=200`);
    const body = (await response.json()) as { items?: Array<{ clientData?: { id?: string; status?: string; run?: unknown } }> };
    const row = (body.items ?? []).map((i) => i.clientData ?? {}).find((r) => r.status === "in_progress" && r.run != null);
    if (row?.id !== undefined) return row.id;
    await sleep(250);
  }
  throw new Error("store: the run-lab's board never held a running row");
}

// ---- reading the page --------------------------------------------------------

type Sample = { part: string; el: string; prop: string; value: string };
type PageRead = { counts: Record<string, number>; colours: Sample[]; fonts: Sample[]; probes: Record<string, string> };

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
    if (hasText) fonts.push({ part, el: describe(el), prop: "font-family", value: cs.fontFamily });
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
  return { counts, colours, fonts, probes };
}

/** Open the task from Tasks, open what its Session draws closed, and read one pass. */
async function readPass(page: Page, origin: string, taskId: string, dark: boolean): Promise<PageRead> {
  // shift-manager follows the OS setting, so the pass sets the setting, not the class.
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
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
  return page.evaluate(readPage, { swept: SWEPT, probeValues: [...THEME.light, ...THEME.dark] });
}

// ---- grading -------------------------------------------------------------------

const firstFamily = (value: string) => value.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
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
    if (c !== null && !theme.some((t) => near(t, c.rgb))) out.push({ part: s.part, line: `themed [${tag}] ${where(s)} → ${hex(c.rgb)} is not an shift-manager ${variant} value` });
  }
  for (const s of read.fonts) {
    if (!THEME.families.includes(firstFamily(s.value))) out.push({ part: s.part, line: `themed [${tag}] ${where(s)} → font ${firstFamily(s.value)} is not shift-manager's` });
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
    if (hit !== undefined) out.push({ part: s.part, line: `neutral [${tag}] ${where(s)} → ${hex(c!.rgb)} is shift-manager's ${hit.v}` });
  }
  for (const s of read.fonts) {
    if (THEME.families.includes(firstFamily(s.value))) out.push({ part: s.part, line: `neutral [${tag}] ${where(s)} → font ${firstFamily(s.value)} is shift-manager's` });
  }
  return capped(out);
}

// ---- the goal ----------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const control: Patch[] =
    CONTROL === "hardcoded-accent"
      ? [
          {
            file: "src/components/flow-state/tool.tsx",
            from: /CheckCircleIcon className="size-4 text-success"/g,
            to: `CheckCircleIcon className="size-4 text-[${THEME.attentionLight}]"`,
            why: `the tool card's completed icon painted shift-manager's accent ${THEME.attentionLight} as a literal`,
          },
        ]
      : [];

  // Either build failing to set up is its own leg's failure; the other still runs.
  const builds: Array<{ name: "themed" | "no-theme"; pages: string }> = [];
  for (const [name, patches] of [
    ["themed", control],
    ["no-theme", [{ file: "src/styles.css", from: THEME_IMPORT, to: "", why: "the design-system import line removed" }, ...control]],
  ] as const) {
    try {
      const built = await build(name, patches as Patch[]);
      builds.push({ name, pages: built.pages });
      if (built.diff.length > 0) evidence.push(`${name} patches: ${built.diff.join("; ")}`);
    } catch (error) {
      failures.push(`${name === "themed" ? "themed" : "neutral"} [${name}] ${String((error as Error).message ?? error).split("\n")[0]}`);
    }
  }

  const browser = await launchChromium();
  try {
    for (const { name, pages } of builds) {
      const served = await startLab(pages);
      try {
        const taskId = await rowWithRun(served.origin);
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        // tsx compiles this file with esbuild's keepNames, which wraps nested
        // functions in readPage with a `__name` helper the page lacks.
        await page.addInitScript("globalThis.__name = (fn) => fn;");
        for (const variant of ["light", "dark"] as const) {
          const tag = `${name} ${variant}`;
          const read = await readPass(page, served.origin, taskId, variant === "dark");
          if (name === "themed" && variant === "light") {
            const missing = Object.keys(SWEPT).filter((part) => (read.counts[part] ?? 0) === 0);
            if (missing.length > 0) failures.push(`reach [${tag}] the Session drew no registry ${missing.join(", ")}`);
          }
          failures.push(...(name === "themed" ? gradeThemed(read, variant, tag) : gradeNeutral(read, tag)));
          evidence.push(`${tag}: ${Object.entries(read.counts).map(([p, n]) => `${p} ${n}`).join(", ")} elements; ${read.colours.length} colours, ${read.fonts.length} fonts`);
          if (process.env.GOAL_KEEP === "1") await page.screenshot({ path: join(SCRATCH, `${name}-${variant}.png`), fullPage: true });
        }
        if (errors.length > 0) failures.push(`reach [${name}] the page threw: ${errors.join(" | ")}`);
        await page.close();
      } finally {
        served.child.kill("SIGTERM");
        await served.exited;
      }
    }
  } finally {
    await browser.close();
  }
  if (process.env.GOAL_KEEP === "1") console.log(`kept: ${SCRATCH}`);
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `shift-manager copied to ${SCRATCH}, built twice (as written, and with its theme import removed), served over the run-lab, a running task opened from Tasks in Chromium. ${evidence.join("; ")}`,
  };
});
