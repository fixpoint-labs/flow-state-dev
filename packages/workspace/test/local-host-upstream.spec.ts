/**
 * A repository on this machine that tracks an upstream: a new run's branch
 * starts from whichever of the two copies of its base is newer.
 *
 * The person's repository is a real clone of a real bare upstream over
 * `file://`, and the upstream moves on through another clone, the way a
 * teammate's merge does. The host is built as the Shift Manager Lab builds
 * it: no remote allowed, the clone listed in `localRepositories`. Nothing is
 * fetched by the test itself, so a branch that holds the upstream commit got
 * it from the host. Every assertion reads the person's repository with git,
 * not what the host reports.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/exec";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return { ...actual, run: vi.fn(actual.run) };
});

const spawned = vi.mocked(run);
/** The git subcommand, past any leading `-c <key>=<value>` pairs. */
const subcommand = (args: readonly string[]) => args.find((arg, i) => arg !== "-c" && args[i - 1] !== "-c");
const gitCommands = () => spawned.mock.calls.map(([, args]) => subcommand(args));
const fetches = () => spawned.mock.calls.filter(([, args]) => subcommand(args) === "fetch");
const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

let root: string;
/** The person's clone, with `main` checked out and `origin` a `file://` URL. */
let repo: string;
let upstream: Remote;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = tempDir("host");
  upstream = createRemote("marker A");
  repo = join(tempDir("person"), "repo");
  git(join(repo, ".."), "clone", "-q", upstream.url, repo);
  spawned.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

/** Built as the Lab builds it: no remote allowed, the person's clone listed. */
function host(over: { provisionTimeoutMs?: number } = {}) {
  return localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: noSource, ...over });
}

function provision(baseRef: string | undefined, run = "run-1") {
  return host().provision(
    { kind: "repo", repo, ...(baseRef !== undefined ? { baseRef } : {}) },
    { place: [run], branch: `fsd/${run}` },
  );
}

/** Commit on the person's own `main`, never pushed. */
function commitLocally(file: string): string {
  git(repo, "commit", "-q", "--allow-empty", "-m", `${file} locally`);
  return git(repo, "rev-parse", "HEAD");
}

/** Whether `commit` is in the history of `ref`, in the person's repository. */
function contains(ref: string, commit: string): boolean {
  try {
    git(repo, "merge-base", "--is-ancestor", commit, ref);
    return true;
  } catch {
    return false;
  }
}

/** Every ref in the person's repository except the upstream's tracking ref, and the tree's state. */
function personalState(): { refs: string; status: string; head: string } {
  // A symbolic ref (`origin/HEAD`) is compared by what it points at, not through it.
  const refs = git(repo, "for-each-ref", "--format=%(refname) %(if)%(symref)%(then)-> %(symref)%(else)%(objectname)%(end)")
    .split("\n")
    .filter((line) => !line.startsWith("refs/remotes/origin/main ") && !line.startsWith("refs/heads/fsd/"))
    .join("\n");
  return { refs, status: git(repo, "status", "--porcelain", "--untracked-files=all"), head: git(repo, "symbolic-ref", "HEAD") };
}

describe("a person who hasn't pulled: the run starts from upstream", () => {
  it("cuts the branch at upstream's commit and leaves the person's main, index and files alone", async () => {
    const before = personalState();
    const pushed = upstream.commit("main", "merged.txt", "a teammate's merge");
    const localMain = git(repo, "rev-parse", "main");

    const place = await provision("main");

    // starts-from-upstream: read in the repository, not from the place.
    expect(contains("refs/heads/fsd/run-1", pushed)).toBe(true);
    // local-base-unmoved
    expect(git(repo, "rev-parse", "refs/heads/main")).toBe(localMain);
    expect(personalState()).toEqual(before);
    expect(place.repo).toMatchObject({ created: true, baseRef: "main", baseCommit: pushed });
  });

  it("catches up three commits as well as one", async () => {
    upstream.commit("main", "one.txt", "1");
    upstream.commit("main", "two.txt", "2");
    const third = upstream.commit("main", "three.txt", "3");

    await provision("main");

    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(third);
  });

  it("follows HEAD's branch when no base is named, and records HEAD as the base", async () => {
    const pushed = upstream.commit("main", "merged.txt", "a teammate's merge");

    const place = await provision(undefined);

    expect(contains("refs/heads/fsd/run-1", pushed)).toBe(true);
    expect(place.repo).toMatchObject({ baseRef: "HEAD", baseCommit: pushed });
  });

  it("moves only the upstream's tracking ref: every other ref, HEAD and the status are as they were", async () => {
    git(repo, "branch", "-q", "feature");
    git(repo, "tag", "v1");
    const before = personalState();
    upstream.commit("main", "merged.txt", "a teammate's merge");
    upstream.commit("other", "other.txt", "another branch upstream");

    await provision("main");

    const after = personalState();
    expect(after.refs).toBe(before.refs);
    expect(after.head).toBe(before.head);
    // Only `main`'s upstream was fetched: `other` stays unknown here.
    expect(git(repo, "for-each-ref", "refs/remotes/origin/other")).toBe("");
    expect(git(repo, "rev-parse", "refs/remotes/origin/main")).toBe(upstream.rev("main"));
  });

  it("fetches though the host allows no remote: listing the checkout admits its upstream", async () => {
    upstream.commit("main", "merged.txt", "a teammate's merge");

    await provision("main");

    expect(fetches()).toHaveLength(1);
    const [, args, options] = fetches()[0]!;
    expect(args).toContain(upstream.url);
    // Git may speak exactly the upstream's transport, and never prompts.
    expect(options.env).toMatchObject({ GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0" });
  });
});

describe("a person whose main is ahead, or level", () => {
  it("cuts from local main when it has commits upstream lacks", async () => {
    const mine = commitLocally("unpushed");

    const place = await provision("main");

    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(mine);
    expect(place.repo?.baseCommit).toBe(mine);
  });

  it("cuts from local main when the two are the same commit", async () => {
    const place = await provision("main");

    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(upstream.rev("main"));
    expect(place.repo?.baseCommit).toBe(upstream.rev("main"));
  });
});

describe("a main and an upstream that have each moved", () => {
  it("is refused as base-diverged, naming both commits, with nothing made", async () => {
    const mine = commitLocally("unpushed");
    const theirs = upstream.commit("main", "merged.txt", "a teammate's merge");

    const attempt = provision("main");

    await expect(attempt).rejects.toBeInstanceOf(WorkspaceRefusedError);
    await expect(attempt).rejects.toMatchObject({ reason: "base-diverged" });
    const message = ((await attempt.catch((error: Error) => error)) as Error).message;
    expect(message).toContain(repo);
    expect(message).toContain(mine);
    expect(message).toContain(theirs);
    expect(message).toMatch(/pull or rebase, or push/);
    expect(existsSync(join(root, "run-1"))).toBe(false);
    expect(existsSync(join(root, "run-1.provisioning"))).toBe(false);
    expect(git(repo, "branch", "--list", "fsd/run-1")).toBe("");
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain(join(root, "run-1"));
    expect(git(repo, "rev-parse", "main")).toBe(mine);
  });
});

describe("a base with no upstream is cut as it is, with no fetch", () => {
  const cases: Array<[string, () => string]> = [
    ["a tag", () => (git(repo, "tag", "v1"), "v1")],
    ["a commit id", () => git(repo, "rev-parse", "HEAD")],
    ["a branch that tracks nothing", () => (git(repo, "branch", "-q", "--no-track", "solo"), "solo")],
    ["a branch that tracks another local branch", () => (git(repo, "branch", "-q", "--track", "follows", "main"), "follows")],
  ];
  for (const [what, makeBase] of cases) {
    it(`${what}`, async () => {
      const base = makeBase();
      const expected = git(repo, "rev-parse", `${base}^{commit}`);
      upstream.commit("main", "merged.txt", "a teammate's merge");
      spawned.mockClear();

      await provision(base);

      expect(gitCommands()).not.toContain("fetch");
      expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(expected);
    });
  }

  it("except a remote-tracking ref named directly, which is the remote's branch as it is now: fetched", async () => {
    const merged = upstream.commit("main", "merged.txt", "a teammate's merge");
    spawned.mockClear();

    await provision("origin/main");

    expect(gitCommands()).toContain("fetch");
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(merged);
  });

  it("a detached HEAD", async () => {
    git(repo, "checkout", "-q", "--detach");
    const expected = git(repo, "rev-parse", "HEAD");
    upstream.commit("main", "merged.txt", "a teammate's merge");
    spawned.mockClear();

    await provision(undefined);

    expect(gitCommands()).not.toContain("fetch");
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(expected);
  });
});

describe("a fetch that can't happen starts from the local base", () => {
  it("starts from local main when the upstream is gone, not from a tracking ref a run could have moved", async () => {
    const localMain = git(repo, "rev-parse", "main");
    // A run plants a tip on the shared tracking ref, then breaks the fetch.
    const planted = git(repo, "commit-tree", "-p", localMain, "-m", "planted", `${localMain}^{tree}`);
    git(repo, "update-ref", "refs/remotes/origin/main", planted);
    renameSync(upstream.bare, `${upstream.bare}.gone`);

    const place = await provision("main");

    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(localMain);
    expect(place.repo?.baseCommit).toBe(localMain);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain(repo);
    expect(message).toContain(upstream.url);
    expect(message).toContain(`starts from the local "main"`);
  });

  it("starts from local main when the fetch is skipped, though the tracking ref is ahead of it", async () => {
    // Fetched by the person once and never pulled: still not used without a fetch.
    upstream.commit("main", "merged.txt", "a teammate's merge");
    git(repo, "fetch", "-q", "origin");
    const localMain = git(repo, "rev-parse", "main");
    const h = host();
    git(repo, "config", "remote.origin.url", createRemote("elsewhere").url);

    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(fetches()).toHaveLength(0);
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(localMain);
  });

  it("still refuses a remote whose URL carries a token, and the pin never saves the token", async () => {
    const token = "ghp_secretsecretsecret";
    git(repo, "config", "remote.origin.url", `https://x-access-token:${token}@github.com/acme/app.git`);
    const localMain = git(repo, "rev-parse", "main");

    const place = await provision("main");

    expect(fetches()).toHaveLength(0);
    expect(place.repo?.baseCommit).toBe(localMain);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain("carries a password");
    expect(message).not.toContain(token);
    const pinned = readdirSync(join(root, ".fetch-pins")).filter((name) => name.endsWith(".json"));
    expect(pinned.map((name) => readFileSync(join(root, ".fetch-pins", name), "utf8")).join("")).not.toContain(token);
  });

  it("falls back with a warning when the fetched tracking ref is locked and can't move", async () => {
    const localMain = git(repo, "rev-parse", "main");
    upstream.commit("main", "merged.txt", "a teammate's merge");
    writeFileSync(join(repo, ".git", "refs", "remotes", "origin", "main.lock"), "");

    const place = await provision("main");

    // Never cut from a commit the tracking ref doesn't hold.
    expect(git(repo, "rev-parse", "refs/remotes/origin/main")).toBe(localMain);
    expect(place.repo?.baseCommit).toBe(localMain);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("could not fetch");
  });

  it("never moves the person's branch through a tracking ref a run made symbolic", async () => {
    const mine = commitLocally("mine.txt");
    upstream.commit("main", "merged.txt", "a teammate's merge");
    git(repo, "symbolic-ref", "refs/remotes/origin/main", "refs/heads/main");

    await provision("main").catch(() => undefined);

    expect(git(repo, "rev-parse", "refs/heads/main")).toBe(mine);
  });

  it("cuts from local when the fetch fails and nothing was ever fetched", async () => {
    const lone = join(tempDir("lone"), "repo");
    git(join(lone, ".."), "init", "-q", "-b", "main", lone);
    git(lone, "commit", "-q", "--allow-empty", "-m", "first");
    git(lone, "remote", "add", "origin", join(lone, "..", "missing.git"));
    git(lone, "config", "branch.main.remote", "origin");
    git(lone, "config", "branch.main.merge", "refs/heads/main");
    const h = localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [lone], source: noSource });

    await h.provision({ kind: "repo", repo: lone, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(lone, "rev-parse", "refs/heads/fsd/run-1")).toBe(git(lone, "rev-parse", "main"));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never hands git an upstream URL that fails the shape check, and warns", async () => {
    const planted = join(tempDir("planted"), "ran");
    git(repo, "config", "remote.origin.url", `ext::sh -c touch% ${planted}`);
    upstream.commit("main", "merged.txt", "a teammate's merge");

    await provision("main");

    expect(fetches()).toHaveLength(0);
    for (const [, args] of spawned.mock.calls) expect(args.join(" ")).not.toContain("ext::");
    expect(existsSync(planted)).toBe(false);
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(git(repo, "rev-parse", "main"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/not fetched/);
  });

  it("gives up on a fetch that hangs inside a slice of the budget, and still finishes the provision", async () => {
    const actual = await vi.importActual<typeof import("../src/exec")>("../src/exec");
    spawned.mockImplementation((file, args, options) =>
      subcommand(args) === "fetch" ? actual.run("sleep", ["30"], options) : actual.run(file, args, options),
    );
    const budget = 4_000;
    const started = Date.now();
    try {
      await host({ provisionTimeoutMs: budget }).provision(
        { kind: "repo", repo, baseRef: "main" },
        { place: ["run-1"], branch: "fsd/run-1" },
      );
    } finally {
      spawned.mockImplementation(actual.run);
    }

    expect(Date.now() - started).toBeLessThan(budget);
    expect(fetches()[0]![2].timeoutMs).toBeLessThan(budget);
    expect(git(repo, "branch", "--list", "fsd/run-1")).not.toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("a run that already has its branch is handed back, never fetched or moved", () => {
  it("runs no fetch on a second provision, after upstream moved again", async () => {
    upstream.commit("main", "one.txt", "1");
    const first = await provision("main");
    const tip = git(repo, "rev-parse", "refs/heads/fsd/run-1");
    upstream.commit("main", "two.txt", "2");
    spawned.mockClear();

    const again = await provision("main");

    expect(again.repo?.created).toBe(false);
    expect(again.cwd).toBe(first.cwd);
    expect(gitCommands()).not.toContain("fetch");
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(tip);
  });
});

describe("two runs on one checkout at once", () => {
  it("both start", async () => {
    const pushed = upstream.commit("main", "merged.txt", "a teammate's merge");

    const [a, b] = await Promise.all([provision("main", "run-a"), provision("main", "run-b")]);

    expect(a.repo?.created).toBe(true);
    expect(b.repo?.created).toBe(true);
    expect(contains("refs/heads/fsd/run-a", pushed)).toBe(true);
    expect(contains("refs/heads/fsd/run-b", pushed)).toBe(true);
  });
});

/** A script that leaves `marker` behind when it runs, then does `then`. */
function markerScript(marker: string, then = "exit 1"): string {
  const script = join(tempDir("script"), "run.sh");
  writeFileSync(script, `#!/bin/sh\necho ran >> '${marker}'\n${then}\n`);
  chmodSync(script, 0o755);
  return script;
}

describe("a run that rewrites the checkout's shared config can't aim the next run's fetch", () => {
  it("does not fetch from a remote a run repointed after the host started, and warns naming both URLs", async () => {
    const h = host();
    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });
    // The run, in its worktree, repoints origin at a repository of its choosing.
    const other = createRemote("someone else's");
    const planted = other.commit("main", "planted.txt", "not the person's upstream");
    git(repo, "config", "remote.origin.url", other.url);
    spawned.mockClear();
    warn.mockClear();

    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-2"], branch: "fsd/run-2" });

    expect(fetches()).toHaveLength(0);
    expect(contains("refs/remotes/origin/main", planted)).toBe(false);
    expect(contains("refs/heads/fsd/run-2", planted)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain(repo);
    expect(message).toContain(`remote "origin"`);
    expect(message).toContain(other.url);
    expect(message).toContain(upstream.url);
  });

  it("fetches the upstream branch pinned at start, not one a run repointed main at", async () => {
    const h = host();
    // On the person's own remote, a branch that descends from main with code the person never chose.
    const planted = upstream.commit("attacker", "planted.txt", "not main");
    // The run, in its worktree, points main's upstream at that branch.
    git(repo, "config", "branch.main.merge", "refs/heads/attacker");
    spawned.mockClear();

    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(contains("refs/heads/fsd/run-1", planted)).toBe(false);
    expect(fetches()).toHaveLength(1);
    expect(fetches()[0]![1]).toContain("+refs/heads/main:refs/remotes/origin/main");
    expect(warn.mock.calls.map(([m]) => String(m)).join("\n")).toContain("refs/remotes/origin/attacker");
  });

  it("fetches the pinned URL, never one a url.insteadOf a run added rewrites it to", async () => {
    // The person's own rewrite: origin is spelled as an alias the host pins expanded.
    git(repo, "config", `url.${upstream.url}.insteadOf`, "person-alias:");
    git(repo, "config", "remote.origin.url", "person-alias:");
    const h = host();
    const other = createRemote("someone else's");
    const planted = other.commit("main", "planted.txt", "not the person's upstream");
    // Leaves origin's own URL as it was, but rewrites the pinned URL itself.
    git(repo, "config", `url.${other.url}.insteadOf`, upstream.url);

    const pushed = upstream.commit("main", "merged.txt", "a teammate's merge");

    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    // The fetch never reads the person's config, so the rule has nothing to rewrite.
    expect(fetches()).toHaveLength(1);
    expect(contains("refs/remotes/origin/main", planted)).toBe(false);
    expect(contains("refs/heads/fsd/run-1", pushed)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never runs an upload-pack a run planted for the remote, by name or by URL", async () => {
    const h = host();
    const marker = join(tempDir("marker"), "ran");
    const script = markerScript(marker, 'exec git-upload-pack "$@"');
    git(repo, "config", "remote.origin.uploadpack", script);
    git(repo, "config", `remote.${upstream.url}.uploadpack`, script);
    const pushed = upstream.commit("main", "merged.txt", "a teammate's merge");

    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(existsSync(marker)).toBe(false);
    // The fetch itself still happened, through the real upload-pack.
    expect(contains("refs/heads/fsd/run-1", pushed)).toBe(true);
  });

  it("never runs a core.sshCommand a run planted, for an ssh upstream", async () => {
    git(repo, "config", "remote.origin.url", "ssh://127.0.0.1:1/person/repo.git");
    const h = host();
    const marker = join(tempDir("marker"), "ran");
    git(repo, "config", "core.sshCommand", markerScript(marker));

    await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(fetches()).toHaveLength(1);
    expect(existsSync(marker)).toBe(false);
    // ssh itself failed to connect: a warning, and the run still starts.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(git(repo, "branch", "--list", "fsd/run-1")).not.toBe("");
  });

  describe("an https upstream that asks for credentials", () => {
    let server: ReturnType<typeof createServer> | undefined;
    let savedGlobal: string | undefined;

    afterEach(async () => {
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
      await new Promise((done) => (server ? server.close(done) : done(undefined)));
      server = undefined;
    });

    it("never runs a credential.helper a run planted, and still runs the person's own", async () => {
      const certs = tempDir("tls");
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
        "-keyout", join(certs, "key.pem"), "-out", join(certs, "cert.pem"),
      ], { stdio: "ignore" });
      server = createServer({ key: readFileSync(join(certs, "key.pem")), cert: readFileSync(join(certs, "cert.pem")) }, (_, res) => {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="upstream"' }).end();
      });
      await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
      const port = (server.address() as AddressInfo).port;
      git(repo, "config", "remote.origin.url", `https://127.0.0.1:${port}/person/repo.git`);

      // The person's own helper, in their global config.
      const theirs = join(tempDir("marker"), "theirs");
      const globalConfig = join(tempDir("global"), "gitconfig");
      writeFileSync(globalConfig, `[credential]\n\thelper = ${markerScript(theirs)}\n[http]\n\tsslVerify = false\n`);
      savedGlobal = process.env.GIT_CONFIG_GLOBAL;
      process.env.GIT_CONFIG_GLOBAL = globalConfig;
      const h = host();
      // What a run plants in the shared config.
      const planted = join(tempDir("marker"), "planted");
      git(repo, "config", "credential.helper", markerScript(planted));
      git(repo, "config", "credential.https://127.0.0.1.helper", markerScript(planted));

      await h.provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

      expect(fetches()).toHaveLength(1);
      expect(existsSync(planted)).toBe(false);
      expect(existsSync(theirs)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});

/** The pin file a mismatch warning tells the person to delete. */
function refreshFile(message: string): string {
  const match = /delete (\S+) and restart the host/.exec(message);
  if (match === null) throw new Error(`no refresh step in: ${message}`);
  return match[1]!;
}

describe("a host restart keeps the fetch settings it first saw", () => {
  it("does not fetch from a remote a run repointed before the restart, and says how to accept a new one", async () => {
    await provision("main", "run-1");
    // The run, in its worktree, repoints origin; then the host restarts.
    const other = createRemote("someone else's");
    const planted = other.commit("main", "planted.txt", "not the person's upstream");
    git(repo, "config", "remote.origin.url", other.url);
    spawned.mockClear();
    warn.mockClear();

    await provision("main", "run-2");

    expect(fetches()).toHaveLength(0);
    expect(contains("refs/remotes/origin/main", planted)).toBe(false);
    expect(contains("refs/heads/fsd/run-2", planted)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain(repo);
    expect(message).toContain(other.url);
    expect(message).toContain(upstream.url);
    // The refresh step names a file in the host's root, not in the repository.
    expect(refreshFile(message).startsWith(`${root}/`)).toBe(true);
    expect(existsSync(refreshFile(message))).toBe(true);
  });

  it("fetches the upstream branch pinned before the restart, not one a run repointed main at", async () => {
    await provision("main", "run-1");
    const planted = upstream.commit("attacker", "planted.txt", "not main");
    git(repo, "config", "branch.main.merge", "refs/heads/attacker");
    spawned.mockClear();

    await provision("main", "run-2");

    expect(contains("refs/heads/fsd/run-2", planted)).toBe(false);
    expect(fetches()).toHaveLength(1);
    expect(fetches()[0]![1]).toContain("+refs/heads/main:refs/remotes/origin/main");
  });

  it("fetches from a deliberately changed remote once the person runs the refresh step", async () => {
    await provision("main", "run-1");
    // The person moves their upstream on purpose.
    const moved = createRemote("moved");
    git(repo, "config", "remote.origin.url", moved.url);
    git(repo, "fetch", "-q", "origin");
    git(repo, "reset", "-q", "--hard", "origin/main");
    const pushed = moved.commit("main", "merged.txt", "a teammate's merge on the new remote");
    warn.mockClear();
    await provision("main", "run-2");
    expect(contains("refs/heads/fsd/run-2", pushed)).toBe(false);
    const file = refreshFile(String(warn.mock.calls[0]![0]));

    rmSync(file);
    spawned.mockClear();
    warn.mockClear();
    await provision("main", "run-3");

    expect(fetches()).toHaveLength(1);
    expect(fetches()[0]![1]).toContain(moved.url);
    expect(contains("refs/heads/fsd/run-3", pushed)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("fetches nothing from a pin file it can't read, leaves the file alone, and names it", async () => {
    await provision("main", "run-1");
    git(repo, "config", "remote.origin.url", createRemote("someone else's").url);
    warn.mockClear();
    await provision("main", "run-2");
    const file = refreshFile(String(warn.mock.calls[0]![0]));
    writeFileSync(file, "{ not json");
    const localMain = git(repo, "rev-parse", "main");
    spawned.mockClear();
    warn.mockClear();

    await provision("main", "run-3");

    expect(fetches()).toHaveLength(0);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-3")).toBe(localMain);
    expect(String(warn.mock.calls[0]![0])).toContain(`could not be read`);
    expect(refreshFile(String(warn.mock.calls[0]![0]))).toBe(file);
  });

  it("pins a branch's upstream the first time a host start sees it", async () => {
    await provision("main", "run-1");
    // The person starts tracking another upstream branch after the first start.
    upstream.commit("release", "release.txt", "release branch");
    git(repo, "fetch", "-q", "origin");
    git(repo, "branch", "-q", "--track", "release", "origin/release");
    const pushed = upstream.commit("release", "fix.txt", "a fix on release");

    await provision("release", "run-2");

    expect(contains("refs/heads/fsd/run-2", pushed)).toBe(true);
  });
});
