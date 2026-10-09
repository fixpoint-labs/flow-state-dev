/**
 * Goal check — the DevTool shows the copy you selected, in a real browser.
 *
 * Real path, no mocking, no model, out of CI. See goal.md for the contract.
 *
 * The server is the shipped `fsdev dev` shell over the shipped DevTool bundle,
 * so what Chromium loads is the artifact a developer runs, not a test harness
 * assembled around the components. A passing unit suite cannot establish this:
 * the defect being graded is what appears on screen after a switch, and every
 * part of it — the flash, the address a control uses, the retired read landing
 * late — lives in the composition rather than in any one hook.
 *
 * Run: pnpm tsx goals/flow-instances/devtool-shows-the-selected-copy/run.mts
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page, type Request as PwRequest } from "playwright";
import {
  REPO_ROOT,
  goalTmpDir,
  loadFixture,
  refuseIfAnswering,
  runGoal,
  stopProcessGroup,
} from "../../lib/index.mts";

type Copy = { id: string; marker: string };
type Fixture = { copies: Copy[]; singleton: Copy; userId: string };

const fixture = loadFixture<Fixture>(import.meta.url);
const [copyA, copyB] = fixture.copies as [Copy, Copy];
const HERE = fileURLToPath(new URL(".", import.meta.url));
const FLOW_DIR = join(HERE, "fixtures", "flows");
const PORT = 4288;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOTS = goalTmpDir("devtool-instances");

const failures: string[] = [];
/** Every API URL the page requested, so an address can be graded, not assumed. */
const apiCalls: string[] = [];

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

/** API calls addressed to a specific instance, newest last. */
function addressedTo(id: string): string[] {
  return apiCalls.filter((url) => url.includes(`/api/flows/${id}/`));
}

async function shot(page: Page, name: string): Promise<string> {
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

/**
 * Wait for OUR dev server to answer its health check, or give up loudly.
 *
 * Only a 200 counts, and only while the child is alive: a child that exited
 * (EADDRINUSE, say) did not produce whatever is answering.
 */
async function waitForServer(server: ChildProcess): Promise<void> {
  for (let i = 0; i < 240 && server.exitCode === null && server.signalCode === null; i += 1) {
    try {
      const res = await fetch(`${ORIGIN}/healthz`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server never became ready on ${ORIGIN}`);
}

/**
 * A Chromium already on the machine whose build number Playwright did not pick.
 *
 * An environment that pre-installs browsers into `PLAYWRIGHT_BROWSERS_PATH`
 * pins one build; bumping the Playwright package asks for a different one and
 * gets "run npx playwright install", which such a machine cannot do. Any
 * Chromium in that pool drives this page fine — the goal grades the DevTool,
 * not the browser — so an existing one is used rather than fetching. Returns
 * `undefined` when the default resolution is already right.
 */
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

/**
 * The navigator row for one leaf (a collection instance, or a singleton kind),
 * reached by its accessible name, matched exactly.
 *
 * Deliberately the ACCESSIBLE name rather than a test id or the visible text:
 * the visible label is truncated to fit the rail, so "can this copy be told
 * from its peer without looking" is a real property of this screen and is
 * graded here rather than assumed. The row hangs under its kind's row, which
 * carries the kind; the row's own name is the exact id.
 */
function instanceRow(page: Page, id: string) {
  return page.getByRole("button", { name: id, exact: true });
}

/** The row's frame: its button plus the controls the tool draws after it. */
function rowFrame(page: Page, id: string) {
  return instanceRow(page, id).locator("xpath=..");
}

/**
 * Open a collection kind's row so its copies are listed. Opening a kind
 * selects nothing; the copies are one level below it.
 */
async function openKind(page: Page, kind: string): Promise<void> {
  const row = page.locator(`nav button[data-kind="${kind}"]`);
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}

/**
 * Open a leaf's row if it is not already open. Opening is not selecting:
 * several leaves can be open at once, and the workspace moves when a session
 * is picked, or, on an empty workspace, when a saved one is restored.
 */
async function expand(page: Page, id: string): Promise<void> {
  const row = instanceRow(page, id);
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}

/**
 * A session row as listed under one leaf. Scoped to that leaf's own list, so a
 * pick is made from the copy the session is offered under.
 */
function sessionRow(page: Page, leaf: string, sessionId: string) {
  return page.locator(`nav ul[data-leaf="${leaf}"] button[data-session-id="${sessionId}"]`);
}

/** The open session's id, read off the workspace badge, or null if none is open. */
async function openSessionId(page: Page): Promise<string | null> {
  const badge = page.getByTitle(/^Session ID: /);
  if ((await badge.count()) === 0) return null;
  return /^Session ID: (\S+)/.exec((await badge.getAttribute("title")) ?? "")?.[1] ?? null;
}

/** Open a leaf and create a session under it, returning that session's id. */
async function openWithNewSession(page: Page, id: string): Promise<string> {
  await expand(page, id);
  const before = await openSessionId(page);
  // The leaf's own "New session", not the first on the page: two leaves can be
  // open at once, and the control must act on the copy whose row it is on.
  await rowFrame(page, id).getByRole("button", { name: "New session", exact: true }).click();
  await page.waitForFunction(
    (previous) => {
      const badge = document.querySelector('[title^="Session ID: "]')?.getAttribute("title");
      const current = /^Session ID: (\S+)/.exec(badge ?? "")?.[1] ?? null;
      return current !== null && current !== previous;
    },
    before,
    { timeout: 15_000 },
  );
  const opened = await openSessionId(page);
  if (opened === null) throw new Error("could not read the open session id");
  return opened;
}

/**
 * Calls made since `from` that address copy `to` with a request id of copy
 * `other`'s: one copy's request re-addressed to its peer. Invisible on screen
 * (the server refuses it) but the same mismatch as a flash.
 */
function misaddressedSince(from: number, to: string, other: string): string[] {
  const foreign = addressedTo(other)
    .map((url) => /\/requests\/([^/?]+)/.exec(url)?.[1])
    .filter((rid): rid is string => rid !== undefined);
  return apiCalls
    .slice(from)
    .filter((url) => url.includes(`/api/flows/${to}/`))
    .filter((url) => foreign.some((rid) => url.includes(rid)));
}

/**
 * Switch the workspace to a copy's session by picking its row, which is the
 * switch an operator makes, and grade the FRAME the click produces.
 *
 * The screen is read on that frame with nothing awaited in between. The defect
 * is a frame (a commit where the new copy is selected and the old copy's
 * request is still installed), so a check that waits for the new reads to land
 * cannot see it. The network is graded over everything the switch issued, up
 * to the settled state, so a retired read landing late is caught too.
 */
async function switchTo(
  page: Page,
  to: Copy,
  toSession: string,
  from: Copy,
  shotName: string,
): Promise<void> {
  const callsBeforeSwitch = apiCalls.length;
  await sessionRow(page, to.id, toSession).click();
  const midSwitch = await page.locator("main").innerText();
  check(
    !midSwitch.includes(from.marker),
    `${from.id}'s result was still on screen under ${to.id} during the switch (read: ${midSwitch.slice(0, 400)})`,
  );
  await shot(page, shotName);
  await page.waitForTimeout(2500);
  const misaddressed = misaddressedSince(callsBeforeSwitch, to.id, from.id);
  check(
    misaddressed.length === 0,
    `the switch addressed ${from.id}'s request to ${to.id}: ${misaddressed.join(", ")}`,
  );
  const opened = await openSessionId(page);
  check(
    opened === toSession,
    `picking ${to.id}'s session did not open it (badge: ${opened}, expected ${toSession})`,
  );
  const settled = await page.locator("main").innerText();
  check(
    settled.includes(to.marker) && !settled.includes(from.marker),
    `switching to ${to.id} did not show its work alone (read: ${settled.slice(0, 400)})`,
  );
}

/** Dispatch the copy's action and wait for its result to render in the stream. */
async function dispatch(page: Page, action: string): Promise<void> {
  await page.locator("main select").first().selectOption(action);
  await page.getByRole("button", { name: "Send Action" }).click();
  await page.waitForTimeout(2000);
}

async function main() {
  // The bundle the shell serves. Built here rather than assumed, so the goal
  // cannot pass against a stale artifact from a previous branch.
  execFileSync("pnpm", ["--filter", "@flow-state-dev/devtool", "build:assets"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    // Run from a scratch cwd: `fsdev dev` puts its SQLite file under
    // `.fsdev/data` relative to where it was started, and a goal that reuses
    // the repo's dev database would grade sessions left by the previous run
    // (or by whoever last ran `fsdev dev` here). Each run starts empty.
    const workDir = join(SHOTS, "server");
    mkdirSync(workDir, { recursive: true });
    // Refuse beside anything already on the port: our child would fail to
    // bind and the readiness probe below would grade the incumbent.
    await refuseIfAnswering(ORIGIN);
    // Detached, so the stop in `finally` reaches the whole group: `tsx` runs
    // `fsdev dev` in a child, and signalling only `tsx` can leave it listening.
    server = spawn(
      join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [
        join(REPO_ROOT, "packages", "cli", "bin", "fsdev.ts"),
        "dev",
        "--flow-dir",
        FLOW_DIR,
        "--no-config",
        "--no-open",
        "--port",
        String(PORT),
      ],
      {
        cwd: workDir,
        env: { ...process.env, FSDEV_DEBUG_ENDPOINTS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    server.stdout?.on("data", () => {});
    server.stderr?.on("data", () => {});
    await waitForServer(server);

    // The catalog is the ground truth the navigator renders. Grading it here
    // means a navigator failure below is the UI's, not the server's.
    const catalog = (await (await fetch(`${ORIGIN}/api/flows`)).json()) as {
      flows: Array<{ id: string; kind: string; cardinality: string }>;
    };
    const ids = catalog.flows.map((f) => f.id).sort();
    check(
      ids.join(",") === [copyA.id, copyB.id, fixture.singleton.id].sort().join(","),
      `the server did not register both copies and the singleton (got: ${ids.join(", ")})`,
    );

    const executablePath = preinstalledChromium();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath === undefined ? {} : { executablePath }),
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("request", (req: PwRequest) => {
      if (req.url().includes("/api/flows")) apiCalls.push(req.url());
    });
    await page.goto(ORIGIN, { waitUntil: "networkidle" });

    // ---- 1. Both copies are distinguishable, and the singleton is unchanged.
    // The copies are listed under their kind's row, read off the catalog so a
    // swapped fixture still names the right row.
    const kind = catalog.flows.find((f) => f.id === copyA.id)?.kind ?? copyA.id;
    await openKind(page, kind);
    const navText = await page.locator("aside").first().innerText();
    check(
      navText.includes(copyA.id) && navText.includes(copyB.id),
      `the navigator did not show both copies by id (nav read: ${navText.replace(/\s+/g, " ")})`,
    );
    check(
      navText.includes(fixture.singleton.id),
      "the navigator did not show the singleton alongside the two copies",
    );
    // One row per copy, each NAMED by its exact id: a row whose accessible name
    // matched both, or neither, would read as zero or two here.
    for (const copy of [copyA, copyB]) {
      const rows = await instanceRow(page, copy.id).count();
      check(rows === 1, `copy ${copy.id} was not exactly one row by accessible name (found ${rows})`);
    }
    // The visible label is truncated to fit the rail, so the full id has to be
    // recoverable from the row itself: its copy control carries it.
    const rowTitle = await rowFrame(page, copyB.id)
      .getByRole("button", { name: `Copy instance ID ${copyB.id}`, exact: true })
      .getAttribute("title");
    check(
      (rowTitle ?? "").includes(copyB.id),
      `the full instance id was not discoverable from the row (title: ${rowTitle})`,
    );
    await shot(page, "01-navigator");

    // ---- 2. A: its own session, its own request, its own result.
    const sessionA = await openWithNewSession(page, copyA.id);
    await dispatch(page, "inspect");
    const streamA = await page.locator("main").innerText();
    check(
      streamA.includes(copyA.marker),
      `copy A's stream did not show A's marker "${copyA.marker}" (read: ${streamA.slice(0, 400)})`,
    );
    check(
      !streamA.includes(copyB.marker),
      `copy A's stream showed copy B's marker "${copyB.marker}"`,
    );
    check(
      addressedTo(copyA.id).some((url) => url.includes("/actions/inspect")),
      "the dispatch was not addressed to copy A's exact id",
    );
    await shot(page, "02-copy-a");

    // ---- 3. B, opened while A's work is on screen, gets its own session.
    // Opening B's row selects nothing; starting a session under it is what
    // moves the workspace, so that is graded for A's requests leaking across.
    const callsBeforeB = apiCalls.length;
    const sessionB = await openWithNewSession(page, copyB.id);
    check(sessionB !== sessionA, "the two copies were handed the same session");
    // The badge renders before the stream connects: that runs in a passive
    // effect after the commit, and a retired read can land later still. Let the
    // network settle before grading it, as `switchTo` does.
    await page.waitForTimeout(2500);
    const leakedIntoB = misaddressedSince(callsBeforeB, copyB.id, copyA.id);
    check(
      leakedIntoB.length === 0,
      `opening B addressed copy A's request to copy B: ${leakedIntoB.join(", ")}`,
    );
    await shot(page, "03-copy-b-session");
    await dispatch(page, "inspect");
    const streamB = await page.locator("main").innerText();
    check(
      streamB.includes(copyB.marker),
      `copy B's stream did not show B's marker "${copyB.marker}" (read: ${streamB.slice(0, 400)})`,
    );
    check(
      !streamB.includes(copyA.marker),
      `copy B's stream showed copy A's marker "${copyA.marker}"`,
    );
    check(
      addressedTo(copyB.id).some((url) => url.includes("/actions/inspect")),
      "the dispatch was not addressed to copy B's exact id",
    );
    await shot(page, "04-copy-b");

    // ---- 4. Switch straight between the two, in both directions. Picking the
    // peer's session row while the other copy's work is on screen IS the switch
    // an operator makes; both copies have a request installed by now, so each
    // direction can leak. Back to A first: A's session is offered under A, and
    // it restores A's work alone.
    await switchTo(page, copyA, sessionA, copyB, "05-switch-to-a-no-flash");
    await switchTo(page, copyB, sessionB, copyA, "05b-switch-to-b-no-flash");

    // ---- 5. Per-instance session state, read through the panel's own surface.
    const stateA = (await (
      await fetch(`${ORIGIN}/api/flows/sessions/${sessionA}/state`)
    ).json()) as { clientData?: { session?: { marker?: string } } };
    const stateB = (await (
      await fetch(`${ORIGIN}/api/flows/sessions/${sessionB}/state`)
    ).json()) as { clientData?: { session?: { marker?: string } } };
    check(
      stateA.clientData?.session?.marker === copyA.marker,
      `copy A's session state did not hold A's marker (got: ${JSON.stringify(stateA.clientData?.session)})`,
    );
    check(
      stateB.clientData?.session?.marker === copyB.marker,
      `copy B's session state did not hold B's marker (got: ${JSON.stringify(stateB.clientData?.session)})`,
    );

    // ---- 6. The singleton's experience is unchanged.
    await openWithNewSession(page, fixture.singleton.id);
    await dispatch(page, "summarize");
    const streamReports = await page.locator("main").innerText();
    check(
      streamReports.includes(fixture.singleton.marker),
      `the singleton did not run its own action (read: ${streamReports.slice(0, 400)})`,
    );
    check(
      addressedTo(fixture.singleton.id).some((url) => url.includes("/actions/summarize")),
      "the singleton's dispatch was not addressed on its unchanged address",
    );
    // Its sessions are still listed by kind, so rows saved before owners were
    // recorded keep showing for a one-copy app.
    check(
      apiCalls.some(
        (url) => url.includes("/sessions?") && url.includes(`flowKind=${fixture.singleton.id}`),
      ),
      "the singleton's session list was not read on the kind filter",
    );
    check(
      apiCalls.some((url) => url.includes("/sessions?") && url.includes(`flowId=${copyB.id}`)),
      "a collection member's session list was not read on its exact owner",
    );
    await shot(page, "06-singleton");

    // ---- 7. A reload must not hand one copy's saved session to its peer.
    await page.reload({ waitUntil: "networkidle" });
    await openKind(page, kind);
    await expand(page, copyB.id);
    await page.waitForTimeout(2500);
    const reloadBadge = await openSessionId(page);
    check(
      !(reloadBadge ?? "").includes(sessionA),
      `after a reload, copy B was handed copy A's session (badge: ${reloadBadge})`,
    );
    check(
      (reloadBadge ?? "").includes(sessionB),
      `after a reload, copy B did not get its own saved session back (badge: ${reloadBadge}, expected ${sessionB})`,
    );
    await shot(page, "07-after-reload");

    writeFileSync(join(SHOTS, "api-calls.txt"), apiCalls.join("\n"), "utf8");

    return {
      failures,
      evidence:
        `the shipped DevTool bundle under \`fsdev dev\` on ${ORIGIN}, driven in Chromium: ` +
        `both copies of \`${copyA.id.split("-")[0]}\` listed by exact id beside the \`${fixture.singleton.id}\` singleton; ` +
        `A → B → A → B each showed its own session and request with no marker from the other, ` +
        `including during the frame each session pick produced; dispatches were addressed to \`${copyA.id}\`, \`${copyB.id}\` ` +
        `and \`${fixture.singleton.id}\` on their own URLs; per-session state held each copy's marker; ` +
        `the singleton listed by kind while the collection members listed by \`flowId\`; ` +
        `a reload restored each copy's own saved session and never the peer's. ` +
        `Screenshots and the full API call log: ${SHOTS}`,
    };
  } finally {
    await browser?.close().catch(() => {});
    stopProcessGroup(server);
  }
}

mkdirSync(SHOTS, { recursive: true });
void runGoal(main);
