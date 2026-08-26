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
  MAX_TIMER_MS,
  positiveIntFromEnv,
  repositoryIdentity,
  requireSourceRepo,
} from "../src/config-env";
import { seedRepo } from "./harness";

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

    expect(() => requireSourceRepo()).toThrow(/same repository/);
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

    expect(() => requireSourceRepo()).toThrow(/same repository/);
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

    expect(() => requireSourceRepo()).toThrow(/same repository/);
  });

  it("refuses a target that is not a repository at all", () => {
    // Otherwise the failure surfaces from `worktree add` — after a claim — and
    // every retry is spent on a permanent startup error.
    const plain = mkdtempSync(join(tmpdir(), "conductor-plain-"));
    dirs.push(plain);
    process.chdir(repo());

    process.env.CONDUCTOR_REPO = plain;
    expect(() => requireSourceRepo()).toThrow(/not a git repository/);

    process.env.CONDUCTOR_REPO = join(plain, "nope");
    expect(() => requireSourceRepo()).toThrow(/not a git repository/);
  });

  it("accepts a genuinely different repository", () => {
    // The guard has to still permit the thing the lab exists to do, or it is
    // just an outage.
    const mine = repo();
    const theirs = repo();
    process.chdir(mine);
    process.env.CONDUCTOR_REPO = theirs;

    expect(requireSourceRepo()).toBe(theirs);
  });

  it("refuses this repository even when the process runs from outside any repo", () => {
    // The guard identified the dispatcher by `process.cwd()` alone, so a host
    // started anywhere outside its checkout — a service unit, a container whose
    // WORKDIR is not the source tree, a process launched from `/` — produced an
    // undefined identity. And an undefined identity is not a near miss here:
    // the guard only refuses on a MATCH, so it silently did nothing, in a
    // deployment shape that is ordinary rather than exotic.
    //
    // This module's own file does not move when the process's directory does,
    // so it is consulted too. Pointed at the repository this test file lives
    // in, the guard must refuse however far away the process is standing.
    const elsewhere = mkdtempSync(join(tmpdir(), "conductor-not-a-repo-"));
    dirs.push(elsewhere);
    process.chdir(elsewhere);
    // The repository holding the conductor's own source — the one a run must
    // never be aimed at, and the one `cwd` no longer knows about.
    // Derived from this file, not from `cwd` — which is the whole point.
    process.env.CONDUCTOR_REPO = dirname(fileURLToPath(import.meta.url));

    expect(() => requireSourceRepo()).toThrow(/same repository/);
  });

  it("carries the whole rule to a differently-named variable", () => {
    // The goal runner reads `GOAL_CONDUCTOR_REPO`, so it could only reuse
    // `assertDistinctRepository` and kept its own copy of the absent-check.
    // Parameterising the NAME is what lets it reuse both — which is the fix for
    // the class, not for the two rules that were missed.
    const dir = repo();
    process.chdir(nested(dir));
    process.env.GOAL_CONDUCTOR_REPO = dir;

    // Same repository, reached through the other variable: still refused, and
    // the message names the variable the operator actually set.
    expect(() => requireSourceRepo("GOAL_CONDUCTOR_REPO")).toThrow(
      /GOAL_CONDUCTOR_REPO.*same repository/s,
    );

    delete process.env.GOAL_CONDUCTOR_REPO;
    expect(() => requireSourceRepo("GOAL_CONDUCTOR_REPO")).toThrow(
      /GOAL_CONDUCTOR_REPO is not set/,
    );

    // And the default is unchanged, so the dispatcher's call site still works.
    process.env.CONDUCTOR_REPO = dir;
    expect(() => requireSourceRepo()).toThrow(/CONDUCTOR_REPO.*same repository/s);
  });

  it("refuses an absent one rather than defaulting", () => {
    process.chdir(repo());
    expect(() => requireSourceRepo()).toThrow(/not set/);
  });

  it("reports no identity outside a repository, instead of throwing", () => {
    // A dispatcher run from a non-repo directory must still be able to drive a
    // real one — `undefined` on both sides must not read as a match.
    const plain = mkdtempSync(join(tmpdir(), "conductor-plain-"));
    dirs.push(plain);
    expect(repositoryIdentity(plain)).toBeUndefined();

    process.chdir(plain);
    process.env.CONDUCTOR_REPO = repo();
    expect(() => requireSourceRepo()).not.toThrow();
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
    for (const raw of ["abc", "-5", "1.5", "0", "1e400", "Infinity", " ", "2147483648"]) {
      process.env.CONDUCTOR_TEST_MS = raw;
      expect(() => positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000), raw).toThrow(
        /positive whole number/,
      );
    }
  });

  it("takes a valid value, and the fallback when unset", () => {
    process.env.CONDUCTOR_TEST_MS = "60000";
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(60_000);

    // The ceiling itself is accepted — a bound that rejects its own limit is an
    // off-by-one nobody notices until a legitimate config is refused.
    process.env.CONDUCTOR_TEST_MS = String(MAX_TIMER_MS);
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(MAX_TIMER_MS);

    delete process.env.CONDUCTOR_TEST_MS;
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(1_000);
  });
});
