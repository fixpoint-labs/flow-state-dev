/**
 * Goal check: shift-manager › it runs from an install.
 *
 * Someone outside this repository installs Shift Manager, opens their own Lab
 * in the browser with one command and no build, and with `--dev` sees a saved
 * change to their Lab take effect without restarting anything by hand.
 *
 * The real path, end to end: every publishable package is built and packed the
 * way a release packs it, the tarballs are installed with npm into an empty
 * project, a held-out Lab is copied in beside them, and the installed
 * `shift-manager` command serves it. Chromium reads the page.
 *
 * Legs, each failure tagged with its assertion:
 *
 *   a:TEAMS equals the Lab's workers
 *       the sidebar's TEAMS squares are the tree's workers, read off disk
 *   a:Open trace opens the Lab's session
 *       a task with a run offers Open trace; following it opens the DevTool
 *       with that run's session, read from the store
 *   b:the change shows
 *       within 20 s of a saved edit to a file of the Lab (a worker's
 *       `WORKER.md` names another flow), with no other input, the open
 *       Roster shows the worker on that flow
 *
 * Anti-game: no repository import, workspace link or `pnpm` filter. The
 * installed `@flow-state-dev/*` packages must be real directories inside the
 * project, and the Lab's files may import nothing outside the Lab's folder.
 * The port is chosen here, so the check never reads the command's log for an
 * address; it reads the page, the tree on disk, and the store through the
 * Lab's routes.
 *
 * Controls:
 *   GOAL_CONTROL=no-page-config   the installed `@flow-state-dev/node` writes
 *                                 nothing into the pages it serves.
 *                                 Must fail a:Open trace opens the Lab's
 *                                 session and b:the change shows.
 *   GOAL_CONTROL=no-watch         the command runs without `--dev`.
 *                                 Must fail b:the change shows.
 *
 * Model: n/a. The Lab's runs are scripted.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-runs-from-an-install/run.mts
 * `GOAL_LAB=<dir>` swaps the held-out Lab: a folder with an `fsdev.config.mts`
 * and its tree under `workforce/`, importing only installed packages.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, repoPath, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "no-page-config", "no-watch"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL=${CONTROL}`);

/** The held-out Lab: the run-lab unless `GOAL_LAB` names another. */
const LAB = resolve(process.env.GOAL_LAB ?? repoPath("packages", "shift-manager", "test", "fixtures", "run-lab"));
const SCRATCH = goalTmpDir("shift-manager-install");
/** How long a saved change may take to show. */
const CHANGE_WITHIN_MS = 20_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

function sh(cmd: string, args: string[], cwd: string): string {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${result.status}):\n${`${result.stderr}${result.stdout}`.slice(-2000)}`);
  return result.stdout;
}

// ---- the install ---------------------------------------------------------------

/** Build what a release ships, pack every publishable package, and npm-install the tarballs into an empty project. */
function install(): { project: string; packed: string[] } {
  sh("pnpm", ["release:build"], REPO_ROOT);
  const tarballs = join(SCRATCH, "tarballs");
  const packed: string[] = [];
  for (const dir of readdirSync(join(REPO_ROOT, "packages"))) {
    const manifest = join(REPO_ROOT, "packages", dir, "package.json");
    if (!existsSync(manifest) || (JSON.parse(readFileSync(manifest, "utf8")) as { private?: boolean }).private === true) continue;
    sh("pnpm", ["--dir", join(REPO_ROOT, "packages", dir), "pack", "--pack-destination", tarballs], REPO_ROOT);
    packed.push(dir);
  }
  if (!packed.includes("shift-manager")) throw new Error("there is no shift-manager package to install: packages/shift-manager is missing or private");
  const project = join(SCRATCH, "project");
  sh("mkdir", ["-p", project], SCRATCH);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "my-lab", private: true, type: "module" }, null, 2));
  const files = readdirSync(tarballs).map((f) => join(tarballs, f));
  sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...files, "zod@^3.25.0"], project);
  return { project, packed };
}

/** Anti-game: every installed `@flow-state-dev/*` package is a real directory inside the project. */
function installedNotLinked(project: string): string[] {
  const scope = join(project, "node_modules", "@flow-state-dev");
  const problems: string[] = [];
  for (const name of readdirSync(scope)) {
    const path = join(scope, name);
    if (lstatSync(path).isSymbolicLink() || !realpathSync(path).startsWith(realpathSync(project) + sep)) problems.push(`@flow-state-dev/${name} is linked from ${realpathSync(path)}`);
  }
  return problems;
}

/** Anti-game: the Lab's modules import nothing outside the Lab's folder. */
function labStaysInside(lab: string): string[] {
  const problems: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(m?[jt]s)$/.test(entry.name)) {
        for (const [, spec] of readFileSync(path, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
          if (spec!.startsWith(".") && relative(lab, resolve(dirname(path), spec!)).startsWith("..")) problems.push(`${relative(lab, path)} imports ${spec}`);
        }
      }
    }
  };
  walk(lab);
  return problems;
}

/** `no-page-config`: the installed host writes nothing into a page. Throws if the patch finds nothing to patch. */
function dropPageConfig(project: string): void {
  const file = join(project, "node_modules", "@flow-state-dev", "node", "dist", "page-html.js");
  const before = readFileSync(file, "utf8");
  const after = before.replace(/export function createPageHtmlTransform\(options\) \{/, "$& return undefined;");
  if (after === before) throw new Error(`control no-page-config: nothing to patch in ${file}`);
  writeFileSync(file, after);
}

// ---- the command ------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

type Served = { origin: string; child: ChildProcess; log: () => string; exited: Promise<void> };

/** The installed command over the Lab, from the project, as its user types it. */
async function serve(project: string, dev: boolean): Promise<Served> {
  const bin = join(project, "node_modules", ".bin", "shift-manager");
  if (!realpathSync(bin).startsWith(realpathSync(project) + sep)) throw new Error(`the shift-manager command resolves outside the project: ${realpathSync(bin)}`);
  const port = await freePort();
  const env = intentFreeEnv(process.env, { INIT_CWD: project, GOAL_CONTROL: "", SHIFT_MANAGER_SHIFT: "" });
  delete env.NODE_OPTIONS;
  let log = "";
  const child = spawn(bin, ["--config", "./lab/fsdev.config.mts", "--port", String(port), "--no-open", ...(dev ? ["--dev"] : [])], {
    cwd: project,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  const exited = new Promise<void>((r) => child.on("exit", () => r()));
  const origin = `http://127.0.0.1:${port}`;
  for (const until = Date.now() + 90_000; Date.now() < until; await sleep(250)) {
    if (child.exitCode !== null) throw new Error(`shift-manager exited ${child.exitCode}. Log tail:\n${log.slice(-2000)}`);
    const status = await fetch(`${origin}/`).then((r) => r.status, () => 0);
    if (status === 200) return { origin, child, log: () => log, exited };
  }
  stopProcessGroup(child);
  throw new Error(`shift-manager never answered on ${origin}. Log tail:\n${log.slice(-2000)}`);
}

// ---- the page -----------------------------------------------------------------------

/** The `data-seat-id`s the sidebar's TEAMS draws, once it draws any (up to `ms`). */
async function shownWorkers(page: Page, ms: number): Promise<string[]> {
  const read = () => page.locator("[data-testid=worker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-seat-id") ?? ""));
  let shown: string[] = [];
  for (const until = Date.now() + ms; Date.now() < until && shown.length === 0; await sleep(250)) shown = await read().catch(() => []);
  return shown;
}

/** The flow the Roster draws for a worker: the first of the row's two lines under its name. */
async function shownKind(page: Page, seatId: string): Promise<string | null> {
  const line = page.locator(`[data-testid=roster-worker][data-seat-id="${seatId}"] p.truncate`).first();
  const text = await line.textContent({ timeout: 500 }).catch(() => null);
  return text === null ? null : text.split(" · ")[0]!.trim();
}

/** Wait up to `ms` for the Roster to draw `seatId` on `kind`; what it last drew. */
async function waitForKind(page: Page, seatId: string, kind: string, ms: number): Promise<{ ok: boolean; last: string | null; after: number }> {
  const start = Date.now();
  let last: string | null = null;
  while (Date.now() - start < ms) {
    last = await shownKind(page, seatId).catch(() => null);
    if (last === kind) return { ok: true, last, after: Date.now() - start };
    await sleep(250);
  }
  return { ok: false, last, after: Date.now() - start };
}

// ---- the check ------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const failed = (assertion: string, detail: string) => failures.push(`${assertion}: ${detail}`);

  const { project, packed } = install();
  const antiGame = [...installedNotLinked(project), ...labStaysInside(LAB)];
  if (antiGame.length > 0) throw new Error(`anti-game: ${antiGame.join("; ")}`);
  cpSync(LAB, join(project, "lab"), { recursive: true });
  if (CONTROL === "no-page-config") dropPageConfig(project);
  evidence.push(`${packed.length} tarballs npm-installed into an empty project; the Lab copied from ${relative(REPO_ROOT, LAB)}`);

  // The oracle: the tree on disk.
  const tree = await readDeclaredRoster(join(project, "lab", "workforce"));
  if (tree.problems.length > 0) throw new Error(`the Lab's tree did not load: ${tree.problems.map((p) => p.path).join(", ")}`);
  const workers = tree.workers.map((w) => w.id);
  const mailbox = tree.mailboxes.find((m) => ((m.declared.boards as string[] | undefined) ?? []).length > 0);
  if (mailbox === undefined) throw new Error("the Lab's tree holds no mailbox with a board, so no task has a run to trace");
  const boardRef = `${mailbox.id}.${(mailbox.declared.boards as string[])[0]}`;

  // The change leg b saves: a hand-off worker moved onto the flow another one is on.
  const handoff = tree.workers.filter((w) => typeof w.declared.handoff === "string");
  const moved = handoff.find((w) => handoff.some((o) => o.declared.flow !== w.declared.flow));
  const onto = handoff.find((o) => moved !== undefined && o.declared.flow !== moved.declared.flow);
  if (moved === undefined || onto === undefined) throw new Error("the Lab's tree has no two hand-off workers on different flows to move one between");
  const from = String(moved.declared.flow);
  const to = String(onto.declared.flow);

  const served = await serve(project, CONTROL !== "no-watch");
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    // ---- a: TEAMS ----------------------------------------------------------------
    await page.goto(`${served.origin}/roster`);
    const shown = await shownWorkers(page, CHANGE_WITHIN_MS);
    if (!same(shown, workers)) {
      const missing = workers.filter((w) => !shown.includes(w));
      const extra = shown.filter((w) => !workers.includes(w));
      failed("a:TEAMS equals the Lab's workers", `the sidebar draws [${sorted(shown).join(", ")}]; missing [${missing.join(", ")}], extra [${extra.join(", ")}]`);
    } else evidence.push(`TEAMS draws the tree's ${workers.length} workers [${sorted(workers).join(", ")}]`);

    // ---- a: Open trace ---------------------------------------------------------
    const rowsBody = await fetch(`${served.origin}/api/flows/sessions/${encodeURIComponent(mailbox.id)}/resources/${encodeURIComponent(boardRef)}?limit=200`).then((r) => r.json(), () => null);
    const rows = ((rowsBody?.items ?? []) as Array<{ clientData?: { id?: string; run?: { sessionId?: string } | null } }>).map((i) => i.clientData ?? {});
    const traced = rows.find((r) => typeof r.run?.sessionId === "string");
    if (traced === undefined) {
      failed("a:Open trace opens the Lab's session", `the store holds no task with a run on ${boardRef} (${rows.length} rows)`);
    } else {
      const session = traced.run!.sessionId!;
      await page.goto(`${served.origin}/tasks/${encodeURIComponent(boardRef)}/${encodeURIComponent(traced.id!)}/session`);
      const link = page.getByTestId("inspector-trace-link");
      const href = await link.getAttribute("href", { timeout: CHANGE_WITHIN_MS }).catch(() => null);
      if (href === null || !href.startsWith("http") || new URL(href).searchParams.get("session") !== session) {
        failed("a:Open trace opens the Lab's session", `the inspector's trace link is ${href ?? "absent"}, wanted the DevTool with ?session=${session}`);
      } else {
        const [opened] = await Promise.all([page.context().waitForEvent("page", { timeout: 10_000 }), link.click()]);
        const landed = await opened.locator(`button[title^="Session ID: ${session}"]`).waitFor({ timeout: CHANGE_WITHIN_MS }).then(() => true, () => false);
        if (!landed) failed("a:Open trace opens the Lab's session", `following Open trace (${href}) did not open session ${session} in the DevTool`);
        else evidence.push(`Open trace on ${traced.id} opened the DevTool at ${new URL(href).origin} on the run's session ${session}`);
        await opened.close();
      }
    }

    // ---- b: a saved change shows --------------------------------------------------
    await page.goto(`${served.origin}/roster`);
    const before = await waitForKind(page, moved.id, from, CHANGE_WITHIN_MS);
    if (!before.ok) {
      failed("b:the change shows", `precondition: the Roster draws ${moved.id} on ${before.last ?? "nothing"} before the change, the tree says ${from}`);
    } else {
      const workerFile = findWorkerFile(join(project, "lab", "workforce"), moved.id);
      const text = readFileSync(workerFile, "utf8");
      const edited = text.replace(new RegExp(`^flow:\\s*${from}\\s*$`, "m"), `flow: ${to}`);
      if (edited === text) throw new Error(`setup: ${workerFile} has no "flow: ${from}" line to change`);
      writeFileSync(workerFile, edited);
      const after = await waitForKind(page, moved.id, to, CHANGE_WITHIN_MS);
      if (!after.ok) failed("b:the change shows", `${CHANGE_WITHIN_MS / 1000} s after saving ${relative(project, workerFile)} (flow: ${from} → ${to}), the Roster still draws ${moved.id} on ${after.last ?? "nothing"}`);
      else evidence.push(`saving ${relative(project, workerFile)} (flow: ${from} → ${to}) showed on the open Roster after ${(after.after / 1000).toFixed(1)} s, no reload by the check`);
    }
    if (pageErrors.length > 0) evidence.push(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
  } finally {
    await browser.close();
    stopProcessGroup(served.child);
    await Promise.race([served.exited, sleep(10_000)]);
  }

  return { failures, evidence: evidence.join("; ") };
});

/** The `WORKER.md` of `seatId` (`<team>.<name>`) under a tree's `teams/<team>/workers/<name>/`. */
function findWorkerFile(tree: string, seatId: string): string {
  const [team, name] = seatId.split(".");
  const file = join(tree, "teams", team!, "workers", name!, "WORKER.md");
  if (!existsSync(file)) throw new Error(`setup: no WORKER.md for ${seatId} at ${file}`);
  return file;
}
