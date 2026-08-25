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
  conductorTaskId,
  provisionCheckout,
  type RunLocation,
  type RunPrincipal,
  type WorkspaceConfig,
  encodeSegment,
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
      // Issue and phase are OURS, so the grammar is legitimate there.
      expect(() => checkoutPathFor(config, at(bad, "implement"))).toThrow(/not a usable identity segment/);
      expect(() => branchFor(at("FIX-1", bad))).toThrow(/not a usable identity segment/);
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
      // The principal segment is DERIVED, not spelled: it is a digest, and a
      // literal here would only pin how the digest happens to be computed
      // today. What this asserts is the SHAPE — untenanted tag, principal,
      // board identity, framed leaf.
      `conductor/t0/${encodeSegment("alice")}/conductor-tasks-test-epic/FIX-1219--implement`,
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

describe("provisioning is bounded as ONE operation", () => {
  // The defect: `provisionTimeoutMs` was a PER-CALL timeout while the ownership
  // arithmetic read it as the whole provisioning budget. The fresh-checkout path
  // runs three git commands back to back — `worktree prune`, a `rev-parse` to
  // test the branch, then `worktree add` — so a bound of N permitted a real hold
  // of 3N. A live attempt could still be inside `worktree add` when its lock was
  // declared stale, and a reclaimed attempt could take the same tree.
  //
  // These drive the injectable clock rather than real time, so the arithmetic is
  // what is under test and nothing here depends on how fast git happens to be.
  // The per-call timeouts handed to git stay large (tens of seconds), so a
  // failure is the budget and never a killed command.
  const CLOCK_STEP = 25_000;

  function steppingClock(step = CLOCK_STEP): () => number {
    let t = 0;
    return () => {
      const at = t;
      t += step;
      return at;
    };
  }

  it("spends ONE budget across every command, not one per command", async () => {
    // Budget 60s, clock +25s per reading. The third command's draw is what
    // exhausts it — which is precisely the command a per-call bound would have
    // funded in full.
    const config = { ...workspace(), provisionTimeoutMs: 60_000 };

    await expect(
      provisionCheckout(config, at("FIX-1219", "implement"), steppingClock()),
    ).rejects.toThrow(/provisioning exceeded its budget/);
  });

  it("bounds the REUSE path too, which runs fewer commands", async () => {
    // Two commands rather than three, so it needs a tighter clock to exhaust —
    // and it must still be bounded, or the cheaper path silently escapes the
    // rule. Provision once with room to spare, then re-enter it.
    const config = { ...workspace(), provisionTimeoutMs: 60_000 };
    await provisionCheckout(config, at("FIX-1219", "implement"));

    await expect(
      provisionCheckout(config, at("FIX-1219", "implement"), steppingClock(50_000)),
    ).rejects.toThrow(/provisioning exceeded its budget/);
  });

  it("still provisions when the budget covers the whole operation", async () => {
    // The bound has to leave the product working. Real clock, real git.
    const config = { ...workspace(), provisionTimeoutMs: 60_000 };
    const checkout = await provisionCheckout(config, at("FIX-1219", "implement"));
    expect(checkout.created).toBe(true);
    expect(existsSync(join(checkout.path, ".git"))).toBe(true);
  });

  it("never hands a git call a zero or negative timeout", async () => {
    // The state this fix creates. `execFile` reads `timeout: 0` as NO TIMEOUT,
    // so an exhausted budget passed straight down would REMOVE the bound at the
    // exact moment it is needed. It has to throw instead.
    const config = { ...workspace(), provisionTimeoutMs: 60_000 };

    await expect(
      provisionCheckout(config, at("FIX-1219", "implement"), steppingClock(120_000)),
    ).rejects.toThrow(/provisioning exceeded its budget/);

    // And the degenerate config, which is the value that would actually reach
    // `execFile` as "no timeout" if the guard compared with `<` instead of `<=`.
    await expect(
      provisionCheckout({ ...config, provisionTimeoutMs: 0 }, at("FIX-1", "implement")),
    ).rejects.toThrow(/provisioning exceeded its budget/);
  });
});

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
    // the whole hold budget becomes stale-eligible while its process is still alive.
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
    // Encoding is injective, so `a` + `b/c` and `a/b` + `c` cannot collapse —
    // impossible rather than merely forbidden.
    expect(
      checkoutPathFor(config, at("FIX-1", "i", { principal: { userId: "b/c", tenantId: "a" } })),
    ).not.toBe(
      checkoutPathFor(config, at("FIX-1", "i", { principal: { userId: "c", tenantId: "a/b" } })),
    );
  });

  it("accepts the identifiers the framework actually issues", () => {
    // User and tenant ids are unrestricted strings. A grammar would fail every
    // attempt during derivation and burn the retry budget on a mismatch the run
    // cannot fix.
    for (const id of ["auth0|abc", "alice@example.com", "CON", "acme.", "a/b", "ünïcode"]) {
      expect(() =>
        checkoutPathFor(config, at("FIX-1", "i", { principal: { userId: id } })),
      ).not.toThrow();
    }
  });

  it("bounds every derived component below the filesystem limit", () => {
    // The state the DIGEST fix had to close, and the one it would have left
    // open. Measured: a filesystem name is refused at 256 bytes, and the old
    // hex encoding turned a 128-character id into a 257-character component —
    // `ENAMETOOLONG` from inside `worktree add`, after the row was claimed,
    // once per retry.
    //
    // Asserted over BOTH halves: the digested principal and our own validated
    // segments. Fixing only the half that was reported would have left a long
    // epic or phase name failing in exactly the same place.
    const huge = "a".repeat(4_000);
    for (const segment of checkoutPathFor(
      { root: "/w", sourceRepo: "/r", baseRef: "main" },
      at("FIX-1219", "implement", { principal: { userId: huge, tenantId: huge } }),
    ).split("/")) {
      expect(Buffer.byteLength(segment, "utf8")).toBeLessThanOrEqual(255);
    }

    // And the validated half is refused rather than silently truncated — a
    // truncation would map two distinct epics onto one directory, which is the
    // injectivity rule broken to fix a length.
    expect(() => conductorTaskId("FIX-1", "a".repeat(65))).toThrow(
      /not a usable identity segment/,
    );
  });

  it("keeps an untenanted request apart from a tenant named like the default", () => {
    // Presence is tagged separately from value, so these can never collide —
    // the alias a `?? "single-tenant"` fallback would have created.
    expect(
      checkoutPathFor(config, at("FIX-1", "i", { principal: { userId: "u" } })),
    ).not.toBe(
      checkoutPathFor(
        config,
        at("FIX-1", "i", { principal: { userId: "u", tenantId: "single-tenant" } }),
      ),
    );
  });

  it("keeps every hostile principal inside the root", () => {
    // Encoding, not rejecting: these are all legal identifiers somewhere, and
    // none of them can express a separator or a traversal once encoded.
    for (const bad of ["../escape", "..", "", "with space", "/abs", "CON", "a."]) {
      const dir = checkoutPathFor(config, at("FIX-1", "i", { principal: { userId: bad } }));
      expect(dir.startsWith(`${config.root}/`)).toBe(true);
      expect(dir.split("/")).not.toContain("..");
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
        /not a usable identity segment/,
      );
    }
  });
});

describe("the identity rule — injective, and safe for every consumer", () => {
  const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };

  it("does not alias when the delimiter is redistributed between components", () => {
    // The measured defect, in the shape that produced it: with a join over a
    // delimiter a component may itself contain, `(issue "a--b", phase "c")` and
    // `(issue "a", phase "b--c")` spell ONE task id, one checkout and one
    // branch. Two live attempts, one tree.
    //
    // Asserted as the PROPERTY — no tuple survives validation and collides —
    // rather than as a spelling, so a future change of delimiter or encoding
    // cannot make this test stop covering the thing it exists for.
    const tuples: Array<[string, string]> = [
      ["a-b", "c"],
      ["a", "b-c"],
      ["a-b-c", "d"],
      ["a", "b-c-d"],
      ["FIX-1219", "implement"],
      ["FIX", "1219-implement"],
    ];
    const seen = new Map<string, string>();
    for (const [issue, phase] of tuples) {
      const id = conductorTaskId(issue, phase);
      const previous = seen.get(id);
      expect(previous, `"${id}" is also (${previous})`).toBeUndefined();
      seen.set(id, `${issue} + ${phase}`);
      // The path and the branch must agree with it, or the isolation the id
      // buys is undone by the two derivations that actually touch disk.
      expect(checkoutPathFor(config, at(issue, phase))).toContain(id);
      expect(branchFor(at(issue, phase))).toContain(id);
    }
    expect(seen.size).toBe(tuples.length);
  });

  it("refuses a component that could forge the frame", () => {
    // The other half: the join is only injective because no component can
    // contain the delimiter. That has to be enforced, not hoped for.
    for (const bad of ["a--b", "--a", "a--"]) {
      expect(() => conductorTaskId(bad, "implement")).toThrow(/not a usable identity segment/);
      expect(() => conductorTaskId("FIX-1", bad)).toThrow(/not a usable identity segment/);
    }
  });

  it("derives branch names git will actually accept, for everything it accepts", () => {
    // Path-safe is not ref-safe, and this string is BOTH. The property is
    // **whatever the grammar admits must survive the ref check** — asserting it
    // over a fixed set of good inputs would pass under any grammar, including
    // the one that shipped this bug. So the corpus includes values the grammar
    // is expected to reject, and the check runs on exactly the ones it lets
    // through.
    //
    // Measured, not reasoned: `git check-ref-format --branch` rejects
    // `thing.lock` and a trailing dot; the old grammar accepted both, so an
    // accepted phase produced a branch that could never be created — and the
    // row was claimed, charged, and retried against a config error no retry
    // fixes.
    const corpus = ["implement", "review-2", "a_b", "thing.lock", "phase.", "a.b", "a--b"];
    let checked = 0;
    for (const phase of corpus) {
      let accepted = true;
      try {
        conductorTaskId("FIX-1219", phase);
      } catch {
        accepted = false;
      }
      if (!accepted) continue;
      checked += 1;
      const branch = branchFor(at("FIX-1219", phase));
      execFileSync("git", ["check-ref-format", "--branch", branch], { stdio: "pipe" });
    }
    // The corpus must actually exercise the check, or a grammar that rejected
    // everything would pass this vacuously.
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("derives branch names git accepts for any principal, however hostile", () => {
    // The opaque half: these are never rejected — they are encoded — so every
    // one of them must come out ref-clean.
    const principals: RunPrincipal[] = [
      { userId: "alice" },
      { userId: "auth0|abc" },
      { userId: "alice@example.com" },
      { userId: "a.", tenantId: "acme.lock" },
      { userId: "../escape", tenantId: "with space" },
      { userId: "", tenantId: "" },
    ];
    for (const principal of principals) {
      const branch = branchFor(at("FIX-1219", "implement", { principal }));
      execFileSync("git", ["check-ref-format", "--branch", branch], { stdio: "pipe" });
    }
  });

  it("rejects the owned segments git would reject downstream", () => {
    // Measured with `git check-ref-format --branch`: `alice.lock` and a
    // trailing dot are both REJECTED there and were both ACCEPTED by the old
    // grammar. Accepting here and failing at checkout creation is the worse
    // failure — the row is claimed, the attempt is charged, and the retry
    // budget is spent on a configuration error no retry can fix.
    for (const bad of ["thing.lock", "phase.", "a.b"]) {
      expect(() => conductorTaskId("FIX-1", bad)).toThrow(/not a usable identity segment/);
    }
  });
});
