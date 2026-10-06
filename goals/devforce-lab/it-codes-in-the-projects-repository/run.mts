/**
 * Goal check — a coding run works in its project's repository, or on its
 * project's files, and what it keeps is saved to the project.
 *
 * The DevTeam lab, opened as its profile is served: the coder kind's manager
 * runs on a workspace host whose source is `projectWorkspace` on the feature
 * mailbox's board, and the host may reach `file://` remotes only. The harness
 * is the lab's scripted stub; what is graded is where a run's files came from
 * and where they went, read off git, the run's directory and the
 * organization's storage. Rows are filed through the EM seat and run by its
 * drain, exactly as the other checks run them. Which project holds the board's
 * workstream is moved between legs with the project writes, as a person would.
 *
 * Legs:
 *
 *   a  storefront names a bare repository holding marker A. Its run's branch
 *      holds marker A and the run's commit; the note the run wrote in
 *      `project/` is in `project-files/storefront/` and in neither the
 *      branch nor `git status`; nothing from the checkout reached the files.
 *   b  sandbox names no repository. Its first run starts in an empty
 *      `workspace/`; the file it writes is in `project-files/sandbox/`; its
 *      second run's `workspace/` holds that file; a run in platform does not.
 *   c  platform names a remote the host does not allow. The row is refused
 *      naming the remote, the harness never runs, and nothing is cloned.
 *
 * Controls:
 *
 *   fixed-source   the manager on the lab's one fixed repository, as before.
 *                  Must FAIL at `a:marker`.
 *   no-sync-back   the host saves nothing back. Must FAIL at
 *                  `b:second-run-sees-file`.
 *
 * `GOAL_CONTROL=list` prints them.
 *
 * Run: pnpm tsx goals/devforce-lab/it-codes-in-the-projects-repository/run.mts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { hashContent } from "@flow-state-dev/workspace";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";
import { harnessStub, type StubRun } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { openLab, type Lab, type OpenLabOptions } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createNotifyLog } from "../../../packages/shift-manager/teams/devteam/notify.mts";
import { PHASE } from "../../../packages/shift-manager/teams/devteam/phase.mts";
import { BASE_REF, commitAll, createBareRemote, createScratchRepo } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["fixed-source", "no-sync-back"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

interface Fixture {
  marker: { path: string };
  note: { path: string; body: string };
  code: { path: string; body: string };
  sandboxFile: { path: string; body: string };
  disallowedRemote: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);

/** The seat the board's `coder` assignee is addressed to, and the seat that files and drains. */
const CODER_SEAT = "eng.coder";
const EM_SEAT = "eng.em";
/** The rows, one per run. The issue slug is what the stub reads off the prompt. */
const ISSUE = {
  storefront: "storefront-note",
  sandboxFirst: "sandbox-first",
  sandboxSecond: "sandbox-second",
  platform: "platform-check",
  refused: "platform-remote",
} as const;
const SETTLE_BUDGET_MS = 60_000;
const SETTLED = new Set(["completed", "errored", "failed", "cancelled"]);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What one run was handed: where it worked, and every file there (path → contents) when it started. */
interface SeenRun {
  cwd: string;
  started: Record<string, string>;
}
const seen = new Map<string, SeenRun>();

/** Every file under `dir`, recursively, as relative path → contents. Git's and the manager's own directories are not the run's files. */
function filesIn(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (prefix === "" && (entry === ".git" || entry === ".fsdev")) continue;
    const full = join(dir, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) Object.assign(out, filesIn(full, rel));
    else out[rel] = readFileSync(full, "utf8");
  }
  return out;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/**
 * What each run does. It works where the manager put it and names no folder
 * of its own: a repository run writes code in its checkout and commits it, and
 * a note in `project/` beside it; a run with no repository writes in its
 * working directory.
 */
function duringRun(run: StubRun): void {
  const issue = /^Row ([^,\s]+),/m.exec(run.prompt)?.[1] ?? "";
  seen.set(issue, { cwd: run.cwd, started: filesIn(run.cwd) });
  if (issue === ISSUE.storefront) {
    write(join(run.cwd, fixture.code.path), fixture.code.body);
    write(join(run.cwd, "..", "project", fixture.note.path), fixture.note.body);
    commitAll(run.cwd, "storefront run: add the greeting");
  } else if (issue === ISSUE.sandboxFirst) {
    write(join(run.cwd, fixture.sandboxFile.path), fixture.sandboxFile.body);
  } else {
    // Every other run leaves a file of its own, so it settles on its own work.
    write(join(run.cwd, `${issue}.txt`), `${issue}\n`);
    if (existsSync(join(run.cwd, ".git"))) commitAll(run.cwd, `${issue}: a file of its own`);
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

/** File one row through the EM seat, then drain until it settles. */
async function runRow(lab: Lab, issue: string): Promise<Task | undefined> {
  const filed = await lab.file(EM_SEAT, { issue, goal: `Run ${issue} for the project that holds this workstream.`, maxAttempts: 1 });
  if (filed.error !== undefined) throw new Error(`filing ${issue} was refused — ${filed.error}`);
  const taskId = harnessTaskId(issue, PHASE);
  const deadline = Date.now() + SETTLE_BUDGET_MS;
  let row: Task | undefined;
  while (Date.now() < deadline) {
    row = await lab.row(taskId);
    if (row !== undefined && SETTLED.has(row.status)) return row;
    if (row === undefined || row.status === "pending") await lab.drain(EM_SEAT);
    await sleep(200);
  }
  return row;
}

/** Hand the board's workstream to one project, as its members would. */
async function moveWorkstream(lab: Lab, from: string, to: string): Promise<void> {
  for (const [projectId, workstreams] of [
    [from, []],
    [to, ["eng.feature"]],
  ] as const) {
    const done = await lab.projectAct!("setWorkstreams", { projectId, workstreams });
    if (done.error !== undefined) throw new Error(`setWorkstreams ${projectId} was refused — ${done.error}`);
  }
}

/** The organization's stored project files, as `<projectId>/<path>` → content hash. */
async function storedFiles(lab: Lab): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const [key, state] of Object.entries(await lab.stored("org", ""))) {
    const at = key.indexOf("project-files/");
    if (at < 0) continue;
    out[key.slice(at + "project-files/".length)] = (state as { hash?: string | null }).hash ?? null;
  }
  return out;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const note = (assertion: string, why: string): void => {
    failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  };

  // ---- the input: a bare repository holding marker A ----------------------
  const markerToken = `marker A ${globalThis.crypto.randomUUID()}\n`;
  const remoteA = createBareRemote("projects-repo-a", { seed: { [fixture.marker.path]: markerToken } });
  const root = mkdtempSync(join(tmpdir(), "devforce-lab-projects-repo-places-"));
  // The control: the lab's one fixed repository, which holds no marker.
  const fixed = CONTROL === "fixed-source" ? createScratchRepo("projects-repo-fixed") : undefined;
  const workspace: OpenLabOptions["workspace"] =
    fixed === undefined ? { root, remotes: { allow: ["file"] } } : { root: fixed.root, sourceRepo: fixed.sourceRepo, baseRef: BASE_REF };

  const stub = harnessStub({ duringRun });
  const lab = await openLab({
    stores: inMemoryStores(),
    harness: stub.slot,
    workspace,
    coderSeatId: CODER_SEAT,
    logger: silentLogger,
    mailboxes: { addresses: { [EM_SEAT]: EM_SEAT }, log: createNotifyLog() },
    inventory: true,
    projects: [
      { id: "storefront", title: "Storefront", workstreams: ["eng.feature"], repository: remoteA.url },
      { id: "sandbox", title: "Sandbox" },
      { id: "platform", title: "Platform" },
    ],
    ...(CONTROL === "no-sync-back" ? { saveNothing: true } : {}),
  });

  try {
    // ---- (a) storefront: its repository, its notes ------------------------
    const a = await runRow(lab, ISSUE.storefront);
    const aRun = seen.get(ISSUE.storefront);
    if (a?.status !== "completed" || aRun === undefined) {
      note("a:ran", `the storefront row ended ${a?.status ?? "unfiled"} and the harness ${aRun === undefined ? "never ran" : "ran"}`);
    } else {
      const branch = git(aRun.cwd, "rev-parse", "--abbrev-ref", "HEAD");
      let markerOnBranch = "";
      try {
        markerOnBranch = git(aRun.cwd, "show", `${branch}:${fixture.marker.path}`);
      } catch {
        // Absent from the branch.
      }
      if (`${markerOnBranch}\n` !== markerToken) {
        note("a:marker", `branch "${branch}" does not hold ${fixture.marker.path} with marker A: it was not cut from storefront's repository`);
      }
      const subjects = git(aRun.cwd, "log", "--format=%s", branch);
      const tracked = git(aRun.cwd, "ls-tree", "-r", "--name-only", branch).split("\n");
      if (!subjects.includes("storefront run: add the greeting") || !tracked.includes(fixture.code.path)) {
        note("a:commit", `branch "${branch}" does not carry the run's commit of ${fixture.code.path}`);
      }
      const status = git(aRun.cwd, "status", "--porcelain", "--untracked-files=all");
      if (status !== "" || tracked.includes(fixture.note.path)) {
        note("a:note-not-in-git", `the run's note shows in git (status: ${JSON.stringify(status)})`);
      }
      const stored = await storedFiles(lab);
      if (stored[`storefront/${fixture.note.path}`] !== hashContent(fixture.note.body)) {
        note("a:note-saved", `project-files/storefront/${fixture.note.path} holds ${JSON.stringify(stored[`storefront/${fixture.note.path}`] ?? "nothing")}, not the note the run wrote`);
      }
      const leaked = Object.keys(stored).filter((key) => key.endsWith(fixture.code.path));
      if (leaked.length > 0) note("a:checkout-not-in-files", `the checkout's ${fixture.code.path} reached the project's files: ${leaked.join(", ")}`);
      if (failures.length === 0) {
        evidence.push(
          `a: branch "${branch}" holds marker A and "storefront run: add the greeting"; the note is in ` +
            `project-files/storefront/${fixture.note.path} and git status is clean`,
        );
      }
    }

    // ---- (b) sandbox: no repository, the project's files ------------------
    await moveWorkstream(lab, "storefront", "sandbox");
    const b1 = await runRow(lab, ISSUE.sandboxFirst);
    const b1Run = seen.get(ISSUE.sandboxFirst);
    const before = failures.length;
    if (b1?.status !== "completed" || b1Run === undefined) {
      note("b:first-ran", `the first sandbox row ended ${b1?.status ?? "unfiled"}`);
    } else if (Object.keys(b1Run.started).length !== 0) {
      note("b:first-run-empty", `the first run started with ${Object.keys(b1Run.started).join(", ")}`);
    }
    const afterFirst = await storedFiles(lab);
    if (afterFirst[`sandbox/${fixture.sandboxFile.path}`] !== hashContent(fixture.sandboxFile.body)) {
      note("b:file-saved", `project-files/sandbox/${fixture.sandboxFile.path} holds ${JSON.stringify(afterFirst[`sandbox/${fixture.sandboxFile.path}`] ?? "nothing")}`);
    }
    const b2 = await runRow(lab, ISSUE.sandboxSecond);
    const b2Run = seen.get(ISSUE.sandboxSecond);
    if (b2Run === undefined) {
      note("b:second-ran", `the second sandbox row ended ${b2?.status ?? "unfiled"} before its harness ran`);
    } else if (b2Run.started[fixture.sandboxFile.path] !== fixture.sandboxFile.body) {
      note("b:second-run-sees-file", `the second run started with [${Object.keys(b2Run.started).join(", ")}], not the first run's ${fixture.sandboxFile.path}`);
    }
    await moveWorkstream(lab, "sandbox", "platform");
    await runRow(lab, ISSUE.platform);
    const pRun = seen.get(ISSUE.platform);
    if (pRun === undefined) {
      note("b:other-project-ran", "the platform row's harness never ran");
    } else if (Object.keys(pRun.started).length !== 0) {
      note("b:other-project-sees-nothing", `a run in platform started with ${Object.keys(pRun.started).join(", ")}`);
    }
    if (failures.length === before) {
      evidence.push(
        `b: the first sandbox run started in an empty ${b1Run!.cwd.split("/").slice(-1)[0]}/, its ` +
          `${fixture.sandboxFile.path} is in project-files/sandbox/, the second run started with it, and a ` +
          `platform run started empty`,
      );
    }

    // ---- (c) a remote the host does not allow -----------------------------
    const set = await lab.projectAct!("setRepository", { projectId: "platform", repository: fixture.disallowedRemote });
    if (set.error !== undefined) throw new Error(`setRepository was refused — ${set.error}`);
    const beforeC = failures.length;
    const clonesBefore = existsSync(join(root, ".clones")) ? readdirSync(join(root, ".clones")).filter((e) => e.endsWith(".git")) : [];
    const c = await runRow(lab, ISSUE.refused);
    const reason = JSON.stringify(c ?? {});
    if (seen.has(ISSUE.refused)) note("c:not-run", "the harness ran for a remote the host does not allow");
    // Named by host and path: a host shows a remote without its login, so `git@` may be left out.
    const remote = new URL(fixture.disallowedRemote);
    const named = reason.includes(remote.hostname) && reason.includes(remote.pathname);
    if (c?.status !== "cancelled" || !named || !reason.includes("remote-not-allowed")) {
      note("c:refused-by-name", `the row ended ${c?.status ?? "unfiled"} without a refusal naming ${fixture.disallowedRemote}`);
    }
    const clonesAfter = existsSync(join(root, ".clones")) ? readdirSync(join(root, ".clones")).filter((e) => e.endsWith(".git")) : [];
    const newClones = clonesAfter.filter((e) => !clonesBefore.includes(e));
    if (newClones.length > 0) note("c:nothing-cloned", `the host cloned ${newClones.join(", ")}`);
    const refusal = (c as { error?: unknown; reason?: unknown } | undefined) ?? {};
    if (failures.length === beforeC) {
      evidence.push(
        `c: the row was cancelled before its harness ran (${String(refusal.error ?? refusal.reason ?? "").slice(0, 160)}), ` +
          `and ${root}/.clones holds only [${clonesAfter.join(", ")}]`,
      );
    }

    return { failures, evidence: evidence.join("; ") };
  } finally {
    await lab.dispose();
  }
});
