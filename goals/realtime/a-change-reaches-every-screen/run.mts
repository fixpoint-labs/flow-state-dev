/**
 * realtime › a change reaches every screen (FIX-2368, the closure of FIX-2367).
 *
 * The fixture app in `app/` (one flow, one page, its Node host and its Next route) runs as two
 * `serve()` processes (`goals/lib/peers.mts`) over one Postgres
 * (`goals/lib/postgres.mts`, `log_statement = all`, each process its own
 * `application_name`), on the Postgres bus the adapter backs by default.
 * Chromium (`goals/lib/playwright.mts`), one browser context per user: A and
 * B in org 1, C in org 2. Every assertion reads what a page showed, the
 * requests and WebSocket frames the page itself made, or the statements
 * Postgres logged for a process; never a `publish` call.
 *
 *   a  — A, on process 1, patches `ctx.org` and adds an org row; B's board on
 *        process 2 shows each within 1 s (5 samples, none retried). Over 10 s
 *        idle from B's first `crosses: true` frame B sends 0 reads; while A
 *        writes, every read B sends follows a notice frame or a connect.
 *   c  — C asks for A's session on process 2: refused, and C's page shows
 *        nothing of it, through a restart of process 2; C's own org board
 *        reads nothing while A patches org 1.
 *   d  — A's plain reply (items and a status, nothing else) shows on A's
 *        session view on process 2 within 1 s; over the idle window Postgres
 *        logs 0 statements from process 2 naming a watched session.
 *
 * Leg b and journeys j2 to j4 (`GOAL_SCENES`, default all; goal.md has each):
 *   b   — Shift Manager over the closure's Lab on Postgres (D2): a task settles
 *         in its own session and the Shift Coordinator's panel shows it within
 *         1 s; with a task open, the panel reads nothing between notices.
 *   j2  — Shift Manager with nothing written reads nothing for 10 s; a line sent
 *         into a conversation from another client shows within 1 s.
 *   j3  — process 1 enqueue-only on BullMQ, a process-only process runs A's
 *         reply, process 2's view shows it within 1 s and reads no clock.
 *   j4  — the app behind `createNextHandler`: no push, and B catches up within
 *         the hooks' poll interval plus 1 s.
 *   j2-teammates, j2-claude-code-style (FIX-2843) — each lab served twice
 *         with `fsdev dev --app`, its store line swapped to Postgres, its
 *         workers on a scripted model (`labs/`); a reply, a running turn, the
 *         worker's activity and a settled task written on process 1 show on
 *         process 2's page within 1 s, and idle, the page sends nothing and
 *         process 2 reads no watched session.
 *
 * Controls (each runs this file again; goal.md → Controls):
 *   GOAL_CONTROL=memory-bus          both processes on the in-memory bus
 *   GOAL_CONTROL=no-request-publish  the bus's write wrapper publishes nothing
 *   GOAL_CONTROL=never-crosses       the Postgres bus never listens, and says it doesn't cross
 *   GOAL_CONTROL=skip-check          the mint grants every topic
 *   GOAL_CONTROL=main-before         the same app on the parent of FIX-2426's merge
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { createClient } from "@flow-state-dev/client";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  intentFreeEnv,
  modulePatchEnv,
  onClosed,
  runGoal,
  sleep,
  stopProcessGroup,
  type ModulePatch,
  type Tell
} from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { freePort, refuseIfAnswering } from "../../lib/server.mts";
import { forkPeer, type Peer } from "../../lib/peers.mts";
import { startPostgres, type RunningPostgres } from "../../lib/postgres.mts";
import { buildShiftManagerPages, labRoutes, personPage, startShiftManager } from "../../lib/shift-manager.mts";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { COORDINATOR_FLOW, WORKER_ID_STATE_KEY, createWorkforceClient, deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";
import { codingBoardViewRef } from "@flow-state-dev/harness-manager/browser";
import { createInboxClient, type InboxHold } from "@flow-state-dev/orchestration/inbox";
import { appCalls } from "../../../labs/claude-code-style/src/app/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOAL_DIR = relative(REPO_ROOT, HERE);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("a-change-reaches-every-screen");
const KNOWN_SCENES = ["a", "b", "c", "d", "j2", "j3", "j4", "j2-teammates", "j2-claude-code-style"];
const SCENES = new Set((process.env.GOAL_SCENES ?? KNOWN_SCENES.join(",")).split(",").map((s) => s.trim()).filter(Boolean));
// A selection that runs nothing would grade PASS on no evidence.
const unknownScenes = [...SCENES].filter((s) => !KNOWN_SCENES.includes(s));
if (SCENES.size === 0 || unknownScenes.length > 0) {
  throw new Error(`setup: GOAL_SCENES must name at least one of ${KNOWN_SCENES.join(", ")} (got ${JSON.stringify(process.env.GOAL_SCENES)})`);
}
// j4 and the labs' scenes do not run under main-before (see the run), so they alone would grade nothing there.
if (CONTROL === "main-before" && [...SCENES].every((s) => s === "j4" || s.startsWith("j2-"))) {
  throw new Error(`setup: GOAL_SCENES=${[...SCENES].join(",")} runs nothing under GOAL_CONTROL=main-before; select another scene`);
}
const BOUND_MS = 1_000;
const SAMPLES = 5;
const IDLE_MS = 10_000;
/** How long a sample waits for a change before calling it missed: long enough to see a poll's pace. */
const SAMPLE_WAIT_MS = 6_000;

/** Today's `main` for the closure: the parent of FIX-2426's implementation merge (4425231e0). */
const MAIN_BEFORE = "db498b9761179b7315df615d9a799b6b1089ffb0";

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const PATCHES: Record<string, ModulePatch[]> = {
  // FIX-2427's `no-bus`: the adapter backs no bus, so each process gets an in-memory one.
  "memory-bus": [
    {
      module: "packages/store-postgres/src/registry.ts",
      from: String.raw`capabilities: \["primary", "bus"\]`,
      to: 'capabilities: ["primary"]'
    }
  ],
  // FIX-2426's `no-publish`, on today's module: the request and session store
  // wrappers send no notice. Scope-state, resource and board notices share the
  // queue (`publishNotices`) and still go out, so leg a still passes.
  "no-request-publish": [
    {
      module: "packages/engine/src/bus/publish-writes.ts",
      from: String.raw`\.then\(\(notices\) => publishNotices\(bus, notices\)\)`,
      to: ".then(() => undefined)"
    },
    {
      module: "packages/engine/src/bus/publish-writes.ts",
      from: String.raw`publishNotices\(bus, identities\.sessionNotices\(`,
      to: "void (identities.sessionNotices("
    }
  ],
  // FIX-2427's `no-listen`, its first hunk only: the bus never listens, and so never says it crosses.
  "never-crosses": [
    {
      module: "packages/store-postgres/src/bus.ts",
      from: String.raw`#start\(\)(?:: void)? \{`,
      to: "#start() { return;"
    }
  ],
  // FIX-2428's `skip-check`: the mint grants every session topic, checked or not.
  "skip-check": [
    {
      module: "packages/engine/src/push/push-delivery.ts",
      from: String.raw`if \(checked\.denied !== undefined \|\| checked\.session === null\) continue;`,
      to: "void checked;"
    }
  ]
};
const KNOWN = [...Object.keys(PATCHES), "main-before"];

if (CONTROL !== "" && !KNOWN.includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${KNOWN.join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const say = (line: string) => console.error(`[a-change-reaches-every-screen] ${line}`);
const delay = sleep;

// ---------------------------------------------------------------------------
// The checkout the app runs on, and the app's hash
// ---------------------------------------------------------------------------

/** Every file under `dir`, relative, sorted. */
function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name), base) : [relative(base, join(dir, entry.name))]))
    .sort();
}

/** sha256 over the app's files, each as its path and its bytes. */
function appHash(appDir: string): string {
  const hash = createHash("sha256");
  for (const file of filesUnder(appDir)) hash.update(`${file}\0`).update(readFileSync(join(appDir, file))).update("\0");
  return hash.digest("hex");
}

/**
 * The checkout the app's processes and page are built from: this one, or
 * (`main-before`) the parent of FIX-2426's merge extracted to scratch and
 * installed, with this goal's `app/` copied in unchanged and the peer helper
 * it imports beside it.
 */
function checkoutFor(control: string): string {
  if (control !== "main-before") return REPO_ROOT;
  const root = process.env.GOAL_MAIN_BEFORE_DIR ?? join(SCRATCH, `main-before-${MAIN_BEFORE.slice(0, 9)}`);
  if (!existsSync(join(root, "node_modules"))) {
    mkdirSync(root, { recursive: true });
    say(`extracting ${MAIN_BEFORE.slice(0, 9)} into ${root} and installing (one time)`);
    const tar = join(SCRATCH, `main-before-${MAIN_BEFORE.slice(0, 9)}.tar`);
    execFileSync("git", ["archive", MAIN_BEFORE, "-o", tar], { cwd: REPO_ROOT });
    execFileSync("tar", ["-xf", tar, "-C", root]);
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, stdio: "ignore" });
  }
  const app = join(root, GOAL_DIR, "app");
  rmSync(app, { recursive: true, force: true });
  cpSync(join(HERE, "app"), app, { recursive: true });
  if (!existsSync(join(root, "goals", "lib", "peers.mts"))) cpSync(join(REPO_ROOT, "goals", "lib", "peers.mts"), join(root, "goals", "lib", "peers.mts"));
  return root;
}

/** Bundle `app/main.tsx` for the browser, from `checkout`'s packages, into `out`. */
async function buildPage(checkout: string, out: string): Promise<void> {
  const esbuild = await import("esbuild");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const app = join(checkout, GOAL_DIR, "app");
  await esbuild.build({
    entryPoints: [join(app, "main.tsx")],
    absWorkingDir: checkout,
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    outfile: join(out, "main.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "error",
    // Workspace packages export `src/*.ts`; the browser build takes the `browser` condition where one exists.
    conditions: ["browser"],
    // An older checkout's `goals/` carries no React: resolve it where Shift Manager does.
    nodePaths: [join(checkout, "packages", "shift-manager", "node_modules")]
  });
  cpSync(join(app, "index.html"), join(out, "index.html"));
}

// ---------------------------------------------------------------------------
// The two processes
// ---------------------------------------------------------------------------

type AppProcess = { name: string; peer: Peer; port: number; origin: string };

/** `url` with `application_name` set, so Postgres logs this process's statements under its name. */
function withAppName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("application_name", name);
  return parsed.toString();
}

async function startApp(tree: string, db: RunningPostgres, name: string, port: number, staticDir: string, extra: Record<string, string> = {}): Promise<AppProcess> {
  const peer = await forkPeer(join(tree, GOAL_DIR, "app", "host.mts"), name, {
    FSD_DB_URL: withAppName(db.url, `goal-${name}`),
    PORT: String(port),
    STATIC_DIR: staticDir,
    // Quiets the engine's per-block console trace; no timer reads it.
    NODE_ENV: "test",
    ...extra
  });
  const bound = await peer.call<number>("port");
  return { name, peer, port: bound, origin: `http://127.0.0.1:${bound}` };
}

// ---------------------------------------------------------------------------
// What Postgres logged
// ---------------------------------------------------------------------------

type Statement = { at: number; app: string; text: string; params: string };

/** Each statement in the server log, with its bind parameters. Needs `log_line_prefix = '%n|%a|'`. */
function statements(log: string): Statement[] {
  const out: Statement[] = [];
  for (const line of readFileSync(log, "utf8").split("\n")) {
    const m = /^(\d+\.\d+)\|([^|]*)\|(LOG|DETAIL):\s+(.*)$/.exec(line);
    if (m === null) continue;
    const [, at, app, kind, rest] = m;
    if (kind === "LOG" && /^(statement|execute [^:]*):/.test(rest!)) {
      out.push({ at: Math.round(Number(at) * 1000), app: app!, text: rest!.replace(/^(statement|execute [^:]*):\s*/, ""), params: "" });
    } else if (kind === "DETAIL" && rest!.startsWith("parameters:")) {
      const last = out[out.length - 1];
      if (last !== undefined && last.app === app) last.params = rest!;
    }
  }
  return out;
}

const isBusTraffic = (s: Statement) => /^\s*(UN)?LISTEN\s+fsd_bus/i.test(s.text) || /pg_notify/i.test(s.text);

// ---------------------------------------------------------------------------
// A page, and what it showed, sent and heard
// ---------------------------------------------------------------------------

type Shown = { at: number; plan: string; seats: string[]; replies: string[] };
type Sent = { at: number; method: string; url: string; status?: number };
type Frame = { at: number; socket: number; frame: { type: string; crosses?: boolean; topic?: { scope: string; id?: string }; kind?: string } };
/** `ok`: the mint answered as its contract says, HTTP 200 with a ticket, a path and the topics it granted. */
type Minted = { at: number; topics: Array<{ scope: string; id?: string }>; status: number; ok: boolean; asked?: string };

type Screen = {
  name: string;
  page: Page;
  shown: Shown[];
  sent: Sent[];
  frames: Frame[];
  opens: number[];
  minted: Minted[];
  /** Each action the page sent, stamped as it was sent: where a sample starts. */
  actions: Array<{ at: number; action: string }>;
  /** Shift Manager's task panel rows, each time they change. */
  rows: TaskRows[];
};

type TaskRows = { at: number; rows: Array<{ title: string; status: string }> };

/** Records each change of the board's text, stamped in the page as it lands. */
const OBSERVE = `(() => {
  const read = () => ({
    plan: document.querySelector('[data-testid=plan]')?.textContent ?? '',
    seats: [...document.querySelectorAll('[data-testid=seats] li')].map((li) => li.textContent ?? ''),
    replies: [...document.querySelectorAll('[data-testid=replies] li')].map((li) => li.textContent ?? '')
  });
  let last = '';
  const note = () => {
    const now = read();
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    window.__goalShown?.({ at: Date.now(), ...now });
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true });
})();`;

/**
 * C asks, from its own page, to hear A's session: a mint for the session's
 * topic and a socket for the ticket it answers, minted and opened again
 * whenever the socket closes, as a client reconnects. The app's own page
 * never asks (its session read is refused first), so the ask is made by hand.
 */
const ASK = `async (sessionId) => {
  const ask = async () => {
    try {
      const answer = await (await fetch('/api/flows/users/user-c/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topics: [{ scope: 'session', id: sessionId }] })
      })).json();
      const ws = new WebSocket('ws://' + location.host + '/api/flows' + answer.path);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', ticket: answer.ticket }));
      ws.onclose = () => setTimeout(ask, 500);
    } catch {
      setTimeout(ask, 500);
    }
  };
  await ask();
}`;

/** Records each change of Shift Manager's Shift Coordinator task panel: every row's title and status, stamped in the page. */
const OBSERVE_TASKS = `(() => {
  let last = '';
  const note = () => {
    const rows = [...document.querySelectorAll('[data-testid=shift-coordinator-task]')].map((li) => ({
      title: li.querySelector('[data-testid=shift-coordinator-task-open] span')?.textContent ?? '',
      status: li.getAttribute('data-status') ?? ''
    }));
    const key = JSON.stringify(rows);
    if (key === last) return;
    last = key;
    window.__goalRows?.({ at: Date.now(), rows });
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-status'] });
})();`;

const isApi = (url: string) => new URL(url).pathname.startsWith("/api/flows/");
const isAction = (s: Sent) => s.method === "POST" && /\/actions\/[^/]+$/.test(new URL(s.url).pathname);
const isMintOrSocket = (s: Sent) => /\/users\/[^/]+\/stream$/.test(new URL(s.url).pathname);
const isSessionStream = (s: Sent) => /\/sessions\/[^/]+\/stream$/.test(new URL(s.url).pathname);
/** A read: an API request that is not an action, a push mint or socket, or the session stream's connect. */
const isRead = (s: Sent) => isApi(s.url) && !isAction(s) && !isMintOrSocket(s) && !isSessionStream(s);

/** Record what `page` sends and hears from here on; `observe` is the script that reports what it shows. */
async function watchPage(page: Page, name: string, observe: string): Promise<Screen> {
  const screen: Screen = { name, page, shown: [], sent: [], frames: [], opens: [], minted: [], actions: [], rows: [] };
  await page.exposeFunction("__goalShown", (row: Shown) => void screen.shown.push(row));
  await page.exposeFunction("__goalRows", (row: TaskRows) => void screen.rows.push(row));
  await page.addInitScript(observe);
  page.on("request", (request) => {
    if (!isApi(request.url())) return;
    const sent: Sent = { at: Date.now(), method: request.method(), url: request.url() };
    screen.sent.push(sent);
    void request.response().then((response) => void (sent.status = response?.status()), () => undefined);
    if (isAction(sent)) screen.actions.push({ at: sent.at, action: new URL(sent.url).pathname.split("/").pop()! });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!isApi(request.url())) return;
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/users\/[^/]+\/stream$/.test(path)) {
      const at = Date.now();
      const asked = request.postData() ?? undefined;
      void response
        .json()
        .then((body: { topics?: Minted["topics"]; ticket?: unknown; path?: unknown }) =>
          screen.minted.push({
            at,
            topics: body.topics ?? [],
            status: response.status(),
            asked,
            ok: response.status() === 200 && typeof body.ticket === "string" && typeof body.path === "string" && Array.isArray(body.topics)
          })
        )
        .catch(() => screen.minted.push({ at, topics: [], status: response.status(), ok: false, asked }));
    }
  });
  let sockets = 0;
  page.on("websocket", (ws) => {
    const socket = (sockets += 1);
    screen.opens.push(Date.now());
    ws.on("framereceived", ({ payload }) => {
      try {
        screen.frames.push({ at: Date.now(), socket, frame: JSON.parse(String(payload)) as Frame["frame"] });
      } catch {
        // Not a JSON frame.
      }
    });
  });
  return screen;
}

async function openScreen(context: BrowserContext, name: string, origin: string, user: string, session: string): Promise<Screen> {
  const page = await context.newPage();
  const screen = await watchPage(page, name, OBSERVE);
  await page.goto(`${origin}/?user=${encodeURIComponent(user)}&session=${encodeURIComponent(session)}`);
  return screen;
}

async function userContext(browser: Browser, token: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([{ name: "board-token", value: token, domain: "127.0.0.1", path: "/" }]);
  return context;
}

/** A session of the board flow, opened as the user `token` signs in as, on `origin`. */
async function newSession(origin: string, userId: string, token: string): Promise<string> {
  const client = createClient({
    userId,
    baseUrl: origin,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("cookie", `board-token=${token}`);
      return fetch(input, { ...init, headers });
    }
  });
  return (await client.flow("board").createSession()).id;
}

async function until(check: () => boolean, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await delay(10);
  }
  return true;
}

/** When `screen` first showed a row `match` accepts at or after `since`, waiting up to `withinMs`. */
async function shownAt(screen: Screen, since: number, match: (row: Shown) => boolean, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = screen.shown.find((row) => row.at >= since - 50 && match(row));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(5);
  }
}

/** Wait until none of `screens` has sent a request for `quietMs`. */
async function quiet(screens: Screen[], quietMs = 1_000, withinMs = 15_000): Promise<void> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const last = Math.max(0, ...screens.flatMap((s) => s.sent.map((r) => r.at)));
    const wait = last + quietMs - Date.now();
    if (wait <= 0 || Date.now() > deadline) return;
    await delay(Math.min(wait, 200));
  }
}

const crossedAt = (screen: Screen) => screen.frames.find((f) => f.frame.type === "crossing" && f.frame.crosses === true)?.at;

/**
 * A sends `action` with `value` from its own page; the moment the page sent
 * the action's POST is where each sample starts, so a sample's latency
 * includes the whole run.
 */
async function act(a: Screen, action: "setPlan" | "addSeat" | "say", value: string): Promise<number> {
  const before = a.actions.length;
  await a.page.fill("input[name=value]", value);
  await a.page.click(`button[name=${action}]`);
  const answered = await until(() => a.actions.slice(before).some((x) => x.action === action), 5_000);
  if (!answered) throw new Error(`setup: A's page never sent ${action} within 5 s`);
  return a.actions.slice(before).find((x) => x.action === action)!.at;
}

// ---------------------------------------------------------------------------
// Legs a, c, d: one conversation, at once
// ---------------------------------------------------------------------------

type Legs = { failures: string[]; tell: Tell; evidence: string[] };

/** Evidence, printed as it is read so a FAIL still shows every number. */
const noting = (evidence: string[]) => (line: string) => {
  evidence.push(line);
  say(line);
};

async function legsACD(
  { failures, tell, evidence }: Legs,
  env: { checkout: string; db: RunningPostgres; browser: Browser; pages: string }
): Promise<void> {
  const { checkout, db, browser, pages } = env;
  const note = noting(evidence);
  const p1 = await startApp(checkout, db, "p1", await freePort(), pages);
  let p2 = await startApp(checkout, db, "p2", await freePort(), pages);
  const contexts: BrowserContext[] = [];
  try {
    const sA = await newSession(p1.origin, "user-a", "tok-a");
    const sB = await newSession(p2.origin, "user-b", "tok-b");
    const sC = await newSession(p2.origin, "user-c", "tok-c");
    const ctxA = await userContext(browser, "tok-a");
    const ctxB = await userContext(browser, "tok-b");
    const ctxC = await userContext(browser, "tok-c");
    contexts.push(ctxA, ctxB, ctxC);

    const a = await openScreen(ctxA, "A on p1", p1.origin, "user-a", sA);
    // Leg d's viewer: A's session, on process 2. A session is its owner's alone
    // (C is refused it below), so the second screen on A's session is A's.
    const d = await openScreen(ctxA, "A's session view on p2", p2.origin, "user-a", sA);
    const b = await openScreen(ctxB, "B on p2", p2.origin, "user-b", sB);
    const cA = await openScreen(ctxC, "C asking for A's session on p2", p2.origin, "user-c", sA);
    await cA.page.evaluate(`(${ASK})(${JSON.stringify(sA)})`);
    const cOwn = await openScreen(ctxC, "C's own board on p2", p2.origin, "user-c", sC);
    const watchers = [d, b, cA, cOwn];

    // The idle window: from B's first `crosses: true`, once the pages' opening reads are done.
    const crossed = await until(() => crossedAt(b) !== undefined && crossedAt(d) !== undefined, 10_000);
    if (!crossed) failures.push("a:no-timer: B's socket never said crosses: true within 10 s");
    tell.over("a:no-timer · B's crossing frames", b.frames.filter((f) => f.frame.type === "crossing"));
    await quiet(watchers);
    const idleFrom = Date.now();
    say(`idle window from ${idleFrom - (crossedAt(b) ?? idleFrom)} ms after B's first crosses: true`);
    await delay(IDLE_MS);
    const idleTo = Date.now();
    const inIdle = (s: Sent) => s.at >= idleFrom && s.at < idleTo;

    // a:no-timer (idle half) · B sends nothing.
    const bIdle = tell.over("a:no-timer · B's requests over the idle window", b.sent.filter(inIdle), { emptyIs: "the claim: B sends 0 reads" });
    tell.over("a:no-timer · B's requests before the window (it was reading)", b.sent.filter((s) => s.at < idleFrom));
    if (bIdle.length !== 0) failures.push(`a:no-timer: B sent ${bIdle.length} requests in ${IDLE_MS / 1000} s idle (${bIdle.slice(0, 3).map((s) => `${s.method} ${new URL(s.url).pathname}`).join(", ")})`);

    // d:no-timed-read · Postgres logs nothing from process 2 naming a watched session.
    if (db.log === undefined) {
      tell.over("d:no-timed-read · process 2's statements in the window (FSD_DB_URL: no server log to read)", []);
    } else {
      const logged = statements(db.log);
      const p2All = logged.filter((s) => s.app === "goal-p2");
      tell.over("d:no-timed-read · process 2's logged statements (the log reads p2)", p2All);
      const windowed = p2All.filter((s) => s.at >= idleFrom && s.at < idleTo && !isBusTraffic(s));
      const named = windowed.filter((s) => [sA, sB].some((id) => s.text.includes(id) || s.params.includes(id)));
      tell.over("d:no-timed-read · p2 statements naming a watched session, idle", named, { emptyIs: "the claim: no timed read" });
      if (named.length !== 0) failures.push(`d:no-timed-read: process 2 sent ${named.length} statements naming a watched session over ${IDLE_MS / 1000} s idle (${named[0]!.text.slice(0, 100)})`);
      const busIdle = p2All.filter((s) => s.at >= idleFrom && s.at < idleTo && isBusTraffic(s)).length;
      note(`d: idle ${IDLE_MS / 1000} s, p2 logged ${named.length} statements naming a watched session (${windowed.length} other, ${busIdle} bus)`);
    }
    note(`a: idle ${IDLE_MS / 1000} s, B sent ${bIdle.length} requests`);

    // The writes: A, on p1, patches the plan, adds a seat and replies, five times.
    const writesFrom = Date.now();
    const lat = { plan: [] as number[], seat: [] as number[], reply: [] as number[] };
    const missed: string[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
      const tag = `${RUN_STAMP.slice(-6)}-${i}`;
      const plan = `plan-${tag}`;
      const planAt = await act(a, "setPlan", plan);
      const planShown = await shownAt(b, planAt, (row) => row.plan === plan, SAMPLE_WAIT_MS);
      if (planShown === undefined) missed.push(`plan ${i}`);
      else lat.plan.push(planShown - planAt);

      const seat = `seat-${tag}`;
      const seatAt = await act(a, "addSeat", seat);
      const seatShown = await shownAt(b, seatAt, (row) => row.seats.includes(seat), SAMPLE_WAIT_MS);
      if (seatShown === undefined) missed.push(`seat ${i}`);
      else lat.seat.push(seatShown - seatAt);

      const reply = `reply-${tag}`;
      const replyAt = await act(a, "say", reply);
      const replyShown = await shownAt(d, replyAt, (row) => row.replies.includes(reply), SAMPLE_WAIT_MS);
      if (replyShown === undefined) missed.push(`reply ${i}`);
      else lat.reply.push(replyShown - replyAt);
      await delay(300);
    }
    const writesTo = Date.now();
    const grade = (name: string, what: string, list: number[], expected: number) => {
      const read = tell.over(`${name} · samples shown`, list);
      const slow = read.filter((ms) => ms >= BOUND_MS);
      if (read.length < expected) failures.push(`${name}: ${expected - read.length} of ${expected} ${what} never showed within ${SAMPLE_WAIT_MS / 1000} s (shown: ${read.join(", ")} ms)`);
      if (slow.length > 0) failures.push(`${name}: ${what} shown ${read.join(", ")} ms after A's page sent the action (bound ${BOUND_MS})`);
      note(`${name} ${read.join("/")} ms`);
    };
    grade("a:org-state", "plan patches", lat.plan, SAMPLES);
    grade("a:org-row", "seats", lat.seat, SAMPLES);
    grade("d:plain-reply", "replies", lat.reply, SAMPLES);

    // a:no-timer (writes half) · every read B sent follows a notice frame or a connect.
    const bWrites = tell.over("a:no-timer · B's reads while A writes", b.sent.filter((s) => s.at >= writesFrom && s.at < writesTo && isRead(s)));
    const cause = (at: number) =>
      b.frames.some((f) => f.frame.type === "notice" && f.at <= at && at - f.at < BOUND_MS) ||
      b.opens.some((o) => o <= at && at - o < BOUND_MS) ||
      b.sent.some((s) => isSessionStream(s) && s.at <= at && at - s.at < BOUND_MS);
    const unprompted = bWrites.filter((s) => !cause(s.at));
    if (unprompted.length > 0) failures.push(`a:no-timer: ${unprompted.length} of B's ${bWrites.length} reads while A wrote followed no notice frame or connect (${unprompted.slice(0, 3).map((s) => new URL(s.url).pathname).join(", ")})`);
    note(`a: ${bWrites.length} reads by B while A wrote, ${unprompted.length} unprompted`);

    // c:refused · C asked for A's session: the mint never grants it, and C's page shows none of it.
    const allValues = (row: Shown) => [row.plan, ...row.seats, ...row.replies];
    const ofA = (row: Shown) => allValues(row).some((v) => /^(plan|seat|reply)-/.test(v));
    const cMints = tell.over("c:refused · C's mint answers on A's session page", cA.minted);
    const granted = cMints.filter((m) => m.topics.some((t) => t.scope === "session" && t.id === sA));
    const cAShown = tell.over("c:refused · C's renders of A's session page", cA.shown);
    const cAHeard = cA.frames.filter((f) => f.frame.type === "notice" && f.frame.topic?.id === sA);
    // Only the hand-made ask counts: the page's own load already names sA in its URLs.
    // A broken mint (500, malformed body) is not a refusal: require one answered to contract.
    const asksForA = (m: Minted) => m.ok && m.asked?.includes(sA) === true;
    const asked = cMints.some(asksForA);
    if (!asked) failures.push("c:refused: C's page never got a valid mint answer to its ask for A's session, so a refusal can't be read");
    if (granted.length > 0) failures.push(`c:refused: the mint granted C A's session topic ${granted.length} times`);
    if (cAHeard.length > 0) failures.push(`c:refused: C's socket heard ${cAHeard.length} notices on A's session`);
    if (cAShown.some(ofA)) failures.push(`c:refused: C's page showed A's ${allValues(cAShown.find(ofA)!).join(", ")}`);
    note(`c: ${cMints.length} mints for C, ${granted.length} granted A's session; C heard ${cAHeard.length} of its notices`);

    // c:other-org-silent · C's own org board reads nothing and shows no change while A patches org 1.
    const cOwnShownBefore = cOwn.shown.filter((r) => r.at < writesFrom);
    tell.over("c:other-org-silent · C's own board rendered before the writes", cOwnShownBefore);
    // Silence only counts from a live board: it read its org and its socket is subscribed.
    const cOwnRead = cOwn.sent.some((s) => s.at < writesFrom && isRead(s) && s.status === 200);
    const cOwnCrossed = crossedAt(cOwn);
    if (!cOwnRead) failures.push("c:other-org-silent: C's own board never got a successful read before A wrote, so its silence can't be read");
    if (cOwnCrossed === undefined || cOwnCrossed >= writesFrom) failures.push("c:other-org-silent: C's own board's socket never said crosses: true before A wrote, so its silence can't be read");
    const cOwnReads = tell.over("c:other-org-silent · C's own board's reads while A wrote", cOwn.sent.filter((s) => s.at >= writesFrom && s.at < writesTo && isRead(s)), { emptyIs: "the claim: 0 reads" });
    const cOwnChanged = cOwn.shown.filter((r) => r.at >= writesFrom && r.at < writesTo);
    if (cOwnReads.length !== 0) failures.push(`c:other-org-silent: C's own board sent ${cOwnReads.length} reads while A patched org 1`);
    if (cOwnChanged.length !== 0) failures.push(`c:other-org-silent: C's own board changed ${cOwnChanged.length} times while A patched org 1 (${JSON.stringify(cOwnChanged[0])})`);
    note(`c: own org board ${cOwnReads.length} reads, ${cOwnChanged.length} changes while A wrote`);

    // c:reconnect-refused · process 2 restarts; C's socket reconnects, the re-mint refuses A's session again.
    const port2 = p2.port;
    await p2.peer.stop();
    const restartedAt = Date.now();
    p2 = await startApp(checkout, db, "p2", port2, pages);
    const reconnected = await until(() => cA.opens.some((o) => o > restartedAt) && cA.minted.some((m) => m.at > restartedAt && asksForA(m)), 20_000);
    const reMints = tell.over("c:reconnect-refused · C's mints after the restart", cA.minted.filter((m) => m.at > restartedAt));
    if (!reconnected) failures.push("c:reconnect-refused: C's socket never reconnected and got a valid re-mint within 20 s of process 2's restart");
    const reGranted = reMints.filter((m) => m.topics.some((t) => t.scope === "session" && t.id === sA));
    if (reGranted.length > 0) failures.push(`c:reconnect-refused: the re-mint granted C A's session topic`);
    const lastReply = `reply-${RUN_STAMP.slice(-6)}-after-restart`;
    const lastAt = await act(a, "say", lastReply);
    const dAfter = await shownAt(d, lastAt, (row) => row.replies.includes(lastReply), SAMPLE_WAIT_MS);
    tell.over("c:reconnect-refused · A's session view on the restarted p2 showing the reply (the reply was heard there)", dAfter === undefined ? [] : [dAfter - lastAt]);
    await delay(2_000);
    const cAfter = cA.frames.filter((f) => f.at > restartedAt && f.frame.type === "notice" && f.frame.topic?.id === sA);
    if (cAfter.length > 0) failures.push(`c:reconnect-refused: after the restart C heard ${cAfter.length} notices on A's session`);
    if (cA.shown.some((r) => r.at > restartedAt && ofA(r))) failures.push("c:reconnect-refused: after the restart C's page showed something of A's session");
    note(`c: after p2 restarted, ${reMints.length} re-mints, ${reGranted.length} granted; A's view on p2 showed the next reply ${dAfter === undefined ? "never" : `${dAfter - lastAt} ms`}`);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await Promise.all([p1.peer.stop(), p2.peer.stop()]);
  }
}

// ---------------------------------------------------------------------------
// Leg b: Shift Manager's board, on a Lab over Postgres (D2)
// ---------------------------------------------------------------------------

/** The session stream's interval: it reads at most once per interval per connection. */
const STREAM_INTERVAL_MS = 1_000;

/** The run-lab's user, and its lead's conversation. */
const RUN_LAB_USER = "u_run_lab";
const RUN_LAB_LEAD = "s_run_lab_lead";
/** The coordinator the closure's Lab adds, and the run-lab worker it files for (a scripted handler run). */
const SHIFT_COORDINATOR = "shift-coordinator";
const SHIFT_COORDINATOR_DELEGATE = "lab.coder";
const SHIFT_COORDINATOR_FILE = `---
name: Shift Coordinator
description: The closure's coordinator. Files tasks for the lab's coder.
flow: coordinator
routing: everyone
delegates: [${SHIFT_COORDINATOR_DELEGATE}]
---

Files tasks for the lab's coder.
`;

/**
 * The closure's Lab (D2): Shift Manager's run-lab copied to scratch with its
 * store line swapped to Postgres, its lead flow declaring the board's
 * task-list view as shipped worker flows do, and one file added to its tree:
 * a Shift Coordinator on the coordinator flow filing for the run-lab's coder,
 * since the task panel Shift Manager kept a board timer on is the Shift
 * Coordinator's and the run-lab declares none. Its config, its workers and
 * their scripted runs are the run-lab's. Imports resolve through the tree's
 * `goals/node_modules`.
 *
 * @returns The copy's `fsdev.config.mts`.
 */
function postgresRunLab(tree: string, label: string): string {
  const from = join(tree, "packages", "shift-manager", "test", "fixtures", "run-lab");
  const to = join(SCRATCH, `run-lab-postgres-${label}`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  symlinkSync(join(tree, "goals", "node_modules"), join(to, "node_modules"));
  const lab = join(to, "lab.mts");
  const swaps: Array<[string, string]> = [
    [
      'import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";',
      'import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";\nimport { postgresStores } from "@flow-state-dev/store-postgres";'
    ],
    ["stores: { default: { primary: inMemoryStores() } },", "stores: { default: { primary: postgresStores({ connectionString: process.env.FSD_DB_URL }) } },"],
    // The board's task-list view, as every shipped worker flow declares it (`views: board.views`);
    // the run-lab's hand-built lead flow predates it, so its conversation's task cards read a 404.
    ["    actions: { ...hearingDoor, ...board.actions },", '    actions: { ...hearingDoor, ...board.actions },\n    ...("views" in board ? { views: board.views } : {}),']
  ];
  let source = readFileSync(lab, "utf8");
  for (const [before, after] of swaps) {
    if (!source.includes(before)) throw new Error(`setup: the run-lab at ${from} has no "${before}" to swap`);
    source = source.replace(before, after);
  }
  writeFileSync(lab, source);
  const coordinator = join(to, "workforce", "org", "workers", SHIFT_COORDINATOR);
  mkdirSync(coordinator, { recursive: true });
  writeFileSync(join(coordinator, "WORKER.md"), SHIFT_COORDINATOR_FILE);
  return join(to, "fsdev.config.mts");
}

/** When the store first holds the task `taskId` at `status`, polled every 5 ms on the runner's own connection. */
async function storedAt(db: RunningPostgres, taskId: string, status: string, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    const rows = await db.query<{ status: string }>(
      "SELECT state->>'status' AS status FROM resource_state WHERE resource_key LIKE 'tasks/%' AND state->>'id' = $1",
      [taskId]
    );
    if (rows[0]?.status === status) return Date.now();
    await delay(5);
  }
  return undefined;
}

async function legB(
  { failures, tell, evidence }: Legs,
  env: { tree: string; db: RunningPostgres; browser: Browser; label: string }
): Promise<void> {
  const note = noting(evidence);
  const { tree, db, browser, label } = env;
  const root = join(tree, "packages", "shift-manager");
  const pages = await buildShiftManagerPages(join(SCRATCH, `shift-manager-pages-${label}`), root);
  const config = postgresRunLab(tree, label);
  const served = await startShiftManager({
    scratch: SCRATCH,
    label: `run-lab-postgres-${label}`,
    config,
    pages,
    root,
    tsx: join(tree, "node_modules", ".bin", "tsx"),
    env: { FSD_DB_URL: withAppName(db.url, "goal-shift-manager") }
  });
  const { context, page } = await personPage(browser, served.origin, { userId: RUN_LAB_USER, bearer: "" }, true);
  try {
    // The user's conversation with the Lab's coordinator, at the id Shift Manager derives for it,
    // and one task on its board that runs until stopped: the panel has a task open.
    const lab = labRoutes(served.origin, { userId: RUN_LAB_USER, bearer: "" });
    const conversation = await deriveWorkerSessionId({ userId: RUN_LAB_USER, orgId: DEFAULT_ORG_ID, flow: COORDINATOR_FLOW, criteria: { worker: SHIFT_COORDINATOR } });
    const opened = await lab.call("POST", `/${COORDINATOR_FLOW}/sessions`, { userId: RUN_LAB_USER, sessionId: conversation, state: { [WORKER_ID_STATE_KEY]: SHIFT_COORDINATOR } });
    if (opened.status !== 201) throw new Error(`setup: the coordinator's conversation was not opened: ${opened.status} ${JSON.stringify(opened.body)}`);
    const assignee = SHIFT_COORDINATOR_DELEGATE;
    const file = async (goal: string, input: Record<string, unknown>): Promise<string> => {
      const filed = await lab.act(COORDINATOR_FLOW, conversation, "createTask_tasks", { goal, assignee, input });
      const taskId = (filed.output as { taskId?: string } | undefined)?.taskId;
      if (taskId === undefined) throw new Error(`setup: filing "${goal}" answered ${filed.status} ${filed.error ?? JSON.stringify(filed.output)}`);
      return taskId;
    };
    if (SCENES.has("b")) {
    const held = await file(`closure hold ${RUN_STAMP.slice(-6)}`, {});
    if ((await storedAt(db, held, "in_progress", 20_000)) === undefined) throw new Error("setup: the held task never started running");

    const board = await watchPage(page, "Shift Manager's Shift Coordinator panel", OBSERVE_TASKS);
    await page.goto(`${served.origin}/`);
    await page.getByTestId("shift-coordinator-task").first().waitFor({ timeout: 30_000 }).catch(async (error: unknown) => {
      await page.screenshot({ path: join(SCRATCH, `shift-coordinator-${label}.png`) });
      throw new Error(`setup: the Shift Coordinator panel never drew a task (${join(SCRATCH, `shift-coordinator-${label}.png`)}): ${String(error).split("\n")[0]}`);
    });

    // b:no-read-between · 10 s from the board's first `crosses: true`, a task open and its run streaming.
    const crossed = await until(() => crossedAt(board) !== undefined, 15_000);
    tell.over("b:no-read-between · the board's crossing frames", board.frames.filter((f) => f.frame.type === "crossing"));
    if (!crossed) failures.push("b:no-read-between: the board's socket never said crosses: true within 15 s");
    await quiet([board]);
    const from = Date.now();
    await delay(IDLE_MS);
    const to = Date.now();
    tell.over("b:no-read-between · the open task drawn on the panel in the window", board.rows.filter((r) => r.at < to && r.rows.some((row) => row.status === "in_progress")));
    const windowReads = board.sent.filter((s) => s.at >= from && s.at < to && isRead(s));
    const cause = (at: number) => board.frames.some((f) => f.frame.type === "notice" && f.at <= at && at - f.at < BOUND_MS);
    const between = tell.over(
      "b:no-read-between · board reads in the window no notice preceded",
      windowReads.filter((s) => !cause(s.at)),
      { emptyIs: "the claim: no read between notices" }
    );
    const notices = board.frames.filter((f) => f.frame.type === "notice" && f.at >= from && f.at < to);
    if (between.length !== 0) {
      failures.push(`b:no-read-between: the board sent ${between.length} reads no notice preceded over ${IDLE_MS / 1000} s (${between.slice(0, 3).map((s) => new URL(s.url).pathname).join(", ")})`);
    }
    note(`b: ${IDLE_MS / 1000} s with a task open, ${windowReads.length} reads, ${between.length} between notices (${notices.length} notices)`);

    // b:settles · five tasks, each settling in its own task session; the panel shows each settled.
    const lat: number[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
      const goal = `closure settle ${RUN_STAMP.slice(-6)}-${i}`;
      const taskId = await file(goal, { steps: 1 });
      const stored = await storedAt(db, taskId, "completed", 20_000);
      if (stored === undefined) throw new Error(`setup: "${goal}" never completed in the store within 20 s`);
      // The panel lists active tasks and folds the done ones away: settled reads as completed, or drawn open and then gone.
      const deadline = Date.now() + SAMPLE_WAIT_MS;
      const mine = (r: TaskRows) => r.rows.find((row) => row.title.includes(goal));
      let shown: number | undefined;
      while (shown === undefined && Date.now() < deadline) {
        const drawn = board.rows.findIndex((r) => mine(r) !== undefined);
        shown = drawn < 0 ? undefined : board.rows.slice(drawn).find((r) => mine(r) === undefined || mine(r)!.status === "completed")?.at;
        if (shown === undefined) await delay(5);
      }
      if (!board.rows.some((r) => mine(r) !== undefined)) failures.push(`b:settles: the board never drew "${goal}", so its settling can't be read`);
      else if (shown === undefined) failures.push(`b:settles: the board still drew "${goal}" open ${SAMPLE_WAIT_MS / 1000} s after the store said completed`);
      else lat.push(shown - stored);
    }
    const read = tell.over("b:settles · samples shown", lat);
    if (read.some((ms) => ms >= BOUND_MS)) failures.push(`b:settles: the board showed a settled task ${read.join(", ")} ms after the store (bound ${BOUND_MS})`);
    note(`b:settles ${read.join("/")} ms`);
    }

    // j2 · Shift Manager with nothing written: every scripted run stopped, one task held open on the
    // panel, and the conversation, its messages and the panel mounted. 0 reads over 10 s; then a line
    // sent into the conversation from another client shows within 1 s.
    if (SCENES.has("j2")) {
      const sessions = await lab.sessions();
      const flowOf = new Map(sessions.map((s) => [s.id, s.flowKind ?? s.flowId ?? ""]));
      const lead = sessions.find((s) => s.flowKind !== COORDINATOR_FLOW && s.id === RUN_LAB_LEAD)?.id;
      if (lead === undefined) throw new Error("setup: the run-lab's lead conversation is not among its sessions");
      const leadKind = flowOf.get(lead)!;
      // Cancel every open row, as Shift Manager's Cancel does, and wait until no request runs anywhere:
      // a cancelled run stops when its next lease renewal is refused.
      for (const boardSession of [lead, conversation]) {
        for (const row of await lab.collection(boardSession, "tasks/**")) {
          if (row.status !== "in_progress" && row.status !== "pending") continue;
          await lab.act(flowOf.get(boardSession)!, boardSession, "updateTask_tasks", { id: row.id, status: "cancelled" });
        }
      }
      for (let waited = 0; ; waited += 500) {
        const [{ running }] = await db.query<{ running: string }>("SELECT count(*) AS running FROM requests WHERE status = 'in_progress'");
        if (Number(running) === 0) break;
        if (waited > 120_000) throw new Error(`setup: ${running} requests still ran 120 s after their tasks were cancelled`);
        await delay(500);
      }
      const held = await lab.act(COORDINATOR_FLOW, conversation, "createTask_tasks", { goal: `closure held ${RUN_STAMP.slice(-6)}`, assignee, input: {}, held: true });
      if ((held.output as { ok?: boolean } | undefined)?.ok !== true) throw new Error(`setup: the held task was refused: ${JSON.stringify(held.output ?? held.error)}`);

      const pagesOpen: Screen[] = [];
      for (const [name, path] of [["the lead's conversation", `/s/${lead}`], ["Messages", "/messages"], ["the Shift Coordinator panel", "/"]] as const) {
        const viewPage = await context.newPage();
        const screen = await watchPage(viewPage, `j2 · ${name}`, OBSERVE_TASKS);
        await viewPage.goto(`${served.origin}${path}`);
        pagesOpen.push(screen);
      }
      const crossedAll = await until(() => pagesOpen.every((p) => crossedAt(p) !== undefined), 15_000);
      tell.over("j2:no-poll · the views' crossing frames", pagesOpen.flatMap((p) => p.frames.filter((f) => f.frame.type === "crossing")));
      if (!crossedAll) failures.push(`j2:no-poll: ${pagesOpen.filter((p) => crossedAt(p) === undefined).map((p) => p.name).join(", ")} never said crosses: true within 15 s`);
      await quiet(pagesOpen, 2_000, 30_000);
      const from = Date.now();
      await delay(IDLE_MS);
      const to = Date.now();
      tell.over("j2:no-poll · the held task drawn on the panel", pagesOpen[2]!.rows.filter((r) => r.rows.some((row) => row.title.includes("closure held"))));
      const idle = pagesOpen.map((p) => ({ name: p.name, reads: p.sent.filter((s) => s.at >= from && s.at < to && isApi(s.url)) }));
      tell.over("j2:no-poll · reads over the idle window, every view", idle.flatMap((v) => v.reads), { emptyIs: "the claim: 0 reads" });
      tell.over("j2:no-poll · reads before the window (the views were reading)", pagesOpen.flatMap((p) => p.sent.filter((s) => s.at < from)));
      const heard = (p: Screen, at: number) => p.frames.some((f) => f.frame.type === "notice" && f.at <= at && at - f.at < BOUND_MS);
      for (const [i, v] of idle.entries()) {
        if (v.reads.length === 0) continue;
        const prompted = v.reads.filter((r) => heard(pagesOpen[i]!, r.at)).length;
        failures.push(`j2:no-poll: ${v.name} sent ${v.reads.length} requests in ${IDLE_MS / 1000} s with nothing written, ${prompted} after a notice (${v.reads.slice(0, 3).map((s) => `${s.method} ${new URL(s.url).pathname} answered ${s.status ?? "?"}`).join(", ")})`);
      }
      // The session stream reads on the server, out of the browser's sight: Postgres says whether it read on a clock.
      if (db.log === undefined) {
        tell.over("j2:no-poll · Shift Manager's statements naming the conversation, idle (FSD_DB_URL: no server log to read)", []);
      } else {
        tell.over("j2:no-poll · Shift Manager's logged statements (the log reads its process)", statements(db.log).filter((x) => x.app === "goal-shift-manager"));
        const smIdle = statements(db.log).filter((x) => x.app === "goal-shift-manager" && x.at >= from && x.at < to && !isBusTraffic(x));
        const naming = tell.over("j2:no-poll · Shift Manager's statements naming the conversation, idle", smIdle.filter((x) => x.text.includes(lead) || x.params.includes(lead)), { emptyIs: "the claim: no timed read" });
        if (naming.length > 0) failures.push(`j2:no-poll: Shift Manager's process read the conversation ${naming.length} times in ${IDLE_MS / 1000} s with nothing written (${naming[0]!.text.slice(0, 80)})`);
        note(`j2: over the idle window Shift Manager's process logged ${smIdle.length} statements, ${naming.length} naming the conversation`);
      }
      note(`j2: Shift Manager idle ${IDLE_MS / 1000} s, ${idle.map((v) => `${v.name} ${v.reads.length}`).join(", ")} requests`);

      const conversationPage = pagesOpen[0]!.page;
      // The person is looking at the conversation. Messages and the panel opened after it in the
      // same browser context, which leaves it a background tab: Chromium then runs its frames,
      // and with them the `raf` polling below, a frame or two a second, so a line already drawn
      // ~200 ms after its send would read 500–1000 ms (FIX-2841). Front it, and refuse to time a
      // page whose frames still don't run (`document.hasFocus()` says true either way).
      await conversationPage.bringToFront();
      // One runner pause can stall a single 300 ms probe; a background tab stays slow on every one.
      const rates: number[] = [];
      for (let probe = 0; probe < 3; probe++) {
        rates.push(await conversationPage.evaluate<number>(FRAME_PROBE));
        if (rates.at(-1)! >= 20) break;
      }
      if (rates.every((r) => r < 20)) throw new Error(`setup: the lead's conversation draws ${rates.map((r) => r.toFixed(1)).join(", ")} frames a second over ${rates.length} probes, a background tab's rate; its samples would time that, not the line`);
      const lat: number[] = [];
      /** When each line's request ended in the store, from its send: what the Lab itself took. */
      const storeLat: number[] = [];
      /** When each line's first characters (its tag) appeared, from its send. */
      const firstLat: number[] = [];
      for (let i = 1; i <= SAMPLES; i++) {
        const tag = `L${RUN_STAMP.slice(-6)}x${i}`;
        const line = `${tag} closure line`;
        const sent = Date.now();
        const posted = await lab.call("POST", `/${leadKind}/${lead}/actions/respond`, { userId: RUN_LAB_USER, input: { message: line } });
        if (posted.status !== 202) throw new Error(`setup: the line was refused: ${posted.status} ${JSON.stringify(posted.body)}`);
        const requestId = String((posted.body as { request?: { id?: string } }).request?.id ?? "");
        const ended = (async () => {
          for (const until = Date.now() + SAMPLE_WAIT_MS; Date.now() < until; await delay(5)) {
            const [row] = await db.query<{ status: string }>("SELECT status FROM requests WHERE id = $1", [requestId]);
            if (row !== undefined && row.status !== "in_progress" && row.status !== "pending") return Date.now();
          }
          return undefined;
        })();
        const appearing = conversationPage
          .waitForFunction((text) => (document.body.innerText.includes(text) ? Date.now() : 0), tag, { polling: "raf", timeout: SAMPLE_WAIT_MS })
          .then((handle) => handle.jsonValue() as Promise<number>)
          .catch(() => undefined);
        const shown = await conversationPage
          .waitForFunction((text) => (document.body.innerText.includes(text) ? Date.now() : 0), line, { polling: "raf", timeout: SAMPLE_WAIT_MS })
          .then((handle) => handle.jsonValue() as Promise<number>)
          .catch(() => undefined);
        const firstAt = await appearing;
        firstLat.push(firstAt === undefined ? -1 : firstAt - sent);
        const endedAt = await ended;
        if (shown === undefined) failures.push(`j2:message: the conversation never showed "${line}" within ${SAMPLE_WAIT_MS / 1000} s`);
        else lat.push(shown - sent);
        storeLat.push(endedAt === undefined ? -1 : endedAt - sent);
        // The session stream reads at most once a second per connection (FIX-2426's interval):
        // a sample sent sooner after the last read would time that cap, not the line.
        await delay(STREAM_INTERVAL_MS + 500);
      }
      const read = tell.over("j2:message · samples shown", lat);
      if (read.some((ms) => ms >= BOUND_MS)) failures.push(`j2:message: Shift Manager showed the line ${read.join(", ")} ms after it was sent (bound ${BOUND_MS})`);
      note(`j2:message (Shift Manager) ${read.join("/")} ms after sent; its request ended in the store ${storeLat.join("/")} ms, its first characters drawn ${firstLat.join("/")} ms after sent`);
      for (const p of pagesOpen) await p.page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
    await served.stop();
  }
}


// ---------------------------------------------------------------------------
// Journey j3: a reply run on a BullMQ worker reaches a viewer on a third process
// ---------------------------------------------------------------------------

type Redis = { url: string; stop(): Promise<void> };

/** A throwaway `redis-server` on a free port, nothing saved. */
async function startRedis(): Promise<Redis> {
  const port = await freePort();
  const child = spawn("redis-server", ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const url = `redis://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (up) return { url, stop: async () => void (child.kill("SIGTERM"), await gone) };
    await delay(50);
  }
  child.kill("SIGKILL");
  throw new Error("setup: redis-server never listened");
}

async function journeyJ3(
  { failures, tell, evidence }: Legs,
  env: { tree: string; db: RunningPostgres; browser: Browser; pages: string }
): Promise<void> {
  const note = noting(evidence);
  const { tree, db, browser, pages } = env;
  const redis = await startRedis();
  const queue = { FSD_REDIS_URL: redis.url };
  // Each process is stopped in `finally`, whichever later start fails.
  const started: AppProcess[] = [];
  const contexts: BrowserContext[] = [];
  const start = async (...args: Parameters<typeof startApp>) => {
    const app = await startApp(...args);
    started.push(app);
    return app;
  };
  try {
    const p1 = await start(tree, db, "j3-p1", await freePort(), pages, { ...queue, FSD_WORKER_MODE: "enqueue-only" });
    await start(tree, db, "j3-worker", 0, pages, { ...queue, FSD_WORKER_MODE: "process-only" });
    const p2 = await start(tree, db, "j3-p2", await freePort(), pages);
    const context = await userContext(browser, "tok-a");
    contexts.push(context);
    const sA = await newSession(p1.origin, "user-a", "tok-a");
    const a = await openScreen(context, "A on p1 (enqueue-only)", p1.origin, "user-a", sA);
    const view = await openScreen(context, "A's session view on p2", p2.origin, "user-a", sA);
    if (!(await until(() => crossedAt(view) !== undefined, 10_000))) failures.push("j3:worker-reply: the view's socket never said crosses: true within 10 s");
    await quiet([a, view]);

    const lat: number[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
      const reply = `worker-reply-${RUN_STAMP.slice(-6)}-${i}`;
      const at = await act(a, "say", reply);
      const shown = await shownAt(view, at, (row) => row.replies.includes(reply), SAMPLE_WAIT_MS);
      if (shown === undefined) failures.push(`j3:worker-reply: the view on p2 never showed "${reply}" within ${SAMPLE_WAIT_MS / 1000} s`);
      else lat.push(shown - at);
      await delay(300);
    }
    const read = tell.over("j3:worker-reply · samples shown", lat);
    if (read.some((ms) => ms >= BOUND_MS)) failures.push(`j3:worker-reply: the view on p2 showed the worker's reply ${read.join(", ")} ms after A's page sent it (bound ${BOUND_MS})`);
    note(`j3:worker-reply ${read.join("/")} ms`);

    // Who ran the reply: the worker's own connection wrote its items, process 1's did not.
    if (db.log !== undefined) {
      const logged = statements(db.log);
      // Each j3 process logs under its own name, so a process's item writes are its runs'.
      const wrote = (app: string) => logged.filter((s) => s.app === app && /INSERT INTO request_items/i.test(s.text)).length;
      const byWorker = tell.over("j3:worker-reply · item writes by the worker process", Array.from({ length: wrote("goal-j3-worker") }));
      note(`j3: items written by the worker ${byWorker.length}, by p1 ${wrote("goal-j3-p1")}`);
      if (wrote("goal-j3-p1") > 0) failures.push(`j3:worker-reply: process 1 wrote ${wrote("goal-j3-p1")} of the reply's items itself, so the worker didn't run them all`);
    }

    // j3:no-timed-read · 10 s idle, nothing written: no statement from p2 names the session.
    await quiet([a, view]);
    const from = Date.now();
    await delay(IDLE_MS);
    const to = Date.now();
    if (db.log === undefined) tell.over("j3:no-timed-read · p2's statements (FSD_DB_URL: no server log to read)", []);
    else {
      const p2s = tell.over("j3:no-timed-read · p2's logged statements", statements(db.log).filter((s) => s.app === "goal-j3-p2"));
      const named = p2s.filter((s) => s.at >= from && s.at < to && !isBusTraffic(s) && (s.text.includes(sA) || s.params.includes(sA)));
      tell.over("j3:no-timed-read · p2 statements naming the session, idle", named, { emptyIs: "the claim: no timed read" });
      if (named.length !== 0) failures.push(`j3:no-timed-read: p2 sent ${named.length} statements naming the session over ${IDLE_MS / 1000} s idle`);
      note(`j3: idle ${IDLE_MS / 1000} s, p2 logged ${named.length} statements naming the session`);
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await Promise.all(started.map((app) => app.peer.stop()));
    await redis.stop();
  }
}

// ---------------------------------------------------------------------------
// Journey j4: behind `createNextHandler`, no push, and the screen polls
// ---------------------------------------------------------------------------

/** The read hooks' pace where push can't reach them (`client.live`'s default). */
const LIVE_POLL_MS = 3_000;

async function journeyJ4(
  { failures, tell, evidence }: Legs,
  env: { db: RunningPostgres; browser: Browser; pages: string }
): Promise<void> {
  const note = noting(evidence);
  const { db, browser, pages } = env;
  const next = async (name: string): Promise<AppProcess> => {
    const peer = await forkPeer(join(HERE, "next-server.mts"), name, {
      FSD_DB_URL: withAppName(db.url, `goal-${name}`),
      PORT: String(await freePort()),
      STATIC_DIR: pages,
      NODE_ENV: "test"
    });
    const port = await peer.call<number>("port");
    return { name, peer, port, origin: `http://127.0.0.1:${port}` };
  };
  // Each server is stopped in `finally`, whichever later start fails.
  const started: AppProcess[] = [];
  const contexts: BrowserContext[] = [];
  try {
    const n1 = await next("j4-next-1");
    started.push(n1);
    const n2 = await next("j4-next-2");
    started.push(n2);
    const capabilities = (await (await fetch(`${n2.origin}/api/flows/capabilities`)).json()) as { push?: unknown };
    tell.over("j4:polls · the Next host's capabilities", [capabilities]);
    if (capabilities.push !== null && capabilities.push !== undefined) failures.push(`j4:polls: GET /capabilities on the Next handler reports push ${JSON.stringify(capabilities.push)}`);
    note(`j4: GET /capabilities push ${JSON.stringify(capabilities.push ?? null)}`);

    const sA = await newSession(n1.origin, "user-a", "tok-a");
    const sB = await newSession(n2.origin, "user-b", "tok-b");
    const ctxA = await userContext(browser, "tok-a");
    const ctxB = await userContext(browser, "tok-b");
    contexts.push(ctxA, ctxB);
    const a = await openScreen(ctxA, "A behind Next 1", n1.origin, "user-a", sA);
    const b = await openScreen(ctxB, "B behind Next 2", n2.origin, "user-b", sB);
    await until(() => b.shown.length > 0, 10_000);
    await quiet([a, b]);

    const bound = LIVE_POLL_MS + BOUND_MS;
    const lat: number[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
      const tag = `${RUN_STAMP.slice(-6)}-next-${i}`;
      const planAt = await act(a, "setPlan", `plan-${tag}`);
      const planShown = await shownAt(b, planAt, (row) => row.plan === `plan-${tag}`, bound + 3_000);
      const seatAt = await act(a, "addSeat", `seat-${tag}`);
      const seatShown = await shownAt(b, seatAt, (row) => row.seats.includes(`seat-${tag}`), bound + 3_000);
      for (const [what, at, shown] of [["plan", planAt, planShown], ["seat", seatAt, seatShown]] as const) {
        if (shown === undefined) failures.push(`j4:polls: B never showed A's ${what} ${i} within ${(bound + 3_000) / 1000} s`);
        else lat.push(shown - at);
      }
    }
    const read = tell.over("j4:polls · samples shown", lat);
    if (read.some((ms) => ms >= bound)) failures.push(`j4:polls: B showed A's changes ${read.join(", ")} ms after A's page sent them (bound ${bound}: the hooks' ${LIVE_POLL_MS} ms poll plus 1 s)`);
    note(`j4:polls ${read.join("/")} ms (bound ${bound}); B opened ${b.opens.length} sockets`);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await Promise.all(started.map((app) => app.peer.stop()));
  }
}

// ---------------------------------------------------------------------------
// Journeys j2-teammates and j2-claude-code-style: each lab on two processes
// ---------------------------------------------------------------------------

/** The lab's one user, on both processes. */
const LAB_USER = "u_closure";
/** Where the store swap's `postgresStores` loads from: the goals' own dependency. */
const STORE_POSTGRES = import.meta.resolve("@flow-state-dev/store-postgres");

/** What a lab page drew, each time it changed, stamped in the page. */
type LabShown = { at: number; answers: string[]; running: boolean; working: boolean; settled: string[] };

/**
 * One lab, as its scene serves, opens and reads it. `storeLine` is the host's
 * store line, swapped as each process loads the host (FIX-2368 D2); `observe`
 * reports what the page draws: each `answer`/`held <tag>` in the
 * conversation, whether the conversation draws a turn running, whether the
 * worker list draws the worker working, and the text of each task the tasks
 * view draws settled.
 */
type Lab = {
  name: "teammates" | "claude-code-style";
  pkg: string;
  config: string;
  host: string;
  storeLine: string;
  env(dir: string, repo: string): Record<string, string>;
  /** On process 1, as another client: the conversation the scene writes into. */
  open(fsd: ReturnType<typeof createClient>, repo: string): Promise<string>;
  /** The page on process 2, on that conversation, with its tasks view showing settled tasks. */
  show(page: Page, origin: string, session: string): Promise<void>;
  observe: string;
};

/** The observer every lab page runs, over the lab's four reads. */
const labObserver = (reads: { conversation: string; running: string; working: string; settled: string }) => `(() => {
  const tags = (re, text) => [...text.matchAll(re)].map((m) => m[0]);
  let last = '';
  const note = () => {
    const conversation = document.querySelector(${JSON.stringify(reads.conversation)});
    const now = {
      answers: tags(/(answer|held) [A-Za-z0-9]+/g, conversation?.innerText ?? ''),
      running: (${reads.running})(),
      working: (${reads.working})(),
      settled: [...document.querySelectorAll(${JSON.stringify(reads.settled)})].map((el) => el.textContent ?? '')
    };
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    window.__goalLab?.({ at: Date.now(), ...now });
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
})();`;

const TEAMMATES_LEAD = { id: "teammates.chief-of-staff", name: "Chief of Staff" };

const LABS: Record<string, Lab> = {
  "j2-teammates": {
    name: "teammates",
    pkg: "@flow-state-dev/teammates",
    config: join(HERE, "labs", "teammates.config.mts"),
    host: "labs/teammates/host.mts",
    storeLine: String.raw`sqliteStores\(\{ filename: options\.store \}\)`,
    env: (dir, repo) => ({ TEAMMATES_STORE: join(dir, "teammates.sqlite"), TEAMMATES_USER: LAB_USER, TEAMMATES_WORKDIR: repo, TEAMMATES_RUNS: join(dir, "runs") }),
    open: async (fsd) => (await createWorkforceClient(fsd).ensureWorkerSession({ worker: TEAMMATES_LEAD.id })).id,
    show: async (page, origin) => {
      await page.goto(origin);
      await page.locator(`nav[aria-label="Workers"] button[data-worker="${TEAMMATES_LEAD.name}"]`).click();
      const panel = page.locator(`aside[aria-label="${TEAMMATES_LEAD.name}'s panel"]`);
      await panel.waitFor({ timeout: 30_000 });
      // The panel shows one status at a time: settled tasks are under Done.
      await panel.locator("#tasks-tab-done").click();
    },
    observe: labObserver({
      conversation: 'main[aria-label="Conversation"]',
      running: `() => document.querySelector('main[aria-label="Conversation"] [data-chat-activity]') !== null`,
      working: `() => /^Replying/.test(document.querySelector('nav[aria-label="Workers"] button[data-worker="${TEAMMATES_LEAD.name}"] [data-status]')?.textContent ?? '')`,
      settled: `aside[aria-label="${TEAMMATES_LEAD.name}'s panel"] button[data-task="done"]`
    })
  },
  "j2-claude-code-style": {
    name: "claude-code-style",
    pkg: "@flow-state-dev/claude-code-style",
    config: join(HERE, "labs", "claude-code-style.config.mts"),
    host: "labs/claude-code-style/host.mts",
    storeLine: String.raw`sqliteStores\(\{ filename: join\(data, "lab\.db"\) \}\)`,
    env: (dir, repo) => ({ CLAUDE_CODE_STYLE_DATA: join(dir, "data"), CLAUDE_CODE_STYLE_USER: LAB_USER, CLAUDE_CODE_STYLE_REPOSITORIES: repo }),
    open: async (fsd, repo) => {
      const calls = appCalls(fsd);
      const project = await calls.createProject(`closure ${RUN_STAMP.slice(-6)}`, `file://${repo}`);
      return (await calls.openSession("session", project.id)).id;
    },
    show: async (page, origin, session) => {
      await page.goto(`${origin}/?session=${encodeURIComponent(session)}`);
      await page.getByRole("complementary", { name: "Background tasks" }).waitFor({ timeout: 30_000 });
    },
    observe: labObserver({
      conversation: 'main[aria-label="Main thread"]',
      running: `() => [...document.querySelectorAll('main[aria-label="Main thread"] [role=status]')].some((el) => /working/.test(el.textContent ?? ''))`,
      working: `() => document.querySelector('nav[aria-label="Sessions"] li button[aria-current="true"] [aria-label="running"]') !== null`,
      settled: 'aside[aria-label="Background tasks"] [data-task-status="completed"]'
    })
  }
};

/** A scratch git checkout with one commit that ignores `.fsdev/`: the labs' working folder and project. */
function labRepository(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), "# Closure\n");
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: dir });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "start");
  return dir;
}

type ServedLab = { name: string; origin: string; log: () => string; stop(): Promise<void> };

/**
 * One process of `lab`: `fsdev dev --config <the goal's config> --app <the lab's pages>`, its
 * own OS process, its statements logged under `goal-<name>`. The host's store line is swapped to
 * Postgres as the process loads it, beside the control's patches; a host whose line is gone
 * fails here, before anything starts, and a process Postgres hears nothing from fails once it serves.
 */
async function serveLab(lab: Lab, name: string, db: RunningPostgres, dir: string, repo: string): Promise<ServedLab> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // Another process can take the port between freePort and the bind; its answers would pass the readiness poll below.
  await refuseIfAnswering(origin);
  const swap: ModulePatch = {
    module: lab.host,
    from: lab.storeLine,
    to: `(await import(${JSON.stringify(STORE_POSTGRES)})).postgresStores({ connectionString: process.env.FSD_DB_URL })`
  };
  // The control's patches still apply: the runner was started with them, and they are handed on with the swap.
  const control = process.env.GOAL_MODULE_PATCH === undefined ? undefined : (JSON.parse(process.env.GOAL_MODULE_PATCH) as { mark?: string });
  const mark = control?.mark ?? join(SCRATCH, `swap-mark-${RUN_STAMP}`);
  const patches = [...(PATCHES[CONTROL] ?? []), swap];
  let log = "";
  const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["packages/fsdev/src/bin.ts", "dev", "--config", lab.config, "--app", lab.pkg, "--port", String(port), "--no-open"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: intentFreeEnv(process.env, {
      GOAL_CONTROL: "",
      FSD_DB_URL: withAppName(db.url, `goal-${name}`),
      ...lab.env(dir, repo),
      ...modulePatchEnv(patches, REPO_ROOT, mark)
    })
  });
  const keep = (chunk: unknown) => {
    log += String(chunk);
    writeFileSync(join(dir, `${name}.log`), log);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  let gone = false;
  const exited = new Promise<void>((resolve) => onClosed(child, () => ((gone = true), resolve())));
  const stop = async () => {
    stopProcessGroup(child);
    await exited;
  };
  for (const until = Date.now() + 120_000; Date.now() < until && !gone; await delay(500)) {
    if (!/Data:/.test(log)) continue;
    if ((await fetch(origin).then((r) => r.status, () => 0)) !== 200) continue;
    // The swap took: this process talks to Postgres under its own name (the SQLite store would log nothing there).
    if (db.log !== undefined && !statements(db.log).some((s) => s.app === `goal-${name}`)) {
      await stop();
      throw new Error(`setup: ${name} serves, but Postgres logged nothing from it: its store is not the swapped one`);
    }
    return { name, origin, log: () => log, stop };
  }
  await stop();
  throw new Error(`setup: ${name} never served on ${origin}. Log tail:\n${log.slice(-2000)}`);
}

/**
 * The page's frame rate over 300 ms, as j2 and the lab scenes probe it: a background tab runs a frame or two a second.
 * A string, so the bundler's helpers don't reach the page. The timeout ends the count where frames stop altogether.
 */
const FRAME_PROBE = "new Promise((done) => { let frames = 0; const t0 = performance.now(); const rate = () => frames / ((performance.now() - t0) / 1000); const tick = () => (++frames, performance.now() - t0 < 300 ? requestAnimationFrame(tick) : done(rate())); requestAnimationFrame(tick); setTimeout(() => done(rate()), 1500); })";

/** When the store first holds `query`'s single `status` at one of `statuses`, polled every 5 ms on the runner's own connection. */
async function storeSaid(db: RunningPostgres, query: string, params: unknown[], statuses: string[], withinMs: number): Promise<number | undefined> {
  for (const deadline = Date.now() + withinMs; Date.now() < deadline; await delay(5)) {
    const found = await db.query<{ status: string }>(query, params);
    if (found.some((r) => statuses.includes(r.status))) return Date.now();
  }
  return undefined;
}

/** When `shown` first held a drawing `match` accepts at or after `since`, waiting up to `withinMs`. */
async function labShownAt(shown: LabShown[], since: number, match: (drawn: LabShown) => boolean, withinMs: number): Promise<number | undefined> {
  for (const deadline = Date.now() + withinMs; ; await delay(5)) {
    const hit = shown.find((drawn) => drawn.at >= since && match(drawn));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
  }
}

const isWrite = (s: Statement) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s.text) || /^\s*WITH\b[\s\S]*\b(INSERT|UPDATE|DELETE)\b/i.test(s.text);

async function journeyLab(
  scene: string,
  { failures, tell, evidence }: Legs,
  env: { db: RunningPostgres; browser: Browser }
): Promise<void> {
  const note = noting(evidence);
  const lab = LABS[scene]!;
  const { db, browser } = env;
  const dir = join(SCRATCH, `${scene}-${CONTROL || "main"}-${RUN_STAMP}`);
  mkdirSync(dir, { recursive: true });
  const repo = labRepository(join(dir, "repo"));
  const sceneFrom = Date.now();
  const p1Name = `${scene}-p1`;
  const p2Name = `${scene}-p2`;
  // Process 1 first: it makes the schema; process 2 then starts on it.
  const started: ServedLab[] = [];
  let context: BrowserContext | undefined;
  try {
    started.push(await serveLab(lab, p1Name, db, join(dir, "p1"), repo));
    started.push(await serveLab(lab, p2Name, db, join(dir, "p2"), repo));
    const [p1, p2] = started as [ServedLab, ServedLab];
    // Another client, on process 1: it opens the conversation and sends every line.
    const fsd = createClient({ userId: LAB_USER, baseUrl: p1.origin });
    const workforce = createWorkforceClient(fsd);
    const inbox = createInboxClient(fsd);
    const session = await lab.open(fsd, repo);

    context = await browser.newContext();
    const page = await context.newPage();
    const screen = await watchPage(page, `${scene} on p2`, lab.observe);
    const drawings: LabShown[] = [];
    await page.exposeFunction("__goalLab", (drawn: LabShown) => void drawings.push(drawn));
    await lab.show(page, p2.origin, session);
    await page.bringToFront();
    const rates: number[] = [];
    for (let probe = 0; probe < 3; probe++) {
      rates.push(await page.evaluate<number>(FRAME_PROBE));
      if (rates.at(-1)! >= 20) break;
    }
    if (rates.every((r) => r < 20)) throw new Error(`setup: ${scene}'s page draws ${rates.map((r) => r.toFixed(1)).join(", ")} frames a second, a background tab's rate`);
    note(`${scene}: page on p2 at ${rates.at(-1)!.toFixed(0)} frames a second`);

    // :no-poll and :no-timed-read · the idle window, from the first `crosses: true` (or, under
    // never-crosses, `crosses: false`) once the opening reads have gone quiet. Nothing has run.
    const crossing = (value: boolean) => screen.frames.find((f) => f.frame.type === "crossing" && f.frame.crosses === value)?.at;
    const said = await until(() => crossing(true) !== undefined || (CONTROL === "never-crosses" && crossing(false) !== undefined), 15_000);
    tell.over(`${scene}:no-poll · the page's crossing frames`, screen.frames.filter((f) => f.frame.type === "crossing"));
    // Under never-crosses the control fails only on what its window counts: a missing frame shows nothing.
    if (!said && CONTROL === "never-crosses") throw new Error(`setup: ${scene}: the page's socket never said crosses: false within 15 s, so never-crosses' window has no start`);
    if (!said) failures.push(`${scene}:no-poll: the page's socket never said crosses: true within 15 s`);
    await quiet([screen], 1_000, 15_000);
    const from = Date.now();
    await delay(IDLE_MS);
    const to = Date.now();
    const idleSent = tell.over(`${scene}:no-poll · the page's requests over the idle window`, screen.sent.filter((s) => s.at >= from && s.at < to), { emptyIs: "the claim: 0 requests" });
    tell.over(`${scene}:no-poll · the page's requests before the window (it was reading)`, screen.sent.filter((s) => s.at < from));
    if (idleSent.length > 0) failures.push(`${scene}:no-poll: the page sent ${idleSent.length} requests in ${IDLE_MS / 1000} s with nothing written (${idleSent.slice(0, 3).map((s) => `${s.method} ${new URL(s.url).pathname}`).join(", ")})`);
    // A watched session: one the page named in a request it sent.
    const sessionIds = (await db.query<{ id: string }>("SELECT id FROM sessions")).map((r) => r.id);
    const watched = sessionIds.filter((id) => screen.sent.some((s) => s.url.includes(id)) || id === session);
    tell.over(`${scene}:no-timed-read · the sessions the page watches`, watched);
    let named: Statement[] = [];
    if (db.log === undefined) tell.over(`${scene}:no-timed-read · p2's statements (FSD_DB_URL: no server log to read)`, []);
    else {
      tell.over(`${scene}:no-timed-read · p2's logged statements (the log reads p2)`, statements(db.log).filter((s) => s.app === `goal-${p2Name}`));
      const p2Idle = statements(db.log).filter((s) => s.app === `goal-${p2Name}` && s.at >= from && s.at < to && !isBusTraffic(s));
      named = tell.over(`${scene}:no-timed-read · p2 statements naming a watched session, idle`, p2Idle.filter((s) => watched.some((id) => s.text.includes(id) || s.params.includes(id))), { emptyIs: "the claim: no timed read" });
      if (named.length > 0) failures.push(`${scene}:no-timed-read: process 2 sent ${named.length} statements naming a watched session over ${IDLE_MS / 1000} s idle (${named[0]!.text.slice(0, 100)})`);
    }
    note(`${scene}: idle ${IDLE_MS / 1000} s, the page sent ${idleSent.length} requests, p2 logged ${named.length} statements naming ${watched.length} watched sessions`);

    // The samples: every line sent on process 1, 1.5 s apart (past the session stream's interval).
    const stamp = RUN_STAMP.replace(/[^A-Za-z0-9]/g, "").slice(-6);
    // Unique to this run and this scene: both labs' scenes share the one Postgres.
    const tagOf = (kind: string, i: number) => `${kind.toLowerCase()}${lab.name === "teammates" ? "t" : "c"}${stamp}x${i}`;
    const lat = { message: [] as number[], running: [] as number[], ended: [] as number[], activity: [] as number[], task: [] as number[] };
    const written: Array<{ assertion: string; needles: string[] }> = [];
    let reviewed = 0;
    const requestOf = "SELECT r.status FROM requests r WHERE r.id = $1";
    const missed = (assertion: string, what: string) => failures.push(`${scene}:${assertion}: ${what} never drawn within ${SAMPLE_WAIT_MS / 1000} s`);

    for (let i = 1; i <= SAMPLES; i++) {
      const tag = tagOf("SAY", i);
      const sent = Date.now();
      const { requestId } = await workforce.send(session, `SAY-${tag}`);
      const shown = await labShownAt(drawings, sent, (r) => r.answers.includes(`answer ${tag}`), SAMPLE_WAIT_MS);
      if (shown === undefined) missed("message", `answer ${tag}`);
      else lat.message.push(shown - sent);
      written.push({ assertion: "message", needles: [`answer ${tag}`, requestId] });
      await delay(STREAM_INTERVAL_MS + 500);
    }
    for (let i = 1; i <= SAMPLES; i++) {
      const tag = tagOf("HOLD", i);
      const sent = Date.now();
      const { requestId } = await workforce.send(session, `HOLD-${tag}`);
      const running = await storeSaid(db, requestOf, [requestId], ["in_progress"], SAMPLE_WAIT_MS);
      if (running === undefined) throw new Error(`setup: ${scene}: the turn for HOLD-${tag} never ran in the store`);
      const drawnRunning = await labShownAt(drawings, sent, (r) => r.running, SAMPLE_WAIT_MS);
      const drawnWorking = await labShownAt(drawings, sent, (r) => r.working, SAMPLE_WAIT_MS);
      const ended = await storeSaid(db, requestOf, [requestId], ["completed", "failed", "aborted"], 30_000);
      if (ended === undefined) throw new Error(`setup: ${scene}: the turn for HOLD-${tag} never ended in the store`);
      const drawnEnded = await labShownAt(drawings, Math.max(ended - 50, drawnRunning ?? sent), (r) => !r.running && r.answers.includes(`held ${tag}`), SAMPLE_WAIT_MS);
      if (drawnRunning === undefined) missed("turn", `HOLD-${tag}'s turn running`);
      else lat.running.push(drawnRunning - running);
      if (drawnEnded === undefined) missed("turn", `HOLD-${tag}'s turn ended`);
      else lat.ended.push(drawnEnded - ended);
      if (drawnWorking === undefined) missed("activity", `the worker working on HOLD-${tag}`);
      else lat.activity.push(drawnWorking - running);
      written.push({ assertion: "turn", needles: [requestId] }, { assertion: "activity", needles: [requestId] });
      await delay(STREAM_INTERVAL_MS + 500);
    }
    for (let i = 1; i <= SAMPLES; i++) {
      const tag = tagOf("FILE", i);
      const sent = Date.now();
      await workforce.send(session, `FILE-${tag}`);
      // A run that committed waits for your review where the lab reviews (Teammates): the other client
      // on process 1 accepts it, as a person does from the task's popup. The store is read every 5 ms.
      const taskQuery = "SELECT state->>'status' AS status FROM resource_state WHERE resource_key LIKE 'tasks/%' AND state->>'title' = $1";
      let settled: number | undefined;
      let accepted = false;
      for (let n = 0, deadline = Date.now() + 60_000; settled === undefined && Date.now() < deadline; n++, await delay(5)) {
        if ((await db.query<{ status: string }>(taskQuery, [`Task ${tag}`])).some((r) => ["completed", "failed", "cancelled"].includes(r.status))) settled = Date.now();
        else if (!accepted && n % 40 === 0) {
          const board = (await fsd.view(codingBoardViewRef(), { sessionId: session })).value as Array<{ title: string; asks: InboxHold[] }>;
          const review = board.find((t) => t.title === `Task ${tag}`)?.asks.find((hold) => hold.ask.kind === "review");
          if (review !== undefined) {
            await inbox.answerOne(review, { value: { verdict: "accepted" } });
            accepted = true;
          }
        }
      }
      if (settled === undefined) throw new Error(`setup: ${scene}: "Task ${tag}" never settled in the store within 60 s`);
      const [task] = await db.query<{ status: string; id: string }>("SELECT state->>'status' AS status, state->>'id' AS id FROM resource_state WHERE resource_key LIKE 'tasks/%' AND state->>'title' = $1", [`Task ${tag}`]);
      if (task?.status !== "completed") throw new Error(`setup: ${scene}: "Task ${tag}" settled ${task?.status}, not completed`);
      const drawn = await labShownAt(drawings, sent, (r) => r.settled.some((text) => text.includes(`Task ${tag}`)), SAMPLE_WAIT_MS);
      if (drawn === undefined) {
        missed("task", `"Task ${tag}" settled`);
        await page.screenshot({ path: join(dir, `task-${i}.png`) }).catch(() => {});
      }
      else lat.task.push(drawn - settled);
      written.push({ assertion: "task", needles: [task.id] });
      if (accepted) reviewed += 1;
      await delay(STREAM_INTERVAL_MS + 500);
    }

    // Every graded change was written by process 1: each write naming a sample's answer, request or task.
    if (db.log === undefined) tell.over(`${scene} · writes by process (FSD_DB_URL: no server log to read)`, []);
    else {
      const writes = statements(db.log).filter((x) => x.at >= sceneFrom && isWrite(x));
      for (const { assertion, needles } of written) {
        const mine = writes.filter((s) => needles.some((n) => s.text.includes(n) || s.params.includes(n)));
        const by = new Set(mine.map((s) => s.app));
        if (mine.length === 0) failures.push(`setup: ${scene}:${assertion}: no logged write names ${needles.join(" or ")}, so who wrote it can't be read`);
        else if ([...by].some((app) => app !== `goal-${p1Name}`)) failures.push(`setup: ${scene}:${assertion}: a sample naming ${needles.join(" or ")} was written by ${[...by].join(", ")}, not process 1 alone`);
      }
      const p2Writes = writes.filter((s) => s.app === `goal-${p2Name}` && s.at >= from);
      note(`${scene}: every graded change written by p1 (${written.length} checked); p2 wrote ${p2Writes.length} statements of its own after the page opened`);
    }

    const grade = (assertion: string, what: string, list: number[], expected: number) => {
      const read = tell.over(`${scene}:${assertion} · ${what} samples`, list);
      if (read.length === expected && read.some((ms) => ms >= BOUND_MS)) failures.push(`${scene}:${assertion}: ${what} drawn ${read.join(", ")} ms after the change (bound ${BOUND_MS})`);
      note(`${scene}:${assertion} ${what} ${read.join("/")} ms`);
    };
    grade("message", "answer after sent", lat.message, SAMPLES);
    grade("turn", "running after the store", lat.running, SAMPLES);
    grade("turn", "ended after the store", lat.ended, SAMPLES);
    grade("activity", "working after the store", lat.activity, SAMPLES);
    grade("task", "settled after the store", lat.task, SAMPLES);
    note(`${scene}: ${reviewed} of ${SAMPLES} tasks waited for a review, accepted from process 1`);
  } finally {
    await context?.close().catch(() => {});
    for (const served of started.reverse()) await served.stop();
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const checkout = checkoutFor(CONTROL);
  const hash = appHash(join(checkout, GOAL_DIR, "app"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const ran = CONTROL === "main-before" ? MAIN_BEFORE : commit;
  say(`app on ${ran.slice(0, 9)}${CONTROL === "" ? "" : ` (control ${CONTROL})`}; app/ sha256 ${hash}`);
  if (hash !== appHash(join(HERE, "app"))) failures.push("setup: the app the processes run differs from this goal's app/");
  evidence.push(`commit ${ran.slice(0, 9)} · app/ sha256 ${hash.slice(0, 16)}`);

  const pages = join(SCRATCH, `pages-${CONTROL || "main"}`);
  await buildPage(checkout, pages);
  const db = await startPostgres({ slug: "every-screen", settings: { log_statement: "all", log_line_prefix: "'%n|%a|'" } });
  let browser: Browser | undefined;
  try {
    evidence.push(`postgres: ${db.source}`);
    browser = await launchChromium();
    if (SCENES.has("a") || SCENES.has("c") || SCENES.has("d")) await legsACD({ failures, tell, evidence }, { checkout, db, browser, pages });
    // j4's server is this goal's next-server.mts on today's packages; the old checkout has no Next adapter dependency
    // in goals/, so under main-before it would grade today's server against the old page. It does not run there.
    if (SCENES.has("j4") && CONTROL === "main-before") evidence.push(`j4: not run under main-before (its server runs on today's packages only)`);
    else if (SCENES.has("j4")) await journeyJ4({ failures, tell, evidence }, { db, browser, pages });
    if (SCENES.has("j3")) await journeyJ3({ failures, tell, evidence }, { tree: checkout, db, browser, pages });
    if (SCENES.has("b") || SCENES.has("j2")) await legB({ failures, tell, evidence }, { tree: checkout, db, browser, label: CONTROL || "main" });
    // The labs' hosts on the main-before commit predate the options these scenes serve them with.
    for (const scene of Object.keys(LABS).filter((s) => SCENES.has(s))) {
      if (CONTROL === "main-before") evidence.push(`${scene}: not run under main-before (its lab predates the options it serves it with)`);
      else {
        execFileSync("pnpm", ["--filter", LABS[scene]!.pkg, "build"], { cwd: REPO_ROOT, stdio: "ignore" });
        await journeyLab(scene, { failures, tell, evidence }, { db, browser });
      }
    }
  } finally {
    await browser?.close();
    await db.stop();
  }
  return { failures, evidence: evidence.join(" · ") };
});
