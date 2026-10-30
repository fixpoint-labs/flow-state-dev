/**
 * Where the `fsd` profile's coding runs work (BR-13 to BR-16): a run on FSD or
 * Shift Manager, filed from a board or from a conversation with the Shift
 * Coordinator, gets a fresh worktree of the checkout the profile sits in, on a
 * branch cut from local `main`; a run the mapping misses is refused by name,
 * and nothing is cloned.
 *
 * The profile's mapping is read from its leaf module (`fsd-checkouts.mts`),
 * with no Lab opened; that the profile hands it to `openLab`, with no remote
 * allowed, is `fsd-profile.test.ts`. The runs then go through `openLab` with
 * that workspace except for the runs' root and the checkout, which is a temp
 * repository with `main` and a feature branch checked out: CI's checkout has
 * no local `main`, and a check must not add worktrees to the checkout it runs
 * in. The coder is scripted (it commits `SCRIPTED-RUN.md`), and the Shift
 * Coordinator's model is scripted to make one tool call, so nothing here spends a
 * model.
 *
 * Every grade reads the checkout itself (`git worktree list`, `git branch`,
 * `git merge-base`), never what the host returned.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import type { ProjectCheckout } from "@flow-state-dev/workforce";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { LIST_TASKS_ACTION } from "../src/lib/conversation-tasks";
import { commitScriptedWork } from "../teams/devteam/harness.mts";
import { harnessStub, type HarnessStub } from "@flow-state-dev/harness-manager";
import { CHECKOUTS } from "../teams/devteam/fsd-checkouts.mts";
import { CODER_BRIEF, FSD_DOCUMENTS, FSD_SKILLS } from "../teams/devteam/fsd-projects.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createScratchRepo } from "../teams/devteam/scratch-repo.mts";

const REMOTE = "https://github.com/fixpoint-labs/flow-state-dev.git";
const CHECKOUTS_MODULE = fileURLToPath(new URL("../teams/devteam/fsd-checkouts.mts", import.meta.url));
const CODER = "eng.coder";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
const isAncestor = (cwd: string, ancestor: string, of: string) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, of], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
/** The worktrees git lists for `checkout`, by real path. */
const worktrees = (checkout: string) =>
  git(checkout, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

let opened: Lab[] = [];
afterEach(async () => {
  for (const lab of opened) await lab.dispose();
  opened = [];
});

/**
 * A checkout like a user's: `main` with one commit, and a feature branch one
 * commit ahead checked out, so a run cut from HEAD is told apart from one cut
 * from `main`.
 */
function userCheckout() {
  const { sourceRepo } = createScratchRepo("fsd-checkout");
  const repo = realpathSync(sourceRepo);
  const main = git(repo, "rev-parse", "main");
  git(repo, "switch", "--quiet", "-c", "my-feature");
  writeFileSync(join(repo, "MINE.md"), "on my branch, not main\n");
  git(repo, "add", "MINE.md");
  git(repo, "commit", "--quiet", "-m", "my work");
  return { repo, main, head: git(repo, "rev-parse", "HEAD") };
}

/** A model that has the Shift Coordinator make `call` once, then stop. */
function scripted(call: { toolName: string; args: Record<string, unknown> }): ModelResolver {
  let made = false;
  const model: GeneratorModel = {
    modelId: "test/step",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      if (made) return { text: "done", finishReason: "stop" };
      made = true;
      return { toolCalls: [{ toolCallId: "t1", ...call }], finishReason: "tool-calls" };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => {
      if (block === "coordinator-route-ask") throw new Error("no route model in this test");
      return model;
    },
    { resolveId: (id: string) => id },
  ) as unknown as ModelResolver;
}

/**
 * The fsd profile's hosts, as `openLab` builds them from its mapping, documents
 * and skills, over `checkout` instead of this repository. `replaced: null`
 * opens on the tree's own documents and skills, as DevTeam does. `mine` is a shared project of the
 * Lab's organization on the same remote that the mapping doesn't name.
 */
async function openMapped(checkout: string, stub: HarnessStub, model?: ModelResolver, replaced: { documents?: Record<string, string>; skills?: Record<string, string> } | null = { documents: FSD_DOCUMENTS, skills: FSD_SKILLS }) {
  const root = mkdtempSync(join(tmpdir(), "sm-fsd-runs-"));
  const lab = await openLab({
    ...(model === undefined ? {} : { modelResolver: model }),
    ...replaced,
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 30_000,
    workspace: { root, remotes: { allow: [] }, checkouts: CHECKOUTS.map((entry) => ({ ...entry, checkout })) },
    coderWorkerId: CODER,
    withoutJudge: true,
    projects: [
      { id: "fsd", title: "FSD", repository: REMOTE },
      { id: "shift-manager", title: "Shift Manager", repository: REMOTE },
      { id: "mine", title: "Mine", repository: REMOTE },
    ],
  });
  opened.push(lab);
  return { lab, root };
}

/** File `issue` on the EM's board for `project`, and drain until it settles. */
async function fileOnBoard(lab: Lab, issue: string, project: string) {
  const filed = await lab.file("eng.em", { issue, goal: `Note the row on ${project}.`, maxAttempts: 1, project: { visibility: "shared", id: project } });
  expect(filed.error).toBeUndefined();
  let row = await lab.featureRow(issue);
  for (let i = 0; i < 100 && (row === undefined || row.status === "pending" || row.status === "in_progress"); i += 1) {
    await lab.drain("eng.em");
    row = await lab.featureRow(issue);
  }
  return row;
}

/** The run's branch, as checked out in its worktree. */
const branchOf = (cwd: string) => git(cwd, "rev-parse", "--abbrev-ref", "HEAD");

/** What BR-13 says of one run: a worktree of `repo`, on a branch of `repo` cut from `main`, not from HEAD. */
function expectWorktreeFromMain(user: ReturnType<typeof userCheckout>, cwd: string) {
  expect(worktrees(user.repo)).toContain(cwd);
  const branch = branchOf(cwd);
  expect(branch).not.toBe("my-feature");
  expect(git(user.repo, "branch", "--list", branch)).not.toBe("");
  expect(isAncestor(user.repo, user.main, branch)).toBe(true);
  expect(isAncestor(user.repo, user.head, branch)).toBe(false);
  return branch;
}

describe("the fsd profile's checkout mapping", () => {
  it("maps exactly FSD and Shift Manager of the Lab's organization, on the rows' remote, to this checkout, from main", () => {
    const toplevel = realpathSync(git(fileURLToPath(new URL(".", import.meta.url)), "rev-parse", "--show-toplevel"));
    expect(CHECKOUTS).toHaveLength(1);
    const [entry] = CHECKOUTS as [ProjectCheckout];
    expect(realpathSync(entry.checkout)).toBe(toplevel);
    expect(entry.projects).toEqual([
      { orgId: LAB_ORG_ID, id: "fsd" },
      { orgId: LAB_ORG_ID, id: "shift-manager" },
    ]);
    expect(entry.baseRef).toBe("main");
    // One remote for the rows and the mapping: a drift is a silent miss (BR-14).
    // The rows are held to the same REMOTE by fsd-profile.test.ts's BR-1.
    expect(entry.remote).toBe(REMOTE);
  });

  it("BR-16: holds no machine path; the checkout is worked out from where the file is", () => {
    const source = readFileSync(CHECKOUTS_MODULE, "utf8");
    expect(source).not.toMatch(/["'`](\/(home|Users|root|tmp|mnt|opt|var|srv|workspace)\/|[A-Za-z]:\\\\)/);
    expect(source).toMatch(/new URL\("\.\.\/\.\.\/\.\.\/\.\.", import\.meta\.url\)/);
  });
});

describe("a coding run on the fsd profile's projects", () => {
  /** DevTeam's brief builds greet() and stamps FEATURE-BRIEF-E61B8; its commit style stamps COMMIT-STYLE-F70C4. */
  const DEMO_BRIEF = /FEATURE-BRIEF-E61B8|greet\(|COMMIT-STYLE-F70C4/;

  it("BR-13: from a board, a run on fsd and one on shift-manager each work in a fresh worktree of the checkout, cut from main", async () => {
    const user = userCheckout();
    const stub = harnessStub({ duringRun: commitScriptedWork });
    const { lab, root } = await openMapped(user.repo, stub);

    const branches: string[] = [];
    for (const project of ["fsd", "shift-manager"]) {
      const row = await fileOnBoard(lab, `on-${project}`, project);
      const run = stub.runs.find((r) => r.prompt.includes(`on-${project}`));
      expect(run, `the ${project} row ended ${row?.status}: ${JSON.stringify(row?.error ?? null)}`).toBeDefined();
      expect(run!.prompt).toContain(FSD_DOCUMENTS[CODER_BRIEF]!.trim());
      expect(run!.prompt).toContain(FSD_SKILLS["commit-style"]);
      expect(run!.prompt).not.toMatch(DEMO_BRIEF);
      const branch = expectWorktreeFromMain(user, run!.cwd);
      // The coder's commit is on the run's branch, in the user's checkout.
      expect(git(user.repo, "show", `${branch}:SCRIPTED-RUN.md`)).toContain("A scripted run");
      branches.push(branch);
    }
    expect(new Set(stub.runs.map((r) => r.cwd)).size).toBe(2);
    expect(new Set(branches).size).toBe(2);
    // The user's own branch is untouched, and nothing was cloned.
    expect(git(user.repo, "rev-parse", "my-feature")).toBe(user.head);
    expect(existsSync(join(root, ".clones")) ? readdirSync(join(root, ".clones")) : []).toEqual([]);
  }, 120_000);

  it("on the tree's own documents and skills, that run is handed both demo markers", async () => {
    // Red state of the check above: without the replacements, the prompt carries both markers.
    const stub = harnessStub({ duringRun: commitScriptedWork });
    const { lab } = await openMapped(userCheckout().repo, stub, undefined, null);
    await fileOnBoard(lab, "brief-devteam", "fsd");
    const prompt = stub.runs.find((r) => r.prompt.includes("brief-devteam"))?.prompt;
    expect(prompt).toContain("FEATURE-BRIEF-E61B8");
    expect(prompt).toContain("COMMIT-STYLE-F70C4");
  }, 120_000);

  it("refuses to replace a document or skill the tree does not declare", async () => {
    const repo = userCheckout().repo;
    await expect(openMapped(repo, harnessStub(), undefined, { documents: { "teams/eng/no-such-brief": "x" } })).rejects.toThrow(
      /does not declare/,
    );
    await expect(openMapped(repo, harnessStub(), undefined, { skills: { "no-such-skill": "x" } })).rejects.toThrow(
      /no worker in the tree carries/,
    );
  });

  it("BR-13: from a conversation, the Shift Coordinator's task for the coder works in a worktree of the checkout, cut from main", async () => {
    const user = userCheckout();
    const stub = harnessStub({ duringRun: commitScriptedWork, finalMessage: "Noted." });
    const call = { toolName: "createTask", args: { goal: "note the row", assignee: CODER, input: { project: { visibility: "shared", id: "shift-manager" } } } };
    const { lab } = await openMapped(user.repo, stub, scripted(call));
    const runtime = await lab.state.getRuntime();
    const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId, state: { workerId: "shift-coordinator" } } });
    expect(created.status).toBe(201);
    const act = async (actionName: string, input: unknown) =>
      (await runAction({
        orgId: LAB_ORG_ID,
        flow: runtime.registry.get("coordinator") as FlowInstance,
        actionName,
        input,
        userId: LAB_USER_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { output?: any; error?: unknown };
    expect((await act("respond", { message: "on Shift Manager, note the row" })).error).toBeUndefined();

    let task: Record<string, any> | undefined;
    for (const deadline = Date.now() + 30_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 50))) {
      task = ((await act(LIST_TASKS_ACTION, {})).output as { tasks: Array<Record<string, any>> }).tasks?.[0];
      if (["completed", "errored", "cancelled"].includes(task?.status)) break;
    }
    expect(stub.runs, `the task ended ${task?.status}: ${JSON.stringify(task?.error ?? null)}`).toHaveLength(1);
    expectWorktreeFromMain(user, stub.runs[0]!.cwd);
    expect(task?.status).toBe("completed");
  }, 120_000);

  it("BR-14: a shared project of the Lab the mapping doesn't name is refused by its remote, with no worktree and nothing cloned", async () => {
    const user = userCheckout();
    const stub = harnessStub({ duringRun: commitScriptedWork });
    const { lab, root } = await openMapped(user.repo, stub);
    const before = worktrees(user.repo);

    const row = await fileOnBoard(lab, "on-mine", "mine");
    expect(row?.status).toBe("errored");
    expect(stub.runs).toEqual([]);
    const said = JSON.stringify(row);
    expect(said).toContain("remote-not-allowed");
    expect(said).toContain("/fixpoint-labs/flow-state-dev");
    expect(worktrees(user.repo)).toEqual(before);
    expect(existsSync(join(root, ".clones")) ? readdirSync(join(root, ".clones")) : []).toEqual([]);
  }, 120_000);
});
