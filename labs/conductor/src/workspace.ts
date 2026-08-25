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
 * The run record is session-scoped; the board is `user`-scoped so a parked row
 * outlives the coordinator session that filed it. A task woken in a NEW
 * coordinator session therefore sees the board row and not the previous
 * checkout row — and if that row were the authority for the path, the retry
 * would silently start from nothing, which is precisely the carry-forward the
 * retry budget is priced on.
 *
 * The two obvious repairs both cost more than they are worth. Moving the
 * association onto the durable task is a typed top-level task field, which is
 * FIX-1179's to design and which this lab is explicitly not allowed to stand in
 * for. Constraining retries and wakes to the original session lineage forks the
 * decision that made the board `user`-scoped in the first place — a parked row
 * must outlive its session, or a human's answer tomorrow has nowhere to land.
 *
 * Deriving costs neither. The run record still RECORDS the path, exactly as it
 * records the harness session id: a copy conductor reads to say where a run
 * was, never the source anything resolves from.
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

/** This issue-phase's checkout directory. A pure function of the task. */
export function checkoutPathFor(config: WorkspaceConfig, issue: string, phase: string): string {
  return join(
    config.root,
    `${assertSafeSegment("issue", issue)}--${assertSafeSegment("phase", phase)}`,
  );
}

/** This issue-phase's branch. Derived alongside the path, from the same inputs. */
export function branchFor(issue: string, phase: string): string {
  return `conductor/${assertSafeSegment("issue", issue)}-${assertSafeSegment("phase", phase)}`;
}

/** The lock file guarding one checkout. Beside it, not inside — see `acquire`. */
function lockPathFor(checkoutPath: string): string {
  return `${checkoutPath}.lock`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
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
  issue: string,
  phase: string,
): Promise<Checkout> {
  const path = checkoutPathFor(config, issue, phase);
  const branch = branchFor(issue, phase);
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
      return {
        release() {
          // Only ever remove OUR lock. A wait that stole a stale one has
          // rewritten the file, so a late release from the original holder must
          // not take the live attempt's lock with it.
          try {
            const held = JSON.parse(readFileSync(lock, "utf8")) as { owner?: string };
            if (held.owner === owner) rmSync(lock, { force: true });
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
    try {
      if (now() - statSync(lock).mtimeMs > bounds.staleAfterMs) {
        rmSync(lock, { force: true });
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
