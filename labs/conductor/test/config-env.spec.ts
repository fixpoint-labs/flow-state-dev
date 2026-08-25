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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { positiveIntFromEnv, repositoryIdentity, requireSourceRepo } from "../src/config-env";
import { seedRepo } from "./harness";

const dirs: string[] = [];
const cwd = process.cwd();
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.chdir(cwd);
  delete process.env.CONDUCTOR_REPO;
  delete process.env.CONDUCTOR_TEST_MS;
});

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

  it("accepts a genuinely different repository", () => {
    // The guard has to still permit the thing the lab exists to do, or it is
    // just an outage.
    const mine = repo();
    const theirs = repo();
    process.chdir(mine);
    process.env.CONDUCTOR_REPO = theirs;

    expect(requireSourceRepo()).toBe(theirs);
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

describe("numeric settings — refused at startup, not charged to a task", () => {
  it("refuses everything a timer would reject later", () => {
    // Measured against `AbortSignal.timeout`: NaN, negative and fractional all
    // throw `RangeError` — but only once a claimed attempt hands the value to
    // it, so the config error is charged as a failed attempt once per retry.
    // Zero is refused too: a deadline that fires immediately settles every row
    // errored without running anything.
    for (const raw of ["abc", "-5", "1.5", "0", "1e400", "Infinity", " "]) {
      process.env.CONDUCTOR_TEST_MS = raw;
      expect(() => positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000), raw).toThrow(
        /positive whole number/,
      );
    }
  });

  it("takes a valid value, and the fallback when unset", () => {
    process.env.CONDUCTOR_TEST_MS = "60000";
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(60_000);

    delete process.env.CONDUCTOR_TEST_MS;
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(1_000);
  });
});
