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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { GIT_TIMEOUT_MS, run } from "./exec";

/** Where checkouts and their lock files live, and what they are cut from. */
export interface WorkspaceConfig {
  /** Directory holding every issue-phase checkout. Host-set, never per-task. */
  root: string;
  /** The repository checkouts are cut from. Host-set. */
  sourceRepo: string;
  /** The ref a fresh checkout branches from. */
  baseRef: string;
  /**
   * How long **the whole of provisioning** may take, in milliseconds.
   *
   * One budget for the operation, not one per git call. That distinction is the
   * entire point: provisioning runs up to three git commands back to back
   * (`worktree prune`, a `rev-parse` to test the branch, then `worktree add`),
   * so a per-call timeout of N bounds the operation at 3N. The ownership
   * arithmetic reads this number as the longest provisioning can hold the lock,
   * and a number that is wrong by a factor of the command count is worse than no
   * number: a live attempt could still be inside `worktree add` when its lock is
   * declared stale, letting a reclaimed attempt steal the tree and edit the same
   * checkout concurrently.
   *
   * Expressing it as one deadline also means adding a fourth git command cannot
   * silently widen the bound.
   */
  provisionTimeoutMs?: number;
}

/** One provisioned checkout. */
export interface Checkout {
  path: string;
  branch: string;
  /** True when this attempt created it, false when it inherited the last one's. */
  created: boolean;
}

/**
 * **The identity rule, stated once because it has been re-learned four times.**
 *
 * Every string this module derives — a task id, a collection id, a board id, a
 * directory, a branch — is built from components. Two properties govern all of
 * them, and each was violated in a different place by a fix that was written
 * over the cases in front of it instead of over the rule:
 *
 * 1. **Injective over its components.** No redistribution of characters between
 *    components may produce the same string. A delimiter that a component can
 *    itself contain is not a frame, it is a suggestion: with a `-` join,
 *    `(tenant "a-b", epic "c")` and `(tenant "a", epic "b-c")` both spell
 *    `conductor-tasks-a-b-c`, so two tenants share one claim pool. With a `--`
 *    join over components that may contain `--`, `(issue "a--b", phase "c")`
 *    and `(issue "a", phase "b--c")` share one task id, one checkout and one
 *    branch — obligation B's harm arriving through the door built to stop it.
 *    Both were measured, not reasoned about.
 *
 * 2. **Safe for every consumer of the string, not just the first one.** These
 *    segments become filesystem paths AND git refs. `git check-ref-format`
 *    rejects a name ending in `.` or `.lock`; the old grammar accepted both.
 *    An accepted-then-rejected value is worse than a rejected one: the row is
 *    claimed, the checkout fails to create, the attempt is charged, and the
 *    whole retry budget is spent on a configuration error no retry can fix.
 *
 * Two mechanisms serve the one rule, chosen by who owns the identifier:
 *
 * - Identifiers **we** issue (epics, issue keys, phase names) are *validated*
 *   against {@link OWNED_SEGMENT}. The grammar is ours to set, a malformed
 *   issue key is a real signal, and the value stays readable in a path.
 * - Identifiers **someone else** issues (user ids, tenant ids) are *encoded*
 *   by {@link encodeSegment}. See its note for why a grammar is the wrong
 *   instrument there.
 *
 * Both outputs are free of {@link IDENTITY_DELIMITER}, which is what makes the
 * join injective — the frame is a sequence no component can forge.
 */
const OWNED_SEGMENT = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/;

/**
 * How long one of our own segments may be.
 *
 * Bounding the *encoded* half and not this one would have left the same defect
 * standing: a 300-character epic or phase name overflows a filesystem
 * component exactly as a long user id did, and fails the same way — from inside
 * git, after the row is claimed, once per retry. Measured: a name is refused at
 * 256 bytes. 64 leaves room for the frame and keeps a segment readable, which
 * is the whole reason these are validated rather than digested.
 */
const MAX_OWNED_SEGMENT = 64;

/**
 * The frame. Never a single `-`: our own issue keys contain those.
 *
 * `git check-ref-format` accepts `--` inside a ref, and so does every
 * filesystem — verified, not assumed.
 */
const IDENTITY_DELIMITER = "--";

export function assertSafeSegment(label: string, value: string): string {
  if (!OWNED_SEGMENT.test(value) || value.length > MAX_OWNED_SEGMENT) {
    throw new Error(
      `[conductor] ${label} "${value}" is not a usable identity segment — ` +
        `at most ${MAX_OWNED_SEGMENT} letters and digits, separated by single \`-\` or ` +
        `\`_\`. No dots (a git ref may not end in "." or ".lock"), no ` +
        `"${IDENTITY_DELIMITER}" (it is the component frame), nothing that could climb out ` +
        `of a directory, and nothing long enough to overflow a filesystem component.`,
    );
  }
  return value;
}

/**
 * Join identity components into one string, injectively.
 *
 * Every component reaching here is already frame-free — an owned one by
 * grammar, an opaque one by encoding — so the join is reversible and two
 * distinct component tuples can never collide. **Use this for every derived
 * identity.** A literal prefix is an ordinary component: it must be frame-free
 * too, which is why `conductor-tasks` is spelled with a single dash.
 */
export function joinIdentity(...parts: string[]): string {
  return parts.join(IDENTITY_DELIMITER);
}

/**
 * A string that is used as ONE path segment or ref component, whole.
 *
 * The rule above has two roles, and conflating them is what made the first
 * attempt at this reject its own output. A **component** is joined with others,
 * so it must be frame-free ({@link assertSafeSegment}). A **derived identity**
 * is the finished string — a board collection id, say — and it lands between
 * `/` separators rather than inside a join, so it may legitimately contain the
 * frame. What it may still never do is anything a path or a git ref forbids.
 *
 * `joinIdentity`'s output satisfies this by construction; this exists for the
 * identities that arrive from elsewhere already built.
 */
const DERIVED_IDENTITY = /^[A-Za-z0-9]+(?:[_-]+[A-Za-z0-9]+)*$/;

export function assertDerivedIdentity(label: string, value: string): string {
  if (!DERIVED_IDENTITY.test(value)) {
    throw new Error(
      `[conductor] ${label} "${value}" is not a usable identity segment — ` +
        `letters and digits, separated by \`-\` or \`_\`. No dots (a git ref may not ` +
        `end in "." or ".lock"), and nothing that could climb out of a directory.`,
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
  return [tenantSegment(principal.tenantId), encodeSegment(principal.userId)];
}

/**
 * One tenant, as one identity component. **Presence is tagged, never
 * defaulted.**
 *
 * `t0` for an untenanted request, `t1<digest>` for a tenanted one — so an
 * absent tenant and a tenant *named* like whatever placeholder someone picks
 * can never produce the same component.
 *
 * This exists as a shared function because collapsing absence into a value is a
 * bug that was fixed here and then reintroduced one file away: the board's
 * identity used `?? "single-tenant"`, which made a real tenant called
 * `single-tenant` indistinguishable from no tenant at all. Same user id, same
 * user-scoped board, each able to claim the other's rows — while THIS function
 * kept them in different checkouts, so a task could execute and report against
 * a tree that was not its own.
 *
 * Absent and `"single-tenant"` are different facts. The type carries that
 * (`string | undefined`), and every derivation reads it through here.
 */
export function tenantSegment(tenantId: string | undefined): string {
  return tenantId === undefined ? "t0" : `t1${encodeSegment(tenantId)}`;
}

/**
 * Encode an identifier into one path segment. **Encode, never validate.**
 *
 * The framework's user and tenant ids are unrestricted strings — `auth0|abc`
 * and `alice@example.com` are ordinary values, and neither matches a filesystem
 * grammar. Validating them would fail every attempt during workspace derivation
 * and burn the retry budget on a configuration mismatch the run cannot fix.
 *
 * Worse, a grammar is a rule someone else's identifier space never agreed to,
 * and enforcing it is a list that is never finished: separators, `..`, trailing
 * dots (Windows strips them, so `acme` and `acme.` are one directory), reserved
 * device names, case folding. Encoding removes the list — the output is
 * injective, so two distinct ids can never share a directory, and its alphabet
 * contains nothing any filesystem treats specially.
 *
 * A SHA-256 digest in hex, behind a literal `h`: `h[0-9a-f]{64}`, which cannot
 * spell a reserved device name, cannot end in a dot, and cannot contain a
 * separator or the identity frame.
 *
 * **A digest and not a reversible encoding, because the output has to be
 * bounded.** Hex of the input doubles it, so a 128-character id — an ordinary
 * length for an opaque subject claim — produced a 257-character component.
 * Measured: a filesystem name is refused at 256, and `ENAMETOOLONG` arrives
 * from `worktree add`, which is to say *after* the row is claimed. Every retry
 * would then be spent on a length no retry can change. A fixed 65 characters
 * cannot do that.
 *
 * The cost is honest: the path no longer says which user it belongs to. What it
 * keeps is the property the derivation actually needs — distinct ids give
 * distinct components — since a SHA-256 collision is not a failure mode this
 * system will meet.
 *
 * **The prefix is load-bearing, not decoration.** A bare digest of an empty id
 * is still a digest, but the prefix keeps the alphabet closed under `h[0-9a-f]`
 * for every input including the empty one, and it is what a reader recognises
 * as "this segment is derived, not typed".
 *
 * **The issue and phase segments stay validated.** Those identifiers are ours,
 * the grammar is one we set, and rejecting a malformed issue key is a real
 * signal rather than an imposition.
 */
export function encodeSegment(value: string): string {
  return `h${createHash("sha256").update(value, "utf8").digest("hex")}`;
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
    // The BOARD COLLECTION ID, not a bare epic name — it arrives already
    // joined, so it is checked as a finished identity rather than as a
    // component. See `assertDerivedIdentity`.
    assertDerivedIdentity("epic", location.epic),
  ];
}

/** The issue-phase leaf, shared by the path, the branch, and the board task id. */
function issuePhaseSegment(location: RunLocation): string {
  return conductorTaskId(location.issue, location.phase);
}

/**
 * This run's checkout directory.
 *
 * A pure function of the durable task, the authenticated identity, and the
 * epic whose board filed it.
 */
export function checkoutPathFor(config: WorkspaceConfig, location: RunLocation): string {
  // **Absolute, always.** The derived path is consumed from two different
  // working directories: the lock, the existence checks, the recorded path and
  // the agent's `cwd` all resolve it against the dispatcher's directory, while
  // `git worktree add` runs with `cwd: config.sourceRepo`. A relative
  // `workspace.root` therefore split in two — reproduced: the worktree lands
  // under the SOURCE REPO while everything else looks for it under the
  // dispatcher, so the agent is handed a directory that does not exist and no
  // retry recovers, because the derivation is stable and stably wrong.
  //
  // Resolved here rather than at each call because this is the one derivation
  // every consumer goes through. A host should still pass an absolute root:
  // `resolve` reads `process.cwd()`, so a process that changes directory
  // mid-flight would move the checkout, and that is not a case this guards.
  return resolve(config.root, ...locationSegments(location), issuePhaseSegment(location));
}

/**
 * This issue-phase's board task id — stable, so `seed` is idempotent.
 *
 * Built from the same validated segments the checkout path and branch are, for
 * the same reason: the value lands in the ledger's key space, and a separator or
 * a traversal there is the identical class of problem it would be in a path.
 */
export function conductorTaskId(issue: string, phase: string): string {
  return joinIdentity(assertSafeSegment("issue", issue), assertSafeSegment("phase", phase));
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
  // The same leaf the checkout path uses. It was spelled with a SINGLE dash
  // here while the path used `--`, so the branch aliased on inputs the path
  // kept apart — the identity rule broken in one of the two places that had to
  // agree, which is the whole reason the leaf is now derived in one function.
  return `conductor/${scope}/${issuePhaseSegment(location)}`;
}

/** The lock file guarding one checkout. Beside it, not inside — see `acquire`. */
function lockPathFor(checkoutPath: string): string {
  return `${checkoutPath}.lock`;
}

/**
 * The remaining time in one provisioning, as a per-call timeout.
 *
 * **Zero is not "no budget left" to `execFile` — it is "no timeout at all".**
 * So an exhausted deadline has to throw here rather than be passed down, or the
 * exact case this bound exists for (provisioning running long enough to be
 * declared stale) would remove the bound instead of enforcing it.
 */
function remainingBudget(deadline: number, now: () => number): number {
  const left = deadline - now();
  if (left <= 0) {
    throw new Error(
      "[conductor] provisioning exceeded its budget (workspace.provisionTimeoutMs) before " +
        "it finished. The lock is held across provisioning, so a longer one would risk " +
        "being declared stale while this attempt is still legitimately working.",
    );
  }
  return left;
}

async function git(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * The branch a worktree is actually on, or `null` on a detached HEAD.
 *
 * A detached HEAD is a mismatch like any other — the run would commit to no
 * branch at all — so it is reported rather than tolerated.
 */
async function currentBranch(
  checkoutPath: string,
  timeoutMs: number,
): Promise<string | null> {
  const head = await git(checkoutPath, ["rev-parse", "--abbrev-ref", "HEAD"], timeoutMs);
  return head === "HEAD" ? null : head;
}

async function branchExists(
  config: WorkspaceConfig,
  branch: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await git(
      config.sourceRepo,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      timeoutMs,
    );
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
  now: () => number = Date.now,
): Promise<Checkout> {
  const path = checkoutPathFor(config, location);
  const branch = branchFor(location);
  mkdirSync(resolve(config.root), { recursive: true });

  // **One deadline for the whole operation.** Every git call below draws from
  // it, so the lock is held for at most this long no matter how many commands
  // the path happens to run. `now` is injectable for the same reason it is on
  // `acquireCheckout`: the thing under test is time arithmetic.
  const deadline = now() + (config.provisionTimeoutMs ?? GIT_TIMEOUT_MS);
  const left = () => remainingBudget(deadline, now);

  if (existsSync(join(path, ".git"))) {
    if (!(await branchExists(config, branch, left()))) {
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
    const head = await currentBranch(path, left());
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
  await git(config.sourceRepo, ["worktree", "prune"], left());

  const args = (await branchExists(config, branch, left()))
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, config.baseRef];
  await git(config.sourceRepo, args, left());
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
 * **What bounds the residual** is the construction check that `staleAfterMs`
 * must exceed the longest a live attempt can legitimately hold the lock — the
 * run's deadline AND the provisioning that precedes it, since the lock is taken
 * first. A lock is only ever judged stale
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
  signal?: AbortSignal,
): Promise<CheckoutLease> {
  const lock = lockPathFor(checkoutPath);
  /**
   * Stop waiting once this attempt has been cancelled.
   *
   * **Checked in the WAIT, never during an in-flight git command.** Shutdown, or
   * a lease renewal reporting that this attempt lost its claim, propagates
   * through `ctx.signal` — and an ordinary sleep ignores it, so a stale attempt
   * kept polling for the whole ownership window and could still go on to acquire
   * and provision a checkout it can no longer record a result for. That window
   * is now the run's deadline plus provisioning plus slack, so ignoring the
   * signal costs the better part of an hour of a replacement's time.
   *
   * Interrupting the wait is safe in a way interrupting provisioning is not:
   * nothing has been created yet, so there is nothing half-made to leave behind.
   */
  const stopIfCancelled = (): void => {
    if (signal?.aborted !== true) return;
    throw new Error(
      `[conductor] the attempt waiting for the checkout at ${checkoutPath} was cancelled ` +
        "before it acquired the lock. Stopping rather than taking a tree whose result " +
        "this attempt can no longer record.",
    );
  };
  stopIfCancelled();
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
          // the whole hold budget becomes stale-eligible while its process is still
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
    stopIfCancelled();
  }
}
