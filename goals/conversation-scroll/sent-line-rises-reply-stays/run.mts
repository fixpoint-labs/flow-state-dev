/**
 * Goal check: a line you send rises to near the top of the view and its reply
 * streams in below it; after that, nothing you didn't do moves the view
 * (FIX-2360). See goal.md.
 *
 * Each app's own conversation views, built by the app's own Vite config from a
 * scratch copy of its source, run in headless Chromium on scripted reads
 * (`pages/script.ts`): no server, no model. One leg per surface:
 *
 *   devtool/stream                   DevTool's stream view
 *   shift-manager/conversation       Shift Manager's conversation
 *   shift-manager/task-session       a task's Session tab
 *   shift-manager/first-send         a first line into a conversation the send creates (f only)
 *   claude-code-style/thread         the Claude Code-style lab's main thread
 *   claude-code-style/task-thread    a task's thread
 *   claude-code-style/task-panel     the task panel's sheet (never sends: b, d, e)
 *   teammates/conversation           the Teammates lab's conversation
 *   teammates/popup                  a session popup (never sends: b, d, e)
 *
 * Signals, read off rendered boxes and `scrollTop`, never the hook:
 *
 *   a.short  a send from the end with a short reply: the sent line's top is 0–48px below the feed's top
 *   a.long   a send from far up with a long reply: the same
 *   b        as the reply grows past the bottom edge, `scrollTop` moves no more than 1px, and the arrow shows
 *   c        a wheel scroll mid-reply, then no move for the rest of it
 *   d        a line that isn't the person's lands: `scrollTop` stays, and the arrow shows
 *   e        a switch to the other conversation is at its end on every frame it is drawn, from the first
 *   f        a first send that creates its conversation: the line lands near the top, and the long reply
 *            grows past the bottom edge with `scrollTop` moving no more than 1px, and the arrow shows
 *
 * Run:     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/conversation-scroll/sent-line-rises-reply-stays/run.mts
 * Control: GOAL_CONTROL=main-rule | no-reserve | key-reset, same command (goal.md → Controls).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Locator, Page } from "playwright";
import { goalTmpDir, REPO_ROOT, repoPath, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("sent-line-rises");
const say = (s: string) => console.error(`[sent-line-rises] ${s}`);
/** How far below the feed's top a risen line may sit. */
const NEAR_TOP = 48;

// ---- the controls ----------------------------------------------------------------

type Signal = "a.short" | "a.long" | "b" | "c" | "d" | "e" | "f";
/** Each control serves the hook patched (`build.mts`) and must fail exactly these signals, on every surface that has them. */
const CONTROLS: Record<string, { why: string; fails: Signal[] }> = {
  "main-rule": { why: "useJumpToLatest as it was before this change (581142fb): a send goes to the end", fails: ["a.short", "a.long", "f"] },
  // The person's line lands before its reply starts, so with no space it can't reach the top under either length.
  "no-reserve": { why: "useJumpToLatest keeps no space under the sent line", fails: ["a.short", "a.long", "f"] },
  // The conversation's id arriving before its first line reopens the feed, as if switched to: the reply scrolls as history.
  "key-reset": { why: "useJumpToLatest reopens on a key that arrives while a send waits", fails: ["f"] },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);

// ---- the apps and their surfaces --------------------------------------------------

type App = { name: string; dir: string; entry: string; aliases?: Record<string, string> };
const APPS: App[] = [
  { name: "devtool", dir: repoPath("apps", "devtool"), entry: "src/goal/devtool.tsx", aliases: { "@devtool-src": repoPath("packages", "devtool", "src") } },
  { name: "shift-manager", dir: repoPath("packages", "shift-manager"), entry: "src/goal/shift-manager/main.tsx" },
  { name: "claude-code-style", dir: repoPath("labs", "claude-code-style"), entry: "src/goal/claude-code.tsx" },
  { name: "teammates", dir: repoPath("labs", "teammates"), entry: "src/goal/teammates.tsx" },
];

/** How a surface sends: through its own composer, or as the app learns of a send from elsewhere (`goal.send`). */
type Send = { composer: string; key: string } | "goal" | "none";
/** `first`: the send creates the conversation, so the feed's key arrives after the send and before its line. */
type Surface = { id: string; app: string; query: string; feed: string; send: Send; first?: true };
const SURFACES: Surface[] = [
  { id: "devtool/stream", app: "devtool", query: "stream", feed: ".overflow-auto.bg-fs-surface", send: "goal" },
  { id: "shift-manager/conversation", app: "shift-manager", query: "conversation", feed: '[data-testid="conversation-feed"]', send: { composer: '[data-testid="conversation-composer-input"]', key: "Enter" } },
  {
    id: "shift-manager/first-send",
    app: "shift-manager",
    query: "first-send",
    feed: '[data-testid="conversation-feed"]',
    send: { composer: '[data-testid="conversation-composer-input"]', key: "Enter" },
    first: true,
  },
  { id: "shift-manager/task-session", app: "shift-manager", query: "task-session", feed: '[data-testid="session"]', send: "goal" },
  { id: "claude-code-style/thread", app: "claude-code-style", query: "thread", feed: 'main[aria-label="Main thread"] .overflow-y-auto', send: { composer: '[aria-label="Message the main session"]', key: "Enter" } },
  { id: "claude-code-style/task-thread", app: "claude-code-style", query: "task-thread", feed: "aside .overflow-y-auto", send: { composer: '[aria-label="Message this task"]', key: "ControlOrMeta+Enter" } },
  { id: "claude-code-style/task-panel", app: "claude-code-style", query: "task-panel", feed: '[role="dialog"] .overflow-y-auto', send: "none" },
  { id: "teammates/conversation", app: "teammates", query: "conversation", feed: "[data-scroller]", send: { composer: '[aria-label="Message Helper"]', key: "Enter" } },
  { id: "teammates/popup", app: "teammates", query: "popup", feed: '[role="dialog"] .overflow-y-auto', send: "none" },
];

// ---- building and serving ----------------------------------------------------------

/** The app copied to scratch with the goal's pages at `src/goal/`, built by its own config, into `<scratch>/<name>/pages`. */
function build(app: App): string {
  const root = join(SCRATCH, app.name, "source");
  cpSync(app.dir, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist|dist-client|\.fsdev)$/.test(src) });
  symlinkSync(join(app.dir, "node_modules"), join(root, "node_modules"));
  // The copy sits outside the workspace: what its configs reach by `../..` is the checkout.
  for (const file of ["tsconfig.json", "vite.config.ts"]) {
    const path = join(root, file);
    if (existsSync(path)) writeFileSync(path, readFileSync(path, "utf8").replaceAll('"../../', `"${REPO_ROOT}/`).replaceAll('"../.."', JSON.stringify(REPO_ROOT)));
  }
  // Shift Manager's fakes go only into its own copy: the build swaps them in wherever they are.
  cpSync(join(HERE, "pages"), join(root, "src", "goal"), { recursive: true, filter: (src) => app.name === "shift-manager" || !src.includes(`${join("pages", "shift-manager")}`) });
  const html = join(root, "index.html");
  writeFileSync(html, readFileSync(html, "utf8").replace(/src="\/src\/main\.tsx"/, `src="/${app.entry}"`));
  const pages = join(SCRATCH, app.name, "pages");
  const built = spawnSync(repoPath("node_modules", ".bin", "tsx"), [join(HERE, "build.mts"), JSON.stringify({ repo: REPO_ROOT, root, outDir: pages, control: CONTROL, aliases: app.aliases ?? {} })], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (built.status !== 0) throw new Error(`setup [${app.name}]: the page build failed: ${(built.stderr || built.stdout).slice(-2500)}`);
  return pages;
}

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
/** The built pages, on a local port. */
async function serve(pages: string): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = join(pages, decodeURIComponent((req.url ?? "/").split("?")[0]!));
    const file = existsSync(path) && statSync(path).isFile() ? path : join(pages, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("setup: no port");
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

// ---- reading the page --------------------------------------------------------------

/** The feed's scroll state and, for `text`, where the innermost element holding it sits below the feed's top. */
type Read = { top: number; height: number; view: number; arrow: boolean; lineTop: number | null };
const read = (page: Page, feed: string, text?: string): Promise<Read | null> =>
  page.evaluate(
    ({ feed, text }) => {
      const el = document.querySelector<HTMLElement>(feed);
      if (el === null) return null;
      let lineTop: number | null = null;
      if (text !== undefined) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent?.includes(text)) {
            lineTop = node.parentElement!.getBoundingClientRect().top - (el.getBoundingClientRect().top + el.clientTop);
            break;
          }
        }
      }
      const arrow = el.querySelector<HTMLElement>('button[aria-label="Jump to latest"]');
      return { top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight, arrow: arrow !== null && arrow.offsetParent !== null, lineTop };
    },
    { feed, text },
  );

async function must(page: Page, feed: string, text?: string): Promise<Read> {
  const r = await read(page, feed, text);
  if (r === null) throw new Error(`no feed at ${feed}`);
  return r;
}

/** Wait until the feed's `scrollTop` has held for `ms`: a smooth move has ended. */
async function settled(page: Page, feed: string, ms = 400, limit = 6_000): Promise<Read> {
  let last = await must(page, feed);
  let since = Date.now();
  for (const until = Date.now() + limit; Date.now() < until; ) {
    await page.waitForTimeout(50);
    const now = await must(page, feed);
    if (Math.abs(now.top - last.top) > 0.5) since = Date.now();
    last = now;
    if (Date.now() - since >= ms) return now;
  }
  return last;
}

const busy = (page: Page) => page.evaluate(() => (window as unknown as { goal: { busy(): boolean } }).goal.busy());
const goal = (page: Page, call: string, arg?: string) =>
  page.evaluate(({ call, arg }) => (window as unknown as { goal: Record<string, (a?: string) => void> }).goal[call]!(arg), { call, arg });

/** Sample `scrollTop` every 50ms until the reply ends: how far it moved from `from`. */
async function driftUntilDone(page: Page, feed: string, from: number): Promise<{ drift: number; last: Read }> {
  let drift = 0;
  for (const until = Date.now() + 20_000; Date.now() < until; ) {
    const last = await must(page, feed);
    drift = Math.max(drift, Math.abs(last.top - from));
    if (!(await busy(page))) break;
    await page.waitForTimeout(50);
  }
  return { drift, last: await must(page, feed) };
}

async function send(page: Page, surface: Surface, text: string) {
  if (surface.send === "goal") return await goal(page, "send", text);
  if (surface.send === "none") throw new Error(`${surface.id} never sends`);
  const box: Locator = page.locator(surface.send.composer);
  await box.fill(text);
  await box.press(surface.send.key);
}

/** Wait for the line holding `text` to be drawn in the feed, then for the feed to come to rest. */
async function landed(page: Page, surface: Surface, text: string): Promise<Read> {
  for (const until = Date.now() + 8_000; Date.now() < until; await page.waitForTimeout(50)) {
    if ((await must(page, surface.feed, text)).lineTop !== null) break;
  }
  await settled(page, surface.feed);
  return await must(page, surface.feed, text);
}

const nearTop = (r: Read) => r.lineTop !== null && r.lineTop >= -0.5 && r.lineTop <= NEAR_TOP;
const where = (r: Read) => (r.lineTop === null ? "the line is not in the feed" : `the line's top is ${r.lineTop.toFixed(0)}px below the feed's top (view ${r.view}px)`);

// ---- one surface -------------------------------------------------------------------

type Verdict = { pass: boolean; note: string };

async function runSurface(browser: Browser, origin: string, surface: Surface): Promise<Map<Signal, Verdict>> {
  const out = new Map<Signal, Verdict>();
  const grade = (signal: Signal, pass: boolean, note: string) => out.set(signal, { pass, note });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  // tsx compiles this file with esbuild's keepNames, which wraps the functions `evaluate` ships in `__name(…)`.
  await context.addInitScript("window.__name = (fn) => fn");
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${origin}/?surface=${surface.query}`);
    await page.waitForFunction(() => (window as unknown as { goal?: { ready: boolean } }).goal?.ready === true, undefined, { timeout: 15_000 });
    await page.waitForSelector(surface.feed, { timeout: 15_000 });
    await settled(page, surface.feed);
    const stamp = Date.now().toString(36);

    if (surface.first) {
      // f: the first line, into a conversation that doesn't exist until the send opens it; a reply of a few screens.
      await goal(page, "reply", "long");
      const first = `goal line ${stamp} first`;
      await send(page, surface, first);
      const r = await landed(page, surface, first);
      const { drift, last } = await driftUntilDone(page, surface.feed, r.top);
      const below = last.height - last.top - last.view > 40;
      grade(
        "f",
        nearTop(r) && drift <= 1 && last.arrow && below,
        `landed: ${where(r)}; scrollTop moved ${drift.toFixed(1)}px while the reply grew; ${below ? "content below the view" : "no content below the view"}; arrow ${last.arrow ? "shown" : "not shown"}`,
      );
      return out;
    }

    if (surface.send !== "none") {
      // a.short: from the end, a two-line reply.
      await goal(page, "reply", "short");
      const short = `goal line ${stamp} short`;
      await send(page, surface, short);
      const r1 = await landed(page, surface, short);
      for (let i = 0; i < 100 && (await busy(page)); i++) await page.waitForTimeout(50);
      const r1done = await must(page, surface.feed, short);
      grade("a.short", nearTop(r1) && nearTop(r1done), `landed: ${where(r1)}; reply done: ${where(r1done)}`);

      // a.long and b: from far up, a reply of a few screens.
      await page.evaluate((feed) => document.querySelector<HTMLElement>(feed)!.scrollTo({ top: 0, behavior: "instant" }), surface.feed);
      await settled(page, surface.feed, 200);
      await goal(page, "reply", "long");
      const long = `goal line ${stamp} long`;
      await send(page, surface, long);
      const r2 = await landed(page, surface, long);
      grade("a.long", nearTop(r2), where(r2));
      const { drift, last } = await driftUntilDone(page, surface.feed, r2.top);
      const below = last.height - last.top - last.view > 40;
      grade("b", drift <= 1 && last.arrow && below, `scrollTop moved ${drift.toFixed(1)}px while the reply grew; ${below ? "content below the view" : "no content below the view"}; arrow ${last.arrow ? "shown" : "not shown"}`);

      // c: a wheel mid-reply, then nothing moves.
      const wheeled = `goal line ${stamp} wheel`;
      await send(page, surface, wheeled);
      await landed(page, surface, wheeled);
      await page.waitForTimeout(700);
      const box = await page.locator(surface.feed).boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.wheel(0, 120);
      const after = await settled(page, surface.feed, 300);
      const stillBusy = await busy(page);
      const c = await driftUntilDone(page, surface.feed, after.top);
      grade("c", stillBusy && c.drift <= 1, `${stillBusy ? "wheel mid-reply" : "the reply had ended before the wheel"}; scrollTop moved ${c.drift.toFixed(1)}px after it`);
    } else {
      // b on a view that never sends: the worker writes while the reader is at the end.
      await goal(page, "reply", "long");
      const start = await must(page, surface.feed);
      await goal(page, "stream");
      const { drift, last } = await driftUntilDone(page, surface.feed, start.top);
      grade("b", drift <= 1 && last.arrow, `scrollTop moved ${drift.toFixed(1)}px while the reply grew; arrow ${last.arrow ? "shown" : "not shown"}`);
    }

    // d: at the end (by the arrow, as a reader gets there), a line that isn't theirs lands.
    const arrow = page.locator(`${surface.feed} button[aria-label="Jump to latest"]`);
    if (await arrow.isVisible().catch(() => false)) await arrow.click();
    const before = await settled(page, surface.feed);
    await goal(page, "background");
    await page.waitForTimeout(600);
    const bg = await settled(page, surface.feed, 200);
    grade("d", Math.abs(bg.top - before.top) <= 1 && bg.arrow, `scrollTop ${before.top.toFixed(0)} → ${bg.top.toFixed(0)}; arrow ${bg.arrow ? "shown" : "not shown"}`);

    // e: switch, from scrolled up, and read every frame after.
    await page.evaluate((feed) => document.querySelector<HTMLElement>(feed)!.scrollTo({ top: 0, behavior: "instant" }), surface.feed);
    await settled(page, surface.feed, 200);
    const frames = await page.evaluate(
      (feed) =>
        new Promise<{ shows: boolean; distance: number | null }[]>((resolve) => {
          const goalApi = (window as unknown as { goal: { switch(): void } }).goal;
          const seen: { shows: boolean; distance: number | null }[] = [];
          goalApi.switch();
          const tick = () => {
            const el = document.querySelector<HTMLElement>(feed);
            seen.push(
              el === null
                ? { shows: false, distance: null }
                : { shows: (el.textContent ?? "").includes("conversation b"), distance: el.scrollHeight - el.scrollTop - el.clientHeight },
            );
            if (seen.length < 40) requestAnimationFrame(tick);
            else resolve(seen);
          };
          requestAnimationFrame(tick);
        }),
      surface.feed,
    );
    const shown = frames.filter((f) => f.shows);
    const off = shown.filter((f) => f.distance === null || f.distance > 2);
    grade(
      "e",
      shown.length > 0 && off.length === 0,
      shown.length === 0 ? "the other conversation never drew in 40 frames" : off.length === 0 ? `at its end on all ${shown.length} frames it was drawn` : `${off.length} of ${shown.length} frames drawn away from the end (first ${off[0]!.distance}px)`,
    );
  } finally {
    if ([...out.values()].some((v) => !v.pass)) await page.screenshot({ path: join(SCRATCH, `${surface.id.replace("/", "-")}.png`) }).catch(() => undefined);
    if (errors.length > 0) say(`${surface.id} page errors: ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
  return out;
}

// ---- the run -----------------------------------------------------------------------

await runGoal(async (failures) => {
  say(`scratch ${SCRATCH}${CONTROL === "" ? "" : `; control ${CONTROL}: ${CONTROLS[CONTROL]!.why}`}`);
  mkdirSync(SCRATCH, { recursive: true });
  const served = new Map<string, { origin: string; server: Server }>();
  for (const app of APPS.filter((a) => SURFACES.some((s) => s.app === a.name && s.id.startsWith(process.env.GOAL_ONLY ?? "")))) {
    say(`building ${app.name}`);
    served.set(app.name, await serve(build(app)));
  }
  const lines: string[] = [];
  const expected = new Set(CONTROLS[CONTROL]?.fails ?? []);
  const browser = await launchChromium();
  try {
    // GOAL_ONLY=<prefix>: only the surfaces whose id starts with it, while working on one.
    for (const surface of SURFACES.filter((s) => s.id.startsWith(process.env.GOAL_ONLY ?? ""))) {
      say(surface.id);
      let verdicts: Map<Signal, Verdict>;
      try {
        verdicts = await runSurface(browser, served.get(surface.app)!.origin, surface);
      } catch (error) {
        failures.push(`${surface.id} setup: ${(error as Error).message.slice(0, 600)}`);
        continue;
      }
      const signals: Signal[] = surface.first ? ["f"] : surface.send === "none" ? ["b", "d", "e"] : ["a.short", "a.long", "b", "c", "d", "e"];
      for (const signal of signals) {
        const v = verdicts.get(signal) ?? { pass: false, note: "never ran" };
        const line = `${surface.id} ${signal} ${v.pass ? "PASS" : "FAIL"} ${v.note}`;
        lines.push(line);
        say(line);
        if (!v.pass && expected.has(signal)) failures.push(`(expected under ${CONTROL}) ${line}`);
        else if (!v.pass) failures.push(`${CONTROL === "" ? "" : "WRONG: "}${line}`);
        else if (expected.has(signal)) failures.push(`WRONG: stayed green under ${CONTROL}: ${line}`);
      }
    }
  } finally {
    await browser.close();
    for (const { server } of served.values()) server.close();
  }
  return { failures, evidence: lines.join("\n") };
});
