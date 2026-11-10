/**
 * Landing a run's accepted branch from a repository on this machine: push it
 * and open a pull request, or merge it into the person's checkout of its base.
 *
 * The person's repository is a real clone of a real bare upstream over
 * `file://`, listed in `localRepositories` with no remote allowed, as the
 * Teammates lab builds its host. `gh` is a script that logs what it was asked
 * and prints a pull request link. Every assertion reads git or that log, not
 * only what the host reports.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

const PR_URL = "https://github.com/acme/widgets/pull/42";

let root: string;
let repo: string;
let upstream: Remote;
let ghLog: string;
let gh: string;

beforeEach(() => {
  root = tempDir("land-host");
  upstream = createRemote("marker A");
  repo = join(tempDir("land-person"), "repo");
  git(join(repo, ".."), "clone", "-q", upstream.url, repo);
  // The person's own identity, in their checkout: a merge commit is theirs, so the host never
  // supplies one, and a machine with no global git identity (CI) must not decide these tests.
  git(repo, "config", "user.name", "The Person");
  git(repo, "config", "user.email", "person@example.com");
  const bin = tempDir("land-gh");
  ghLog = join(bin, "gh.log");
  gh = join(bin, "gh");
  // `pr list` finds none open; `pr create` prints the link, as gh does.
  writeFileSync(
    gh,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\npwd >> '${ghLog}.cwd'\nif [ "$2" = "list" ]; then echo '[]'; else echo '${PR_URL}'; fi\n`,
  );
  chmodSync(gh, 0o755);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** The GitHub repository the test's upstream stands for: its URL is a local `file://` one, which names none. */
const GITHUB_REPO = "github.com/acme/widgets";

function host(pullRequestRepo: ((url: string) => string | undefined) | null = () => GITHUB_REPO) {
  return localWorkspaceHost({
    root,
    remotes: { allow: [] },
    localRepositories: [repo],
    source: () => ({ kind: "repo", repo }),
    ...(pullRequestRepo === null ? {} : { pullRequestRepo }),
  });
}

/** A run's place, with one commit on its branch touching `file`. */
async function runWithCommit(file = "change.txt", content = "the run's change\n") {
  const h = host();
  const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
  writeFileSync(join(place.cwd, file), content);
  git(place.cwd, "add", file);
  git(place.cwd, "commit", "-q", "-m", "The run's change");
  return { h, place, commit: git(place.cwd, "rev-parse", "HEAD") };
}

const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n") : []);

describe("accepting a run by opening a pull request", () => {
  it("pushes the run's branch to the pinned remote and opens its pull request against the base", async () => {
    const { h, place, commit } = await runWithCommit();

    const landed = await h.land!(
      { cwd: place.cwd, branch: "fsd/run-1", baseRef: place.repo!.baseRef },
      { kind: "pull-request", title: "Add the change", body: "Why it changed.", gh },
    );

    // pushed: the branch is on the upstream, at the run's commit.
    expect(upstream.rev("refs/heads/fsd/run-1")).toBe(commit);
    // opened: gh was asked to create it, from the run's branch into main.
    expect(ghCalls().some((call) => call.startsWith("pr create") && call.includes(`--repo ${GITHUB_REPO}`) && call.includes("--head acme:fsd/run-1") && call.includes("--base main"))).toBe(true);
    expect(landed).toEqual({ kind: "pull-request", url: PR_URL, number: 42, branch: "fsd/run-1", base: "main", remote: upstream.url });
  });

  it("runs gh outside every checkout the run can configure, so it can't push again through the run's config", async () => {
    const { h, place } = await runWithCommit();

    await h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "pull-request", title: "t", body: "b", gh });

    const cwds = readFileSync(`${ghLog}.cwd`, "utf8").trim().split("\n");
    expect(cwds.length).toBeGreaterThan(0);
    for (const cwd of cwds) {
      // Not the run's worktree or the person's repository, and not inside a git repository at all.
      expect(cwd.startsWith(realpathSync(place.cwd))).toBe(false);
      expect(cwd.startsWith(realpathSync(repo))).toBe(false);
    }
    // gh is told the repository and the branch, so it never reads a remote or pushes it itself.
    expect(ghCalls().length).toBeGreaterThan(0);
    expect(ghCalls().every((call) => call.includes(`--repo ${GITHUB_REPO}`))).toBe(true);
    expect(ghCalls().filter((call) => call.startsWith("pr create")).every((call) => call.includes("--head acme:fsd/run-1"))).toBe(true);
  });

  it("refuses a pull request where the pinned remote names no GitHub repository, before pushing anything", async () => {
    const h = host(null);
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    writeFileSync(join(place.cwd, "change.txt"), "the run's change\n");
    git(place.cwd, "add", "change.txt");
    git(place.cwd, "commit", "-q", "-m", "The run's change");

    await expect(h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "pull-request", title: "t", body: "b", gh })).rejects.toMatchObject({
      reason: "no-pull-request-repo",
    });
    expect(() => upstream.rev("refs/heads/fsd/run-1")).toThrow();
    expect(ghCalls()).toEqual([]);
  });

  it("refuses to push to a remote repointed since the host started, and pushes nothing", async () => {
    const { h, place } = await runWithCommit();
    const elsewhere = createRemote("elsewhere");
    // A run shares the repository's config, so it can repoint origin.
    git(repo, "remote", "set-url", "origin", elsewhere.url);

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "pull-request", title: "t", body: "b", gh });

    await expect(landing).rejects.toMatchObject({ reason: "remote-repointed" });
    expect(() => elsewhere.rev("refs/heads/fsd/run-1")).toThrow();
    expect(() => upstream.rev("refs/heads/fsd/run-1")).toThrow();
    expect(ghCalls()).toEqual([]);
  });

  it("says the push failed when the remote is unreachable, and leaves the run's commit on its branch", async () => {
    const { h, place, commit } = await runWithCommit();
    rmSync(upstream.bare, { recursive: true, force: true });

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "pull-request", title: "t", body: "b", gh });

    await expect(landing).rejects.toBeInstanceOf(WorkspaceRefusedError);
    await expect(landing).rejects.toMatchObject({ reason: "push-failed" });
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(commit);
  });
});

describe("the ways a run can land, asked before its review", () => {
  it("offers both for a worktree of a listed repository whose remote names a GitHub repository", async () => {
    const { h, place } = await runWithCommit();
    expect(await h.landWays!({ cwd: place.cwd, branch: "fsd/run-1" })).toEqual(["pull-request", "merge"]);
  });

  it("offers only the merge when the remote names no GitHub repository", async () => {
    const h = host(null);
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    expect(await h.landWays!({ cwd: place.cwd, branch: "fsd/run-1" })).toEqual(["merge"]);
  });

  it("offers nothing for a checkout that isn't a worktree of a listed repository, where land would refuse", async () => {
    const h = host();
    const clone = join(tempDir("land-clone"), "clone");
    git(join(clone, ".."), "clone", "-q", upstream.url, clone);
    git(clone, "checkout", "-q", "-b", "fsd/run-1");
    expect(await h.landWays!({ cwd: clone, branch: "fsd/run-1" })).toEqual([]);
    await expect(h.land!({ cwd: clone, branch: "fsd/run-1" }, { kind: "merge" })).rejects.toMatchObject({ reason: "land-unsupported" });
  });
});

describe("accepting a run by merging it locally", () => {
  it("lands the run's commit on the base branch of the person's checkout", async () => {
    const { h, place, commit } = await runWithCommit();

    const landed = await h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseRef: "HEAD" }, { kind: "merge" });

    git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main");
    expect(readFileSync(join(repo, "change.txt"), "utf8")).toBe("the run's change\n");
    expect(landed).toEqual({ kind: "merge", branch: "main", commit: git(repo, "rev-parse", "main"), checkout: repo, from: "fsd/run-1" });
    // Nothing was pushed: a local merge stays local.
    expect(() => upstream.rev("refs/heads/fsd/run-1")).toThrow();
  });

  it("stops on a conflict, says which file, and leaves the person's checkout as it was", async () => {
    const { h, place } = await runWithCommit("marker.txt", "the run's marker\n");
    writeFileSync(join(repo, "marker.txt"), "the person's marker\n");
    git(repo, "commit", "-q", "-am", "The person's marker");
    const before = git(repo, "rev-parse", "main");

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" });

    await expect(landing).rejects.toMatchObject({ reason: "merge-conflict", message: expect.stringContaining("marker.txt") });
    expect(git(repo, "rev-parse", "main")).toBe(before);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("the person's marker\n");
  });

  it("refuses a checkout with uncommitted changes, and merges nothing", async () => {
    const { h, place, commit } = await runWithCommit();
    writeFileSync(join(repo, "marker.txt"), "edited, not committed\n");

    await expect(h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" })).rejects.toMatchObject({ reason: "checkout-dirty" });
    expect(() => git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main")).toThrow();
  });
  it("never overwrites an ignored file in the person's checkout that the run tracks, and merges nothing", async () => {
    writeFileSync(join(repo, ".gitignore"), "secret.txt\n");
    git(repo, "add", ".gitignore");
    git(repo, "commit", "-q", "-m", "Ignore the secret");
    const h = host();
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    writeFileSync(join(place.cwd, "secret.txt"), "the run's file\n");
    git(place.cwd, "add", "-f", "secret.txt");
    git(place.cwd, "commit", "-q", "-m", "Track the secret");
    writeFileSync(join(repo, "secret.txt"), "the person's secret\n");
    const before = git(repo, "rev-parse", "main");

    await expect(h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" })).rejects.toMatchObject({ reason: "merge-failed" });
    expect(readFileSync(join(repo, "secret.txt"), "utf8")).toBe("the person's secret\n");
    expect(git(repo, "rev-parse", "main")).toBe(before);
  });

  it("lands a real merge commit even when the checkout's config would squash it or leave it uncommitted", async () => {
    const { h, place, commit } = await runWithCommit();
    git(repo, "config", "branch.main.mergeOptions", "--squash --no-commit");

    const landed = await h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" });

    git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main");
    expect(landed).toMatchObject({ kind: "merge", branch: "main", commit: git(repo, "rev-parse", "main") });
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});

describe("a checkout in the middle of the person's own merge", () => {
  it("refuses before merging, and leaves the person's unfinished merge as it was", async () => {
    const { h, place, commit } = await runWithCommit();
    // The person's own merge, unfinished with a clean index: a side branch whose tree matches main's.
    git(repo, "checkout", "-q", "-b", "side");
    git(repo, "commit", "-q", "--allow-empty", "-m", "Side");
    git(repo, "checkout", "-q", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "Main");
    git(repo, "merge", "-q", "--no-commit", "--no-ff", "side");
    const mergeHead = readFileSync(join(repo, ".git", "MERGE_HEAD"), "utf8");
    const before = git(repo, "rev-parse", "main");

    await expect(h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" })).rejects.toMatchObject({ reason: "checkout-busy" });
    expect(readFileSync(join(repo, ".git", "MERGE_HEAD"), "utf8")).toBe(mergeHead);
    expect(git(repo, "rev-parse", "main")).toBe(before);
    expect(() => git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main")).toThrow();
  });
});

describe("a merge that git reports done but that didn't commit the run's work", () => {
  it("puts the checkout back where it was and says so, so nothing is left staged", async () => {
    const { h, place, commit } = await runWithCommit();
    const before = git(repo, "rev-parse", "main");
    // A git that squashes every merge, as a config the flags didn't reach would.
    const bin = tempDir("land-git");
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'case " $* " in *" merge --abort "*|*" merge "*" --abort "*) exec ' + `'${real}'` + ' "$@";; esac',
        'case " $* " in *" merge "*) ;; *) exec ' + `'${real}'` + ' "$@";; esac',
        // Drop the flags the host passes, and squash.
        'for a in "$@"; do shift; case "$a" in --commit|--no-squash) ;; *) set -- "$@" "$a";; esac; done',
        "exec " + `'${real}'` + ' "$@" --squash',
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "git"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" });

    await expect(landing).rejects.toMatchObject({ reason: "merge-failed", message: expect.stringContaining("Nothing changed in that checkout") });
    expect(git(repo, "rev-parse", "main")).toBe(before);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(() => git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main")).toThrow();
  });
});

describe("a merge never runs a program the run could have planted in the shared config", () => {
  /** A script that leaves `marker` behind when it runs, then does what `then` says. */
  function planted(marker: string, then: string): string {
    const bin = tempDir("land-planted");
    const script = join(bin, "planted");
    writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n${then}\n`);
    chmodSync(script, 0o755);
    return script;
  }

  it("runs no planted fsmonitor or filter while it checks and merges the person's checkout", async () => {
    const marker = join(tempDir("land-marker"), "ran");
    const h = host();
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    // The run shares the repository's config: it plants programs there, and attributes on its branch.
    git(place.cwd, "config", "core.fsmonitor", planted(marker, "exit 1"));
    git(place.cwd, "config", "filter.evil.smudge", `${planted(marker, "cat")}`);
    git(place.cwd, "config", "filter.evil.clean", `${planted(marker, "cat")}`);
    writeFileSync(join(place.cwd, ".gitattributes"), "*.txt filter=evil\n");
    writeFileSync(join(place.cwd, "change.txt"), "the run's change\n");
    git(place.cwd, "-c", "filter.evil.clean=cat", "-c", "core.fsmonitor=false", "add", ".gitattributes", "change.txt");
    git(place.cwd, "-c", "filter.evil.clean=cat", "-c", "core.fsmonitor=false", "commit", "-q", "-m", "The run's change");

    const landed = await h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" });

    expect(landed).toMatchObject({ kind: "merge", branch: "main" });
    expect(readFileSync(join(repo, "change.txt"), "utf8")).toBe("the run's change\n");
    expect(existsSync(marker)).toBe(false);
  });

  it("runs no planted filter whose name holds an =, which a -c key=value would split", async () => {
    const marker = join(tempDir("land-marker"), "ran");
    const h = host();
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    git(place.cwd, "config", "filter.a=b.smudge", planted(marker, "cat"));
    writeFileSync(join(place.cwd, ".gitattributes"), "*.txt filter=a=b\n");
    writeFileSync(join(place.cwd, "change.txt"), "the run's change\n");
    git(place.cwd, "add", ".gitattributes", "change.txt");
    git(place.cwd, "commit", "-q", "-m", "The run's change");

    await h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" });

    expect(readFileSync(join(repo, "change.txt"), "utf8")).toBe("the run's change\n");
    expect(existsSync(marker)).toBe(false);
  });

  it("runs no planted merge driver on a conflict, and still stops on it", async () => {
    const marker = join(tempDir("land-marker"), "ran");
    // The attribute is on the base already; only the driver it names is the run's.
    writeFileSync(join(repo, ".gitattributes"), "marker.txt merge=evil\n");
    git(repo, "add", ".gitattributes");
    git(repo, "commit", "-q", "-m", "Attributes");
    const h = host();
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    git(place.cwd, "config", "merge.evil.driver", planted(marker, "exit 0"));
    writeFileSync(join(place.cwd, "marker.txt"), "the run's marker\n");
    git(place.cwd, "add", "marker.txt");
    git(place.cwd, "commit", "-q", "-m", "The run's marker");
    writeFileSync(join(repo, "marker.txt"), "the person's marker\n");
    git(repo, "commit", "-q", "-am", "The person's marker");

    await expect(h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" })).rejects.toMatchObject({ reason: "merge-conflict" });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("the person's marker\n");
  });
});

describe("a merge that runs out of the landing's time", () => {
  it("still puts the checkout back, with its own time to do it, so Retry can run", async () => {
    const { h, place } = await runWithCommit();
    // Diverged, so the merge makes a commit; signing it takes longer than the landing may.
    writeFileSync(join(repo, "other.txt"), "the person's other change\n");
    git(repo, "add", "other.txt");
    git(repo, "commit", "-q", "-m", "The person's other change");
    const before = git(repo, "rev-parse", "main");
    // The person's own slow signer, in their global config: trusted, so the hardening leaves it on.
    const bin = tempDir("land-gpg");
    writeFileSync(join(bin, "slow-gpg"), "#!/bin/sh\nsleep 3\nexit 1\n");
    chmodSync(join(bin, "slow-gpg"), 0o755);
    writeFileSync(join(bin, "gitconfig"), `[commit]\n\tgpgSign = true\n[gpg]\n\tformat = openpgp\n\tprogram = ${join(bin, "slow-gpg")}\n`);
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(bin, "gitconfig"));

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge", timeoutMs: 1000 });

    // It failed on the landing's deadline, not on anything else, and was still undone.
    await expect(landing).rejects.toMatchObject({ reason: "merge-failed", message: expect.stringContaining("ran out of the landing's time") });
    vi.unstubAllEnvs();
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(repo, "rev-parse", "main")).toBe(before);
    expect(git(repo, "status", "--porcelain", "--untracked-files=no")).toBe("");
  }, 20_000);
});

describe("a run whose base is a remote-tracking ref", () => {
  for (const baseRef of ["origin/main", "refs/remotes/origin/main"]) {
    it(`merges into the local branch that tracks ${baseRef}, and opens a pull request into main on origin`, async () => {
      const { h, place, commit } = await runWithCommit();

      const merged = await h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseRef }, { kind: "merge" });
      expect(merged).toMatchObject({ kind: "merge", branch: "main" });
      git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main");

      const pr = await h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseRef }, { kind: "pull-request", title: "t", body: "b", gh });
      expect(pr).toMatchObject({ kind: "pull-request", base: "main", remote: upstream.url });
      expect(upstream.rev("refs/heads/fsd/run-1")).toBe(commit);
      expect(ghCalls().some((call) => call.startsWith("pr create") && call.includes("--base main"))).toBe(true);
    });
  }

  it("reads a local branch named origin/main as that branch, not as the remote's", async () => {
    const { h, place, commit } = await runWithCommit();
    git(repo, "checkout", "-q", "-b", "origin/main");
    const main = git(repo, "rev-parse", "refs/heads/main");

    const merged = await h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseRef: "origin/main" }, { kind: "merge" });

    expect(merged).toMatchObject({ kind: "merge", branch: "origin/main" });
    git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/origin/main");
    expect(git(repo, "rev-parse", "refs/heads/main")).toBe(main);
  });
});


// FIX-2658: a run moved its work off the branch it was given (renaming it to
// get past a refused push, or opening its own pull request), and Retry failed
// on `rev-parse … Needed a single revision` for a branch that no longer exists.
describe("landing a run whose work moved off its branch", () => {
  it("lands the branch its checkout is on, when that holds the run's commits", async () => {
    const { h, place, commit } = await runWithCommit();
    git(place.cwd, "branch", "-m", "fsd/run-1", "short-name");

    const landed = await h.land!(
      { cwd: place.cwd, branch: "fsd/run-1", baseRef: place.repo!.baseRef, baseCommit: place.repo!.baseCommit },
      { kind: "pull-request", title: "t", body: "b", gh },
    );

    expect(upstream.rev("refs/heads/short-name")).toBe(commit);
    expect(landed).toMatchObject({ kind: "pull-request", branch: "short-name", url: PR_URL });
    expect(ghCalls().some((call) => call.startsWith("pr create") && call.includes("--head acme:short-name"))).toBe(true);
  });

  it("refuses, naming what it found, when the checkout is on no branch holding the run's commits", async () => {
    const { h, place } = await runWithCommit();
    git(place.cwd, "checkout", "-q", "-b", "empty", place.repo!.baseCommit!);
    git(place.cwd, "branch", "-D", "fsd/run-1");

    await expect(
      h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseCommit: place.repo!.baseCommit }, { kind: "pull-request", title: "t", body: "b", gh }),
    ).rejects.toMatchObject({ reason: "branch-gone", message: expect.stringContaining(`on "empty"`) });
    expect(ghCalls()).toEqual([]);
  });

  it("takes the pull request already open from that branch, and opens no second one", async () => {
    const { h, place, commit } = await runWithCommit();
    git(place.cwd, "branch", "-m", "fsd/run-1", "teammates/tidy-task-list");
    // The run pushed it and opened its pull request itself.
    writeFileSync(
      gh,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\nif [ "$2" = "list" ]; then echo '[{"number":5027,"url":"https://github.com/acme/widgets/pull/5027"}]'; else echo '${PR_URL}'; fi\n`,
    );

    const landed = await h.land!(
      { cwd: place.cwd, branch: "fsd/run-1", baseCommit: place.repo!.baseCommit },
      { kind: "pull-request", title: "t", body: "b", gh },
    );

    expect(landed).toMatchObject({ kind: "pull-request", number: 5027, branch: "teammates/tidy-task-list" });
    expect(ghCalls().filter((call) => call.startsWith("pr create"))).toEqual([]);
    // The branch is still pushed, so a commit made since reaches the pull request.
    expect(upstream.rev("refs/heads/teammates/tidy-task-list")).toBe(commit);
  });

  it("takes that pull request when the push is refused but the remote's branch already holds the run's commit", async () => {
    const { h, place, commit } = await runWithCommit();
    git(place.cwd, "branch", "-m", "fsd/run-1", "teammates/tidy-task-list");
    // The run pushed its commit and one more on top: a push of the checkout's tip would not fast-forward.
    git(repo, "checkout", "-q", "-b", "ahead", commit);
    writeFileSync(join(repo, "other.txt"), "pushed by the run\n");
    git(repo, "add", "other.txt");
    git(repo, "commit", "-q", "-m", "Ahead");
    git(repo, "push", "-q", "origin", "ahead:refs/heads/teammates/tidy-task-list");
    const remoteTip = upstream.rev("refs/heads/teammates/tidy-task-list");
    writeFileSync(
      gh,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\nif [ "$2" = "list" ]; then echo '[{"number":5027,"url":"https://github.com/acme/widgets/pull/5027"}]'; else echo '${PR_URL}'; fi\n`,
    );

    const landed = await h.land!(
      { cwd: place.cwd, branch: "fsd/run-1", baseCommit: place.repo!.baseCommit },
      { kind: "pull-request", title: "t", body: "b", gh },
    );

    expect(landed).toMatchObject({ kind: "pull-request", number: 5027 });
    expect(upstream.rev("refs/heads/teammates/tidy-task-list")).toBe(remoteTip);
    expect(ghCalls().filter((call) => call.startsWith("pr create"))).toEqual([]);
  });

  // The open pull request lacks the reviewed commit, so it is not the landing.
  it("refuses with push-failed when the push is refused and the remote's branch lacks the run's commit", async () => {
    const { h, place } = await runWithCommit();
    git(place.cwd, "branch", "-m", "fsd/run-1", "teammates/tidy-task-list");
    git(repo, "checkout", "-q", "-b", "elsewhere");
    writeFileSync(join(repo, "other.txt"), "pushed by the run\n");
    git(repo, "add", "other.txt");
    git(repo, "commit", "-q", "-m", "Elsewhere");
    git(repo, "push", "-q", "origin", "elsewhere:refs/heads/teammates/tidy-task-list");
    const remoteTip = upstream.rev("refs/heads/teammates/tidy-task-list");
    writeFileSync(
      gh,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\nif [ "$2" = "list" ]; then echo '[{"number":5027,"url":"https://github.com/acme/widgets/pull/5027"}]'; else echo '${PR_URL}'; fi\n`,
    );

    await expect(
      h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseCommit: place.repo!.baseCommit }, { kind: "pull-request", title: "t", body: "b", gh }),
    ).rejects.toMatchObject({ reason: "push-failed" });
    expect(upstream.rev("refs/heads/teammates/tidy-task-list")).toBe(remoteTip);
    expect(ghCalls().filter((call) => call.startsWith("pr create"))).toEqual([]);
  });
});
