/**
 * The run's checkout — where it is, how it is made, and who holds it.
 */
import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireCheckout,
  branchFor,
  checkoutPathFor,
  provisionCheckout,
  type WorkspaceConfig,
} from "../src/workspace";
import { seedRepo } from "./harness";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): WorkspaceConfig {
  const dir = mkdtempSync(join(tmpdir(), "conductor-ws-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  execFileSync("mkdir", ["-p", sourceRepo]);
  seedRepo(sourceRepo);
  return { root: join(dir, "checkouts"), sourceRepo, baseRef: "main" };
}

describe("where the checkout is — derived, never read back", () => {
  it("gives one issue-phase the same directory every time it is asked", () => {
    // The property that closes the session-scope gap: a task woken in a NEW
    // coordinator session sees the board row and not the previous run record,
    // so anything that READ the path from that record would silently start the
    // retry from nothing — which is exactly the carry-forward the retry budget
    // is priced on. A pure function of the durable task has nothing to lose.
    const config = workspace();
    expect(checkoutPathFor(config, "FIX-1219", "implement")).toBe(
      checkoutPathFor(config, "FIX-1219", "implement"),
    );
    expect(checkoutPathFor(config, "FIX-1219", "implement")).not.toBe(
      checkoutPathFor(config, "FIX-1220", "implement"),
    );
    expect(checkoutPathFor(config, "FIX-1219", "implement")).not.toBe(
      checkoutPathFor(config, "FIX-1219", "review"),
    );
  });

  it("refuses a segment that could climb out of the root", () => {
    // BP-031's other half. The derivation's inputs ride on the task's typed
    // payload, which the model-facing `updateTask` cannot patch — but a caller
    // that skipped the schema must still not be able to escape, and two
    // distinct issues must never collapse onto one directory (that would be
    // obligation B's harm arriving through the door meant to prevent it).
    const config = workspace();
    for (const bad of ["../escape", "a/b", "..", ".", "", "with space", "/abs"]) {
      expect(() => checkoutPathFor(config, bad, "implement")).toThrow(/not a usable path/);
      expect(() => branchFor("FIX-1", bad)).toThrow(/not a usable path/);
    }
  });
});

describe("provisioning", () => {
  it("is idempotent, and the second call leaves uncommitted work untouched", async () => {
    const config = workspace();
    const first = await provisionCheckout(config, "FIX-1219", "implement");
    expect(first.created).toBe(true);

    writeFileSync(join(first.path, "wip.txt"), "half done");
    const second = await provisionCheckout(config, "FIX-1219", "implement");

    expect(second.path).toBe(first.path);
    expect(second.created).toBe(false);
    // Asserted on the WORK still being there, not on a call count — the promise
    // is that nothing reset, forced, cleaned, or deleted.
    expect(readFileSync(join(first.path, "wip.txt"), "utf8")).toBe("half done");
  });

  it("puts the checkout on its own branch", async () => {
    const config = workspace();
    const checkout = await provisionCheckout(config, "FIX-1219", "implement");
    const head = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: checkout.path,
      encoding: "utf8",
    }).trim();
    expect(head).toBe("conductor/FIX-1219-implement");
  });

  it("fails loudly when the branch was deleted underneath", async () => {
    // Never silently create a divergent branch: the tree may hold uncommitted
    // work, and a fresh branch off the base ref would diverge from whatever the
    // deleted one pointed at.
    const config = workspace();
    const checkout = await provisionCheckout(config, "FIX-1219", "implement");
    writeFileSync(join(checkout.path, "wip.txt"), "half done");
    // `git branch -D` refuses a branch that is checked out in a worktree, which
    // is exactly the state this test needs — so the ref is deleted directly,
    // reproducing "somebody removed the branch from under a live checkout".
    execFileSync("git", ["update-ref", "-d", `refs/heads/${checkout.branch}`], {
      cwd: config.sourceRepo,
      stdio: "pipe",
    });

    await expect(provisionCheckout(config, "FIX-1219", "implement")).rejects.toThrow(
      /no longer exists/,
    );
    expect(existsSync(join(checkout.path, "wip.txt"))).toBe(true);
  });
});

describe("obligation B — one live attempt per tree", () => {
  const bounds = { waitMs: 2_000, pollMs: 10, staleAfterMs: 60_000 };

  it("makes a second attempt WAIT rather than proceed or fail", async () => {
    const config = workspace();
    const path = checkoutPathFor(config, "FIX-1219", "implement");
    const held = await acquireCheckout(path, "attempt#1", bounds);

    let secondProceeded = false;
    const second = acquireCheckout(path, "attempt#2", bounds).then((lease) => {
      secondProceeded = true;
      return lease;
    });

    // The assertion is that it has NOT proceeded — a check that only confirmed
    // it eventually got the tree would pass on an implementation that never
    // excluded anything.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondProceeded).toBe(false);

    held.release();
    (await second).release();
    expect(secondProceeded).toBe(true);
  });

  it("throws only once the bound is exceeded — a wedged process, not a race", async () => {
    const config = workspace();
    const path = checkoutPathFor(config, "FIX-1219", "implement");
    await acquireCheckout(path, "attempt#1", bounds);

    await expect(
      acquireCheckout(path, "attempt#2", { waitMs: 60, pollMs: 10, staleAfterMs: 60_000 }),
    ).rejects.toThrow(/still held/);
  });

  it("takes a lock no live attempt could still be holding", async () => {
    // A host that died mid-run leaves its lock behind. Waiting out a bound
    // nobody is going to release would fail a perfectly good attempt. The
    // staleness threshold sits past the run's own deadline, so this can only
    // fire for a process that is gone — which is why no heartbeat is needed.
    const config = workspace();
    const path = checkoutPathFor(config, "FIX-1219", "implement");
    await acquireCheckout(path, "the dead host", bounds);

    const lease = await acquireCheckout(path, "attempt#2", {
      waitMs: 500,
      pollMs: 10,
      staleAfterMs: 0,
    });
    lease.release();
  });

  it("a late release from a displaced holder does not free the live attempt's tree", async () => {
    const config = workspace();
    const path = checkoutPathFor(config, "FIX-1219", "implement");
    const stale = await acquireCheckout(path, "attempt#1", bounds);
    // Attempt 2 steals the stale lock…
    const live = await acquireCheckout(path, "attempt#2", {
      waitMs: 500,
      pollMs: 10,
      staleAfterMs: 0,
    });
    // …and attempt 1 finally notices it is done.
    stale.release();

    // Attempt 2 must still hold the tree. Releasing somebody else's lock is how
    // two coding agents end up in one checkout after the exclusion "worked".
    let third = false;
    const waiting = acquireCheckout(path, "attempt#3", bounds).then((lease) => {
      third = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(third).toBe(false);

    live.release();
    // Awaited rather than abandoned: a poll loop left running past the test
    // outlives the temp directory and surfaces as an unhandled ENOENT that has
    // nothing to do with what is under test.
    (await waiting).release();
    expect(third).toBe(true);
  });
});
