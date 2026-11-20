/**
 * Goal: in each of the three labs the feed and the composer read at the body
 * step, no text in the main views is below 12px, and one value in the design
 * system's type file changes that size in all three labs. See goal.md.
 *
 * Model-free, real browser, real labs. Each lab is copied to scratch, built by
 * its own Vite config (Tailwind reads class names off the files on disk, so a
 * control's patch lands in the copy, never the checkout), served by its own
 * command on a fresh store with no model credential, seeded through its own
 * screens and actions, and read in headless Chromium:
 *
 *   Shift Manager      over the run-lab (scripted runs): Shift Coordinator, Tasks,
 *                      two tasks' Sessions, Inbox; day and night
 *   Teammates          Chief of Staff's conversation and panel with a coding task
 *                      on the scripted harness, that task's popup, a second
 *                      teammate's conversation; dark (its only theme)
 *   Claude Code-style  a session's main thread, its background task's sheet, a
 *                      Projects session's thread (its feed and composer) on the
 *                      scripted harness, a second session; light and dark
 *
 * Each lab is built twice from one copy: as written, and with its node_modules'
 * design system swapped for a copy whose `type.css` sets the body step to 17px.
 * One server per lab serves both: the second build's pages are routed in by
 * the browser, so the store and the seeded sessions are the same.
 *
 * Signals (each failure names its lab):
 *   a  every feed body and every composer computes to the body step (16px)
 *   b  no visible text is below 12px, except the glyphs the lint lets through
 *      (an aria-hidden element at a size a reasoned
 *      `eslint-disable-next-line fsd/no-hardcoded-text-size` line sets)
 *   c  with the type file's body step at 17px, every feed body and composer
 *      computes to 17px
 *
 * Controls:
 *   GOAL_CONTROL=drop-import          Teammates' copy drops its type-file import:
 *                                     c must FAIL naming Teammates, and only it
 *   GOAL_CONTROL=drop-import:<lab>    the same for `shift-manager`, `teammates`
 *                                     or `claude-code-style`
 *   GOAL_BASELINE=<git ref>           each lab's `src/` from that ref (one-time
 *                                     evidence: `main` before this change
 *                                     FAILS a and b in every lab)
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/design-system/labs-read-one-type-scale/run.mts
 *      GOAL_ONLY=<lab> reads one lab. Screenshots land in the scratch folder the run prints.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { taskActionName } from "@flow-state-dev/orchestration/inbox";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import type { Browser, BrowserContext, Page } from "playwright";
import { boardOf, startLab as startClaudeCodeStyle } from "../../claude-code-style-lab/lab.mts";
import { startTeammates } from "../../teammates-lab/lab.mts";
import { goalTmpDir, REPO_ROOT, repoPath, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { pickShift, startShiftManager } from "../../lib/shift-manager.mts";
import { NO_MODEL } from "../../lib/task-signals.mts";

type LabName = "shift-manager" | "teammates" | "claude-code-style";
const LABS: Record<LabName, { name: string; dir: string }> = {
  "shift-manager": { name: "Shift Manager", dir: repoPath("packages", "shift-manager") },
  teammates: { name: "Teammates", dir: repoPath("labs", "teammates") },
  "claude-code-style": { name: "Claude Code-style", dir: repoPath("labs", "claude-code-style") },
};

const CONTROL = process.env.GOAL_CONTROL ?? "";
const BASELINE = process.env.GOAL_BASELINE;
const ONLY = process.env.GOAL_ONLY;
const DROPPED: LabName | undefined =
  CONTROL === "" ? undefined : CONTROL === "drop-import" ? "teammates" : (CONTROL.replace(/^drop-import:/, "") as LabName);
if (CONTROL !== "" && (DROPPED === undefined || !(DROPPED in LABS) || !CONTROL.startsWith("drop-import"))) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: drop-import, ${Object.keys(LABS).map((l) => `drop-import:${l}`).join(", ")}`);
  process.exit(2);
}

const SCRATCH = goalTmpDir("labs-read-one-type-scale");
const SHOTS = join(SCRATCH, "shots");
const DESIGN_SYSTEM = repoPath("labs", "design-system");
/** The one line each lab's stylesheet imports the type file with; the control removes it. */
const TYPE_IMPORT = '@import "@flow-state-dev/design-system/type.css";\n';
/** The type file's body step as written, and what the 17px build sets it to. */
const BODY_STEP = "--text-base: 1rem;";
const BODY_17 = "--text-base: 1.0625rem;";
const FLOOR = 12;
const NODE_ENV_AT_LOAD = process.env.NODE_ENV;
const say = (s: string) => console.error(`[type-scale] ${s}`);

/** What a feed body is, in every lab: the registry's message, the labs' own entries and steps, the Shift Coordinator's prose. */
const BODY = [
  "[data-testid=message]",
  "[data-line=received] > :not([data-part=label])",
  "[data-look=summary-prose]",
  "[data-entry=user]",
  "[data-entry=assistant]",
  "[data-step=given]",
  "[data-step=said]",
].join(", ");
/** What a composer is, in every lab: the field a user types a turn into. */
const COMPOSER = ["[data-look=composer-input]", 'textarea[aria-label^="Message "]', 'textarea[aria-label^="Steer"]'].join(", ");

// ---- the glyphs the lint lets through ----------------------------------------

/**
 * Every px size a reasoned `eslint-disable-next-line fsd/no-hardcoded-text-size` sets, per lab: the only sizes below the floor b allows.
 * The contract (a `text-[<n>px]` on the next line, on an aria-hidden element) is stated once, in the rule's header.
 */
function lintExceptions(lab: LabName, src: string): number[] {
  const sizes: number[] = [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  for (const file of walk(src)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("eslint-disable-next-line fsd/no-hardcoded-text-size")) return;
      for (const m of (lines[i + 1] ?? "").matchAll(/text-\[([\d.]+)px\]/g)) sizes.push(Number(m[1]));
    });
  }
  return [...new Set(sizes)];
}

// ---- building ------------------------------------------------------------------

/**
 * `node_modules` for a copy: every entry of the lab's own, linked, except the
 * design system, which is a scratch copy whose `type.css` sets the body step
 * to 17px. Setup fails when the type file has no body step to change.
 */
function modulesWithBody17(lab: string, into: string): void {
  const real = join(lab, "node_modules");
  mkdirSync(join(into, "@flow-state-dev"), { recursive: true });
  for (const entry of readdirSync(real)) if (entry !== "@flow-state-dev") symlinkSync(join(real, entry), join(into, entry));
  for (const entry of readdirSync(join(real, "@flow-state-dev"))) {
    if (entry !== "design-system") symlinkSync(join(real, "@flow-state-dev", entry), join(into, "@flow-state-dev", entry));
  }
  const ds = join(into, "@flow-state-dev", "design-system");
  cpSync(DESIGN_SYSTEM, ds, { recursive: true, filter: (src) => !/[/\\]node_modules$/.test(src) });
  symlinkSync(join(DESIGN_SYSTEM, "node_modules"), join(ds, "node_modules"));
  const type = readFileSync(join(DESIGN_SYSTEM, "type.css"), "utf8");
  if (type.split(BODY_STEP).length !== 2) throw new Error(`setup: labs/design-system/type.css doesn't set "${BODY_STEP}" exactly once`);
  writeFileSync(join(ds, "type.css"), type.replace(BODY_STEP, BODY_17));
}

/** A lab's scratch copy, its `src/` from `GOAL_BASELINE` when set, with a control's patch applied; built twice. */
function buildLab(lab: LabName): { pages: string; pages17: string; src: string; diff: string[] } {
  const from = LABS[lab].dir;
  const root = join(SCRATCH, lab, "source");
  cpSync(from, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist|dist-client|\.fsdev)$/.test(src) });
  if (BASELINE !== undefined) {
    rmSync(join(root, "src"), { recursive: true, force: true });
    const archive = execFileSync("git", ["archive", BASELINE, `${relative(REPO_ROOT, from)}/src`], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 });
    const tar = join(SCRATCH, lab, "src.tar");
    writeFileSync(tar, archive);
    execFileSync("tar", ["-xf", tar, "-C", root, `--strip-components=${relative(REPO_ROOT, from).split("/").length}`]);
  }
  // The copy sits outside the workspace; its configs reach the workspace by relative paths.
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  const vite = join(root, "vite.config.ts");
  writeFileSync(
    vite,
    readFileSync(vite, "utf8")
      .replace('"../../scripts/build-inputs.mjs"', JSON.stringify(join(REPO_ROOT, "scripts", "build-inputs.mjs")))
      .replace('fileURLToPath(new URL("../..", import.meta.url))', JSON.stringify(REPO_ROOT)),
  );
  const diff: string[] = [];
  if (DROPPED === lab) {
    const styles = join(root, "src", "styles.css");
    const css = readFileSync(styles, "utf8");
    if (css.split(TYPE_IMPORT).length !== 2) throw new Error(`setup [${lab}]: the drop-import control has no "${TYPE_IMPORT.trim()}" line to remove in src/styles.css`);
    writeFileSync(styles, css.replace(TYPE_IMPORT, ""));
    diff.push(`${LABS[lab].name} src/styles.css: the type file's import removed`);
  }
  const build = (modules: string, out: string) => {
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    symlinkSync(modules, join(root, "node_modules"));
    // Its own process: several Vite builds in this one run out of heap.
    const built = spawnSync(join(from, "node_modules", ".bin", "vite"), ["build", "--config", vite, "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    });
    if (built.status !== 0) throw new Error(`setup [${lab}]: vite build failed: ${(built.stderr || built.stdout).slice(-1500)}`);
  };
  const modules17 = join(SCRATCH, lab, "node_modules-17");
  modulesWithBody17(from, modules17);
  const pages = join(SCRATCH, lab, "pages");
  const pages17 = join(SCRATCH, lab, "pages-17");
  build(join(from, "node_modules"), pages);
  build(modules17, pages17);
  return { pages, pages17, src: join(root, "src"), diff };
}

// ---- reading -------------------------------------------------------------------

type Read = {
  small: Array<{ el: string; size: number; text: string }>;
  allowed: Array<{ el: string; size: number }>;
  texts: number;
  bodies: Array<{ el: string; dominant: number; chars: number }>;
  composers: Array<{ el: string; size: number }>;
};

/** Runs in the page: every visible text's computed size, and each feed body's and composer's. */
function readType(args: { body: string; composer: string; floor: number; exceptions: number[] }): Read {
  const describe = (el: Element) => {
    const label = el.getAttribute("data-testid") ?? el.getAttribute("data-look") ?? el.getAttribute("data-entry") ?? el.getAttribute("aria-label");
    return `${el.tagName.toLowerCase()}${label ? `[${label}]` : ""}`;
  };
  const visible = (el: Element) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility === "visible" && rect.width > 1 && rect.height > 1 && el.closest("[inert]") === null;
  };
  const ownText = (el: Element) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
  const small: Read["small"] = [];
  const allowed: Read["allowed"] = [];
  let texts = 0;
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el.closest("svg") !== null) continue;
    const text = ownText(el);
    if (text === "" || !visible(el)) continue;
    texts += 1;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size >= args.floor) continue;
    if (args.exceptions.includes(size) && el.closest('[aria-hidden="true"], [aria-hidden=""]') !== null) allowed.push({ el: describe(el), size });
    else small.push({ el: describe(el), size, text: text.slice(0, 40) });
  }
  // A body's size is the one most of its words are set in; code, headings and controls inside it have steps of their own.
  const skip = "code, pre, kbd, h1, h2, h3, h4, h5, h6, button, svg, [data-look=message-label]";
  const bodies: Read["bodies"] = [];
  for (const root of Array.from(document.querySelectorAll(args.body))) {
    if (!visible(root)) continue;
    const chars = new Map<number, number>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const parent = n.parentElement;
      const length = (n.textContent ?? "").trim().length;
      if (parent === null || length === 0 || parent.closest(skip) !== null || !visible(parent)) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      chars.set(size, (chars.get(size) ?? 0) + length);
    }
    const ranked = [...chars].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) continue;
    bodies.push({ el: describe(root), dominant: ranked[0]![0], chars: ranked.reduce((s, [, c]) => s + c, 0) });
  }
  const composers = Array.from(document.querySelectorAll(args.composer))
    .filter(visible)
    .map((el) => ({ el: describe(el), size: parseFloat(getComputedStyle(el).fontSize) }));
  return { small, allowed, texts, bodies, composers };
}

/**
 * Serve the 17px build's files in place of the server's own, for every built
 * asset the page asks for. The page itself (`index.html`, which the server
 * fills in at serve time) and the API stay the server's. A hashed file is
 * matched by its name without the hash: the two builds differ in their CSS.
 */
async function routePages(context: BrowserContext, served: string, pages17: string): Promise<{ swapped: () => number }> {
  const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".png": "image/png" };
  const stem = (file: string) => file.replace(/-[\w-]{8}(\.\w+)$/, "$1");
  const assets = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else assets.set(stem(relative(pages17, full)), full);
    }
  };
  walk(pages17);
  let swapped = 0;
  await context.route(/\.(css|js|woff2?|svg|png)(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname).replace(/^\//, "");
    if (!existsSync(join(served, path))) return route.fallback();
    const file = assets.get(stem(path));
    if (file === undefined) return route.fallback();
    if (extname(file) === ".css") swapped += 1;
    await route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });
  return { swapped: () => swapped };
}

/** One view, ready: what the lab draws there. */
type View = { name: string; open: (page: Page) => Promise<void> };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 10_000 }).catch(() => undefined);
}

// ---- grading ---------------------------------------------------------------------

type Graded = { failures: string[]; evidence: string[] };

/**
 * Every view in every variant: a and b on the pages as written, then c on the
 * 17px build over the same server. `variants` sets the page's colour scheme.
 */
async function gradeLab(
  browser: Browser,
  lab: LabName,
  built: { pages: string; pages17: string; src: string },
  views: View[],
  variants: Array<{ name: string; scheme: "light" | "dark"; prepare?: (page: Page) => Promise<void> }>,
  out: Graded,
  tell: { over<T>(name: string, values: readonly T[]): T[] },
  shots: string,
): Promise<void> {
  const name = LABS[lab].name;
  const exceptions = lintExceptions(lab, built.src);
  const read = async (page: Page) => {
    // tsx names the functions it compiles with a `__name` helper the page doesn't have.
    await page.evaluate("globalThis.__name ??= (f) => f");
    return page.evaluate(readType, { body: BODY, composer: COMPOSER, floor: FLOOR, exceptions });
  };
  for (const [pass, want] of [
    ["as written", 16],
    ["body step 17px", 17],
  ] as const) {
    const bodies: string[] = [];
    const composers: string[] = [];
    const glyphs: number[] = [];
    for (const variant of variants) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: variant.scheme });
      const routed = want === 17 ? await routePages(context, built.pages, built.pages17) : undefined;
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      try {
        if (variant.prepare !== undefined) await variant.prepare(page);
        for (const view of views) {
          const where = `${name} · ${view.name} · ${variant.name}`;
          await view.open(page).catch(async (error: Error) => {
            mkdirSync(shots, { recursive: true });
            await page.screenshot({ path: join(shots, `${lab}-${view.name}-${variant.name}-setup-error.png`) }).catch(() => undefined);
            throw new Error(`setup [${where}]: ${error.message.split("\n")[0]}`);
          });
          await settle(page);
          const r = await read(page);
          if (routed !== undefined && routed.swapped() === 0) throw new Error(`setup [${where}]: the 17px build's stylesheet never reached the page`);
          if (want === 16) {
            mkdirSync(shots, { recursive: true });
            await page.screenshot({ path: join(shots, `${lab}-${view.name.replace(/\W+/g, "-")}-${variant.name}.png`) });
            tell.over(`b · ${name} visible texts`, Array.from({ length: r.texts }));
            for (const s of r.small) out.failures.push(`b [${where}]: ${s.el} "${s.text}" is ${s.size}px, below ${FLOOR}px`);
          }
          for (const b of r.bodies) {
            bodies.push(`${view.name}:${b.el}`);
            if (b.dominant !== want) out.failures.push(`${want === 16 ? "a" : "c"} [${where}]: feed body ${b.el}'s words are ${b.dominant}px, not the body step's ${want}px`);
          }
          for (const c of r.composers) {
            composers.push(`${view.name}:${c.el}`);
            if (c.size !== want) out.failures.push(`${want === 16 ? "a" : "c"} [${where}]: composer ${c.el} is ${c.size}px, not the body step's ${want}px`);
          }
          if (want === 16) glyphs.push(...r.allowed.map((a) => a.size));
        }
      } finally {
        await context.close();
      }
    }
    const leg = want === 16 ? "a" : "c";
    tell.over(`${leg} · ${name} feed bodies`, bodies);
    tell.over(`${leg} · ${name} composers`, composers);
    const allowed = glyphs.length === 0 ? "" : `, ${glyphs.length} glyph(s) at ${[...new Set(glyphs)].join("/")}px let through by the lint's exceptions`;
    out.evidence.push(`${name} ${pass}: ${bodies.length} feed bodies, ${composers.length} composers read${allowed}`);
  }
}

// ---- the labs ------------------------------------------------------------------------

async function shiftManager(browser: Browser, built: ReturnType<typeof buildLab>, out: Graded, tell: Parameters<typeof gradeLab>[6]) {
  const served = await startShiftManager({
    scratch: SCRATCH,
    label: "run-lab",
    config: repoPath("packages", "shift-manager", "test", "fixtures", "run-lab", "fsdev.config.mts"),
    pages: built.pages,
    env: { SHIFT_MANAGER_SHIFT: "day", ...NO_MODEL },
  });
  try {
    // Two tasks whose Sessions hold a message: the run-lab's scripted runs write one as they open.
    const page = await browser.newPage();
    await page.goto(`${served.origin}/tasks`);
    await page.getByTestId("tasks-table").waitFor({ timeout: 30_000 });
    const tasks: string[] = [];
    for (let waited = 0; tasks.length < 2 && waited < 60_000; waited += 1_000) {
      const listed = await page.locator("[data-testid=task-row][data-task-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task-id")!));
      for (const id of listed) {
        if (tasks.includes(id) || tasks.length >= 2) continue;
        await page.locator(`[data-testid=task-row][data-task-id="${id}"]`).click();
        const has = await page.locator("[data-testid=session-item] [data-testid=message]").first().waitFor({ timeout: 5_000 }).then(() => true, () => false);
        if (has) tasks.push(page.url().replace(served.origin, ""));
        await page.goto(`${served.origin}/tasks`);
        await page.getByTestId("tasks-table").waitFor();
      }
      if (tasks.length < 2) await sleep(1_000);
    }
    await page.close();
    if (tasks.length < 2) throw new Error(`setup [Shift Manager]: found ${tasks.length} task(s) whose Session holds a message; the run-lab should give two`);
    const open = (path: string, ready: (page: Page) => Promise<unknown>) => async (page: Page) => {
      await page.goto(`${served.origin}${path}`);
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await ready(page);
    };
    const views: View[] = [
      { name: "shift-coordinator", open: open("/shift-coordinator", (p) => p.waitForLoadState("networkidle")) },
      { name: "tasks", open: open("/tasks", (p) => p.getByTestId("tasks-table").waitFor()) },
      ...tasks.map((path, i) => ({ name: `task-${i + 1}`, open: open(path, (p) => p.locator("[data-testid=session-item] [data-testid=message]").first().waitFor()) })),
      { name: "inbox", open: open("/inbox", (p) => p.waitForLoadState("networkidle")) },
    ];
    await gradeLab(browser, "shift-manager", built, views, [
      { name: "day", scheme: "light" },
      {
        name: "night",
        scheme: "dark",
        prepare: async (page) => {
          await page.goto(`${served.origin}/tasks`);
          await pickShift(page, "night");
        },
      },
    ], out, tell, SHOTS);
  } finally {
    await served.stop();
  }
}

async function teammates(browser: Browser, built: ReturnType<typeof buildLab>, out: Graded, tell: Parameters<typeof gradeLab>[6]) {
  const dir = join(SCRATCH, "teammates", "data");
  const workdir = join(dir, "workdir");
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, "README.md"), "# Team\n");
  writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start the README");
  const user = "u_type";
  const lab = await startTeammates(dir, user, { GOAL_HARNESS: "stub", GOAL_HARNESS_STEP_MS: "1000", ...NO_MODEL }, workdir, built.pages);
  try {
    const fsd = createClient({ userId: user, baseUrl: lab.origin });
    const filer = { id: "teammates.chief-of-staff", name: "Chief of Staff" };
    const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker: filer.id });
    const flow = session.flowId ?? session.flowKind;
    const sent = await fsd.flow(flow).send(taskActionName("createTask", "tasks"), { title: "Tidy the README", goal: "Put the README's lines in order.", assignee: "teammates.cursor" }, { sessionId: session.id });
    await sent.wait({ timeoutMs: 60_000 });
    // A user's line in two conversations, sent from the composer. No model answers; the line stays.
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(lab.origin);
    const roster = page.locator('nav[aria-label="Workers"] button[data-worker]');
    await roster.first().waitFor({ timeout: 30_000 });
    const names = await roster.evaluateAll((els) => els.map((e) => e.getAttribute("data-worker") ?? ""));
    const second = names.find((n) => n !== filer.name);
    if (second === undefined) throw new Error("setup [Teammates]: the roster lists no second teammate");
    for (const who of [filer.name, second]) {
      await page.locator(`nav[aria-label="Workers"] button[data-worker="${who}"]`).click();
      const box = page.locator(`textarea[aria-label="Message ${who}"]`);
      await box.fill(`A note for ${who}: read the README before the next task, and say what is out of order.`);
      await box.press("Enter");
      await page.locator("[data-entry=user]").first().waitFor({ timeout: 20_000 });
    }
    await page.close();
    const conversation = (who: string) => async (page: Page) => {
      if (!page.url().startsWith(lab.origin)) await page.goto(lab.origin);
      await page.keyboard.press("Escape");
      await page.locator(`nav[aria-label="Workers"] button[data-worker="${who}"]`).click();
      await page.locator("[data-entry=user]").first().waitFor();
    };
    const views: View[] = [
      {
        name: "chief-of-staff",
        open: async (page) => {
          await conversation(filer.name)(page);
          await page.locator(`aside[aria-label="${filer.name}'s panel"]`).getByText("Tidy the README").first().waitFor();
        },
      },
      {
        name: "task-popup",
        open: async (page) => {
          await conversation(filer.name)(page);
          await page.locator(`aside[aria-label="${filer.name}'s panel"]`).getByText("Tidy the README").first().click();
          await page.locator("[role=dialog] [data-step]").first().waitFor({ timeout: 60_000 });
        },
      },
      { name: "second-teammate", open: conversation(second) },
    ];
    await gradeLab(browser, "teammates", built, views, [{ name: "dark", scheme: "dark" }], out, tell, SHOTS);
  } finally {
    stopProcessGroup(lab.child);
  }
}

async function claudeCodeStyle(browser: Browser, built: ReturnType<typeof buildLab>, out: Graded, tell: Parameters<typeof gradeLab>[6]) {
  const data = join(SCRATCH, "claude-code-style", "data");
  mkdirSync(data, { recursive: true });
  const repo = join(SCRATCH, "claude-code-style", "repo");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# Goal notes\n");
  writeFileSync(join(repo, ".gitignore"), ".fsdev/\n");
  git("add", ".");
  git("commit", "-q", "-m", "start");
  const user = "u_type";
  const lab = await startClaudeCodeStyle(data, user, { CLAUDE_CODE_STYLE_MODEL: "goal/no-model", CLAUDE_CODE_STYLE_UTILITY_MODEL: "goal/no-model", CLAUDE_CODE_STYLE_HARNESS: "stub", CLAUDE_CODE_STYLE_HARNESS_STEP_MS: "1000", ...NO_MODEL }, built.pages);
  try {
    const fsd = createClient({ userId: user, baseUrl: lab.origin });
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(lab.origin);
    const form = page.getByRole("form", { name: "New project" });
    await form.getByLabel("Project name").fill("Type Orchard");
    await form.getByLabel("Repository").fill(`file://${repo}`);
    await form.getByRole("button", { name: "Create project" }).click();
    const sessions: string[] = [];
    for (const line of ["Read the README and say what it is missing.", "List what a first contributor would ask about."]) {
      const known = new Set((await fsd.sessions.list({ flowKind: "agent", userId: user })).map((s) => s.id));
      const picker = page.getByRole("region", { name: "Choose a project" });
      if (!(await picker.isVisible())) await page.getByRole("button", { name: "+ New session" }).click();
      await picker.getByRole("button", { name: "Type Orchard" }).click();
      const box = page.getByRole("textbox", { name: "Message the main session" });
      await box.fill(line);
      await box.press("Enter");
      await page.locator("[data-entry=user]").first().waitFor({ timeout: 20_000 });
      let id: string | undefined;
      for (let waited = 0; id === undefined && waited < 10_000; waited += 250) {
        id = (await fsd.sessions.list({ flowKind: "agent", userId: user })).find((s) => !known.has(s.id))?.id;
        if (id === undefined) await sleep(250);
      }
      if (id === undefined) throw new Error("setup [Claude Code-style]: no session opened");
      sessions.push(id);
    }
    // A task on the first session's board, run by the scripted harness: its sheet is a main view.
    await boardOf(fsd).file(sessions[0]!, "Tidy the README", "Put the README's lines in order.");
    // A Projects session with a thread on its board, run by the scripted harness: the thread's view is a main view.
    await page.getByRole("tab", { name: "Projects" }).click();
    const leads = new Set((await fsd.sessions.list({ flowKind: "coordinator", userId: user })).map((s) => s.id));
    const projects = page.getByRole("region", { name: "Choose a project" });
    if (!(await projects.isVisible())) await page.getByRole("button", { name: "+ New session" }).click();
    await projects.getByRole("button", { name: "Type Orchard" }).click();
    const ask = page.getByRole("textbox", { name: "Message the main session" });
    await ask.fill("Split the README's work into threads.");
    await ask.press("Enter");
    await page.locator("[data-entry=user]").first().waitFor({ timeout: 20_000 });
    let lead: string | undefined;
    for (let waited = 0; lead === undefined && waited < 10_000; waited += 250) {
      lead = (await fsd.sessions.list({ flowKind: "coordinator", userId: user })).find((s) => !leads.has(s.id))?.id;
      if (lead === undefined) await sleep(250);
    }
    if (lead === undefined) throw new Error("setup [Claude Code-style]: no Projects session opened");
    const filed = await fsd.flow("coordinator").send(taskActionName("createTask", "tasks"), { title: "Order the README", goal: "Put the README's lines in order.", assignee: "desk.thread-coder" }, { sessionId: lead });
    await filed.wait({ timeoutMs: 60_000 });
    await page.close();
    // No model titles a session, so they are told apart by place: the list keeps the order they were made in.
    const openSession = (which: "first" | "second") => async (page: Page) => {
      if (!page.url().startsWith(lab.origin)) await page.goto(lab.origin);
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "Sessions" }).click();
      const items = page.locator('nav[aria-label="Sessions"] li button');
      await items.nth(1).waitFor();
      await (which === "first" ? items.first() : items.last()).click();
      await page.locator("[data-entry=user]").first().waitFor();
    };
    const views: View[] = [
      { name: "main-session", open: openSession("first") },
      {
        // Projects mode's thread: ThreadView, a sheet with its own feed and composer. Both must draw, or the view fails setup.
        name: "thread",
        open: async (page) => {
          if (!page.url().startsWith(lab.origin)) await page.goto(lab.origin);
          await page.keyboard.press("Escape");
          await page.getByRole("tab", { name: "Projects" }).click();
          await page.locator('nav[aria-label="Sessions"] li button').first().click();
          const board = page.locator('aside[aria-label="Tasks"]');
          for (const shut of await board.locator('button[aria-expanded="false"]').all()) await shut.click();
          await board.locator("[data-task-id]").first().click();
          const sheet = page.locator('[role="dialog"][aria-label^="Task: "]');
          await sheet.getByRole("textbox", { name: "Message this task" }).waitFor({ timeout: 60_000 });
          await sheet.locator(BODY).first().waitFor({ timeout: 60_000 });
        },
      },
      {
        // Session mode's background task: TaskSheet.
        name: "background-task",
        open: async (page) => {
          await openSession("first")(page);
          // A finished task sits under a shut *Done*; open it so the task's row can be clicked.
          const pane = page.locator('aside[aria-label="Background tasks"]');
          for (const shut of await pane.locator("details:not([open]) > summary").all()) await shut.click();
          await pane.locator("li button").first().click();
          await page.locator("[role=dialog]").first().waitFor();
          await page.locator("[role=dialog] [data-entry]").first().waitFor({ timeout: 60_000 }).catch(() => undefined);
        },
      },
      { name: "second-session", open: openSession("second") },
    ];
    await gradeLab(browser, "claude-code-style", built, views, [
      { name: "light", scheme: "light" },
      { name: "dark", scheme: "dark" },
    ], out, tell, SHOTS);
  } finally {
    stopProcessGroup(lab.child);
  }
}

// ---- the run ------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const out: Graded = { failures, evidence: [] };
  const run: Array<[LabName, typeof shiftManager]> = [
    ["shift-manager", shiftManager],
    ["teammates", teammates],
    ["claude-code-style", claudeCodeStyle],
  ];
  say(`scratch ${SCRATCH}${CONTROL ? ` · control ${CONTROL}` : ""}${BASELINE ? ` · baseline ${BASELINE}` : ""}`);
  const browser = await launchChromium();
  try {
    for (const [lab, drive] of run) {
      if (ONLY !== undefined && ONLY !== lab) continue;
      say(`${LABS[lab].name}: building`);
      const built = buildLab(lab);
      if (NODE_ENV_AT_LOAD === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = NODE_ENV_AT_LOAD;
      out.evidence.push(...built.diff);
      say(`${LABS[lab].name}: serving and reading`);
      try {
        await drive(browser, built, out, tell);
      } catch (error) {
        failures.push(`${LABS[lab].name}: ${(error as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }
  say(`screenshots in ${SHOTS}`);
  return { failures, evidence: out.evidence.join(" · ") };
});
