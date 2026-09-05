/**
 * Reading the environment, executed.
 *
 * The RULES these two apply — is this the dispatcher's own repository, is this
 * a number a timer will honour — belong to `@flow-state-dev/harness-manager`
 * and are tested there. What is tested here is the READING: that an absent
 * variable is refused rather than defaulted, that the variable's NAME travels
 * so a second caller reusing the reader gets the whole rule and not two thirds
 * of it, and that a string becomes a number before the rule sees it.
 *
 * A config file's checks are exactly the code nobody runs until it is too late,
 * which is why they are in a module a suite can drive at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TIMER_MS, repositoryIdentity } from "@flow-state-dev/harness-manager";
import { seedRepo } from "../../../packages/harness-manager/test/fixtures";
import { positiveIntFromEnv, requireSourceRepo } from "../src/config-env";

const dirs: string[] = [];
const cwd = process.cwd();
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.chdir(cwd);
  delete process.env.CONDUCTOR_REPO;
  delete process.env.GOAL_CONDUCTOR_REPO;
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

describe("CONDUCTOR_REPO — the reading, not the rule", () => {
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

describe("numeric settings — the env door onto the rule", () => {
  it("turns a string into a number before the rule sees it", () => {
    process.env.CONDUCTOR_TEST_MS = "60000";
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(60_000);

    // The ceiling itself is accepted — a bound that rejects its own limit is an
    // off-by-one nobody notices until a legitimate config is refused.
    process.env.CONDUCTOR_TEST_MS = String(MAX_TIMER_MS);
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(MAX_TIMER_MS);
  });

  it("takes the fallback when unset, and refuses an unusable string", () => {
    delete process.env.CONDUCTOR_TEST_MS;
    expect(positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000)).toBe(1_000);

    // The rule itself is the package's; what this pins is that the reading
    // reaches it rather than coercing silently. `"abc"` becomes `NaN`, which
    // survives every later comparison if nothing refuses it here.
    for (const raw of ["abc", "-5", "1.5", "0", "1e400", "Infinity", " ", "2147483648"]) {
      process.env.CONDUCTOR_TEST_MS = raw;
      expect(() => positiveIntFromEnv("CONDUCTOR_TEST_MS", 1_000), raw).toThrow(
        /positive whole number/,
      );
    }
  });
});
