/**
 * The run's own checkout: where it is, how it is made, and who holds it.
 *
 * Three things live here, and they are separable on purpose — FIX-150's
 * workspaces replace this module, not the manager's shape.
 *
 * 1. **Derivation.** Where an issue-phase's checkout is, as a pure function of
 *    the durable task. Never read back from anywhere.
 * 2. **Provisioning.** Idempotent per issue-phase, on its own branch. Never
 *    resets, never forces, never discards uncommitted work.
 * 3. **Ownership.** One live attempt in one tree, resolved by WAITING rather
 *    than by failing (obligation B).
 *
 * ## Why the path is derived and not stored
 *
 * **The durable task is the only thing that must exist for a retry to work**, so
 * it is what the path is computed from. Anything else — a record, a cache, a
 * field somebody remembered to write — is a second source that can be absent,
 * stale, or disagree, and the failure when it is absent is silent: the retry
 * starts from an empty directory instead of the work the last attempt left,
 * which is exactly the carry-forward the retry budget is priced on.
 *
 * This argument used to lean on the run record being session-scoped while the
 * board was not. **That difference is gone** — the run record is `user`-scoped
 * now (see `./run-record`) — and the derivation is unchanged, because it never
 * depended on the gap. A record readable from everywhere is still a record.
 *
 * The alternative worth naming: moving the association onto the durable task as
 * a typed top-level field. That is FIX-1179's to design, and this lab is
 * explicitly not allowed to stand in for it.
 *
 * The run record still RECORDS the path, exactly as it records the harness
 * session id: a copy conductor reads to say where a run was, never the source
 * anything resolves from.
 *
 * ## The derivation's inputs are not model-writable (BP-031)
 *
 * `issue` and `phase` ride on the task's typed `input` payload. The model-facing
 * `updateTask` tool patches `priority`, `metadata`, `assignee` and labels — and
 * reaches no typed top-level field, `input` included. `metadata` would have been
 * the wrong home for exactly that reason. Both segments are then validated
 * against a strict grammar before they reach a path, so a task filed by some
 * future caller that skips the schema still cannot escape the root.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where checkouts and their lock files live, and what they are cut from. */
export interface WorkspaceConfig {
  /** Directory holding every issue-phase checkout. Host-set, never per-task. */
  root: string;
  /** The repository checkouts are cut from. Host-set. */
  sourceRepo: string;
  /** The ref a fresh checkout branches from. */
  baseRef: string;
}

/** One provisioned checkout. */
export interface Checkout {
  path: string;
  branch: string;
  /** True when this attempt created it, false when it inherited the last one's. */
  created: boolean;
}

/**
 * A segment that is safe to put in a path and in a branch name.
 *
 * Anchored, no dots-only values, no separators — so no input can climb out of
 * the root, and `..` can never appear. Rejects rather than sanitizes: silently
 * mapping two distinct issues onto one segment would give two runs one checkout,
 * which is obligation B's harm arriving through the door meant to prevent it.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeSegment(label: string, value: string): string {
  if (!SAFE_SEGMENT.test(value) || value.includes("..")) {
    throw new Error(
      `[conductor] ${label} "${value}" is not a usable path segment — ` +
        `letters, digits, and \`.\`/\`_\`/\`-\` after a leading alphanumeric, and no "..".`,
    );
  }
  return value;
}

/**
 * Who a run belongs to. Both halves come from the request's resolved identity,
 * never from anything a caller supplies in a body.
 */
export interface RunPrincipal {
  /** The authenticated user. */
  userId: string;
  /** The tenant, on a multi-tenant deployment. */
  tenantId?: string;
}

/**
 * The principal's segments, validated, in the order they appear in a path.
 *
 * **One place, because this is an isolation boundary and not a formatting
 * choice.** The board and the run record are `user`-scoped, so the framework
 * partitions them by principal for us. The filesystem and git partition nothing
 * — so unless the principal is in the path and in the branch, two users on one
 * host seeding the same issue-phase derive the *same* directory and the *same*
 * branch. The lock then serializes them rather than separating them: the second
 * user's agent opens a tree holding the first user's commits and uncommitted
 * work, and a pull request on the shared branch can satisfy the second user's
 * completion check. One user's run reports success on another's work.
 *
 * The invariant is **one job's state is isolated per principal**, and it ranges
 * over every store that job touches: collections, the filesystem, and git.
 */
function principalSegments(principal: RunPrincipal): string[] {
  return [
    // A literal rather than an empty segment on a single-tenant deployment, so
    // the depth of the tree never depends on configuration.
    assertSafeSegment("tenant", principal.tenantId ?? "single-tenant"),
    assertSafeSegment("user", principal.userId),
  ];
}

/**
 * Everything that makes one run's state distinct from another's.
 *
 * **One object rather than four positional strings, deliberately.** Every field
 * here is an isolation boundary, and adjacent string parameters are exactly the
 * shape that lets a transposed call compile and silently resolve the wrong
 * tree — which is the failure this type exists to make impossible.
 */
export interface RunLocation {
  principal: RunPrincipal;
  /**
   * The board's own discriminator — one epic's collection identity.
   *
   * D-4 partitions the board by it because the board is a claim pool. It has to
   * reach here too: `runs/**` is one collection EVERY epic writes, so without it
   * two epics driving the same issue-phase resolve one run topic, one checkout
   * and one branch. That is obligation B across boards — two live attempts, one
   * tree — and partitioning the topic while leaving the path shared would fix
   * the report and keep the overwrite.
   */
  epic: string;
  issue: string;
  phase: string;
}

/**
 * The segments that partition one run's state from every other run's.
 *
 * Principal first, then epic, then the issue-phase. **All three derivations use
 * this**, so a discriminator can never reach one and miss another.
 */
function locationSegments(location: RunLocation): string[] {
  return [
    ...principalSegments(location.principal),
    assertSafeSegment("epic", location.epic),
  ];
}

/** The issue-phase leaf, shared by the path and the branch. */
function issuePhaseSegment(location: RunLocation): string {
  return `${assertSafeSegment("issue", location.issue)}--${assertSafeSegment("phase", location.phase)}`;
}

/**
 * This run's checkout directory.
 *
 * A pure function of the durable task, the authenticated identity, and the
 * epic whose board filed it.
 */
export function checkoutPathFor(config: WorkspaceConfig, location: RunLocation): string {
  return join(config.root, ...locationSegments(location), issuePhaseSegment(location));
}

/**
 * This issue-phase's board task id — stable, so `seed` is idempotent.
 *
 * Built from the same validated segments the checkout path and branch are, for
 * the same reason: the value lands in the ledger's key space, and a separator or
 * a traversal there is the identical class of problem it would be in a path.
 */
export function conductorTaskId(issue: string, phase: string): string {
  return `${assertSafeSegment("issue", issue)}--${assertSafeSegment("phase", phase)}`;
}

/**
 * This issue-phase's branch, for this principal.
 *
 * Carries the principal for the same reason the path does, and it is the half
 * that is easier to miss: two users could be given separate directories and
 * still share a branch, at which point one user's commits land on the other's
 * branch and a pull request opened by either can satisfy the other's completion
 * check. Separate trees pushing one ref is not isolation.
 */
export function branchFor(location: RunLocation): string {
  const scope = locationSegments(location).join("/");
  return `conductor/${scope}/${assertSafeSegment("issue", location.issue)}-${assertSafeSegment("phase", location.phase)}`;
}

/** The lock file guarding one checkout. Beside it, not inside — see `acquire`. */
function lockPathFor(checkoutPath: string): string {
  return `${checkoutPath}.lock`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * The branch a worktree is actually on, or `null` on a detached HEAD.
 *
 * A detached HEAD is a mismatch like any other — the run would commit to no
 * branch at all — so it is reported rather than tolerated.
 */
async function currentBranch(checkoutPath: string): Promise<string | null> {
  const head = await git(checkoutPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return head === "HEAD" ? null : head;
}

async function branchExists(config: WorkspaceConfig, branch: string): Promise<boolean> {
  try {
    await git(config.sourceRepo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Give this issue-phase a checkout, or hand back the one the last attempt left.
 *
 * Idempotent: called twice it returns the same directory, and the second call
 * leaves uncommitted work exactly where it was. Nothing here resets, forces,
 * cleans, or deletes — decision 2's economics are the work on disk surviving a
 * failed attempt.
 *
 * A checkout whose branch was deleted underneath **fails loudly**. Recreating it
 * would produce a divergent branch pointing at the base ref while the tree still
 * holds the last attempt's work, and the next push would be a surprise.
 */
export async function provisionCheckout(
  config: WorkspaceConfig,
  location: RunLocation,
): Promise<Checkout> {
  const path = checkoutPathFor(config, location);
  const branch = branchFor(location);
  mkdirSync(config.root, { recursive: true });

  if (existsSync(join(path, ".git"))) {
    if (!(await branchExists(config, branch))) {
      throw new Error(
        `[conductor] the checkout at ${path} is on branch "${branch}", which no longer ` +
          `exists in ${config.sourceRepo}. Refusing to recreate it: the tree may hold ` +
          `uncommitted work, and a fresh branch off ${config.baseRef} would diverge from ` +
          `whatever the deleted one pointed at.`,
      );
    }

    // **The branch existing is not the branch being checked out.** A worktree
    // that was switched — by hand, by a tool, by a run that ran `git checkout` —
    // still satisfies the check above, because the expected branch is still in
    // the source repo; it is simply not the one this tree is on.
    //
    // Returning it anyway is a silent wrong answer of the worst kind here: the
    // prompt tells the run it is on the expected branch, the run record says so,
    // the commits land somewhere else entirely, and a pre-existing pull request
    // for the expected branch can make the attempt look done. Every layer agrees
    // and all of them are wrong.
    //
    // Fail loudly rather than resetting. A reset would discard whatever the tree
    // holds, and this module never resets (decision 2's carry-forward is exactly
    // that work).
    const head = await currentBranch(path);
    if (head !== branch) {
      throw new Error(
        `[conductor] the checkout at ${path} is on branch "${head}", not the expected ` +
          `"${branch}". Refusing to use it: a run told it is on "${branch}" would commit ` +
          `to "${head}" while the record says otherwise. Restore the branch or remove the ` +
          `checkout by hand — nothing here resets a tree.`,
      );
    }

    return { path, branch, created: false };
  }

  // A worktree whose directory was removed leaves an administrative entry
  // behind, and `worktree add` then refuses the path by name. Pruning is not a
  // reset: it touches bookkeeping, never a tree.
  await git(config.sourceRepo, ["worktree", "prune"]);

  const args = (await branchExists(config, branch))
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, config.baseRef];
  await git(config.sourceRepo, args);
  return { path, branch, created: true };
}

/** A held checkout. Release it on every exit from the attempt that took it. */
export interface CheckoutLease {
  release(): void;
}

/** How ownership is bounded. Sized against the renewal lag that causes overlap. */
export interface OwnershipBounds {
  /** How long to wait for a live holder to finish before failing the attempt. */
  waitMs: number;
  /** How often to re-check. */
  pollMs: number;
  /**
   * A lock older than this belongs to a process that is gone.
   *
   * Sized past the run's own wall-clock deadline, so a lock is only ever
   * declared stale once no live attempt could still be holding it. That is what
   * lets this work without a heartbeat.
   */
  staleAfterMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Take exclusive ownership of a checkout — **waiting** for it, not failing on it
 * (obligation B).
 *
 * Both halves of the obligation bind together and satisfying one while breaking
 * the other is not an implementation:
 *
 * - **Two live attempts never share a tree.** A lapsed lease does not stop the
 *   attempt that held it, and the renewal driver's abort signal lags the loss by
 *   up to about a third of the lease. Two coding agents in one checkout corrupt
 *   the artifact the run exists to produce.
 * - **Resolving contention never consumes a retry.** Every throw out of this
 *   worker reaches the board's fenced failure recorder and spends one. A
 *   reclaimed attempt that merely refused would be charged for the DISPLACED
 *   attempt's lease lag, and overlapping wakes could exhaust the row's budget
 *   before the old run noticed it had lost its claim. The retry budget bounds
 *   coding failures; spending it on a lock is a category error and a silent one.
 *
 * So ordinary contention resolves by waiting and costs nothing. Only exceeding
 * the bound throws, and that is a wedged process rather than a race — a real
 * failure, correctly charged.
 *
 * The lock sits BESIDE the checkout rather than inside it, so `git worktree add`
 * never meets a non-empty directory and the file survives a tree that has not
 * been created yet.
 *
 * ## What this is not: atomic
 *
 * **Acquiring** is atomic — an `O_EXCL` create either wins or does not.
 * **Unlinking** is not, in either of the two places that do it. Both the steal
 * and the release establish the file's identity (inode plus the bytes it
 * carries) immediately before removing it, but compare-then-unlink is two
 * syscalls, and a lock could in principle change hands between them. That is
 * cross-process mutual exclusion the filesystem API does not offer at this
 * level; closing it needs a rename/token protocol, which is a bigger change
 * than this lab's ownership problem warrants.
 *
 * **What bounds the residual** is the construction check that
 * `staleAfterMs` must exceed `runTimeoutMs`: a lock is only ever judged stale
 * once no live attempt could still be holding it, so the window requires a
 * holder to release and a new attempt to acquire between two adjacent
 * syscalls. Narrow enough to name rather than to solve — and named rather than
 * left for a reader to assume the inode check is a guarantee it is not.
 */
export async function acquireCheckout(
  checkoutPath: string,
  owner: string,
  bounds: OwnershipBounds,
  now: () => number = Date.now,
): Promise<CheckoutLease> {
  const lock = lockPathFor(checkoutPath);
  mkdirSync(join(checkoutPath, ".."), { recursive: true });
  const deadline = now() + bounds.waitMs;

  for (;;) {
    try {
      writeFileSync(lock, JSON.stringify({ owner, at: now() }), { flag: "wx" });
      // The identity of the file we just created, captured rather than re-derived.
      // See `release`.
      const mine = statSync(lock).ino;
      return {
        release() {
          // **Never unlink a lock without establishing it is still the one we
          // hold.** Same rule as the steal above, and it has to be here too —
          // this is the other place that unlinks.
          //
          // The case it closes is reachable, and the construction check is what
          // makes it reachable rather than preventing it: a run that overruns
          // `runTimeoutMs` becomes stale-eligible while its process is still
          // alive. Another attempt steals the lock and takes the tree; then this
          // release fires and, checking nothing, removes THE REPLACEMENT'S lock.
          // A third attempt acquires the path while the replacement is mid-edit —
          // two agents in one tree, which is the whole thing the lock prevents.
          //
          // So both the inode and the owner must still be ours. The inode is the
          // load-bearing half: an owner string alone cannot tell our lock from a
          // later file that happens to carry the same bytes.
          try {
            const current = statSync(lock);
            const held = JSON.parse(readFileSync(lock, "utf8")) as { owner?: string };
            if (current.ino === mine && held.owner === owner) {
              rmSync(lock, { force: true });
            }
          } catch {
            // Already gone, or unreadable. Either way there is nothing of ours
            // left to release, and a cleanup failure must never fail a run.
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    // A holder older than any live attempt could be is a process that died.
    // Steal it rather than waiting out a bound nobody is going to release.
    //
    // **The removal is conditioned on the identity of the file that was
    // judged**, and that is the whole correctness of this branch.
    // Remove-then-create is the obvious shape and it is broken: two waiters both
    // stat one stale lock, both decide it is stale, A removes it and creates its
    // replacement, and B then executes its already-authorised removal against
    // *A's new lock* and creates its own. Both hold leases and two agents mutate
    // one checkout — the precise harm obligation B exists to prevent, arriving
    // through the mechanism meant to prevent it.
    //
    // So the victim is identified before it is judged (inode plus the bytes it
    // carries), re-identified immediately before the unlink, and the steal is
    // abandoned if anything moved. A successful steal only CLEARS the path — it
    // never acquires. Acquisition is always the atomic `wx` create at the top of
    // this loop, so a stealer competes fairly with every other waiter afterwards.
    try {
      const victim = statSync(lock);
      const held = readFileSync(lock, "utf8");
      if (now() - victim.mtimeMs > bounds.staleAfterMs) {
        // Re-read rather than trusting the reads above: between judging the lock
        // and unlinking it, the holder may have released and a live attempt
        // taken the path.
        const current = statSync(lock);
        if (current.ino === victim.ino && readFileSync(lock, "utf8") === held) {
          rmSync(lock, { force: true });
        }
        continue;
      }
    } catch {
      // It was released between the failed create and the stat. Retry.
      continue;
    }

    if (now() >= deadline) {
      throw new Error(
        `[conductor] waited ${bounds.waitMs}ms for the checkout at ${checkoutPath} and it ` +
          `is still held. Treating that as a wedged process rather than a race: an ` +
          `ordinary reclaim resolves well inside this bound.`,
      );
    }
    await sleep(bounds.pollMs);
  }
}
