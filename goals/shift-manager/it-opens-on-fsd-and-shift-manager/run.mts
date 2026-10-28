/**
 * Goal check: the checkout's script opens the `fsd` profile on FSD and Shift
 * Manager, and with no Claude credential it refuses to start, naming what to set.
 *
 * Each leg starts the checkout's own script (`packages/shift-manager/scripts/checkout.mts`)
 * with no `--config`, as `pnpm shift-manager:dev` runs it, on pages built once into scratch
 * (`--assets`, so the script doesn't rebuild the checkout's). The only thing a
 * leg sets is the store location (a temp file), and in c it takes credentials away.
 *
 *   a  the projects a person sees: through the Lab's own routes, as the page's
 *      user, the organization's projects are exactly `fsd` and `shift-manager`,
 *      shared, naming this repository's remote, each brief naming its focus; and
 *      the user holds no private project. Needs a Claude credential (the
 *      default coder checks for one at start); spends no model.
 *   b  one item on each project, through the Shift Coordinator, as the page's
 *      user over the Lab's routes: each asks the coder to commit one file
 *      named with a stamp picked at run time. Both tasks settle `completed`;
 *      `git worktree list` in this checkout names both runs' places; each
 *      run's branch descends from `main` (and not from the checked-out branch,
 *      which must not be `main`), commits the file the item asked for, and
 *      holds no `SCRIPTED-RUN.md`. Needs a real model: the Shift Coordinator's
 *      key and a Claude credential. The checkout's worktrees and branches the
 *      leg made are removed after it, pass or fail.
 *   c  no credential (no ANTHROPIC_API_KEY, no CLAUDE_CODE_OAUTH_TOKEN, an empty
 *      home), as `start` and as `dev` (`--dev`) run it: the process exits
 *      non-zero before it listens, and its output names `ANTHROPIC_API_KEY`
 *      and `DEVFORCE_LAB_HARNESS=stub`.
 *
 * `GOAL_LEG=a,c` runs only those legs (default: all three). An empty or
 * unknown selection is refused, so no run passes by checking nothing.
 *
 * Controls:
 *   GOAL_CONTROL=silent-stub  `harness.mts` patched, in the process under test only,
 *                             to fall back to the scripted coder when there is no
 *                             account, saying nothing. Leg c must FAIL on
 *                             `c:exit-before-listening`, in both forms.
 *   GOAL_CONTROL=no-checkout  the profile patched, in the process under test only,
 *                             to open its Lab with no checkout mapping. Leg b must
 *                             FAIL on `b:worktrees-in-checkout`, with each run
 *                             refused by its remote and nothing cloned.
 *
 * Run:   pnpm tsx goals/shift-manager/it-opens-on-fsd-and-shift-manager/run.mts
 */
import { onClosed } from "../../lib/server.mts";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { goalTmpDir, intentFreeEnv, keysServing, modulePatchEnv, assertPatched, describePatches, runGoal, RUN_STAMP, REPO_ROOT, repoPath, type ModulePatch } from "../../lib/index.mts";
import { buildShiftManagerPages, devteamShiftCoordinatorModel, labApi, labRoutes, servedAddresses } from "../../lib/shift-manager.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const ALL_LEGS = ["a", "b", "c"] as const;
const LEGS = new Set((process.env.GOAL_LEG ?? ALL_LEGS.join(",")).split(",").map((l) => l.trim()).filter(Boolean));
if (LEGS.size === 0) throw new Error(`GOAL_LEG="${process.env.GOAL_LEG}" names no leg; use a comma-separated subset of ${ALL_LEGS.join(", ")}`);
for (const l of LEGS) if (!(ALL_LEGS as readonly string[]).includes(l)) throw new Error(`unknown leg "${l}" in GOAL_LEG; use a comma-separated subset of ${ALL_LEGS.join(", ")}`);
const SCRATCH = goalTmpDir("it-opens-on-fsd-and-shift-manager");
const SCRIPT = repoPath("packages", "shift-manager", "scripts", "checkout.mts");
const TSX = repoPath("node_modules", ".bin", "tsx");
const REPOSITORY = "https://github.com/fixpoint-labs/flow-state-dev.git";

/** The silent-stub control: no account falls back to the scripted coder, and says nothing. */
const SILENT_STUB: ModulePatch[] = [
  {
    module: "packages/shift-manager/teams/devteam/harness.mts",
    from: 'if \\(account\\.status !== "account"\\) throw new Error\\(refusalOf\\(account\\)\\);',
    to: 'if (account.status !== "account") return selectHarness("stub", stepMs);',
  },
];

/** The no-checkout control: the profile opens its Lab with no checkout mapping, its remotes as they are. */
const NO_CHECKOUT: ModulePatch[] = [
  {
    module: "packages/shift-manager/teams/devteam/fsd.fsdev.config.mts",
    from: "remotes: \\{ allow: \\[\\] \\}, checkouts: CHECKOUTS \\}",
    to: "remotes: { allow: [] } }",
  },
];

const CONTROLS = ["silent-stub", "no-checkout"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; this goal knows ${CONTROLS.join(", ")}`);

type Started = { log: () => string; exited: Promise<number | null>; origin?: string; stop: () => Promise<void> };

/**
 * Start the checkout's script with no `--config`, as `pnpm shift-manager:dev`
 * runs it, and wait until it serves or exits.
 * Resolves with the origin once its banner prints, or with none if it exits first.
 */
async function startScript(env: Record<string, string>, form: "start" | "dev" = "start", timeoutMs = 120_000): Promise<Started> {
  const cwd = mkdtempSync(join(SCRATCH, "cwd-"));
  const pagesArgs = form === "dev" ? ["--dev"] : ["--assets", pages!];
  const child = spawn(TSX, [SCRIPT, "--port", "0", "--no-open", ...pagesArgs], {
    cwd,
    env: { ...env, INIT_CWD: cwd },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let code: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => onClosed(child, (c) => resolve((code = c))));
  const stop = async () => {
    if (code === undefined) child.kill("SIGTERM");
    await exited;
  };
  for (const until = Date.now() + timeoutMs; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
    const served = servedAddresses(log);
    if (served !== undefined) return { log: () => log, exited, origin: served.origin, stop };
    if (code !== undefined) return { log: () => log, exited, stop };
  }
  await stop();
  throw new Error(`the script neither served nor exited in ${timeoutMs} ms. Log tail:\n${log.slice(-2000)}`);
}

/** A fresh store and nothing else changed: the environment a leg starts the script with. */
function legEnv(name: string, extra: Record<string, string> = {}): Record<string, string> {
  const dir = join(SCRATCH, `store-${name}`);
  mkdirSync(dir, { recursive: true });
  return intentFreeEnv(process.env, { FSD_STORE: join(dir, "fsd.sqlite"), GOAL_CONTROL: "", ...extra });
}

let pages: string | undefined;

/** The user the Lab handed its page, and their bearer: who a person is when they open it. */
async function pageUser(origin: string): Promise<{ userId: string; bearerToken?: string }> {
  const html = await (await fetch(origin)).text();
  const injected = /window\.__FSD_DEVTOOL_CONFIG__ = (\{.*?\});<\/script>/.exec(html)?.[1];
  if (injected === undefined) throw new Error("setup: the page was handed no user");
  return JSON.parse(injected) as { userId: string; bearerToken?: string };
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
const isAncestor = (ancestor: string, of: string) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, of], { cwd: REPO_ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
/** The checkout's worktrees: each one's real path and the branch it has checked out. */
function worktrees(): Array<{ path: string; branch?: string }> {
  return git(REPO_ROOT, "worktree", "list", "--porcelain")
    .split("\n\n")
    .map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1] ?? "", branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] }))
    .filter((w) => w.path !== "");
}

/** Leg b's two items: the project, and the file its run must commit. */
const ITEMS = [
  { id: "fsd", title: "FSD" },
  { id: "shift-manager", title: "Shift Manager" },
].map((p) => ({ ...p, file: `goal-scratch/${RUN_STAMP.replace(/[^A-Za-z0-9-]/g, "-")}-${p.id}.txt`, stamp: `${p.id} ${RUN_STAMP}` }));
/** How long one item may take: the Claude Code run's ten minutes, and the Shift Coordinator's turn. */
const ITEM_BUDGET_MS = 14 * 60_000;
const SETTLED = new Set(["completed", "errored", "failed", "cancelled"]);

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string) => failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  // Every leg starts the script on the built pages, so build them whichever legs run.
  pages = await buildShiftManagerPages(join(SCRATCH, "pages"));

  // ---- (a) the projects a person sees ------------------------------------
  if (LEGS.has("a")) {
    const started = await startScript(legEnv("a"));
    try {
      if (started.origin === undefined) {
        throw new Error(`setup: leg a needs a Claude credential (sign in, or set ANTHROPIC_API_KEY); the script exited:\n${started.log().slice(-1500)}`);
      }
      const user = await pageUser(started.origin);
      const api = labApi(started.origin, user.bearerToken);
      const roster = await api.call("POST", "/workforce-roster/sessions", { userId: user.userId });
      if (roster.status !== 201) throw new Error(`setup: no roster session: ${roster.status}`);
      const sessionId = String(roster.body.session.id);
      const manifest = await api.get(`/sessions/${encodeURIComponent(sessionId)}/manifest`);
      const declared = manifest.resources as Array<{ kind: string; ref: string; pattern: string; scope?: string }>;
      const at = (scope: string) => declared.find((r) => r.kind === "collection" && r.pattern === "projects/*" && r.scope === scope)?.ref;
      const shared = at("org") === undefined ? [] : await api.collection(sessionId, at("org")!);
      const own = at("user") === undefined ? [] : await api.collection(sessionId, at("user")!);
      const ids = shared.map((p) => String(p.id)).sort();
      if (JSON.stringify(ids) !== JSON.stringify(["fsd", "shift-manager"]) || own.length > 0) {
        note("a:exactly-fsd-and-shift-manager", `the person sees shared ${JSON.stringify(ids)} and ${own.length} private`);
      }
      for (const p of shared) {
        if (p.repository !== REPOSITORY) note("a:names-this-repository", `${p.id} names ${JSON.stringify(p.repository)}`);
      }
      const brief = (id: string) => String(shared.find((p) => p.id === id)?.brief ?? "");
      if (!/packages\//.test(brief("fsd")) || /packages\/shift-manager/.test(brief("fsd"))) note("a:briefs-name-their-focus", `fsd's brief: ${brief("fsd")}`);
      if (!/packages\/shift-manager/.test(brief("shift-manager"))) note("a:briefs-name-their-focus", `shift-manager's brief: ${brief("shift-manager")}`);
      const coderLine = started.log().split("\n").find((l) => l.startsWith("Coder:"));
      if (coderLine === undefined || !coderLine.includes("Claude Code")) note("a:start-line-names-the-coder", `start line: ${coderLine ?? "none"}`);
      evidence.push(`a: shared ${ids.join(", ")} on ${REPOSITORY}, none private; "${coderLine}"`);
    } finally {
      await started.stop();
    }
  }

  // ---- (b) one item on each project, in a worktree of this checkout -------
  if (LEGS.has("b")) {
    const keys = keysServing(devteamShiftCoordinatorModel());
    if (!keys.some((k) => process.env[k])) throw new Error(`setup: leg b needs the Shift Coordinator's model key (${keys.join(" or ")})`);
    const head = git(REPO_ROOT, "rev-parse", "--abbrev-ref", "HEAD");
    if (head === "main" || head === "HEAD") throw new Error(`setup: leg b needs this checkout on a named branch other than main, so a run cut from main is told apart from one cut from it; it is on ${head}`);
    const headCommit = git(REPO_ROOT, "rev-parse", "HEAD");
    const mainCommit = git(REPO_ROOT, "rev-parse", "main");
    if (headCommit === mainCommit) throw new Error(`setup: leg b needs ${head} to differ from main; both are at ${mainCommit}`);

    const env = legEnv("b");
    // The profile keeps its runs' places beside its store; by real path, as git lists worktrees.
    const runs = join(realpathSync(SCRATCH), "store-b", "fsd-runs");
    const ours = () => worktrees().filter((w) => w.path.startsWith(`${runs}${sep}`));
    const found: Array<{ task?: Record<string, any>; places: Array<{ path: string; branch?: string }> }> = [];
    const mark = join(SCRATCH, "no-checkout.mark");
    if (CONTROL === "no-checkout") {
      console.error(describePatches(NO_CHECKOUT, REPO_ROOT));
      Object.assign(env, modulePatchEnv(NO_CHECKOUT, REPO_ROOT, mark));
    }
    const branchesBefore = new Set(git(REPO_ROOT, "branch", "--format=%(refname:short)").split("\n"));
    const started = await startScript(env);
    try {
      if (started.origin === undefined) {
        throw new Error(`setup: leg b needs a Claude credential (sign in, or set ANTHROPIC_API_KEY); the script exited:\n${started.log().slice(-1500)}`);
      }
      if (CONTROL === "no-checkout") assertPatched(NO_CHECKOUT, REPO_ROOT, mark);
      const user = await pageUser(started.origin);
      const http = labRoutes(started.origin, { userId: user.userId, bearer: user.bearerToken ?? "" });
      // The coder's row, never the post: the post completes when the EM says it handed the
      // work over, before the coder has committed.
      const filedFor = async (conversation: string): Promise<Record<string, any> | undefined> => {
        const coders = (tasks: Array<Record<string, any>>) => tasks.find((t) => t.assignee === "eng.coder");
        const own = coders((await http.act("coordinator", conversation, "listTasks_tasks", {})).output?.tasks ?? []);
        if (own !== undefined) return own;
        for (const em of (await http.sessions()).filter((s) => s.flowId === "em" && s.parentSessionId === conversation)) {
          const row = coders((await http.act("em", em.id, "listTasks_tasks", {})).output?.tasks ?? []);
          if (row !== undefined) return row;
        }
        return undefined;
      };
      for (const item of ITEMS) {
        const before = new Set(ours().map((w) => w.path));
        // A conversation with the Shift Coordinator, as the page opens one, and the person's ask.
        const sessionId = `goal-b-${item.id}-${RUN_STAMP}`;
        const opened = await http.call("POST", "/coordinator/sessions", { userId: user.userId, sessionId, state: { workerId: "shift-coordinator" } });
        if (opened.status !== 201) throw new Error(`setup: no conversation with the Shift Coordinator: ${opened.status} ${JSON.stringify(opened.body)}`);
        const ask =
          `On ${item.title} (the shared project "${item.id}"), have the coder create the file ${item.file} ` +
          `containing exactly the line "${item.stamp}", and commit it on its branch. Nothing else.`;
        const turn = await http.act("coordinator", sessionId, "respond", { message: ask });
        if (turn.error !== undefined) note(`b:${item.id}:asked`, `the Shift Coordinator's turn failed: ${turn.error}`);
        let task: Record<string, any> | undefined;
        for (const until = Date.now() + ITEM_BUDGET_MS; Date.now() < until; await new Promise((r) => setTimeout(r, 2_000))) {
          task = await filedFor(sessionId);
          if (task !== undefined && SETTLED.has(task.status)) break;
        }
        const said = JSON.stringify(task ?? null);
        if (task?.status !== "completed") note(`b:${item.id}:completed`, `the task is ${task === undefined ? "never filed" : `${task.status}: ${said.slice(0, 600)}`}`);
        found.push({ task, places: ours().filter((w) => !before.has(w.path)) });
        if (CONTROL === "no-checkout") {
          // The control's own evidence: refused by name, and nothing fetched.
          // A board's row says it errored, not why: the why is its run's recorded answer.
          const run = task?.run?.sessionId === undefined ? [] : await http.requests(String(task.run.sessionId));
          const why = `${said} ${JSON.stringify(run)}`;
          if (!why.includes("remote-not-allowed")) note(`b:${item.id}:refused-by-name`, `under the control the task is ${why.slice(0, 600)}`);
          const clones = join(runs, ".clones");
          if (existsSync(clones) && readdirSync(clones).length > 0) note(`b:${item.id}:nothing-cloned`, `${clones} holds ${readdirSync(clones).join(", ")}`);
        }
      }
      // One new place per item, each a worktree of this checkout on a branch of its own.
      if (found.some((f) => f.places.length !== 1 || f.places[0]!.branch === undefined)) {
        note(
          "b:worktrees-in-checkout",
          `git worktree list in ${REPO_ROOT} names ${found.map((f, i) => `${f.places.length} new place(s) for ${ITEMS[i]!.id}`).join(" and ")} under ${runs}`,
        );
      }
      for (const [i, item] of ITEMS.entries()) {
        const place = found[i]?.places.length === 1 ? found[i]!.places[0]! : undefined;
        const branch = place?.branch;
        if (place === undefined || branch === undefined) continue;
        if (!isAncestor(mainCommit, branch) || isAncestor(headCommit, branch)) {
          note(`b:${item.id}:from-main`, `${branch} ${isAncestor(headCommit, branch) ? `descends from the checked-out ${head}` : "does not descend from main"}`);
        }
        const changed = git(REPO_ROOT, "diff", "--name-only", `${mainCommit}...${branch}`).split("\n").filter(Boolean);
        let body = "";
        try {
          body = git(REPO_ROOT, "show", `${branch}:${item.file}`);
        } catch {
          body = "";
        }
        if (!changed.includes(item.file) || !body.includes(item.stamp)) note(`b:${item.id}:commits-the-file`, `${branch} changes ${JSON.stringify(changed)}; ${item.file} reads ${JSON.stringify(body.slice(0, 200))}`);
        if (changed.includes("SCRIPTED-RUN.md")) note(`b:${item.id}:not-the-script`, `${branch} commits SCRIPTED-RUN.md: the scripted coder ran`);
        evidence.push(`b (${item.id}): task ${found[i]!.task?.id} completed in ${place.path} on ${branch}, from main, committing ${item.file}`);
      }
    } finally {
      await started.stop();
      // The leg writes into this checkout: remove its worktrees and branches, pass or fail.
      const made = ours();
      for (const w of made) execFileSync("git", ["worktree", "remove", "--force", w.path], { cwd: REPO_ROOT, stdio: "pipe" });
      git(REPO_ROOT, "worktree", "prune");
      for (const w of made) if (w.branch !== undefined && !branchesBefore.has(w.branch)) git(REPO_ROOT, "branch", "-D", w.branch);
      if (made.length > 0) console.error(`removed ${made.length} worktree(s) and their branches from ${REPO_ROOT}`);
    }
  }

  // ---- (c) no credential: refused before it listens, as `start` and as `dev` --
  if (LEGS.has("c")) {
    for (const form of ["start", "dev"] as const) {
      const home = mkdtempSync(join(SCRATCH, "empty-home-"));
      const mark = join(SCRATCH, `silent-stub-${form}.mark`);
      const env = legEnv(`c-${form}`, { HOME: home, ...(CONTROL === "silent-stub" ? modulePatchEnv(SILENT_STUB, REPO_ROOT, mark) : {}) });
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      if (CONTROL === "silent-stub" && form === "start") console.error(describePatches(SILENT_STUB, REPO_ROOT));
      const started = await startScript(env, form);
      const code = started.origin === undefined ? await started.exited : undefined;
      await started.stop();
      if (CONTROL === "silent-stub") assertPatched(SILENT_STUB, REPO_ROOT, mark);
      const log = started.log();
      if (started.origin !== undefined || code === 0) {
        note(`c:exit-before-listening (${form})`, started.origin !== undefined ? `it listened at ${started.origin}` : "it exited 0");
      }
      const missing = ["ANTHROPIC_API_KEY", "DEVFORCE_LAB_HARNESS=stub"].filter((v) => !log.includes(v));
      if (missing.length > 0) note(`c:names-the-variable (${form})`, `the output does not name ${missing.join(" or ")}`);
      const said = log.split("\n").find((l) => l.includes("ANTHROPIC_API_KEY")) ?? "";
      evidence.push(`c (${form}): exited ${code} before listening: ${said.trim().slice(0, 200)}`);
    }
  }

  return { failures, evidence: evidence.join(" · ") };
});
