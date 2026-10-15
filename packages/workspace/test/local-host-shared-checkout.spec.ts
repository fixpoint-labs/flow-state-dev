/**
 * Several runs on one repository the operator names on this machine.
 *
 * Two projects can be worked in one checkout. Each run gets a worktree of it
 * on a branch of its own, with its kept files beside it, and neither waits on
 * the other: there is no lock over the repository, only git's own. What is
 * graded is git's view in the operator's repository (`git worktree list`,
 * `git branch`), never what a provision returned, so a host that reported two
 * places but shared one directory would fail here.
 */
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/exec";
import { localWorkspaceHost, type WorkspaceHost, type WorkspacePlace } from "../src/local-host";
import { createFakeCollection, type FakeCollection } from "./fake-collection";
import { createRemote, git, subcommand, tempDir } from "./git-fixtures";

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return { ...actual, run: vi.fn(actual.run) };
});

const spawned = vi.mocked(run);
const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });
const execFileAsync = promisify(execFile);

let root: string;
/** The operator's own checkout, on `main`. */
let repo: string;
let files: FakeCollection;

beforeEach(() => {
  root = tempDir("host");
  const remote = createRemote("marker A");
  repo = join(tempDir("local"), "repo");
  git(join(repo, ".."), "clone", "-q", remote.bare, repo);
  files = createFakeCollection("project-files/**");
  spawned.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function host(): WorkspaceHost {
  return localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: noSource });
}

/** The answer a run source gives for project `projectId` mapped to the operator's checkout. */
function mapped(projectId: string, baseRef?: string) {
  return {
    kind: "repo" as const,
    repo,
    ...(baseRef !== undefined ? { baseRef } : {}),
    projectId,
    files: { collection: files, collectionId: "project-files" },
  };
}

/** The worktrees git lists for the operator's repository, by path. */
function worktrees(): string[] {
  return git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** The branches the operator's repository holds. */
function branches(): string[] {
  return git(repo, "branch", "--format=%(refname:short)").split("\n");
}

/** Every `git` call the host made whose arguments start with `prefix`. */
function gitCalls(...prefix: string[]): (readonly string[])[] {
  return spawned.mock.calls
    .map(([, args]) => subcommand(args))
    .filter((args) => prefix.every((word, i) => args[i] === word));
}

/** Commit `file` in `cwd`, asynchronously, so two runs commit at the same moment. */
async function commit(cwd: string, file: string): Promise<void> {
  writeFileSync(join(cwd, file), `${file}\n`);
  const author = ["-c", "user.email=test@example.com", "-c", "user.name=test"];
  await execFileAsync("git", [...author, "add", file], { cwd });
  await execFileAsync("git", [...author, "commit", "-q", "-m", file], { cwd });
}

/** One whole run: provision, commit, keep a note, save. Settles to what happened. */
async function oneRun(h: WorkspaceHost, projectId: string, place: string[], branch: string) {
  try {
    const at: WorkspacePlace = await h.provision(mapped(projectId), { place, branch });
    await commit(at.cwd, `${projectId}.txt`);
    writeFileSync(join(at.filesDir!, "note.md"), `${projectId}'s note`);
    const report = await h.save(at);
    return { ok: true as const, place: at, conflicts: report.conflicts.length };
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }
}

/** Two projects' runs at once. `onePlace` is the control: both runs given the same place. */
async function twoProjectsAtOnce(iteration: number, onePlace: boolean) {
  const h = host();
  const placeA = onePlace ? ["shared", `i${iteration}`] : ["web", `i${iteration}`];
  const placeB = onePlace ? ["shared", `i${iteration}`] : ["api", `i${iteration}`];
  const [a, b] = await Promise.all([
    oneRun(h, "web", placeA, `fsd/web-${iteration}`),
    oneRun(h, "api", placeB, `fsd/api-${iteration}`),
  ]);
  return { a, b };
}

/**
 * ER-4, read off git in the operator's checkout and the project's files:
 * both runs settled, in two worktrees, on two branches, each with its own
 * commit and its own kept files. Returns what is wrong, or nothing.
 */
function bothSettled(iteration: number, outcome: Awaited<ReturnType<typeof twoProjectsAtOnce>>): string[] {
  const wrong: string[] = [];
  for (const [project, result] of [["web", outcome.a], ["api", outcome.b]] as const) {
    const branch = `fsd/${project}-${iteration}`;
    if (!result.ok) {
      wrong.push(`${project}'s run did not settle: ${result.error}`);
      continue;
    }
    if (!worktrees().includes(result.place.cwd)) wrong.push(`git lists no worktree at ${result.place.cwd}`);
    if (!branches().includes(branch)) wrong.push(`the checkout holds no branch ${branch}`);
    else if (!git(repo, "ls-tree", "--name-only", branch).split("\n").includes(`${project}.txt`)) {
      wrong.push(`${branch} does not carry ${project}'s commit`);
    }
    if (files.contents()[`${project}/note.md`] !== `${project}'s note`) wrong.push(`${project}'s note was not saved under ${project}/`);
  }
  return wrong;
}

describe("two projects on one checkout (ER-4)", () => {
  it("run at once in two worktrees on two branches, and both settle, ten times over (BR-17, BR-20)", async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const outcome = await twoProjectsAtOnce(iteration, false);
      expect(bothSettled(iteration, outcome), `iteration ${iteration}`).toEqual([]);
    }
    // One `worktree add` per run: nothing waited and tried again.
    expect(gitCalls("worktree", "add")).toHaveLength(20);
  }, 120_000);

  it("control: given one place, the second run is refused and both-settle fails (BR-18)", async () => {
    const outcome = await twoProjectsAtOnce(0, true);

    const refused = [outcome.a, outcome.b].filter((r) => !r.ok);
    expect(refused).toHaveLength(1);
    // The live checkout is on the other run's branch, so it is not handed over.
    expect((refused[0] as { error: string }).error).toMatch(/shared\/i0\/checkout .*Refusing/);
    expect(bothSettled(0, outcome)).not.toEqual([]);
  }, 60_000);

  it("fails one provision loudly on a git lock it finds held, and does not retry it (BR-19)", async () => {
    // Git's own lock on the branch one run is about to create.
    mkdirSync(join(repo, ".git", "refs", "heads", "fsd"), { recursive: true });
    writeFileSync(join(repo, ".git", "refs", "heads", "fsd", "web-0.lock"), "");

    const outcome = await twoProjectsAtOnce(0, false);

    expect(outcome.a.ok).toBe(false);
    expect((outcome.a as { error: string }).error).toMatch(/fsd\/web-0\.lock/);
    expect(outcome.b.ok).toBe(true);
    const webAdds = gitCalls("worktree", "add").filter((args) => args.includes("fsd/web-0"));
    expect(webAdds).toHaveLength(1);
  }, 60_000);
});

describe("where a run's branch is cut from, and what becomes of it", () => {
  it("cuts from whatever the checkout has checked out when no baseRef is given, and fetches nothing (BR-9)", async () => {
    git(repo, "checkout", "-q", "-b", "topic");
    writeFileSync(join(repo, "topic.txt"), "on topic");
    git(repo, "add", "topic.txt");
    git(repo, "commit", "-q", "-m", "topic");
    const topic = git(repo, "rev-parse", "HEAD");

    const place = await host().provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(place.cwd, "rev-parse", "HEAD")).toBe(topic);
    expect(gitCalls("fetch")).toEqual([]);
    expect(gitCalls("ls-remote")).toEqual([]);
  });

  it("fails naming a baseRef the checkout doesn't have, and leaves nothing behind (BR-10)", async () => {
    const attempt = host().provision(mapped("web", "no-such-branch"), { place: ["run-1"], branch: "fsd/run-1" });

    await expect(attempt).rejects.toThrow(/no-such-branch/);
    await expect(attempt).rejects.toMatchObject({ reason: "remote-unreadable" });
    expect(branches()).not.toContain("fsd/run-1");
    expect(worktrees()).toEqual([repo]);
    expect(existsSync(join(root, "run-1", "checkout"))).toBe(false);
    expect(existsSync(join(root, "run-1", ".checkout.provisioning"))).toBe(false);
  });

  it("adds the worktree again on the run's own branch after a person removed it (BR-14)", async () => {
    const h = host();
    const first = await h.provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" });
    await commit(first.cwd, "work.txt");
    await h.release(first);
    git(repo, "worktree", "remove", first.cwd);

    const again = await h.provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" });

    expect(again.cwd).toBe(first.cwd);
    expect(worktrees()).toContain(again.cwd);
    expect(git(again.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(readFileSync(join(again.cwd, "work.txt"), "utf8")).toBe("work.txt\n");
  });

  it("fails when a person has the run's branch checked out in their own tree, and resets nothing (BR-15)", async () => {
    const h = host();
    const first = await h.provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" });
    await commit(first.cwd, "work.txt");
    await h.release(first);
    git(repo, "worktree", "remove", first.cwd);
    git(repo, "checkout", "-q", "fsd/run-1");
    writeFileSync(join(repo, "mine.txt"), "the person's own edit");

    await expect(h.provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" })).rejects.toThrow(/fsd\/run-1/);

    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(readFileSync(join(repo, "mine.txt"), "utf8")).toBe("the person's own edit");
    expect(worktrees()).toEqual([repo]);
  });
});

describe("the operator's own git hooks", () => {
  /**
   * A post-checkout hook like a developer's `pnpm packages:build`: it fails in
   * a fresh tree with no dependencies, and leaves a mark whenever it runs.
   */
  function installFailingHook(dir: string): string {
    const ran = join(tempDir("hook"), "ran");
    mkdirSync(dir, { recursive: true });
    const hook = join(dir, "post-checkout");
    writeFileSync(hook, `#!/bin/sh\necho "$PWD" >> '${ran}'\necho "no node_modules here" >&2\nexit 1\n`);
    chmodSync(hook, 0o755);
    return ran;
  }

  it("never run while a run's worktree is cut, so a failing one can't stop the run", async () => {
    const ran = installFailingHook(join(repo, ".git", "hooks"));
    // Control: the hook is live. The operator's own `worktree add` runs it and fails.
    expect(() => git(repo, "worktree", "add", "-q", "-b", "control", join(tempDir("control"), "tree"))).toThrow(
      /no node_modules here/,
    );
    expect(existsSync(ran)).toBe(true);
    rmSync(ran);

    const place = await host().provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" });

    expect(worktrees()).toContain(place.cwd);
    expect(git(place.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(existsSync(ran), "the operator's post-checkout hook ran while the worktree was cut").toBe(false);
  });

  it("are not run from a configured hooks directory either (husky's core.hooksPath)", async () => {
    const ran = installFailingHook(join(repo, ".husky"));
    git(repo, "config", "core.hooksPath", ".husky");

    const place = await host().provision(mapped("web"), { place: ["run-1"], branch: "fsd/run-1" });

    expect(worktrees()).toContain(place.cwd);
    expect(existsSync(ran), "the configured post-checkout hook ran while the worktree was cut").toBe(false);
  });
});
