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
  type RunLocation,
  type RunPrincipal,
  type WorkspaceConfig,
} from "../src/workspace";
import { seedRepo } from "./harness";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The principal every existing behaviour runs as, unless it says otherwise. */
const ALICE: RunPrincipal = { userId: "alice" };
/** The epic every existing behaviour runs under, unless it says otherwise. */
const EPIC = "conductor-tasks-test-epic";

/** One run's location, defaulting to ALICE under EPIC. */
const at = (issue: string, phase: string, over: Partial<RunLocation> = {}): RunLocation => ({
  principal: ALICE,
  epic: EPIC,
  issue,
  phase,
  ...over,
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
    expect(checkoutPathFor(config, at("FIX-1219", "implement"))).toBe(
      checkoutPathFor(config, at("FIX-1219", "implement")),
    );
    expect(checkoutPathFor(config, at("FIX-1219", "implement"))).not.toBe(
      checkoutPathFor(config, at("FIX-1220", "implement")),
    );
    expect(checkoutPathFor(config, at("FIX-1219", "implement"))).not.toBe(
      checkoutPathFor(config, at("FIX-1219", "review")),
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
      expect(() => checkoutPathFor(config, at(bad, "implement"))).toThrow(/not a usable path/);
      expect(() => checkoutPathFor(config, at("FIX-1", "implement", { principal: { userId: bad } }))).toThrow(
        /not a usable path/,
      );
      expect(() => branchFor(at("FIX-1", bad))).toThrow(/not a usable path/);
    }
  });
});

describe("provisioning", () => {
  it("is idempotent, and the second call leaves uncommitted work untouched", async () => {
    const config = workspace();
    const first = await provisionCheckout(config, at("FIX-1219", "implement"));
    expect(first.created).toBe(true);

    writeFileSync(join(first.path, "wip.txt"), "half done");
    const second = await provisionCheckout(config, at("FIX-1219", "implement"));

    expect(second.path).toBe(first.path);
    expect(second.created).toBe(false);
    // Asserted on the WORK still being there, not on a call count — the promise
    // is that nothing reset, forced, cleaned, or deleted.
    expect(readFileSync(join(first.path, "wip.txt"), "utf8")).toBe("half done");
  });

  it("puts the checkout on its own branch", async () => {
    const config = workspace();
    const checkout = await provisionCheckout(config, at("FIX-1219", "implement"));
    const head = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: checkout.path,
      encoding: "utf8",
    }).trim();
    expect(head).toBe(
      "conductor/single-tenant/alice/conductor-tasks-test-epic/FIX-1219-implement",
    );
  });

  it("fails loudly when the branch was deleted underneath", async () => {
    // Never silently create a divergent branch: the tree may hold uncommitted
    // work, and a fresh branch off the base ref would diverge from whatever the
    // deleted one pointed at.
    const config = workspace();
    const checkout = await provisionCheckout(config, at("FIX-1219", "implement"));
    writeFileSync(join(checkout.path, "wip.txt"), "half done");
    // `git branch -D` refuses a branch that is checked out in a worktree, which
    // is exactly the state this test needs — so the ref is deleted directly,
    // reproducing "somebody removed the branch from under a live checkout".
    execFileSync("git", ["update-ref", "-d", `refs/heads/${checkout.branch}`], {
      cwd: config.sourceRepo,
      stdio: "pipe",
    });

    await expect(provisionCheckout(config, at("FIX-1219", "implement"))).rejects.toThrow(
      /no longer exists/,
    );
    expect(existsSync(join(checkout.path, "wip.txt"))).toBe(true);
  });
});

const bounds = { waitMs: 2_000, pollMs: 10, staleAfterMs: 60_000 };

describe("obligation B — one live attempt per tree", () => {

  it("makes a second attempt WAIT rather than proceed or fail", async () => {
    const config = workspace();
    const path = checkoutPathFor(config, at("FIX-1219", "implement"));
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
    const path = checkoutPathFor(config, at("FIX-1219", "implement"));
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
    const path = checkoutPathFor(config, at("FIX-1219", "implement"));
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
    const path = checkoutPathFor(config, at("FIX-1219", "implement"));
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

describe("obligation B — releasing is as guarded as stealing", () => {
  it("a displaced holder's release does not remove the replacement's lock", async () => {
    // The sibling of the steal guard, and reachable *because* of the
    // construction check rather than in spite of it: a run that overruns
    // `runTimeoutMs` becomes stale-eligible while its process is still alive.
    // Another attempt steals the lock and takes the tree; then the original's
    // release fires. Unguarded, it removes THE REPLACEMENT'S lock, and a third
    // attempt acquires the path while the replacement is mid-edit.
    const config = workspace();
    const path = checkoutPathFor(config, at("FIX-1219", "implement"));

    const overrun = await acquireCheckout(path, "attempt#1", bounds);
    // Attempt 2 steals it — the overrunning attempt is still alive.
    const replacement = await acquireCheckout(path, "attempt#2", {
      waitMs: 500,
      pollMs: 10,
      staleAfterMs: 0,
    });

    // …and only now does attempt 1 notice it is done.
    overrun.release();

    // The replacement must still hold the tree. Asserted by a third attempt
    // NOT getting it — the observable form of "two agents in one checkout".
    let third = false;
    const waiting = acquireCheckout(path, "attempt#3", bounds).then((lease) => {
      third = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(third).toBe(false);

    replacement.release();
    (await waiting).release();
    expect(third).toBe(true);
  });

  it("a holder still releases its own lock", async () => {
    // The other direction: the guard must not be so tight that nothing is ever
    // released, which would wedge every checkout after one run.
    const config = workspace();
    const path = checkoutPathFor(config, at("FIX-1219", "implement"));

    const first = await acquireCheckout(path, "attempt#1", bounds);
    first.release();

    // Free immediately, without waiting out the bound.
    const started = Date.now();
    const second = await acquireCheckout(path, "attempt#2", bounds);
    expect(Date.now() - started).toBeLessThan(500);
    second.release();
  });
});

describe("one job's state is isolated per principal", () => {
  // The invariant the `user`-scoped ledgers give for free and the filesystem
  // gives for nothing. Both derivations are asserted, because separate trees
  // pushing one ref is not isolation either.
  const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };
  const alice: RunPrincipal = { userId: "alice" };
  const bob: RunPrincipal = { userId: "bob" };

  it("gives two users different checkouts for the same issue-phase", () => {
    // Without this, user B's agent opens a tree holding user A's commits and
    // uncommitted work — the lock serializes them rather than separating them.
    expect(checkoutPathFor(config, at("FIX-1219", "implement", { principal: alice }))).not.toBe(
      checkoutPathFor(config, at("FIX-1219", "implement", { principal: bob })),
    );
  });

  it("gives two users different branches for the same issue-phase", () => {
    // The half that is easier to miss. A shared branch means one user's commits
    // land on another's ref, and a pull request opened by either can satisfy the
    // other's completion check — user B's run "succeeds" on user A's PR.
    expect(branchFor(at("FIX-1219", "implement", { principal: alice }))).not.toBe(
      branchFor(at("FIX-1219", "implement", { principal: bob })),
    );
  });

  it("gives two tenants different checkouts and branches", () => {
    const a: RunPrincipal = { userId: "u", tenantId: "acme" };
    const b: RunPrincipal = { userId: "u", tenantId: "globex" };
    expect(checkoutPathFor(config, at("FIX-1", "implement", { principal: a }))).not.toBe(
      checkoutPathFor(config, at("FIX-1", "implement", { principal: b })),
    );
    expect(branchFor(at("FIX-1", "implement", { principal: a }))).not.toBe(branchFor(at("FIX-1", "implement", { principal: b })));
  });

  it("keeps one principal's own derivation stable across calls", () => {
    // Isolation must not cost idempotency: the same principal and issue-phase
    // still resolve the same tree, which is what a retry's carry-forward needs.
    expect(checkoutPathFor(config, at("FIX-1219", "implement", { principal: alice }))).toBe(
      checkoutPathFor(config, at("FIX-1219", "implement", { principal: alice })),
    );
    expect(branchFor(at("FIX-1219", "implement", { principal: alice }))).toBe(
      branchFor(at("FIX-1219", "implement", { principal: alice })),
    );
  });

  it("does not let a user and a tenant run together into one path", () => {
    // Separate segments, never concatenated: tenant `a` + user `b/c` and tenant
    // `a/b` + user `c` must not collapse. The grammar forbids the separator, so
    // this is impossible rather than unlikely.
    expect(() => checkoutPathFor(config, at("FIX-1", "implement", { principal: { userId: "a/b" } }))).toThrow();
    expect(() =>
      checkoutPathFor(config, at("FIX-1", "implement", { principal: { userId: "u", tenantId: "a/b" } })),
    ).toThrow();
  });

  it("validates the principal like every other segment", () => {
    for (const bad of ["../escape", "..", "", "with space", "/abs"]) {
      expect(() => branchFor(at("FIX-1", "implement", { principal: { userId: bad } }))).toThrow(
        /not a usable path/,
      );
      expect(() => branchFor(at("FIX-1", "implement", { principal: { userId: "u", tenantId: bad } }))).toThrow(
        /not a usable path/,
      );
    }
  });
});

describe("provisioning verifies the branch a reused checkout is actually on", () => {
  it("fails loudly when the worktree was switched to another branch", async () => {
    // The expected branch still EXISTING is not the tree being ON it. A worktree
    // switched by hand, by a tool, or by the run itself passes the
    // branch-exists check and is silently accepted — so the prompt says one
    // branch, the run record says one branch, and the commits land on another,
    // while a pre-existing PR for the expected branch can make the attempt look
    // done. Every layer agrees and all of them are wrong.
    const config = workspace();
    const checkout = await provisionCheckout(config, at("FIX-1219", "implement"));
    writeFileSync(join(checkout.path, "wip.txt"), "half done");

    execFileSync("git", ["checkout", "-b", "somewhere-else"], {
      cwd: checkout.path,
      stdio: "pipe",
    });

    await expect(
      provisionCheckout(config, at("FIX-1219", "implement")),
    ).rejects.toThrow(/is on branch "somewhere-else", not the expected/);

    // And it refused rather than resetting — the work is untouched.
    expect(existsSync(join(checkout.path, "wip.txt"))).toBe(true);
  });

  it("fails loudly on a detached HEAD", async () => {
    // A run on a detached HEAD commits to no branch at all, which is a mismatch
    // like any other rather than a tolerable state.
    const config = workspace();
    const checkout = await provisionCheckout(config, at("FIX-1219", "implement"));
    execFileSync("git", ["checkout", "--detach"], { cwd: checkout.path, stdio: "pipe" });

    await expect(
      provisionCheckout(config, at("FIX-1219", "implement")),
    ).rejects.toThrow(/not the expected/);
  });

  it("still accepts a checkout that is on the branch it should be", async () => {
    // The guard must not be so tight that an ordinary retry cannot reuse its own
    // tree — which is the carry-forward the retry budget is priced on.
    const config = workspace();
    const first = await provisionCheckout(config, at("FIX-1219", "implement"));
    writeFileSync(join(first.path, "wip.txt"), "half done");

    const second = await provisionCheckout(config, at("FIX-1219", "implement"));

    expect(second.path).toBe(first.path);
    expect(second.created).toBe(false);
    expect(readFileSync(join(first.path, "wip.txt"), "utf8")).toBe("half done");
  });
});

describe("two epics on one issue-phase are isolated too", () => {
  // D-4 partitions the board because it is a claim pool. `runs/**`, the
  // checkout and the branch are the other three things two epics both write —
  // and partitioning the topic while leaving the path shared would fix the
  // report and keep the overwrite on disk, which is obligation B across boards:
  // two live attempts, one tree.
  const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };
  const one = at("FIX-1219", "implement", { epic: "conductor-tasks-alpha" });
  const two = at("FIX-1219", "implement", { epic: "conductor-tasks-beta" });

  it("gives two epics different checkouts", () => {
    expect(checkoutPathFor(config, one)).not.toBe(checkoutPathFor(config, two));
  });

  it("gives two epics different branches", () => {
    expect(branchFor(one)).not.toBe(branchFor(two));
  });

  it("keeps one epic's own derivation stable", () => {
    // Isolation must not cost idempotency — the retry's carry-forward needs the
    // same epic to resolve the same tree.
    expect(checkoutPathFor(config, one)).toBe(checkoutPathFor(config, one));
    expect(branchFor(one)).toBe(branchFor(one));
  });

  it("validates the epic like every other segment", () => {
    for (const bad of ["../escape", "a/b", "..", "", "with space"]) {
      expect(() => branchFor(at("FIX-1", "implement", { epic: bad }))).toThrow(
        /not a usable path/,
      );
    }
  });
});
