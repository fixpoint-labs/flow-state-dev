/**
 * The local workspace host, for a run that cuts a branch of a repository.
 *
 * Every remote here is a real bare repository reached over `file://`, and
 * every git process the host starts is counted, because the two properties
 * that matter most are about processes: a refused remote starts none, and a
 * retry starts no fetch.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/exec";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { createFakeCollection } from "./fake-collection";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return { ...actual, run: vi.fn(actual.run) };
});

// Every test here drives real git: twenty-odd processes for a fixture remote
// and a provision. Alone each test takes well under a second, but process
// spawns slow down sharply when the whole monorepo's suites run at once, and
// the 5s default then fails tests that are slow, not wrong.
vi.setConfig({ testTimeout: 30_000 });

const spawned = vi.mocked(run);
const { run: realRun } = await vi.importActual<typeof import("../src/exec")>("../src/exec");
/** The git subcommand of every process the host started. */
const gitCommands = () => spawned.mock.calls.map(([, args]) => args[0]);
/** The error `attempt` rejected with; fails the test if it provisioned. */
const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => {
      throw new Error("expected a refusal, but the place was provisioned");
    },
    (e: unknown) => e as WorkspaceRefusedError,
  );
const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

let root: string;
let remote: Remote;

beforeEach(() => {
  root = tempDir("host");
  remote = createRemote("marker A");
  spawned.mockClear();
  spawned.mockImplementation(realRun);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function host(allow: string[] = ["file"]) {
  return localWorkspaceHost({ root, remotes: { allow }, source: noSource });
}

describe("only remotes the operator allows are reached", () => {
  const refused: [string, () => string, string][] = [
    ["file:// when file is not listed", () => remote.url, "remote-not-allowed"],
    ["a transport helper", () => "ext::sh -c touch% /tmp/fsd-pwned", "invalid-remote"],
    ["an ssh host that is an option", () => "ssh://-oProxyCommand=touch%20/tmp/fsd-pwned/x", "invalid-remote"],
    ["an scp host that is an option", () => "git@-oProxyCommand=x:org/repo", "invalid-remote"],
    ["a value that starts with -", () => "--upload-pack=touch /tmp/fsd-pwned", "invalid-remote"],
    ["a host the operator did not list", () => "https://evil.example/org/repo.git", "remote-not-allowed"],
    ["a scheme the host never speaks", () => "http://github.com/org/repo.git", "remote-not-allowed"],
    ["a bare path", () => remote.bare, "invalid-remote"],
  ];

  for (const [label, value, reason] of refused) {
    it(`refuses ${label} before any git process`, async () => {
      const allow = label.startsWith("file://") ? ["github.com"] : ["github.com", "file"];
      const attempt = host(allow).provision({ kind: "repo", repo: value() }, { place: ["run-1"], branch: "fsd/run-1" });

      await expect(attempt).rejects.toBeInstanceOf(WorkspaceRefusedError);
      await expect(attempt).rejects.toMatchObject({ reason });
      expect(spawned).not.toHaveBeenCalled();
      expect(existsSync(join(root, ".clones"))).toBe(false);
      expect(existsSync(join(root, "run-1"))).toBe(false);
    });
  }

  it("names the remote it refused, without its credential", async () => {
    const attempt = host(["github.com"]).provision(
      { kind: "repo", repo: "https://someone:hunter2@github.com/org/repo.git" },
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    const error = await refusalOf(attempt);
    expect(error).toBeInstanceOf(WorkspaceRefusedError);
    expect(error.reason).toBe("invalid-remote");
    expect(error.message).toContain("github.com/org/repo.git");
    expect(error.message).not.toContain("hunter2");
    expect(spawned).not.toHaveBeenCalled();
  });

  it("limits git's transports to the listed schemes", async () => {
    await host(["file"]).provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(spawned).toHaveBeenCalled();
    for (const [, , options] of spawned.mock.calls) {
      expect(options.env?.GIT_ALLOW_PROTOCOL).toBe("file");
    }
  });

  it("puts -- before the remote on every git call that names it", async () => {
    await host().provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    const naming = spawned.mock.calls.filter(([, args]) => args.includes(remote.url));
    expect(naming.length).toBeGreaterThan(0);
    for (const [, args] of naming) {
      expect(args.indexOf("--")).toBeGreaterThanOrEqual(0);
      expect(args.indexOf("--")).toBeLessThan(args.indexOf(remote.url));
    }
  });

  it("fails before the run, naming the remote, when an allowed remote cannot be read", async () => {
    const missing = `${remote.url}-missing`;
    const attempt = host().provision({ kind: "repo", repo: missing }, { place: ["run-1"], branch: "fsd/run-1" });

    const error = await refusalOf(attempt);
    expect(error).toBeInstanceOf(WorkspaceRefusedError);
    expect(error.reason).toBe("remote-unreadable");
    expect(error.message).toContain(missing);
    expect(existsSync(join(root, "run-1", "checkout"))).toBe(false);
    // No half-made clone left for the next attempt to trip on.
    expect(readdirSync(join(root, ".clones"))).toEqual([]);
  });
});

describe("a repository run gets a fresh branch in checkout/", () => {
  it("cuts the branch from the remote's default branch", async () => {
    const place = await host().provision({ kind: "repo", repo: remote.url }, { place: ["t", "run-1"], branch: "fsd/run-1" });

    expect(place.cwd).toBe(join(root, "t", "run-1", "checkout"));
    expect(readFileSync(join(place.cwd, "marker.txt"), "utf8")).toBe("marker A");
    expect(git(place.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(place.repo).toMatchObject({ remote: remote.url, baseRef: "main", baseCommit: remote.rev("main"), created: true });
  });

  it("keeps one clone per remote, shared by every run, under the host's root", async () => {
    const h = host();
    const a = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    const b = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-2"], branch: "fsd/run-2" });

    expect(readdirSync(join(root, ".clones"))).toHaveLength(1);
    expect(a.repo?.clone).toBe(b.repo?.clone);
    expect(a.repo?.clone.startsWith(join(root, ".clones"))).toBe(true);
  });

  it("makes one clone when two first runs for a remote start at once", async () => {
    const h = host();
    const [a, b] = await Promise.all([
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" }),
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-2"], branch: "fsd/run-2" }),
    ]);

    expect(gitCommands().filter((c) => c === "init")).toHaveLength(1);
    expect(readdirSync(join(root, ".clones"))).toHaveLength(1);
    expect(readFileSync(join(a.cwd, "marker.txt"), "utf8")).toBe("marker A");
    expect(readFileSync(join(b.cwd, "marker.txt"), "utf8")).toBe("marker A");
  });

  it("follows the remote's default branch when it is renamed", async () => {
    const h = host();
    await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    const trunk = remote.commit("trunk", "trunk.txt", "on trunk");
    remote.setDefault("trunk");
    git(remote.bare, "branch", "-D", "main");

    const next = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-2"], branch: "fsd/run-2" });

    expect(git(next.cwd, "rev-parse", "HEAD")).toBe(trunk);
    expect(next.repo).toMatchObject({ baseRef: "trunk", baseCommit: trunk });
  });

  it("fetches before cutting a new branch, so a new run starts from the remote's latest", async () => {
    const h = host();
    await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    const latest = remote.commit("main", "later.txt", "later");

    const next = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-2"], branch: "fsd/run-2" });

    expect(git(next.cwd, "rev-parse", "HEAD")).toBe(latest);
  });

  it("cuts from a named base when the source names one", async () => {
    const feature = remote.commit("release", "release.txt", "release");

    const place = await host().provision(
      { kind: "repo", repo: remote.url, baseRef: "release" },
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    expect(git(place.cwd, "rev-parse", "HEAD")).toBe(feature);
    expect(place.repo).toMatchObject({ baseRef: "release", baseCommit: feature });
  });
});

describe("a retry keeps its checkout and never fetches", () => {
  it("hands back the same checkout, work and all, without touching the remote", async () => {
    const h = host();
    const first = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    const started = git(first.cwd, "rev-parse", "HEAD");
    writeFileSync(join(first.cwd, "wip.txt"), "uncommitted");
    remote.commit("main", "later.txt", "later");
    spawned.mockClear();

    const retry = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(retry.cwd).toBe(first.cwd);
    expect(retry.repo?.created).toBe(false);
    expect(readFileSync(join(retry.cwd, "wip.txt"), "utf8")).toBe("uncommitted");
    expect(git(retry.cwd, "rev-parse", "HEAD")).toBe(started);
    expect(gitCommands()).not.toContain("fetch");
    expect(gitCommands()).not.toContain("ls-remote");
  });

  it("re-attaches a lost checkout to its existing branch without fetching", async () => {
    const h = host();
    const first = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    git(first.cwd, "commit", "-q", "--allow-empty", "-m", "the run's own commit");
    const head = git(first.cwd, "rev-parse", "HEAD");
    rmSync(first.cwd, { recursive: true, force: true });
    remote.commit("main", "later.txt", "later");
    spawned.mockClear();

    const again = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(again.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(gitCommands()).not.toContain("fetch");
    expect(gitCommands()).not.toContain("ls-remote");
  });

  it("raises a clone it cannot ask about a branch, rather than reading that as no branch", async () => {
    // Read as "no branch", a failed probe sends the run to fetch and cut a
    // branch that already exists.
    const h = host();
    const first = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    rmSync(first.cwd, { recursive: true, force: true });
    spawned.mockClear();
    spawned.mockImplementation(async (file, args, options) => {
      if (args[0] === "show-ref") throw Object.assign(new Error("fatal: the clone is unreadable"), { code: 128 });
      return realRun(file, args, options);
    });

    await expect(
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" }),
    ).rejects.toThrow(/unreadable/);
    expect(gitCommands()).not.toContain("fetch");
  });

  it("gives two provisions of one place, at once, the one checkout", async () => {
    const h = host();
    const [a, b] = await Promise.all([
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" }),
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" }),
    ]);

    expect(a.cwd).toBe(b.cwd);
    expect([a.repo?.created, b.repo?.created].sort()).toEqual([false, true]);
  });

  it("makes a second host on the same root wait for the first, then hands it the checkout", async () => {
    // Two processes sharing a root share no memory, so only a lock on disk
    // keeps them from both reaching `worktree add -b` for one place.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => (reached = resolve));
    let held = false;
    spawned.mockImplementation(async (file, args, options) => {
      if (!held && args[0] === "worktree" && args[1] === "add") {
        held = true;
        reached();
        await gate;
      }
      return realRun(file, args, options);
    });

    const first = host().provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    await paused;
    const second = host().provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    // Long enough for an unlocked second host to run its whole provision.
    await new Promise((resolve) => setTimeout(resolve, 500));
    open();

    const [a, b] = await Promise.all([first, second]);
    expect(a.cwd).toBe(b.cwd);
    expect([a.repo?.created, b.repo?.created]).toEqual([true, false]);
  });

  it("refuses a checkout cut from another remote, and keeps it", async () => {
    const h = host();
    const first = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    const other = createRemote("marker B");

    await expect(
      h.provision({ kind: "repo", repo: other.url }, { place: ["run-1"], branch: "fsd/run-1" }),
    ).rejects.toThrow(/not a worktree of the clone/);
    expect(readFileSync(join(first.cwd, "marker.txt"), "utf8")).toBe("marker A");
  });

  it("refuses a checkout that is on another branch rather than resetting it", async () => {
    const h = host();
    const first = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    git(first.cwd, "checkout", "-q", "-b", "elsewhere");

    await expect(
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" }),
    ).rejects.toThrow(/elsewhere/);
    expect(git(first.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("elsewhere");
  });
});

/**
 * Stand in for the process timeout killing `git worktree add`: let git run,
 * then leave the tree as `leave` says and reject the way a killed child does.
 */
function killWorktreeAdd(leave: (checkout: string) => void): void {
  spawned.mockImplementation(async (file, args, options) => {
    const result = await realRun(file, args, options);
    if (args[0] === "worktree" && args[1] === "add") {
      spawned.mockImplementation(realRun);
      leave(join(root, "run-1", "checkout"));
      throw Object.assign(new Error("git worktree add: killed"), { killed: true, signal: "SIGTERM" });
    }
    return result;
  });
}

describe("a provision cut short is rebuilt, not handed back", () => {
  // Measured in harness-manager: a killed `worktree add` can leave `.git`, the
  // branch and the worktree registration in place with tracked files missing.
  // Handed back, the run's first `git add -A` commits every missing file as a
  // deletion.
  it("rebuilds a checkout whose worktree add was killed part-way", async () => {
    const h = host();
    killWorktreeAdd((checkout) => rmSync(join(checkout, "marker.txt")));
    await expect(h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" })).rejects.toThrow(
      /killed/,
    );

    const retry = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(readFileSync(join(retry.cwd, "marker.txt"), "utf8")).toBe("marker A");
    expect(git(retry.cwd, "status", "--porcelain")).toBe("");
    expect(git(retry.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
  });

  it("rebuilds one killed before git wrote .git", async () => {
    const h = host();
    killWorktreeAdd((checkout) => rmSync(join(checkout, ".git")));
    await expect(h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" })).rejects.toThrow(
      /killed/,
    );

    const retry = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(readFileSync(join(retry.cwd, "marker.txt"), "utf8")).toBe("marker A");
    expect(git(retry.cwd, "status", "--porcelain")).toBe("");
  });

  it("hands back a checkout missing a tracked file when no provision was cut short — that is the run's work", async () => {
    const h = host();
    const first = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });
    rmSync(join(first.cwd, "marker.txt"));

    const retry = await h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(retry.cwd, "status", "--porcelain")).toBe("D marker.txt");
  });

  it("refuses, and keeps, a cut-short checkout that shows anything but missing files", async () => {
    // The record of an interrupted provision sits where an agent could write
    // it, so it only clears a tree that agrees: one with work in it is kept.
    const h = host();
    killWorktreeAdd((checkout) => {
      rmSync(join(checkout, "marker.txt"));
      writeFileSync(join(checkout, "work.ts"), "real work");
    });
    await expect(h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" })).rejects.toThrow(
      /killed/,
    );

    await expect(
      h.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1" }),
    ).rejects.toThrow(/interrupted/);
    expect(readFileSync(join(root, "run-1", "checkout", "work.ts"), "utf8")).toBe("real work");
  });
});

describe("project/ sits beside the checkout, never inside it", () => {
  function withFiles(seed: Record<string, string> = {}) {
    const collection = createFakeCollection("project-files/**", seed);
    return {
      collection,
      source: {
        kind: "repo" as const,
        repo: remote.url,
        projectId: "storefront",
        files: { collection, collectionId: "project-files" },
      },
    };
  }

  it("hydrates the run's own keys into project/ and saves a note back, invisible to git", async () => {
    const { collection, source } = withFiles({ "storefront/plan.md": "the plan", "other/secret.md": "not yours" });
    const h = host();

    const place = await h.provision(source, { place: ["run-1"], branch: "fsd/run-1" });
    const projectDir = join(root, "run-1", "project");

    expect(place.filesDir).toBe(projectDir);
    expect(readFileSync(join(projectDir, "plan.md"), "utf8")).toBe("the plan");
    expect(existsSync(join(projectDir, "secret.md"))).toBe(false);

    writeFileSync(join(projectDir, "note.md"), "remember this");
    writeFileSync(join(place.cwd, "code.ts"), "export {}");
    const report = await h.save(place);

    expect(report.conflicts).toEqual([]);
    expect(collection.contents()["storefront/note.md"]).toBe("remember this");
    expect(Object.keys(collection.contents()).some((k) => k.endsWith("code.ts"))).toBe(false);
    expect(git(place.cwd, "status", "--porcelain")).toBe("?? code.ts");
  });

  it("refuses a key prefix that could reach outside itself, before anything is made", async () => {
    const { collection } = withFiles();
    await expect(
      host().provision(
        { kind: "repo", repo: remote.url, projectId: "../other", files: { collection, collectionId: "project-files" } },
        { place: ["run-1"], branch: "fsd/run-1" },
      ),
    ).rejects.toThrow(/scope/);
    expect(spawned).not.toHaveBeenCalled();
    expect(existsSync(join(root, "run-1"))).toBe(false);
  });

  it("refuses kept files without the key prefix they live under", async () => {
    const { collection } = withFiles();
    await expect(
      host().provision(
        { kind: "repo", repo: remote.url, files: { collection, collectionId: "project-files" } },
        { place: ["run-1"], branch: "fsd/run-1" },
      ),
    ).rejects.toThrow(/projectId/);
    expect(spawned).not.toHaveBeenCalled();
  });
});

describe("a source's refusal stops provisioning", () => {
  it("refuses with the source's own reason, starting nothing", async () => {
    const attempt = host().provision(
      { kind: "refused", reason: "not-a-member", message: "the run's owner is not a member" },
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    const error = await refusalOf(attempt);
    expect(error).toBeInstanceOf(WorkspaceRefusedError);
    expect(error.reason).toBe("not-a-member");
    expect(spawned).not.toHaveBeenCalled();
    expect(existsSync(join(root, "run-1"))).toBe(false);
  });
});

describe("a place is named inside the root", () => {
  for (const segments of [[], [".."], ["a", "../b"], [".clones"], ["a/b"], [""]]) {
    it(`refuses ${JSON.stringify(segments)}`, async () => {
      await expect(
        host().provision({ kind: "repo", repo: remote.url }, { place: segments, branch: "fsd/run-1" }),
      ).rejects.toThrow(/place/);
      expect(spawned).not.toHaveBeenCalled();
    });
  }
});
