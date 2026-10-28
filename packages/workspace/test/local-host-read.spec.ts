/**
 * The host's read view: a project's files read from the host's shared clone,
 * at the remote's default branch, with no place made — or from its kept files.
 *
 * Every remote is a real bare repository reached over `file://`, and every git
 * process the host starts is counted, because what matters most here is about
 * processes and disk: a read makes no worktree and no place, fetches at most
 * once a minute, never waits on the clone's lock, and never reaches a run's
 * branch.
 */
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/exec";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { acquireLock, releaseLock } from "../src/lock";
import type { RunSourceAnswer } from "../src/run-source";
import { createFakeCollection } from "./fake-collection";
import { createRemote, git, subcommand, tempDir, type Remote } from "./git-fixtures";

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return { ...actual, run: vi.fn(actual.run) };
});

vi.setConfig({ testTimeout: 30_000 });

const spawned = vi.mocked(run);
const { run: realRun } = await vi.importActual<typeof import("../src/exec")>("../src/exec");
/** The git subcommand of every process the host started. */
const gitCommands = () => spawned.mock.calls.map(([, args]) => subcommand(args)[0]);
const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

let root: string;
let remote: Remote;
let clock: number;

beforeEach(() => {
  root = tempDir("read");
  remote = createRemote("marker A");
  remote.commit("main", "src/billing/ledger/codes.ts", 'export const LEDGER_CODE = "LC-7731";\n');
  spawned.mockClear();
  spawned.mockImplementation(realRun);
  clock = Date.now();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function host(options: { localRepositories?: string[] } = {}) {
  return localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: noSource, now: () => clock, ...options });
}

const repo = (): RunSourceAnswer => ({ kind: "repo", repo: remote.url });

/** Everything under the root except the shared clones: a read must leave nothing here. */
const placesUnder = () => (existsSync(root) ? readdirSync(root).filter((name) => !name.startsWith(".")) : []);

describe("a read of a repository comes from the shared clone, at the default branch", () => {
  it("lists the paths at the remote's default branch, making the clone and no place", async () => {
    const read = await host().readSource!(repo(), { kind: "glob", pattern: "src/**" });

    expect(read).toMatchObject({ kind: "glob", paths: ["src/billing/ledger/codes.ts"], cut: null });
    expect(read.at).toMatchObject({ kind: "repo", branch: "main", commit: remote.rev("main") });
    expect(readdirSync(join(root, ".clones")).filter((name) => name.endsWith(".git"))).toHaveLength(1);
    expect(placesUnder()).toEqual([]);
    expect(gitCommands()).not.toContain("worktree");
  });
});

describe("what a read returns, and the caps it is held to", () => {
  it("reads a line range of one file at the commit it names", async () => {
    remote.commit("main", "notes.txt", "one\ntwo\nthree\nfour\n");
    const read = await host().readSource!(repo(), { kind: "read", path: "notes.txt", startLine: 2, endLine: 3 });

    expect(read).toMatchObject({ kind: "read", status: "ok", content: "two\nthree", startLine: 2, endLine: 3, totalLines: 4, cut: null });
    expect(read.at).toMatchObject({ commit: remote.rev("main") });
  });

  it("cuts a long file at 2,000 lines and says how many are left", async () => {
    remote.commit("main", "long.txt", Array.from({ length: 2_500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
    const read = await host().readSource!(repo(), { kind: "read", path: "long.txt" });

    expect(read).toMatchObject({ status: "ok", startLine: 1, endLine: 2_000, totalLines: 2_500, cut: { left: 500, by: "lines" } });
  });

  it("cuts a wide file at 256 KB and says how many lines are left", async () => {
    remote.commit("main", "wide.txt", Array.from({ length: 100 }, () => "x".repeat(10_000)).join("\n") + "\n");
    const read = await host().readSource!(repo(), { kind: "read", path: "wide.txt" });

    if (read.kind !== "read" || read.status !== "ok") throw new Error(`expected a body, got ${JSON.stringify(read)}`);
    expect(Buffer.byteLength(read.content)).toBeLessThanOrEqual(256 * 1024);
    expect(read.endLine).toBe(26);
    expect(read.cut).toEqual({ left: 74, by: "bytes" });
  });

  it("refuses a binary file, and grep skips it", async () => {
    remote.commit("main", "logo.bin", "LEDGER\0\x01\x02");
    const h = host();
    const read = await h.readSource!(repo(), { kind: "read", path: "logo.bin" });
    const grep = await h.readSource!(repo(), { kind: "grep", pattern: "LEDGER" });

    expect(read).toMatchObject({ status: "binary" });
    expect(grep).toMatchObject({ kind: "grep", binary: "skipped" });
    if (grep.kind !== "grep") throw new Error("expected a grep");
    expect(grep.matches.map((m) => m.path)).toEqual(["src/billing/ledger/codes.ts"]);
  });

  it("answers missing and directory rather than failing", async () => {
    const h = host();
    expect(await h.readSource!(repo(), { kind: "read", path: "nope.txt" })).toMatchObject({ status: "missing" });
    expect(await h.readSource!(repo(), { kind: "read", path: "src/billing" })).toMatchObject({ status: "directory" });
  });

  for (const path of ["../outside.txt", "src/../marker.txt", "/etc/passwd", "./marker.txt", "src//x.ts", ""]) {
    it(`refuses the path ${JSON.stringify(path)} before any git process`, async () => {
      const attempt = host().readSource!(repo(), { kind: "read", path });

      await expect(attempt).rejects.toBeInstanceOf(WorkspaceRefusedError);
      await expect(attempt).rejects.toMatchObject({ reason: "invalid-path" });
      expect(spawned).not.toHaveBeenCalled();
    });
  }

  it("reads a path literally, never as a pattern", async () => {
    remote.commit("main", "a*.txt", "star\n");
    remote.commit("main", "ab.txt", "plain\n");
    const h = host();
    const read = await h.readSource!(repo(), { kind: "read", path: "a*.txt" });
    const underPattern = await h.readSource!(repo(), { kind: "grep", pattern: "LEDGER", prefix: "sr*" });

    expect(read).toMatchObject({ status: "ok", content: "star" });
    expect(underPattern).toMatchObject({ matches: [] });
  });

  it("greps with git's extended regular expressions, naming the dialect, under a prefix", async () => {
    remote.commit("main", "docs/codes.md", 'LEDGER_CODE is documented here\n');
    const grep = await host().readSource!(repo(), { kind: "grep", pattern: "LEDGER_(CODE|KEY) =", prefix: "src" });

    expect(grep).toMatchObject({
      kind: "grep",
      dialect: "extended-regex",
      matches: [{ path: "src/billing/ledger/codes.ts", line: 1, snippet: 'export const LEDGER_CODE = "LC-7731";' }],
      cut: null,
    });
  });

  it("searches for a pattern that doesn't compile as written, and says so", async () => {
    remote.commit("main", "calls.ts", "run(a(\n");
    const grep = await host().readSource!(repo(), { kind: "grep", pattern: "a(" });

    expect(grep).toMatchObject({ dialect: "literal", matches: [{ path: "calls.ts", line: 1 }] });
  });

  it("cuts grep at 200 matches with 200-character snippets, saying how many are left", async () => {
    remote.commit("main", "many.txt", Array.from({ length: 250 }, () => `hit ${"y".repeat(300)}`).join("\n") + "\n");
    const grep = await host().readSource!(repo(), { kind: "grep", pattern: "^hit" });

    if (grep.kind !== "grep") throw new Error("expected a grep");
    expect(grep.matches).toHaveLength(200);
    expect(grep.cut).toEqual({ left: 50, by: "matches" });
    expect(grep.matches[0]!.snippet.length).toBe(201);
    expect(grep.matches[0]!.snippet.endsWith("…")).toBe(true);
  });

  it("reads a grep's output as it comes, so a cut past any buffer is still exact", async () => {
    // Each match is ~1 KB of output (the path is long), so 300,000 matches is
    // ~300 MB: past what buffering git's output whole would hold.
    const deep = Array.from({ length: 4 }, (_, i) => `${i}${"d".repeat(240)}`).join("/");
    remote.commit("main", `${deep}/hits.txt`, "hit\n".repeat(300_000));
    const grep = await host().readSource!(repo(), { kind: "grep", pattern: "^hit$" });

    expect(grep).toMatchObject({ kind: "grep", dialect: "extended-regex", cut: { left: 300_000 - 200, by: "matches" } });
    if (grep.kind !== "grep") throw new Error("expected a grep");
    expect(grep.matches).toHaveLength(200);
    expect(grep.matches[199]).toEqual({ path: `${deep}/hits.txt`, line: 200, snippet: "hit" });
  }, 60_000);

  it("fails a grep that fails for any reason but its pattern, rather than searching for it as a literal", async () => {
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    spawned.mockImplementation(async (file, args, options) => {
      if (subcommand(args)[0] !== "grep") return await realRun(file, args, options);
      throw Object.assign(new Error("Command failed: git grep"), { code: 128, stderr: "fatal: unable to read tree (deadbeef)\n" });
    });

    await expect(h.readSource!(repo(), { kind: "grep", pattern: "LEDGER" })).rejects.toThrow("Command failed");
    expect(gitCommands().filter((command) => command === "grep")).toHaveLength(1);
  });

  it("cuts a glob at 500 paths, and at a smaller limit when asked", async () => {
    const work = tempDir("many");
    git(work, "init", "-q", "-b", "main");
    for (let i = 0; i < 520; i += 1) writeFileSync(join(work, `f${String(i).padStart(3, "0")}.txt`), `${i}\n`);
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "many");
    git(work, "push", "-q", "-f", remote.bare, "main:main");
    const h = host();

    expect(await h.readSource!(repo(), { kind: "glob", pattern: "*.txt" })).toMatchObject({ cut: { left: 20, by: "paths" } });
    const limited = await h.readSource!(repo(), { kind: "glob", pattern: "*.txt", limit: 10 });
    expect(limited).toMatchObject({ cut: { left: 510, by: "limit" } });
    if (limited.kind !== "glob") throw new Error("expected a glob");
    expect(limited.paths).toHaveLength(10);
    rmSync(work, { recursive: true, force: true });
  });
});

describe("a read sees the remote's default branch, never a run's branch", () => {
  it("can't reach a run branch in the clone, or another branch pushed to the remote", async () => {
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    // A run's branch lives in the clone's refs/heads, as a provision cuts it.
    const clone = join(root, ".clones", readdirSync(join(root, ".clones")).find((name) => name.endsWith(".git"))!);
    const scratch = tempDir("run-branch");
    git(scratch, "init", "-q");
    writeFileSync(join(scratch, "run-secret.txt"), "RUN-SECRET-1\n");
    git(scratch, "add", ".");
    git(scratch, "commit", "-q", "-m", "a run's work");
    git(scratch, "push", "-q", clone, "HEAD:refs/heads/fsd/other-project-run");
    // A second project's branch on the same remote, pushed but not the default.
    remote.commit("private-project", "private.txt", "PRIVATE-SECRET-2\n");
    clock += 61_000;

    const grep = await h.readSource!(repo(), { kind: "grep", pattern: "SECRET" });
    const runFile = await h.readSource!(repo(), { kind: "read", path: "run-secret.txt" });
    const otherFile = await h.readSource!(repo(), { kind: "read", path: "private.txt" });
    const glob = await h.readSource!(repo(), { kind: "glob" });

    expect(git(clone, "rev-parse", "--verify", "refs/heads/fsd/other-project-run")).not.toBe("");
    expect(git(clone, "rev-parse", "--verify", "refs/remotes/origin/private-project")).not.toBe("");
    expect(grep).toMatchObject({ matches: [] });
    expect(runFile).toMatchObject({ status: "missing" });
    expect(otherFile).toMatchObject({ status: "missing" });
    if (glob.kind !== "glob") throw new Error("expected a glob");
    expect(glob.paths).not.toContain("run-secret.txt");
    expect(glob.paths).not.toContain("private.txt");
    rmSync(scratch, { recursive: true, force: true });
  });

  it("serves the commit the last fetch stamped while another fetch prunes the default branch it named", async () => {
    const h = host();
    const first = await h.readSource!(repo(), { kind: "glob" });
    // The remote renames its default branch, and deletes the old one.
    remote.commit("trunk", "trunk.txt", "on trunk\n");
    remote.setDefault("trunk");
    git(remote.bare, "branch", "-D", "main");
    clock += 61_000;
    // Between this host's `fetch --prune` (main is gone) and its pointing
    // origin/HEAD at trunk, a second host on the root reads.
    let during: Promise<unknown> | undefined;
    spawned.mockImplementation(async (file, args, options) => {
      const [command, ...rest] = subcommand(args);
      if (during === undefined && command === "symbolic-ref" && rest.length === 2) {
        // The first host's lock is live on the host's clock, which the test moved on.
        const lock = join(root, ".clones", readdirSync(join(root, ".clones")).find((name) => name.endsWith(".lock"))!);
        utimesSync(lock, new Date(clock), new Date(clock));
        during = host().readSource!(repo(), { kind: "read", path: "marker.txt" }).catch((error: unknown) => error);
        await during;
      }
      return await realRun(file, args, options);
    });

    const after = await h.readSource!(repo(), { kind: "read", path: "trunk.txt" });

    expect(await during).toMatchObject({ status: "ok", content: "marker A" });
    expect((await during as { at: unknown }).at).toMatchObject({ branch: "main", commit: first.at.kind === "repo" ? first.at.commit : "" });
    expect(after).toMatchObject({ status: "ok", content: "on trunk" });
    expect(after.at).toMatchObject({ branch: "trunk", commit: remote.rev("trunk") });
  });

  it("still reads a clone whose fetch stamp is from before stamps named the commit", async () => {
    await host().readSource!(repo(), { kind: "glob" });
    const stamp = join(root, ".clones", readdirSync(join(root, ".clones")).find((name) => name.endsWith(".fetched.json"))!);
    writeFileSync(stamp, JSON.stringify({ at: clock }));

    const read = await host().readSource!(repo(), { kind: "read", path: "marker.txt" });
    expect(read).toMatchObject({ status: "ok", content: "marker A" });
    expect(read.at).toMatchObject({ branch: "main", commit: remote.rev("main"), ageMs: 0 });
  });

  it("follows the remote's default branch when it moves", async () => {
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    remote.commit("trunk", "trunk.txt", "on trunk\n");
    remote.setDefault("trunk");
    clock += 61_000;

    const read = await h.readSource!(repo(), { kind: "read", path: "trunk.txt" });
    expect(read).toMatchObject({ status: "ok", content: "on trunk" });
    expect(read.at).toMatchObject({ branch: "trunk", commit: remote.rev("trunk") });
  });
});

describe("a read fetches at most once a minute, and never waits on the clone's lock", () => {
  const fetches = () => gitCommands().filter((command) => command === "fetch").length;
  const cloneLock = () => join(root, ".clones", readdirSync(join(root, ".clones")).find((name) => name.endsWith(".lock") || name.endsWith(".git"))!.replace(/\.git$/, ".lock"));

  it("serves a burst of reads from one fetch, and fetches again once the minute is up", async () => {
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    const after = remote.commit("main", "later.txt", "later\n");
    clock += 30_000;
    const soon = await h.readSource!(repo(), { kind: "read", path: "later.txt" });
    expect(soon).toMatchObject({ status: "missing" });
    expect(fetches()).toBe(1);

    clock += 31_000;
    const late = await h.readSource!(repo(), { kind: "read", path: "later.txt" });
    expect(late).toMatchObject({ status: "ok", content: "later" });
    expect(late.at).toMatchObject({ commit: after });
    expect(fetches()).toBe(2);
  });

  it("keeps the fetch time on disk, where another host on the root reads it", async () => {
    await host().readSource!(repo(), { kind: "glob" });
    const stamp = readdirSync(join(root, ".clones")).find((name) => name.endsWith(".fetched.json"));
    expect(stamp).toBeDefined();
    spawned.mockClear();

    await host().readSource!(repo(), { kind: "glob" });
    expect(fetches()).toBe(0);
  });

  it("serves the last fetched commit, with its age, while a provision holds the clone's lock", async () => {
    const h = host();
    const first = await h.readSource!(repo(), { kind: "glob" });
    remote.commit("main", "later.txt", "later\n");
    clock += 90_000;
    const lease = await acquireLock(cloneLock());
    // Live on the host's clock, which the test moved on.
    utimesSync(cloneLock(), new Date(clock), new Date(clock));
    spawned.mockClear();
    try {
      const started = Date.now();
      const read = await h.readSource!(repo(), { kind: "read", path: "later.txt" });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(read).toMatchObject({ status: "missing" });
      expect(read.at).toMatchObject({ commit: first.at.kind === "repo" ? first.at.commit : "", ageMs: 90_000 });
      expect(fetches()).toBe(0);
    } finally {
      releaseLock(lease);
    }
  });

  it("serves the last fetched commit when the fetch runs out of time", async () => {
    const h = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: noSource, now: () => clock, provisionTimeoutMs: 60_000 });
    const first = await h.readSource!(repo(), { kind: "glob" });
    remote.commit("main", "later.txt", "later\n");
    clock += 90_000;
    // A remote that never answers: the call uses its whole wall clock, then is killed.
    spawned.mockImplementation(async (file, args, options) => {
      if (subcommand(args)[0] !== "ls-remote") return await realRun(file, args, options);
      clock += options.timeoutMs;
      throw Object.assign(new Error("Command failed: git ls-remote"), { killed: true, signal: "SIGTERM", code: null });
    });

    const read = await h.readSource!(repo(), { kind: "read", path: "marker.txt" });
    expect(read).toMatchObject({ status: "ok", content: "marker A" });
    expect(read.at).toMatchObject({ commit: first.at.kind === "repo" ? first.at.commit : "" });
  });

  it("takes a lock left by a holder that died, and fetches", async () => {
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    const after = remote.commit("main", "later.txt", "later\n");
    clock += 90_000;
    writeFileSync(cloneLock(), JSON.stringify({ token: "dead" }));
    // Older than the stale bound on the host's own clock.
    const old = new Date(clock - 10 * 60_000);
    utimesSync(cloneLock(), old, old);

    const read = await h.readSource!(repo(), { kind: "read", path: "later.txt" });
    expect(read).toMatchObject({ status: "ok" });
    expect(read.at).toMatchObject({ commit: after });
  });

  it("makes the first clone without the lock, so a held lock never stalls it", async () => {
    // The lock a provision would hold, taken before any clone exists.
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    const lockPath = cloneLock();
    rmSync(join(root, ".clones"), { recursive: true, force: true });
    const lease = await acquireLock(lockPath);
    try {
      const read = await h.readSource!(repo(), { kind: "read", path: "marker.txt" });
      expect(read).toMatchObject({ status: "ok", content: "marker A" });
    } finally {
      releaseLock(lease);
    }
  });

  it("is freshened by a provision's fetch", async () => {
    const h = host();
    await h.readSource!(repo(), { kind: "glob" });
    const after = remote.commit("main", "later.txt", "later\n");
    clock += 90_000;
    await h.provision(repo(), { place: ["run-1"], branch: "fsd/run-1" });
    spawned.mockClear();

    const read = await h.readSource!(repo(), { kind: "read", path: "later.txt" });
    expect(read).toMatchObject({ status: "ok" });
    expect(read.at).toMatchObject({ commit: after });
    expect(fetches()).toBe(0);
  });
});

describe("refusals", () => {
  it("refuses a refused answer with its own reason, before any git process", async () => {
    const attempt = host().readSource!({ kind: "refused", reason: "not-a-member", message: "no" }, { kind: "glob" });
    await expect(attempt).rejects.toMatchObject({ reason: "not-a-member" });
    expect(spawned).not.toHaveBeenCalled();
  });

  it("refuses a remote the host may not reach, before any git process", async () => {
    const attempt = localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: noSource }).readSource!(repo(), { kind: "glob" });
    await expect(attempt).rejects.toMatchObject({ reason: "remote-not-allowed" });
    expect(spawned).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".clones"))).toBe(false);
  });
});

describe("a project with no repository reads its kept files", () => {
  it("lists, reads and greps one project's files, asking the collection for that prefix alone", async () => {
    const collection = createFakeCollection("project-files/**", {
      "p1/notes/plan.md": "# Plan\nLEDGER_CODE = LC-1\n",
      "p1/notes/todo.md": "nothing\n",
      "p2/secret.md": "LEDGER_CODE = OTHER\n",
    });
    const answer: RunSourceAnswer = { kind: "files", projectId: "p1", files: { collection, collectionId: "project-files" } };
    const h = host();

    const glob = await h.readSource!(answer, { kind: "glob" });
    const read = await h.readSource!(answer, { kind: "read", path: "notes/plan.md", startLine: 2 });
    const grep = await h.readSource!(answer, { kind: "grep", pattern: "LEDGER_CODE" });

    expect(glob).toMatchObject({ kind: "glob", at: { kind: "files" }, paths: ["notes/plan.md", "notes/todo.md"] });
    expect(read).toMatchObject({ status: "ok", content: "LEDGER_CODE = LC-1", startLine: 2 });
    expect(grep).toMatchObject({ dialect: "javascript-regex", matches: [{ path: "notes/plan.md", line: 2 }] });
    expect(collection.listCalls().every((prefix) => prefix === "p1/")).toBe(true);
    expect(collection.listCalls().length).toBeGreaterThan(0);
    expect(collection.contentReads().some((key) => key.startsWith("p2/"))).toBe(false);
    expect(spawned).not.toHaveBeenCalled();
    expect(placesUnder()).toEqual([]);
  });
});

describe("a project mapped to a checkout on this machine", () => {
  it("reads the base a new run there would be cut from, never the working tree", async () => {
    const checkout = join(tempDir("checkout"), "repo");
    git(join(checkout, ".."), "clone", "-q", remote.bare, checkout);
    const base = git(checkout, "rev-parse", "HEAD");
    writeFileSync(join(checkout, "marker.txt"), "uncommitted edit");
    const h = host({ localRepositories: [checkout] });

    const read = await h.readSource!({ kind: "repo", repo: checkout }, { kind: "read", path: "marker.txt" });
    expect(read).toMatchObject({ status: "ok", content: "marker A" });
    expect(read.at).toMatchObject({ kind: "repo", commit: base, branch: "HEAD", fetchedAt: null });
    expect(readFileSync(join(checkout, "marker.txt"), "utf8")).toBe("uncommitted edit");
    expect(placesUnder()).toEqual([]);
    expect(gitCommands()).not.toContain("worktree");
  });

  it("refuses a checkout path the operator did not list", async () => {
    const attempt = host().readSource!({ kind: "repo", repo: remote.bare }, { kind: "glob" });
    await expect(attempt).rejects.toMatchObject({ reason: "invalid-remote" });
  });
});
