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
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { GIT_TIMEOUT_MS, run } from "./exec";
import { identityFromCommonDir } from "./config-env";

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
  // **Returns the CANONICAL form, and every derivation uses the return value.**
  //
  // Case is the third way this rule can be broken, after redistribution and
  // length. On a case-insensitive filesystem `FIX-1` and `fix-1` are one
  // directory, so two distinct board task ids resolved to one checkout and one
  // lock: the second task inherits the first's tree, or fails the strict branch
  // comparison repeatedly and spends its attempts on it.
  //
  // Folded rather than refused, and that is not the length call inverted.
  // Truncation maps two LEGITIMATELY distinct values onto one — a collision
  // that did not exist before. Folding maps two values the filesystem ALREADY
  // cannot tell apart onto one: it does not create the collision, it stops the
  // identity from disagreeing with the storage that has to hold it. Refusing
  // was not available either — no single canonical case fits, since real issue
  // keys are upper (`FIX-1219`) and phase names are lower (`implement`).
  //
  // Only the DERIVED identity folds. The issue key a prompt shows the agent
  // comes from the task payload and keeps its own case.
  if (!OWNED_SEGMENT.test(value) || value.length > MAX_OWNED_SEGMENT) {
    throw new Error(
      `[conductor] ${label} "${value}" is not a usable identity segment — ` +
        `at most ${MAX_OWNED_SEGMENT} letters and digits, separated by single \`-\` or ` +
        `\`_\`. No dots (a git ref may not end in "." or ".lock"), no ` +
        `"${IDENTITY_DELIMITER}" (it is the component frame), nothing that could climb out ` +
        `of a directory, and nothing long enough to overflow a filesystem component.`,
    );
  }
  return canonicalSegment(value);
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
  // Folded for the same reason `assertSafeSegment` is: this value becomes a
  // path component too, and an identity built elsewhere must not be the one
  // that reintroduces case into the derivation.
  if (!DERIVED_IDENTITY.test(value)) {
    throw new Error(
      `[conductor] ${label} "${value}" is not a usable identity segment — ` +
        `letters and digits, separated by \`-\` or \`_\`. No dots (a git ref may not ` +
        `end in "." or ".lock"), and nothing that could climb out of a directory.`,
    );
  }
  return canonicalSegment(value);
}

/**
 * The canonical form of an owned segment — the fold, without the grammar check.
 *
 * Both validators above return this, so anything comparing against a derived
 * identity has to apply the same fold or the two quietly disagree. It is a
 * function rather than a `.toLowerCase()` at each site for the usual reason:
 * a rule in a function gets imported, a rule at a call site gets copied — and
 * this one was already spelled out twice here before a third caller needed it.
 *
 * Separate from the validators because a caller-supplied FILTER is not an
 * identity. A filter that could never be a valid segment simply matches nothing,
 * and throwing on it would turn a query into an error.
 */
export function canonicalSegment(value: string): string {
  return value.toLowerCase();
}

/**
 * Do two spellings name the same owned segment?
 *
 * **The comparison, not the fold, is what call sites keep getting wrong.**
 * `canonicalSegment` existed and the sites that needed it still wrote
 * `a !== b` — because applying the fold is a step somebody has to remember,
 * and remembering is what fails. So the comparison itself is the exported
 * thing, and there is no correct-looking way to write it by hand.
 *
 * The cost of a raw comparison is not cosmetic. Identity derivation folds, so
 * `implement` and `IMPLEMENT` are ONE task, one checkout and one branch — but a
 * guard comparing raw strings calls them different. The two disagree only after
 * a row has been claimed, so the row is charged an attempt for a mismatch its
 * own identity says does not exist, once per wake, until the budget is gone.
 */
export function sameSegment(a: string, b: string): boolean {
  return canonicalSegment(a) === canonicalSegment(b);
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
  // **`utf16le`, and the encoding is the load-bearing part.**
  //
  // A JavaScript string is a sequence of UTF-16 code units, lone surrogates
  // included. UTF-8 has no representation for a lone surrogate, so encoding
  // through it substitutes U+FFFD BEFORE the hash runs — measured:
  // `"\ud800"`, `"\ud801"`, `"\udfff"` and a literal `"\ufffd"` produce ONE
  // digest, so four distinct caller-supplied identifiers share one checkout and
  // one lock.
  //
  // This is not the collision the digest's safety argument covers. That
  // argument is about SHA-256, and it holds. This is a collision in the
  // TRANSCODING STEP UPSTREAM of the hash — deliberate, trivial to reproduce,
  // and available to anyone who can supply an identifier. Collision resistance
  // is simply not the property that was broken.
  //
  // `utf16le` is total over the domain: every JavaScript string has an exact
  // representation, so there is no substitution left to collapse anything. The
  // general rule, and the one worth carrying: **never transcode an identifier
  // through an encoding that cannot represent it.**
  return `h${createHash("sha256").update(Buffer.from(value, "utf16le")).digest("hex")}`;
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
  // every consumer goes through.
  //
  // The root must be absolute, and that is now REFUSED at `conductorFlow`
  // rather than asked for here. `resolve` reads `process.cwd()`, so a relative
  // root makes this derivation a function of where the process happens to be
  // standing: a long-lived host that changes directory between attempts derives
  // a second checkout for the same durable task, and the retry inherits an empty
  // tree instead of the uncommitted work its own prompt tells it to continue
  // from. This comment used to say a host "should" pass an absolute one and call
  // the rest unguarded — which is the unenforced convention every other guard at
  // that door exists to replace.
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
 * Marks a provisioning that has started and not yet finished.
 *
 * Written before `git worktree add` and removed once it returns, so a directory
 * left behind by a killed provision is **positively identified** rather than
 * inferred from a missing `.git`. Beside the checkout rather than inside it, for
 * the same reason the lock is: `worktree add` must never meet a non-empty target.
 */
function provisioningMarkerFor(checkoutPath: string): string {
  return `${checkoutPath}.provisioning`;
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

/**
 * Which REPOSITORY a directory belongs to, or `undefined` if it is not in one.
 *
 * The async twin of `repositoryIdentity`: same answer, obtained through the
 * budgeted git helper so it draws from the provisioning deadline rather than
 * blocking outside it. The rule that turns a `--git-common-dir` answer into an
 * identity lives in ONE place, `identityFromCommonDir`, so the startup guard and
 * this one cannot drift into two notions of "the same repository".
 *
 * The common dir and not the toplevel, for the reason the startup guard gives:
 * it is the one directory every worktree of a repository shares.
 */
async function gitIdentity(dir: string, timeoutMs: number): Promise<string | undefined> {
  try {
    return identityFromCommonDir(dir, await git(dir, ["rev-parse", "--git-common-dir"], timeoutMs));
  } catch {
    return undefined;
  }
}

/**
 * Does this tree look like a `worktree add` that was killed part-way?
 *
 * `git ls-files --deleted` lists tracked files that the index expects and the
 * working tree does not have — which is precisely what a half-populated checkout
 * is, and precisely what a checkout an agent has worked in is not. Used to
 * corroborate the provisioning marker before acting on it, because the marker
 * itself is writable by anything with access to the workspace root.
 *
 * **A tree we cannot interrogate does not look half-built.** If git cannot
 * answer — no `.git`, an unreadable repository, a timeout — the honest answer is
 * "unknown", and unknown must not authorise a recursive delete. The caller's
 * other branches handle a missing `.git` on its own terms.
 */
async function looksHalfBuilt(path: string, timeoutMs: number): Promise<boolean> {
  if (!existsSync(join(path, ".git"))) return true;
  try {
    return (await git(path, ["ls-files", "--deleted"], timeoutMs)).length > 0;
  } catch {
    return false;
  }
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
  } catch (err) {
    if (isRefAbsent(err)) return false;
    throw new Error(
      `[conductor] could not determine whether branch "${branch}" exists in ` +
        `${config.sourceRepo}: the probe failed for a reason other than the ref being ` +
        `absent. Not reporting that as a deleted branch — see the cause below.`,
      { cause: err },
    );
  }
}

/**
 * Did the ref probe fail **because the ref is not there**, or because the probe
 * itself did not work?
 *
 * A blanket `catch` cannot tell those apart, and answering `false` for both is
 * wrong twice over. On the reuse path the caller reports a branch someone
 * deleted, so whoever reads the message goes looking for a deletion that never
 * happened. On the fresh path the caller takes `worktree add -b`, which then
 * fails against the branch that does exist. Either way the attempt is charged
 * for an infrastructure failure — the same category error the ownership wait
 * refuses to make, arriving through a `catch` instead of through a lock.
 *
 * **The discriminator is measured, not assumed.** `git rev-parse --verify
 * --quiet` exits 1 with no signal when the ref is absent. Every other failure
 * looks different: a timeout comes back `killed: true` (with `code` 128 and
 * `signal` null, so `killed` is the witness and `signal` is not), a repository
 * git cannot read exits 128 unkilled, and a git that cannot be spawned carries
 * a string `code` such as `ENOENT`. Only the first is an answer.
 */
function isRefAbsent(err: unknown): boolean {
  const { code, killed } = (err ?? {}) as { code?: unknown; killed?: unknown };
  return killed !== true && code === 1;
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

  const marker = provisioningMarkerFor(path);

  // **A marked tree is reused, cleared, or refused — and the marker alone does
  // not decide which.** Two earlier calls in this file were both wrong, in
  // opposite directions, and the rule below is what is left after each was
  // measured.
  //
  // First: `.git` was treated as the witness that provisioning finished, so any
  // checkout carrying it was reused. That is wrong. `git worktree add` killed
  // mid-checkout leaves `.git`, the expected branch, and a registered worktree
  // all in place with the tree only partly populated — measured at 400 tracked
  // files, 241 present, 401 staged deletions waiting in the index. Reusing that
  // hands the agent a tree that looks healthy and is missing most of the
  // repository, and its first commit deletes every file the checkout never
  // received. So `.git` witnesses that setup REACHED a point, not that it
  // finished.
  //
  // Second, the over-correction: let the marker outrank `.git`, on the argument
  // that a marked tree is "by construction one no agent has run in" — the marker
  // is written before `worktree add` and cleared before this function returns,
  // and the agent runs only after it returns. That is wrong about who can write
  // the file. The marker lives beside the checkout, in the workspace root, and
  // the coding agent has a shell: it can create `<checkout>.provisioning` at any
  // time. The next attempt then reads a forged or stray marker as proof of an
  // interrupted provision and recursively deletes a tree holding committed and
  // uncommitted work — the exact loss the whole reuse design is priced on,
  // caused by the guard against it.
  //
  // There is no filesystem location an unrestricted agent cannot reach, so
  // "store the marker out of its scope" is not available. What IS available is a
  // second opinion: a killed `worktree add` leaves tracked files MISSING from
  // the working tree (the 241-of-400 measurement above; the rest are listed by
  // `git ls-files --deleted`), while a checkout an agent has worked in does not.
  // So the marker is acted on only when the tree independently agrees it is
  // half-built.
  //
  // When they disagree — marker present, `.git` valid, nothing missing — the
  // tree is REFUSED rather than reused or deleted. Reusing it would ignore a
  // marker that might be real; deleting it destroys work that is definitely
  // real. This module's standing answer for contents it cannot explain is to
  // keep them and say so.
  const interrupted = existsSync(marker) && (await looksHalfBuilt(path, left()));

  if (existsSync(marker) && !interrupted && existsSync(join(path, ".git"))) {
    throw new Error(
      `[conductor] ${marker} says a provision was interrupted, but the checkout at ${path} ` +
        `is complete — every tracked file is present. One of the two is lying, and this ` +
        `will not guess: the marker can be created by anything with write access to the ` +
        `workspace root, including the coding agent, and the tree may hold real work. ` +
        `Inspect it, then delete the marker to reuse the checkout or delete the checkout ` +
        `to have it rebuilt.`,
    );
  }

  if (!interrupted && existsSync(join(path, ".git"))) {
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

    // **The checkout has to belong to the repository this config names.** The
    // checks below verify the BRANCH — that it still exists, and that the tree
    // is on it — and a branch name says nothing about which repository it lives
    // in. The derived path is a function of the epic, principal and task, not of
    // `sourceRepo`, so a persistent workspace root outlives a change to it: the
    // old checkout still sits at the same path carrying the same deterministic
    // branch name, both checks pass, and the agent edits and opens a pull
    // request in the repository the operator moved OFF.
    //
    // Compared on the git common dir, so a sibling worktree of the right
    // repository is still the right repository, and through the same helper the
    // startup guard uses — one definition of "the same repository", or the two
    // guards eventually disagree about it.
    //
    // Run through the budgeted git helper rather than the startup one: this is
    // inside the provisioning deadline, and a call that does not draw from the
    // budget is a hole in the bound the ownership arithmetic is sized from.
    //
    // **Placed after the branch checks, and that ordering is deliberate.** Put
    // first, this guard answered "does not belong to" for a `sourceRepo` that is
    // not a repository at all — true, and the wrong diagnosis: the branch probe
    // above says exactly that, and a message naming the wrong cause is what the
    // probe's own error was written to avoid. Both orders refuse before the agent
    // runs, which is the property that matters, so the one with the better
    // failure message wins.
    const [mine, theirs] = await Promise.all([
      gitIdentity(path, left()),
      gitIdentity(config.sourceRepo, left()),
    ]);
    if (mine === undefined || theirs === undefined || mine !== theirs) {
      throw new Error(
        `[conductor] the checkout at ${path} does not belong to ${config.sourceRepo}. ` +
          `Refusing to reuse it: the branch name matches, but a run given this tree would ` +
          `commit and open a pull request in another repository. It may hold uncommitted ` +
          `work, so nothing here removes it — move or delete it by hand, or point ` +
          `workspace.root somewhere this repository owns.`,
      );
    }

    return { path, branch, created: false };
  }

  // **A directory with no `.git` is a creation that never finished — remove it.**
  //
  // Measured, not reasoned about: `SIGTERM` to `git worktree add` (which is
  // exactly how the provisioning budget ends it) leaves the target present,
  // partly populated, and without `.git`. The next attempt then takes this same
  // branch, and `worktree add` refuses with `fatal: '<path>' already exists` —
  // on BOTH arms, since the killed run also leaves the branch behind. `worktree
  // prune` does not help; it touches bookkeeping, and the leftover is a tree.
  // So every remaining attempt failed on a leftover no retry could clear.
  //
  // **This does not weaken "never reset".** That rule protects the previous
  // attempt's work, and the whole point of `.git` as the witness is that git
  // writes it as part of setup — so a tree without it was never a usable
  // checkout, no agent ever ran in it, and it holds nothing to carry forward.
  // Reuse is still decided by `.git`; what changed is the disposition when the
  // witness is absent, from "try anyway and fail" to "clear and recreate".
  //
  // Cleaning here rather than in a `catch` around the failed `add` is
  // deliberate: a catch cannot run when the whole process is killed, and this
  // covers that case too.
  if (existsSync(path)) {
    // **A missing `.git` does not prove nobody ever worked here**, which is what
    // this branch used to assume. The run holds an agent with shell access, so
    // removing or renaming `.git` inside its own checkout is reachable — by a
    // cleanup script, or by an agent deciding to start over. The tree then looks
    // exactly like an interrupted provision while holding real uncommitted work,
    // and clearing it destroys the thing decision 2 is priced on.
    //
    // So the interrupted case is IDENTIFIED rather than inferred. `interrupted`
    // is the corroborated reading established above, not a bare `existsSync` on
    // the marker; with no `.git` here the corroboration is trivially satisfied,
    // so on this branch it reduces to the marker — but it reduces to it by the
    // same rule, not by a second one. Absent, this directory is something we did
    // not make and cannot explain, and the safe disposition for unknown contents
    // is to keep them.
    if (!interrupted) {
      throw new Error(
        `[conductor] the checkout at ${path} has no \`.git\` and no record of an ` +
          `interrupted provision, so it is not a half-created checkout and this will not ` +
          `clear it — it may hold work. Inspect it and remove it by hand if it is junk.`,
      );
    }

    // A guard on a destructive call. The path is derived under `config.root` by
    // `checkoutPathFor`, and this keeps that true for any future caller that
    // reaches this function another way.
    const root = resolve(config.root);
    if (!isStrictlyInside(path, root)) {
      throw new Error(
        `[conductor] refusing to clear ${path}: it is not inside the workspace root ` +
          `${root}. A half-created checkout is only ever removed from the directory this ` +
          `lab owns.`,
      );
    }
    rmSync(path, { recursive: true, force: true });
  }

  // A worktree whose directory was removed leaves an administrative entry
  // behind, and `worktree add` then refuses the path by name. Pruning is not a
  // reset: it touches bookkeeping, never a tree.
  await git(config.sourceRepo, ["worktree", "prune"], left());

  const args = (await branchExists(config, branch, left()))
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, config.baseRef];

  // Written BEFORE the call that creates the tree and removed only once it has
  // returned, so the window the marker covers is exactly the window in which a
  // kill leaves a partial directory. A failed `add` deliberately leaves it: the
  // provision did not finish, and the next attempt is the one entitled to clear.
  // `worktree add` creates the nested path itself, so the marker's own parent
  // may not exist yet — the same reason `acquireCheckout` makes it for the lock.
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(marker, "");
  await git(config.sourceRepo, args, left());
  rmSync(marker, { force: true });
  return { path, branch, created: true };
}

/**
 * Is `candidate` a **strict descendant** of `root`?
 *
 * The rule lives here rather than at the `rmSync` it guards, because a rule at a
 * call site gets copied and a rule in a function gets imported.
 *
 * Two things a `startsWith(`${root}/`)` prefix test gets wrong, and both fail
 * toward leaving a half-created tree that every later attempt trips over and
 * spends a retry on:
 *
 * - **A separator is not always `/`.** `resolve` yields the platform's
 *   separator, so on Windows every legitimate child fails a `/`-terminated
 *   prefix. `relative` compares path *segments* and has no separator to get
 *   wrong.
 * - **A root of `/` has no `${root}/` to match.** The prefix becomes `//`, which
 *   no resolved absolute path starts with, so every child is refused.
 *
 * **The root itself is not inside itself.** The prefix test admitted it — the
 * old condition short-circuited on `candidate === root` and let the removal
 * through, so a caller arriving with the root as its checkout path would have
 * had `rmSync(root, { recursive: true })` run against the directory holding
 * every other checkout. An empty `relative` is that case, and it is refused.
 */
export function isStrictlyInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  // `..` is compared as a whole segment, not as a prefix: a directory named
  // `..conductor` is an ordinary child, and a prefix test would refuse it.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
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

/**
 * Wait, but stop waiting the moment the attempt is cancelled.
 *
 * A plain `setTimeout` promise makes the wait's responsiveness a function of
 * `pollMs`, which is a caller-set public option: at a large but perfectly valid
 * interval, a shutdown or a lost claim is not observed until the whole interval
 * elapses, and the replacement worker waits out an attempt that has already
 * been told to stop. Resolving on `abort` removes the dependency instead of
 * bounding it — the wait is as responsive as the signal regardless of how
 * `pollMs` is configured.
 *
 * It resolves rather than rejects: the caller checks the signal on the next
 * line, so cancellation keeps ONE exit and one message rather than growing a
 * second throw site here.
 */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    // **An already-aborted signal is checked, not just listened for.** `abort`
    // fires once; a signal that aborted before this listener existed never
    // replays it, so arming the listener alone sleeps the full interval on a
    // cancellation that had already happened. The window is real: the caller
    // checks cancellation, then computes a bound, then arrives here — and the
    // abort can land in between. What it costs is the whole poll interval, which
    // is caller-configured and can be large, spent after the run was told to
    // stop: a shutdown that waits, and a lost claim whose recovery is delayed
    // past the point the advertised behaviour promised.
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });

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
   * through `ctx.signal`. Left unobserved, a stale attempt keeps polling for the
   * whole ownership window and can still go on to acquire and provision a
   * checkout it can no longer record a result for. That window is the run's
   * deadline plus provisioning plus slack, so ignoring the signal costs the
   * better part of an hour of a replacement's time.
   *
   * Observed here AND in the wait itself — `sleep` resolves on `abort`, so this
   * runs when the signal arrives rather than when `pollMs` next elapses. The
   * check alone would have made the delay a function of a caller-set option.
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
    } catch (err) {
      // It was released between the failed create and the stat. Retry.
      //
      // **Only disappearance retries, and the narrowing is the whole point.**
      // `continue` here skips both the deadline check and the `await` below, so
      // it is only safe for a condition the next iteration can resolve. A
      // PERMANENT read failure — the path is a directory (`EISDIR`), the file is
      // unreadable to this uid (`EACCES`) — reproduces on every pass: the `wx`
      // create fails `EEXIST`, the read throws again, and the loop spins
      // synchronously forever. Not merely slow: nothing between here and the top
      // yields, so the deadline never fires, `stopIfCancelled` is never reached,
      // and the dispatcher's event loop is held by a provisioning wait that
      // advertises a bound it can no longer honour.
      //
      // Waiting `waitMs` first and then reporting a wedged HOLDER would be a
      // second wrong answer: nobody holds this lock, the filesystem state is
      // permanent, and the retry budget buys nothing. So it is raised as itself.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      continue;
    }

    if (now() >= deadline) {
      throw new Error(
        `[conductor] waited ${bounds.waitMs}ms for the checkout at ${checkoutPath} and it ` +
          `is still held. Treating that as a wedged process rather than a race: an ` +
          `ordinary reclaim resolves well inside this bound.`,
      );
    }
    // **Never sleep past the deadline this loop advertises.** `waitMs` is the
    // bound the caller was given and the drain budget is sized from, and a poll
    // interval larger than what is left of it overshoots by the difference —
    // measured at 203ms for `{ waitMs: 30, pollMs: 200 }`. The abort fix above
    // covers cancellation; ordinary expiry needs the clock, not the signal.
    await sleep(Math.min(bounds.pollMs, deadline - now()), signal);
    stopIfCancelled();
  }
}
