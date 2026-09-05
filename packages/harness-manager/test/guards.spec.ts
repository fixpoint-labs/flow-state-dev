/**
 * The startup guards, executed.
 *
 * Both refuse a configuration whose cost is otherwise paid by a *task*: the
 * row is claimed, the attempt is charged, and the failure is a shell typo the
 * retry cannot fix. So the thing under test is not the message — it is that
 * the refusal happens before anything is claimed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBaseRefExists,
  assertCheckoutRootUsable,
  assertDistinctRepository,
  assertPositiveInt,
  MAX_TIMER_MS,
  repositoryIdentity,
} from "../src/guards";
import { seedRepo } from "./fixtures";

const dirs: string[] = [];
const cwd = process.cwd();
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.chdir(cwd);
  delete process.env.CONDUCTOR_REPO;
  delete process.env.CONDUCTOR_TEST_MS;
});

function nested(dir: string): string {
  const inner = join(dir, "packages", "thing");
  execFileSync("mkdir", ["-p", inner]);
  return inner;
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "conductor-cfg-"));
  dirs.push(dir);
  seedRepo(dir);
  return dir;
}

describe("CONDUCTOR_REPO — the same REPOSITORY, not the same path", () => {
  it("refuses a different path inside the dispatcher's own repository", () => {
    // The case path equality missed, and the realistic one: the operator points
    // it at the repository root while running the dispatcher from a package
    // inside it. Two different strings, one repository — and the coding agent
    // gets a worktree of the code that dispatched it.
    const dir = repo();
    const nested = join(dir, "packages", "thing");
    execFileSync("mkdir", ["-p", nested]);
    process.chdir(nested);
    process.env.CONDUCTOR_REPO = dir;

    expect(() => assertDistinctRepository("CONDUCTOR_REPO", process.env.CONDUCTOR_REPO!, process.cwd())).toThrow(/same repository/);
  });

  it("refuses another WORKTREE of the dispatcher's repository", () => {
    // Different toplevel, same repository — which is why the comparison is on
    // the common dir. This is the shape the lab's own agents run in.
    const dir = repo();
    const tree = join(dir, "..", `wt-${Date.now()}`);
    execFileSync("git", ["worktree", "add", "-b", "side", tree], { cwd: dir, stdio: "pipe" });
    dirs.push(tree);
    process.chdir(dir);
    process.env.CONDUCTOR_REPO = tree;

    expect(() => assertDistinctRepository("CONDUCTOR_REPO", process.env.CONDUCTOR_REPO!, process.cwd())).toThrow(/same repository/);
  });

  it("refuses a SYMLINK to the dispatcher's repository", () => {
    // The state the identity fix introduced. `git rev-parse --git-common-dir`
    // answers `.git` for both spellings, and resolving that LEXICALLY
    // canonicalises the string rather than the location — so two different
    // paths came back for one directory and the symlink walked past the guard.
    const dir = repo();
    const link = join(dirname(dir), `link-${Date.now()}`);
    symlinkSync(dir, link);
    dirs.push(link);
    process.chdir(dir);
    process.env.CONDUCTOR_REPO = link;

    expect(() => assertDistinctRepository("CONDUCTOR_REPO", process.env.CONDUCTOR_REPO!, process.cwd())).toThrow(/same repository/);
  });

  it("refuses a target that is not a repository at all", () => {
    // Otherwise the failure surfaces from `worktree add` — after a claim — and
    // every retry is spent on a permanent startup error.
    const plain = mkdtempSync(join(tmpdir(), "conductor-plain-"));
    dirs.push(plain);
    process.chdir(repo());

    process.env.CONDUCTOR_REPO = plain;
    expect(() => assertDistinctRepository("CONDUCTOR_REPO", process.env.CONDUCTOR_REPO!, process.cwd())).toThrow(/not a git repository/);

    process.env.CONDUCTOR_REPO = join(plain, "nope");
    expect(() => assertDistinctRepository("CONDUCTOR_REPO", process.env.CONDUCTOR_REPO!, process.cwd())).toThrow(/not a git repository/);
  });

  it("accepts a genuinely different repository", () => {
    // The guard has to still permit the thing the lab exists to do, or it is
    // just an outage.
    const mine = repo();
    const theirs = repo();
    process.chdir(mine);
    process.env.CONDUCTOR_REPO = theirs;

    // The guard returns nothing — it refuses or it does not. (The env READER
    // returns the path, and that is the lab's to assert, where the reading is.)
    expect(() =>
      assertDistinctRepository("CONDUCTOR_REPO", process.env.CONDUCTOR_REPO!, process.cwd()),
    ).not.toThrow();
    expect(repositoryIdentity(theirs)).not.toBe(repositoryIdentity(mine));
  });

  it("refuses a host that names its own repository, wherever the process stands", () => {
    // `process.cwd()` alone is not the host: a service unit, a container whose
    // WORKDIR is not the source tree, a process launched from `/` all produce an
    // undefined identity. And undefined is not a near miss — the guard only
    // refuses on a MATCH, so it would silently do nothing in a deployment shape
    // that is ordinary rather than exotic.
    //
    // The answer is that the host SAYS where it lives. It is the only party that
    // knows: see the test below for what happens when the package guesses.
    const elsewhere = mkdtempSync(join(tmpdir(), "harness-manager-not-a-repo-"));
    dirs.push(elsewhere);
    process.chdir(elsewhere);
    const host = repo();

    expect(() => assertDistinctRepository("sourceRepo", host, host)).toThrow(
      /same repository/,
    );
    // …and a different path inside it is still the same repository.
    expect(() => assertDistinctRepository("sourceRepo", nested(host), host)).toThrow(
      /same repository/,
    );
  });

  it("refuses when it cannot identify the host, rather than permitting", () => {
    // **"I cannot tell" is not "safe".**
    //
    // This guard refuses on a MATCH, so a host whose location resolves to no git
    // identity matches nothing and would silently pass — and the deployment
    // shapes where that happens are ordinary, not exotic: a container whose
    // WORKDIR is outside the source tree, a service unit, a process launched
    // from `/`. The fence would be inert exactly where nobody looks.
    //
    // The epic already answered this question the same way for the harness
    // version gate: nothing installed is safe, an unknown version is not. Two
    // guards in one epic disagreeing about what an unknown means is worse than
    // either answer.
    const notARepo = mkdtempSync(join(tmpdir(), "harness-manager-plain-"));
    dirs.push(notARepo);

    expect(() => assertDistinctRepository("sourceRepo", repo(), notARepo)).toThrow(
      /dispatcher/,
    );
  });

  it("takes an empty list as the host saying it has no repository", () => {
    // The legitimate case a flat refusal would have broken: a built artifact —
    // compiled output in an image, no `.git` anywhere — genuinely has no
    // repository of its own, and there is nothing for a run to damage by
    // editing it.
    //
    // So the opt-out exists, and it is explicit. The difference from the old
    // behaviour is not whether this host is allowed to run; it is whether the
    // permission was a decision or an accident of the working directory.
    expect(() => assertDistinctRepository("sourceRepo", repo(), [])).not.toThrow();
  });

  it("does NOT refuse a repository merely because this package is installed under it", () => {
    // **The published-package bug.** The guard used to consult this module's own
    // file location as a second candidate for "the dispatcher", which was true
    // while the code lived in the application that dispatched runs. Shipped as a
    // dependency, that path names wherever the package was INSTALLED — under the
    // host's `node_modules`, a linked workspace, a pnpm store — which is a fact
    // about dependency resolution, not about the host.
    //
    // So a host that names its own repository and points a run at some OTHER
    // one was refused whenever the package happened to sit inside that other
    // one. The error even claimed the process was running from it.
    //
    // A guard a legitimate host cannot satisfy is worse than no guard, because
    // the host's only escape is to stop calling it.
    const dispatcher = repo();
    // The repository this test file physically lives in — the package's own.
    const wherePackageLives = dirname(fileURLToPath(import.meta.url));

    expect(() =>
      assertDistinctRepository("sourceRepo", wherePackageLives, dispatcher),
    ).not.toThrow();
  });

});

describe("the base ref — refused at startup, not once per retry", () => {
  it("refuses a ref the target repository does not have", () => {
    // `provisionCheckout` hands this straight to `git worktree add` as the
    // commit-ish for a fresh checkout. A typo, or a repository whose default
    // branch is not `main`, therefore fails EVERY attempt — after the row is
    // claimed, once per retry, until the budget is gone.
    const dir = repo();
    expect(() => assertBaseRefExists(dir, "no-such-branch")).toThrow(/does not resolve/);
  });

  it("accepts the ref the repository actually has", () => {
    // The guard must not become an outage: `seedRepo` creates `main`.
    const dir = repo();
    expect(() => assertBaseRefExists(dir, "main")).not.toThrow();
  });

  it("agrees with what git will actually do with it", () => {
    // The check predicts `worktree add`, so a ref it ACCEPTS must be one that
    // command can cut from. Verified against the real command rather than
    // asserted, since agreeing with git is the whole purpose.
    const dir = repo();
    const tree = join(dir, "..", `wt-base-${Date.now()}`);
    dirs.push(tree);
    assertBaseRefExists(dir, "main");
    expect(() =>
      execFileSync("git", ["worktree", "add", "-b", "cut", tree, "main"], {
        cwd: dir,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});

describe("the checkout root — refused at startup, not once per retry", () => {
  it("refuses a root that is a regular file", () => {
    // `sourceRepo` has two guards that reach the filesystem, so an unusable one
    // fails here. `root` had only its spelling checked — and its failure lands
    // in `acquireCheckout`, which runs AFTER the claim. Every attempt then
    // fails identically before the agent runs, spending the whole budget on a
    // host misconfiguration.
    const dir = mkdtempSync(join(tmpdir(), "conductor-root-"));
    dirs.push(dir);
    const asFile = join(dir, "not-a-directory");
    writeFileSync(asFile, "");

    expect(() => assertCheckoutRootUsable(asFile)).toThrow(/cannot hold checkouts/);
    // And a root UNDER a file, which is the same failure one level up — the
    // spelling is absolute and every ancestor check that stops at the leaf
    // would pass it.
    expect(() => assertCheckoutRootUsable(join(asFile, "checkouts"))).toThrow(
      /cannot hold checkouts/,
    );
  });

  it("accepts a root that exists, and creates one that does not", () => {
    // The guard must not become an outage. An existing directory is accepted
    // rather than refused as already-present, and a missing one is created —
    // checking without creating would leave the ordinary first-run case to fail
    // later, which is the failure being removed.
    const dir = mkdtempSync(join(tmpdir(), "conductor-root-"));
    dirs.push(dir);

    expect(() => assertCheckoutRootUsable(dir)).not.toThrow();
    expect(() => assertCheckoutRootUsable(dir)).not.toThrow();

    const fresh = join(dir, "deep", "checkouts");
    expect(() => assertCheckoutRootUsable(fresh)).not.toThrow();
    expect(existsSync(fresh)).toBe(true);
  });

  it("leaves nothing behind after proving the root can hold a checkout", () => {
    // Existing as a directory is not the question the guard answers — a
    // read-only mount satisfies `mkdirSync` because there is nothing to create.
    // So the guard creates a child and removes it, and this pins the removal:
    // a probe left behind would put a `.conductor-probe-*` directory into the
    // checkout root on every construction, beside the real checkouts.
    const dir = mkdtempSync(join(tmpdir(), "conductor-root-"));
    dirs.push(dir);
    const before = readdirSync(dir);

    assertCheckoutRootUsable(dir);
    assertCheckoutRootUsable(dir);
    assertCheckoutRootUsable(dir);

    expect(readdirSync(dir)).toEqual(before);
  });
});


describe("numeric settings — refused at startup, not charged to a task", () => {
  it("refuses everything a timer would reject later", () => {
    // Measured against `AbortSignal.timeout`: NaN, negative and fractional all
    // throw `RangeError` — but only once a claimed attempt hands the value to
    // it, so the config error is charged as a failed attempt once per retry.
    // Zero is refused too: a deadline that fires immediately settles every row
    // errored without running anything.
    //
    // `2**31` is the state validating the others introduced: it is a positive
    // safe integer, so "positive whole number" admitted it — and Node's timers
    // are 32-bit SIGNED, so it does not throw, it clamps to 1ms and fires
    // immediately, settling every row errored. Measured, and the measurement
    // moved the bound: `AbortSignal.timeout` only throws above 2**32-1, but the
    // silent clamp starts a full power of two earlier, and the quiet failure is
    // the one worth refusing.
    //
    // Driven through the RULE rather than through an environment variable: the
    // reading is a host's, and `harnessManager` is exported, so a host reaches
    // these numbers without passing an env door at all.
    for (const raw of [NaN, -5, 1.5, 0, Infinity, 2_147_483_648]) {
      expect(() => assertPositiveInt("runTimeoutMs", raw), String(raw)).toThrow(
        /positive whole number/,
      );
    }
  });

  it("accepts the ceiling itself", () => {
    // A bound that rejects its own limit is an off-by-one nobody notices until
    // a legitimate configuration is refused.
    expect(assertPositiveInt("runTimeoutMs", MAX_TIMER_MS)).toBe(MAX_TIMER_MS);
    expect(assertPositiveInt("runTimeoutMs", 60_000)).toBe(60_000);
  });
});
