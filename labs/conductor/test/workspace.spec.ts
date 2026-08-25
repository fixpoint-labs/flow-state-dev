/**
 * The run's checkout — where it is, how it is made, and who holds it.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  isStrictlyInside,
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
      `conductor/t0/${encodeSegment("alice")}/conductor-tasks-test-epic/${conductorTaskId("FIX-1219", "implement")}`,
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

  it("does not report a deleted branch when the probe itself failed", async () => {
    // The branch check was a blanket `catch { return false }`, so a probe that
    // timed out, could not spawn git, or met an unreadable repository answered
    // the same as a ref that is genuinely gone.
    //
    // Both readings of that `false` are wrong. Here on the reuse path the caller
    // announces a branch someone deleted, sending whoever reads it after a
    // deletion that never happened; on the fresh path it takes `worktree add -b`
    // and collides with the branch that does exist. Either way the attempt is
    // charged for an infrastructure failure — the category error the ownership
    // wait goes out of its way to refuse, arriving through a `catch`.
    //
    // The branch here is NOT deleted. Only the probe is broken: the source repo
    // is pointed at a directory git cannot read as a repository, which is one of
    // the real shapes (exit 128, unkilled) rather than a hand-made error object.
    const config = workspace();
    const checkout = await provisionCheckout(config, at("FIX-1219", "implement"));
    writeFileSync(join(checkout.path, "wip.txt"), "half done");

    const notARepo = mkdtempSync(join(tmpdir(), "conductor-not-a-repo-"));
    dirs.push(notARepo);
    const broken = { ...config, sourceRepo: notARepo };

    const failure = await provisionCheckout(broken, at("FIX-1219", "implement")).then(
      () => undefined,
      (err: unknown) => err as Error,
    );

    expect(failure).toBeDefined();
    expect(failure?.message).toMatch(/could not determine whether branch/);
    // The load-bearing half: it must NOT claim a deletion. A wrong cause here is
    // worse than a bare failure, because it reads as actionable.
    expect(failure?.message).not.toMatch(/no longer exists/);
    // The real reason survives rather than being flattened into the verdict.
    expect(failure?.cause).toBeDefined();
    expect(existsSync(join(checkout.path, "wip.txt"))).toBe(true);
  });
});

const bounds = { waitMs: 2_000, pollMs: 10, staleAfterMs: 60_000 };

describe("the containment rule guarding the only recursive removal", () => {
  // `provisionCheckout` clears a half-created tree — a directory git left behind
  // when `worktree add` was killed mid-run. That is a recursive `rmSync`, and the
  // only thing standing between it and the wrong directory is this predicate.
  //
  // It was a `startsWith(`${root}/`)` prefix test. Each case below is a way a
  // prefix test answers wrongly, and the two refusal cases are the ones that
  // matter most: a refusal here leaves the partial tree in place, so every later
  // attempt meets it again and spends a retry on it.

  it("accepts an ordinary checkout under the root", () => {
    expect(isStrictlyInside("/ws/FIX-1--implement", "/ws")).toBe(true);
    expect(isStrictlyInside("/ws/nested/deeper", "/ws")).toBe(true);
  });

  it("refuses the root itself rather than clearing every checkout in it", () => {
    // The prefix test short-circuited on equality and let this through, so a
    // caller arriving with the root as its checkout path would have had
    // `rmSync(root, { recursive: true })` run against the directory holding
    // every other checkout. The guard exists for exactly the caller that does
    // not exist yet, which is the caller it admitted.
    expect(isStrictlyInside("/ws", "/ws")).toBe(false);
  });

  it("accepts a child when the root is the filesystem root", () => {
    // `${root}/` is `//` here, which no resolved absolute path starts with, so
    // the prefix test refused every child of a `/` root.
    expect(isStrictlyInside("/anything", "/")).toBe(true);
  });

  it("refuses a sibling whose name merely starts with the root", () => {
    expect(isStrictlyInside("/ws-elsewhere/tree", "/ws")).toBe(false);
  });

  it("refuses a path that climbs out, and keeps one that only looks like it", () => {
    expect(isStrictlyInside("/elsewhere", "/ws")).toBe(false);
    // `..` is a segment, not a prefix. A directory named `..conductor` is an
    // ordinary child, and comparing the string prefix would have refused it.
    expect(isStrictlyInside("/ws/..conductor", "/ws")).toBe(true);
  });
});

describe("a cancelled attempt stops waiting for the tree", () => {
  it("gives up the wait instead of polling out the whole window", async () => {
    // Shutdown, or a lease renewal reporting the claim lost, propagates through
    // `ctx.signal`. An ordinary sleep ignores it, so a stale attempt polled for
    // the entire ownership window and could still go on to acquire and provision
    // a tree whose result it can no longer record. That window is now the run's
    // deadline plus provisioning plus slack, so ignoring the signal costs a
    // replacement the better part of an hour.
    //
    // The bound here is deliberately long: a test that passed because the wait
    // expired would prove nothing, so the ONLY thing that can end this call in
    // time is the signal.
    const dir = mkdtempSync(join(tmpdir(), "conductor-cancel-"));
    dirs.push(dir);
    const checkout = join(dir, "tree");
    const held = await acquireCheckout(checkout, "the holder", {
      waitMs: 1_000,
      pollMs: 10,
      staleAfterMs: 600_000,
    });

    const controller = new AbortController();
    const waiting = acquireCheckout(
      checkout,
      "the waiter",
      { waitMs: 600_000, pollMs: 10, staleAfterMs: 600_000 },
      Date.now,
      controller.signal,
    );

    setTimeout(() => controller.abort(), 50);
    await expect(waiting).rejects.toThrow(/was cancelled/);

    // The holder still owns the tree: a cancelled waiter must not have taken or
    // cleared anything on its way out.
    expect(existsSync(`${checkout}.lock`)).toBe(true);
    held.release();
  });

  it("does not wait at all when it is already cancelled", async () => {
    // The signal can already be aborted when the step is entered. Checked before
    // the first create, not only in the sleep, or a cancelled attempt still takes
    // the lock on its very first pass — which is the acquisition this exists to
    // prevent.
    const dir = mkdtempSync(join(tmpdir(), "conductor-cancel2-"));
    dirs.push(dir);
    const checkout = join(dir, "tree");

    await expect(
      acquireCheckout(
        checkout,
        "already gone",
        { waitMs: 60_000, pollMs: 10, staleAfterMs: 600_000 },
        Date.now,
        AbortSignal.abort(),
      ),
    ).rejects.toThrow(/was cancelled/);

    expect(existsSync(`${checkout}.lock`)).toBe(false);
  });

  it("honours waitMs even when the poll interval is larger than it", async () => {
    // The bound in the error message, and the one the drain budget is sized
    // from, is `waitMs`. The loop checked the deadline and THEN slept a whole
    // `pollMs`, so a poll interval larger than what remained overshot by the
    // difference — and disposal, which accounts only for `waitMs`, could expire
    // while acquisition was still sleeping.
    //
    // Cancellation is a different exit and is covered above; this is ordinary
    // expiry, which needs the clock rather than the signal.
    const dir = mkdtempSync(join(tmpdir(), "conductor-overshoot-"));
    dirs.push(dir);
    const checkout = join(dir, "tree");
    const held = await acquireCheckout(checkout, "the holder", {
      waitMs: 1_000,
      pollMs: 10,
      staleAfterMs: 600_000,
    });

    const startedAt = Date.now();
    await expect(
      acquireCheckout(checkout, "the waiter", {
        waitMs: 30,
        pollMs: 2_000,
        staleAfterMs: 600_000,
      }),
    ).rejects.toThrow(/waited 30ms/);
    const elapsed = Date.now() - startedAt;

    // Generous against a slow runner, and still far inside the 2s the
    // uncapped sleep would have taken.
    expect(elapsed).toBeLessThan(1_000);

    held.release();
  });

  it("observes the signal without waiting out the poll interval", async () => {
    // The two tests above both run at `pollMs: 10`, so they pass whether or not
    // the sleep itself is abortable — ten milliseconds of lag is invisible. That
    // makes the responsiveness of the wait a function of `pollMs`, which is a
    // caller-set public option: at a large but perfectly valid interval, a
    // cancelled attempt keeps a replacement waiting for the whole interval.
    //
    // So this one sets `pollMs` far past any tolerable delay. The waiter reaches
    // the sleep, and from there the ONLY thing that can end the call inside the
    // assertion is `abort` waking the sleep — the poll interval and the deadline
    // are both ten minutes out.
    const dir = mkdtempSync(join(tmpdir(), "conductor-cancel3-"));
    dirs.push(dir);
    const checkout = join(dir, "tree");
    const held = await acquireCheckout(checkout, "the holder", {
      waitMs: 1_000,
      pollMs: 10,
      staleAfterMs: 600_000,
    });

    const controller = new AbortController();
    const startedAt = Date.now();
    const waiting = acquireCheckout(
      checkout,
      "the waiter",
      { waitMs: 600_000, pollMs: 600_000, staleAfterMs: 600_000 },
      Date.now,
      controller.signal,
    );

    setTimeout(() => controller.abort(), 50);
    await expect(waiting).rejects.toThrow(/was cancelled/);
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    expect(existsSync(`${checkout}.lock`)).toBe(true);
    held.release();
  });
});

describe("a relative workspace root still lands in one place", () => {
  it("provisions where every other consumer looks", async () => {
    // Reproduced before fixing: the derived path is consumed from two different
    // working directories. The lock, the existence check, the recorded path and
    // the agent's `cwd` all resolve it against the DISPATCHER's directory, while
    // `git worktree add` runs with `cwd: config.sourceRepo`. With a relative
    // root the worktree landed under the source repo and everything else looked
    // for it under the dispatcher — so the agent got a directory that does not
    // exist, and no retry recovers because the derivation is stable and stably
    // wrong.
    const dir = mkdtempSync(join(tmpdir(), "conductor-rel-"));
    dirs.push(dir);
    const sourceRepo = join(dir, "repo");
    execFileSync("mkdir", ["-p", sourceRepo]);
    seedRepo(sourceRepo);

    const dispatcher = join(dir, "dispatcher");
    execFileSync("mkdir", ["-p", dispatcher]);
    const previous = process.cwd();
    process.chdir(dispatcher);
    try {
      // Relative, exactly as `CONDUCTOR_CHECKOUTS=checkouts` supplies it.
      const config = { root: "checkouts", sourceRepo, baseRef: "main" };
      const location = at("FIX-1219", "implement");

      const checkout = await provisionCheckout(config, location);

      // The one property that matters: the path the rest of the system will use
      // is the path git actually created. Asserted through `checkoutPathFor`
      // rather than against a literal, since that is what the lock, the run
      // record and the agent `cwd` all derive from.
      expect(checkout.path).toBe(checkoutPathFor(config, location));
      expect(existsSync(join(checkout.path, ".git"))).toBe(true);
      // And NOT under the source repository, which is where it used to go.
      expect(existsSync(join(sourceRepo, "checkouts"))).toBe(false);
    } finally {
      process.chdir(previous);
    }
  });
});

describe("a half-created checkout does not brick every retry", () => {
  // Measured with a real `SIGTERM` to `git worktree add`, which is exactly how
  // the provisioning budget ends it: the target is left present, partly
  // populated, and WITHOUT `.git`. The next attempt then took the create arm
  // again and git refused with `fatal: '<path>' already exists` — on both arms,
  // since the killed run also leaves the branch behind — and `worktree prune`
  // did not clear it, because the leftover is a tree rather than bookkeeping.
  // So the whole remaining retry budget went on a leftover no retry could fix.

  it("recreates a checkout whose creation was interrupted", async () => {
    const config = workspace();
    const location = at("FIX-1219", "implement");
    const path = checkoutPathFor(config, location);

    // The exact leftover shape: the directory, some content, no `.git`, and the
    // marker the provision wrote before calling `worktree add`. The marker is
    // part of the shape rather than test scaffolding — it is what makes this an
    // interrupted provision rather than a directory of unknown origin.
    mkdirSync(join(path, "src"), { recursive: true });
    writeFileSync(join(path, "src", "partial.ts"), "half written");
    writeFileSync(`${path}.provisioning`, "");
    expect(existsSync(join(path, ".git"))).toBe(false);

    const checkout = await provisionCheckout(config, location);

    expect(checkout.created).toBe(true);
    expect(existsSync(join(checkout.path, ".git"))).toBe(true);
    // The leftover is gone rather than merged into the new tree.
    expect(existsSync(join(checkout.path, "src", "partial.ts"))).toBe(false);
  });

  it("recreates it even when the interrupted run left the branch behind", () => {
    // The arm the retry actually takes. A killed `worktree add -b` still
    // creates the ref, so the next attempt goes down the "branch exists" path —
    // which failed on the leftover directory in exactly the same way.
    const config = workspace();
    const location = at("FIX-1219", "implement");
    const path = checkoutPathFor(config, location);
    const branch = branchFor(location);

    execFileSync("git", ["branch", branch, "main"], { cwd: config.sourceRepo, stdio: "pipe" });
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "leftover"), "x");
    writeFileSync(`${path}.provisioning`, "");

    return expect(provisionCheckout(config, location)).resolves.toMatchObject({
      created: true,
      branch,
    });
  });

  it("clears a marker stranded by a death between the tree and the cleanup", async () => {
    // The marker is removed after `worktree add` returns. A process that dies in
    // the gap leaves it behind on a checkout that is FINISHED, and the reuse
    // path used to return early without touching it — so the marker outlived its
    // own meaning.
    //
    // That is not harmless. It re-arms exactly the deletion the marker exists to
    // prevent: if the agent later removes `.git`, the next attempt reads the
    // stale marker as proof of an interrupted provision and clears a tree that
    // holds real work. Staged as the full sequence rather than asserting on the
    // file, because the file is the mechanism and the work surviving is the point.
    const config = workspace();
    const location = at("FIX-1219", "implement");
    const first = await provisionCheckout(config, location);
    writeFileSync(join(first.path, "uncommitted.txt"), "the last attempt's work");

    // The death: a completed checkout with the marker still beside it.
    writeFileSync(`${first.path}.provisioning`, "");

    // Reuse must clean it up on the way through.
    const second = await provisionCheckout(config, location);
    expect(second.created).toBe(false);
    expect(existsSync(`${first.path}.provisioning`)).toBe(false);

    // And the re-armed deletion is disarmed: `.git` goes missing, and the tree
    // is now refused rather than cleared.
    rmSync(join(first.path, ".git"), { recursive: true, force: true });
    await expect(provisionCheckout(config, location)).rejects.toThrow(
      /no record of an interrupted provision/,
    );
    expect(readFileSync(join(first.path, "uncommitted.txt"), "utf8")).toBe(
      "the last attempt's work",
    );
  });

  it("keeps a tree whose `.git` went missing without an interrupted provision", async () => {
    // The inference this branch used to make was `no .git` → `nobody ever worked
    // here`. That does not hold: the run holds an agent with shell access, so
    // removing or renaming `.git` inside its own checkout is reachable — a
    // cleanup script, or an agent deciding to start over. The tree then looks
    // exactly like an interrupted provision while holding real uncommitted work,
    // and clearing it destroys the thing the whole reuse design is priced on.
    //
    // Staged on a REAL checkout rather than a hand-made directory, because the
    // point is that a genuine tree can reach this state.
    const config = workspace();
    const location = at("FIX-1219", "implement");
    const first = await provisionCheckout(config, location);
    writeFileSync(join(first.path, "uncommitted.txt"), "the last attempt's work");

    // The agent removes its own `.git`. Provisioning is long finished, so there
    // is no marker — which is exactly what separates this from the case above.
    rmSync(join(first.path, ".git"), { recursive: true, force: true });
    expect(existsSync(`${first.path}.provisioning`)).toBe(false);

    await expect(provisionCheckout(config, location)).rejects.toThrow(
      /no record of an interrupted provision/,
    );
    // The load-bearing assertion: the work is still there.
    expect(readFileSync(join(first.path, "uncommitted.txt"), "utf8")).toBe(
      "the last attempt's work",
    );
  });

  it("still refuses to clear a real checkout", async () => {
    // The guard rail on the rule. `.git` is the witness that git finished
    // setup, so a tree that HAS it is a usable checkout holding the last
    // attempt's work — and this module never resets one. Provisioning it again
    // must return it untouched.
    const config = workspace();
    const location = at("FIX-1219", "implement");
    const first = await provisionCheckout(config, location);
    writeFileSync(join(first.path, "uncommitted.txt"), "the last attempt's work");

    const second = await provisionCheckout(config, location);

    expect(second.created).toBe(false);
    expect(readFileSync(join(second.path, "uncommitted.txt"), "utf8")).toBe(
      "the last attempt's work",
    );
  });

  it("refuses to clear anything outside the workspace root", async () => {
    // A guard on a destructive call. The path is derived under `config.root`,
    // and this keeps that true for a future caller that arrives another way.
    const config = workspace();
    const outside = mkdtempSync(join(tmpdir(), "conductor-outside-"));
    dirs.push(outside);
    mkdirSync(join(outside, "t0"), { recursive: true });

    await expect(
      provisionCheckout({ ...config, root: join(config.root, "..", "elsewhere") }, {
        ...at("FIX-1219", "implement"),
      }),
    ).resolves.toBeDefined();
  });
});

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

describe("the identity rule — the digest cannot be made to collide on purpose", () => {
  // **A width assertion passes happily while four inputs share one output**, so
  // this asserts DISTINCTNESS over inputs chosen to break the transcoding step.
  //
  // `encodeSegment` hashed through UTF-8, which has no representation for a
  // lone surrogate — so `Buffer.from`/`update` substituted U+FFFD BEFORE the
  // hash ran. Measured: `\ud800`, `\ud801`, `\udfff` and a literal `\ufffd`
  // produced ONE digest, hence one checkout and one lock for four distinct
  // caller-supplied identifiers.
  //
  // Not the collision the digest's safety argument covers. That argument is
  // about SHA-256 and it holds; this was a collision upstream of the hash,
  // deliberate and trivially reproducible by anyone who can supply an id.
  const HOSTILE = ["\ud800", "\ud801", "\udfff", "\ufffd", "😀"];

  it("gives distinct digests to inputs UTF-8 cannot tell apart", () => {
    const digests = HOSTILE.map((v) => encodeSegment(v));
    expect(new Set(digests).size).toBe(HOSTILE.length);
  });

  it("encodes the empty string like any other input", () => {
    // `conductorFlow` refuses an empty TENANT, but that is a config rule about
    // present-versus-absent, not a limit of the encoder. Asserted here so the
    // encoder keeps its empty-string case when the config door takes the value
    // away from the other test.
    expect(encodeSegment("")).toMatch(/^h[0-9a-f]{64}$/);
    expect(encodeSegment("")).not.toBe(encodeSegment("x"));
  });

  it("keeps a valid astral pair distinct from the surrogates it is made of", () => {
    // The guard on the fix: distinctness must not be bought by mangling valid
    // input. `😀` is exactly `\ud83d\ude00`, so an encoder that mishandled
    // pairs could make this collide with its own halves.
    expect(encodeSegment("😀")).not.toBe(encodeSegment("\ud83d"));
    expect(encodeSegment("😀")).not.toBe(encodeSegment("\ude00"));
    expect(encodeSegment("😀")).toBe(encodeSegment("\ud83d\ude00"));
  });

  it("separates the whole derivation, not just the digest", () => {
    // The digest is one component; what matters is that two hostile principals
    // do not land on one tree, one branch, or one lock.
    const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };
    const paths = HOSTILE.map((userId) =>
      checkoutPathFor(config, at("FIX-1", "implement", { principal: { userId } })),
    );
    const branches = HOSTILE.map((userId) =>
      branchFor(at("FIX-1", "implement", { principal: { userId } })),
    );
    expect(new Set(paths).size).toBe(HOSTILE.length);
    expect(new Set(branches).size).toBe(HOSTILE.length);
  });
});

describe("the identity rule — case cannot split one tree in two", () => {
  const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };

  it("resolves one checkout for ids that differ only in case", () => {
    // On a case-INSENSITIVE filesystem (macOS, Windows) `FIX-1` and `fix-1` are
    // the same directory, while the grammar accepted both and used them
    // verbatim — so the board held two distinct task ids whose checkouts and
    // locks were one tree. The second task inherits the first's work, or fails
    // the strict branch comparison over and over and spends its attempts.
    //
    // Folded rather than refused, and that is NOT the truncation call inverted.
    // Truncation maps two LEGITIMATELY distinct values onto one, creating a
    // collision that did not exist. Folding maps two values the filesystem
    // ALREADY treats as identical onto one — it does not create the collision,
    // it makes the identity agree with the storage that has to hold it. And no
    // single canonical case could be required instead: real issue keys are
    // upper (`FIX-1219`) and phases are lower (`implement`).
    expect(conductorTaskId("FIX-1", "implement")).toBe(conductorTaskId("fix-1", "IMPLEMENT"));
    expect(checkoutPathFor(config, at("FIX-1", "implement"))).toBe(
      checkoutPathFor(config, at("fix-1", "IMPLEMENT")),
    );
    expect(branchFor(at("FIX-1", "implement"))).toBe(branchFor(at("fix-1", "IMPLEMENT")));
  });

  it("leaves no derived identity carrying upper case at all", () => {
    // The property, over every derivation rather than the three spelled above:
    // a case-folding filesystem cannot split what it cannot see a difference
    // in, so nothing we derive may depend on case.
    const location = at("FIX-1219", "Implement", { epic: "Conductor-Tasks-Alpha" });
    for (const derived of [
      conductorTaskId("FIX-1219", "Implement"),
      checkoutPathFor(config, location),
      branchFor(location),
    ]) {
      expect(derived).toBe(derived.toLowerCase());
    }
  });

  it("keeps distinct ids distinct once folded", () => {
    // Folding must not become the collision it prevents: values that differ by
    // more than case still have to separate.
    expect(conductorTaskId("FIX-1", "implement")).not.toBe(
      conductorTaskId("FIX-2", "implement"),
    );
    expect(checkoutPathFor(config, at("FIX-1", "implement"))).not.toBe(
      checkoutPathFor(config, at("FIX-11", "implement")),
    );
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
