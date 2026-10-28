/**
 * Goal check: on a fresh open of `pnpm shift-manager:dev`, with no config
 * edited, a person picks an item on FSD and one on Shift Manager, and Claude
 * Code works each in a worktree of their checkout, with Linear in reach. See
 * goal.md for the contract.
 *
 * The command is started as a person types it, from the checkout's root, on
 * the store it ships with (moved aside first, and put back after, so the open
 * is fresh). Chromium drives the page as the Lab's owner:
 *
 *   key  Settings: the person sets their Linear key in the `linear` row.
 *   a    the chief of staff is asked, in its composer, to have the coder read
 *        a held-out Linear issue named by its identifier only, on FSD.
 *   b    while a's run works, the same composer asks for one file, stamped
 *        with this run's stamp, committed on Shift Manager.
 *
 * What happened is read from git and from the Lab's routes, never from the
 * page: two new worktrees of the checkout, under the profile's runs folder,
 * both present while both tasks are unsettled; each branch in the checkout;
 * both tasks `completed`; a's run holds a `mcp__linear__` tool call and its
 * answer carries the title Linear's API gives; b's branch commits the file
 * with the stamp. Neither branch carries the DevTeam demo brief's work
 * (`src/greeting.js`, its commit marker).
 *
 * Controls (`GOAL_CONTROL=list`), each must FAIL `a:title`:
 *   no-linear  FSD's MCP servers cleared through the projects flow before asking
 *   no-key     the Settings step skipped (and `LINEAR_MCP_API_KEY` is never set)
 * Today's `main` before the epic: `GOAL_CHECKOUT=<a checkout at that commit>`
 * runs the same legs against it; both legs must FAIL.
 *
 * Needs: LINEAR_API_KEY (the held-out issue, and the key the person pastes),
 * a Claude Code credential (sign-in or ANTHROPIC_API_KEY), the chief of
 * staff's and the EM's model keys, git, Chromium.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/a-fresh-open-works-fsd-and-shift-manager/run.mts
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { goalTmpDir, intentFreeEnv, REPO_ROOT, RUN_STAMP, runGoal } from "../../lib/index.mts";
import { labRoutes, servedAddresses, workerOf } from "../../lib/shift-manager.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { stopProcessGroup } from "../../lib/server.mts";

const SLUG = "a-fresh-open-works-fsd-and-shift-manager";
const CONTROLS = ["no-linear", "no-key"] as const;
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
const KEY = process.env.LINEAR_API_KEY ?? "";
if (KEY === "") {
  console.error("LINEAR_API_KEY is not set: the check picks its held-out issue with it, and it is the key the person pastes on Settings.");
  process.exit(2);
}

/** The checkout the command runs in: this one, or the one `GOAL_CHECKOUT` names (today's-main control). */
const CHECKOUT = realpathSync(process.env.GOAL_CHECKOUT ?? REPO_ROOT);
const STORE = join(CHECKOUT, "packages", "shift-manager", ".fsdev", "fsd.sqlite");
/** The store's files: the database and its WAL-mode sidecars, which move as one. */
const SQLITE_FILES = ["", "-wal", "-shm"];
const RUNS = join(CHECKOUT, "packages", "shift-manager", ".fsdev", "fsd-runs");
const SCRATCH = goalTmpDir(SLUG);
/** How long both items may take: Claude Code's ten-minute run, the turns before it, and margin. */
const BUDGET_MS = 20 * 60_000;
const SETTLED = new Set(["completed", "errored", "failed", "cancelled"]);
/** DevTeam's test markers: its demo feature brief's and its commit-style skill's. Neither belongs in this repository's commits. */
const DEMO_MARKERS = ["FEATURE-BRIEF-E61B8", "COMMIT-STYLE-F70C4"];
/** The worker the dev profile's coding rows are filed for. */
const CODER = "eng.coder";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const git = (...args: string[]) => execFileSync("git", args, { cwd: CHECKOUT, stdio: "pipe", encoding: "utf8" }).trim();

/** Linear's GraphQL API, with the key as a bare Authorization header. */
async function linear<T>(query: string): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!response.ok || body.data === undefined) throw new Error(`Linear answered ${response.status}: ${JSON.stringify(body.errors ?? null).slice(0, 300)}`);
  return body.data;
}

/** Whether `text` appears anywhere in the checkout's HEAD, as a fixed string, any case. */
function mentioned(text: string): boolean {
  try {
    execFileSync("git", ["grep", "-q", "-i", "-F", "-e", text, "HEAD", "--"], { cwd: CHECKOUT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** A held-out issue: one the checkout never mentions, by identifier or title. Read only. */
async function heldOutIssue(): Promise<{ identifier: string; title: string }> {
  const { issues } = await linear<{ issues: { nodes: Array<{ identifier: string; title: string }> } }>(
    "query { issues(first: 100, orderBy: updatedAt) { nodes { identifier title } } }",
  );
  for (const issue of issues.nodes.filter((i) => i.title.trim().length >= 12).sort(() => Math.random() - 0.5)) {
    if (!mentioned(issue.identifier) && !mentioned(issue.title)) return issue;
  }
  throw new Error(`none of Linear's ${issues.nodes.length} most recently updated issues is held out from this checkout`);
}

/** The checkout's worktrees under the profile's runs folder: each one's path and branch. */
function runWorktrees(): Array<{ path: string; branch?: string }> {
  return git("worktree", "list", "--porcelain")
    .split("\n\n")
    .map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1] ?? "", branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] }))
    .filter((w) => w.path.startsWith(`${RUNS}${sep}`));
}

/** Start the command as a person types it, in its own process group so a stop takes Vite with it. */
async function startCommand(env: Record<string, string>) {
  const child = spawn("pnpm", ["shift-manager:dev", "--port", "0", "--no-open"], { cwd: CHECKOUT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let code: number | null | undefined;
  const exited = new Promise<void>((resolve) => child.on("close", (c) => ((code = c), resolve())));
  const stop = async () => {
    stopProcessGroup(child);
    await Promise.race([exited, sleep(10_000)]);
    stopProcessGroup(child, "SIGKILL");
  };
  for (const until = Date.now() + 180_000; Date.now() < until; await sleep(250)) {
    const served = servedAddresses(log);
    if (served !== undefined) return { origin: served.origin, log: () => log, stop };
    if (code !== undefined) break;
  }
  await stop();
  throw new Error(`setup: \`pnpm shift-manager:dev\` never served. Log tail:\n${log.slice(-2500)}`);
}

await runGoal(async (failures) => {
  const note = (assertion: string, why: string) => failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion}: ${why}`);
  const evidence: string[] = [];
  mkdirSync(SCRATCH, { recursive: true });

  const before = new Set(runWorktrees().map((w) => w.path));
  const branchesBefore = new Set(git("branch", "--format=%(refname:short)").split("\n"));
  // Every commit a run's branch could be cut from: the checkout's HEAD, `main` and its upstream (the profile's base is
  // `main`, and the host takes the newer of it and its upstream). A run's own commits are the branch's, less all of these.
  const bases = ["HEAD", "main", "main@{upstream}"].flatMap((ref) => {
    try {
      return [git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`)];
    } catch {
      return [];
    }
  });
  const own = (branch: string, ...format: string[]) => git("log", ...format, branch, "--not", ...bases);

  // A fresh open: the shipped store (the database and its WAL sidecars) moved aside, put back after.
  const kept = SQLITE_FILES.map((suffix) => `${STORE}${suffix}`).filter((path) => existsSync(path));
  for (const path of kept) renameSync(path, `${path}.goal-${process.pid}`);
  let started: Awaited<ReturnType<typeof startCommand>> | undefined;
  let opened: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    // The person's shell: their Claude credential and model keys, and no Linear key. They paste theirs on Settings.
    const env = intentFreeEnv(process.env, { GOAL_CONTROL: "" });
    delete env.LINEAR_MCP_API_KEY;
    delete env.LINEAR_API_KEY;
    delete env.FSD_STORE;

    const issue = await heldOutIssue();
    console.log(`held-out issue: ${issue.identifier}${CONTROL === "" ? "" : ` (control ${CONTROL})`}`);
    const stamp = `shift-manager ${RUN_STAMP}`;
    const file = `goal-scratch/${RUN_STAMP.replace(/[^A-Za-z0-9-]/g, "-")}-shift-manager.txt`;
    const askA = `On FSD: have the coder read Linear issue ${issue.identifier} and answer with its title, exactly as Linear has it. Change no files.`;
    const askB = `On Shift Manager: have the coder create the file ${file} containing exactly the line "${stamp}", and commit it on its branch. Nothing else.`;

    const served = await startCommand(env);
    started = served;
    const browser = await launchChromium();
    opened = browser;
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(served.origin);
    const config = await page.evaluate(() => (window as unknown as { __FSD_DEVTOOL_CONFIG__?: { userId: string; bearerToken?: string } }).__FSD_DEVTOOL_CONFIG__);
    if (config === undefined) throw new Error("setup: the page was handed no user");
    const http = labRoutes(served.origin, { userId: config.userId, bearer: config.bearerToken ?? "" });
    console.log(served.log().split("\n").find((l) => l.startsWith("Coder:")) ?? "no Coder: line");

    // ---- key: the person's Linear key, on Settings ----------------------------
    if (CONTROL !== "no-key") {
      try {
        await page.goto(`${served.origin}/settings`);
        const row = page.locator('[data-testid="mcp-key"][data-server="linear"]');
        await row.getByTestId("mcp-key-input").fill(KEY);
        await row.getByTestId("mcp-key-save").click();
        await page.locator('[data-testid="mcp-key"][data-server="linear"][data-set="true"]').waitFor();
        evidence.push("key: set on Settings");
      } catch (error) {
        note("key:set-on-settings", `the Settings page took no Linear key: ${String(error).split("\n")[0]}`);
      }
      await page.screenshot({ path: join(SCRATCH, "settings.png") });
    }
    if (CONTROL === "no-linear") {
      const off = await http.act("projects", "devforce-projects", "setMcpServers", { project: { visibility: "shared", id: "fsd" }, mcpServers: [] });
      if (off.error !== undefined) throw new Error(`setup: clearing FSD's MCP servers failed: ${off.error}`);
    }

    // ---- watch both tasks from before the first ask until they settle -------
    // Watching starts before a is asked, so an overlap while b's turn is still running is seen.
    let conversation: { id: string } | undefined;
    /** Every row the conversation filed: on its own board, or on the boards of the EM sessions under it. */
    const filed = async (): Promise<Array<Record<string, any>>> => {
      conversation ??= (await http.sessions()).filter((s) => workerOf(s) === "chief-of-staff" && s.parentSessionId == null).sort((x, y) => y.createdAt - x.createdAt)[0];
      if (conversation === undefined) return [];
      const rows = ((await http.act("coordinator", conversation.id, "listTasks_tasks", {})).output?.tasks ?? []) as Array<Record<string, any>>;
      for (const em of (await http.sessions()).filter((s) => s.flowId === "em" && s.parentSessionId === conversation!.id)) {
        rows.push(...(((await http.act("em", em.id, "listTasks_tasks", {})).output?.tasks ?? []) as Array<Record<string, any>>));
      }
      return rows;
    };
    const legOf = (row: Record<string, any>) => {
      const goal = String(row.goal ?? "");
      return goal.includes(issue.identifier) ? "a" : goal.includes(RUN_STAMP) ? "b" : undefined;
    };
    let rows: Record<string, Record<string, any>> = {};
    let together = false;
    const watching = (async () => {
      for (const until = Date.now() + BUDGET_MS; Date.now() < until; await sleep(5_000)) {
        // The coder's row, not the routed task handed to the EM on the way, which ends once the coder's task does.
        rows = Object.fromEntries((await filed()).filter((r) => r.assignee === CODER).map((r) => [legOf(r), r]).filter(([leg]) => leg !== undefined));
        const live = runWorktrees().filter((w) => !before.has(w.path));
        if (rows.a !== undefined && rows.b !== undefined && !SETTLED.has(rows.a.status) && !SETTLED.has(rows.b.status) && live.length >= 2) together = true;
        if (rows.a !== undefined && rows.b !== undefined && SETTLED.has(rows.a.status) && SETTLED.has(rows.b.status)) break;
      }
    })();

    // ---- a, then b while a works: two asks in the chief of staff's composer ---
    await page.goto(served.origin);
    for (const [leg, ask] of [
      ["a", askA],
      ["b", askB],
    ] as const) {
      try {
        const input = page.getByTestId("cos-composer-input");
        await input.fill(ask);
        await page.getByTestId("cos-composer-send").click();
        await page.waitForFunction(() => document.querySelector("[data-testid=cos-composer-status]")?.getAttribute("data-state") === "delivered", undefined, { timeout: 180_000 });
      } catch (error) {
        note(`${leg}:asked`, `the composer never read delivered: ${String(error).split("\n")[0]}`);
      }
    }
    await page.screenshot({ path: join(SCRATCH, "asked.png") });
    await watching;
    await page.screenshot({ path: join(SCRATCH, "settled.png") });

    // ---- grade --------------------------------------------------------------
    for (const [leg, row] of Object.entries(rows)) console.log(`${leg}'s task: ${JSON.stringify(row).slice(0, 1500)}`);
    for (const [leg, row] of Object.entries(rows)) {
      if (row.status === "completed" || row.run?.sessionId === undefined) continue;
      console.log(`${leg}'s run ended ${row.status}: ${JSON.stringify(await http.requests(String(row.run.sessionId))).slice(0, 2000)}`);
    }
    for (const leg of ["a", "b"]) {
      const row = rows[leg];
      if (row?.status !== "completed") note(`${leg}:completed`, row === undefined ? "no task was filed for it" : `the task is ${row.status}: ${JSON.stringify(row).slice(0, 500)}`);
    }
    const made = runWorktrees().filter((w) => !before.has(w.path));
    const commits = (branch: string) => own(branch, "--name-only", "--format=").split("\n").filter(Boolean);
    const placeB = made.find((w) => w.branch !== undefined && commits(w.branch).includes(file));
    const placeA = made.find((w) => w !== placeB);
    if (made.length !== 2 || made.some((w) => w.branch === undefined)) {
      note("worktrees-in-checkout", `git worktree list in ${CHECKOUT} names ${made.length} new place(s) under ${RUNS}: ${JSON.stringify(made)}`);
    }
    if (!together) note("b:while-a-works", "no poll saw both tasks unsettled with both worktrees present");
    const branches = new Set(git("branch", "--format=%(refname:short)").split("\n"));
    for (const [leg, place] of [
      ["a", placeA],
      ["b", placeB],
    ] as const) {
      if (place?.branch === undefined) {
        note(`${leg}:worktree`, "no worktree of the checkout is this leg's");
        continue;
      }
      if (!branches.has(place.branch)) note(`${leg}:branch-in-checkout`, `${place.branch} is not in the checkout's branches`);
      const messages = own(place.branch, "--format=%B");
      console.log(`${leg}'s branch ${place.branch}:\n${own(place.branch, "--format=%h %s", "--stat", "-5")}`);
      if (DEMO_MARKERS.some((m) => messages.includes(m)) || commits(place.branch).some((f) => f.endsWith("greeting.js"))) {
        note(`${leg}:no-demo-brief`, `${place.branch} carries DevTeam's test fixtures (greeting.js or one of ${DEMO_MARKERS.join(", ")})`);
      }
      if (leg === "a" && own(place.branch, "--format=%h") !== "") note("a:changes-nothing", `${place.branch} carries commits, and a was asked to change no files`);
      evidence.push(`${leg}: ${place.path} on ${place.branch}`);
    }
    if (placeB?.branch !== undefined) {
      let body = "";
      try {
        body = git("show", `${placeB.branch}:${file}`);
      } catch {
        body = "";
      }
      if (body !== stamp) note("b:commits-the-file", `${file} on ${placeB.branch} reads ${JSON.stringify(body.slice(0, 200))}`);
    } else {
      note("b:commits-the-file", `no new branch commits ${file}`);
    }

    // a's run: a Linear tool call in its session, and the title in its answer.
    const runOf = rows.a?.run as { sessionId?: string; requestId?: string } | undefined;
    const items = runOf?.sessionId === undefined ? [] : await http.items(runOf.sessionId, "");
    const linearCalls = items.filter((i) => String(i.toolCall?.name ?? "").startsWith("mcp__linear__"));
    const requests = runOf?.sessionId === undefined ? [] : await http.requests(runOf.sessionId);
    const answer = String(requests.find((r) => r.id === runOf?.requestId)?.result?.output?.answer ?? JSON.stringify(rows.a?.result ?? rows.a?.answer ?? ""));
    console.log(`a's answer: ${answer.slice(0, 400)}`);
    if (linearCalls.length === 0) note("a:linear-call", "a's run session holds no mcp__linear__ tool call");
    if (!normal(answer).includes(normal(issue.title))) note("a:title", `a's answer does not carry ${issue.identifier}'s title as Linear gives it`);
    if (/\bgreet\(/.test(answer)) note("a:no-demo-brief", "a's answer talks about the demo brief's greet()");
    if (pageErrors.length > 0) note("page", `the page threw: ${pageErrors.slice(0, 3).join(" | ")}`);
    evidence.push(`a: ${linearCalls.length} mcp__linear__ call(s); the answer carries ${issue.identifier}'s title`, "both tasks completed, unsettled together");
  } finally {
    await opened?.close();
    if (started !== undefined) {
      await started.stop();
      writeFileSync(join(SCRATCH, "server.log"), started.log());
      console.error(`the command's output: ${join(SCRATCH, "server.log")}`);
    }
    // The run writes into the checkout: remove its worktrees and branches, pass or fail; put the store back.
    const made = runWorktrees().filter((w) => !before.has(w.path));
    for (const w of made) execFileSync("git", ["worktree", "remove", "--force", w.path], { cwd: CHECKOUT, stdio: "pipe" });
    git("worktree", "prune");
    for (const w of made) if (w.branch !== undefined && !branchesBefore.has(w.branch)) git("branch", "-D", w.branch);
    for (const suffix of SQLITE_FILES) rmSync(`${STORE}${suffix}`, { force: true });
    for (const path of kept) renameSync(`${path}.goal-${process.pid}`, path);
    if (made.length > 0) console.error(`removed ${made.length} worktree(s) and their branches from ${CHECKOUT}`);
  }
  return { failures, evidence: evidence.join(" · ") };
});
