/**
 * The run's own checkout: where it is, how it is made, and who holds it.
 *
 * Three things live here, and they are separable on purpose — FIX-150's
 * workspaces replace this module, not the manager's shape.
 *
 * 1. **Derivation.** Where an issue-phase's checkout is, as a pure function of
 *    the durable task. Never read back from anywhere.
 * 2. **Provisioning.** Idempotent per issue-phase, on its own branch. Never
 *    resets, never forces, never discards uncommitted work. The git itself is
 *    the workspace host's (`@flow-state-dev/workspace`); this package starts
 *    no git process of its own.
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
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import {
  acquireLock,
  localWorkspaceHost,
  releaseLock,
  type IgnoredDirectory,
  type WorkspaceHost,
} from "@flow-state-dev/workspace";
import { ASK_MARKER_DIR, ASK_MARKER_IGNORE_RULE, isAskMarkerPath } from "./ask";
import { DERIVED_IDENTITY, LOCK_SUFFIX, OWNED_SEGMENT } from "./identity";

export { isStrictlyInside, sleep } from "@flow-state-dev/workspace";

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

/*
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
 *   against `OWNED_SEGMENT` (in `./identity`, with the grammar's own rationale).
 *   The grammar is ours to set, a malformed issue key is a real signal, and the
 *   value stays readable in a path.
 * - Identifiers **someone else** issues (user ids, tenant ids) are *encoded*
 *   by {@link encodeSegment}. See its note for why a grammar is the wrong
 *   instrument there.
 *
 * Both outputs are free of {@link IDENTITY_DELIMITER}, which is what makes the
 * join injective — the frame is a sequence no component can forge.
 */

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
      `[harness-manager] ${label} "${value}" is not a usable identity segment — ` +
        `at most ${MAX_OWNED_SEGMENT} letters and digits, separated by single \`-\` or ` +
        `\`_\`. No dots (a git ref may not end in "." or ".lock"), no ` +
        `"${IDENTITY_DELIMITER}" (it is the component frame), nothing that could climb out ` +
        `of a directory, and nothing long enough to overflow a filesystem component.`,
    );
  }
  return canonicalSegment(value);
}

/** The bare key prefix covering everything kept about one issue-phase. */
export function issuePhasePrefix(issue: string, phase: string): string {
  return `${assertSafeSegment("issue", issue)}/${assertSafeSegment("phase", phase)}/`;
}

/**
 * Hex characters of a {@link hashKeySegment}: 64 bits. Where a counter is
 * unavailable (the ask step commits no state), the hash is the row's identity,
 * and the width is what keeps two different texts off one row.
 */
const KEY_HASH_LENGTH = 16;

/** A key segment naming `text` by its hash, so any text fits the key grammar. */
export function hashKeySegment(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, KEY_HASH_LENGTH);
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
 * identities that arrive from elsewhere already built. The grammar itself is
 * `DERIVED_IDENTITY` in `./identity`, beside `OWNED_SEGMENT` so the single `+`
 * that separates them is visible rather than looking like a typo.
 */

export function assertDerivedIdentity(label: string, value: string): string {
  // Folded for the same reason `assertSafeSegment` is: this value becomes a
  // path component too, and an identity built elsewhere must not be the one
  // that reintroduces case into the derivation.
  if (!DERIVED_IDENTITY.test(value) || LOCK_SUFFIX.test(value)) {
    throw new Error(
      `[harness-manager] ${label} "${value}" is not a usable identity segment — ` +
        `letters and digits, separated by \`-\`, \`_\` or a single \`.\`. No leading, ` +
        `trailing or repeated dot and no ".lock" ending (a git ref refuses each), and ` +
        `nothing that could climb out of a directory.`,
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
  return harnessTaskId(location.issue, location.phase);
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
export function harnessTaskId(issue: string, phase: string): string {
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
/**
 * The place segments of a run, under whatever root its host keeps: the same
 * segments {@link checkoutPathFor} resolves, so a fixed-repository run's place
 * is exactly the checkout this module has always derived.
 */
export function placeFor(location: RunLocation): string[] {
  return [...locationSegments(location), issuePhaseSegment(location)];
}

/** The lock file guarding one checkout. Beside it, not inside — see `acquireCheckout`. */
function lockPathFor(checkoutPath: string): string {
  return `${checkoutPath}.lock`;
}

/**
 * The directory a run writes its question into, which no repository may
 * commit (see `./ask`). Handed to the workspace host on every provision, so a
 * checkout whose repository would commit a question is refused before the
 * agent runs, on a reused branch as well as a new one.
 */
export const ASK_MARKER_IGNORED: IgnoredDirectory = {
  dir: ASK_MARKER_DIR.split(sep).join("/"),
  rule: ASK_MARKER_IGNORE_RULE,
  guards: isAskMarkerPath,
  why:
    "A run writes the question it needs answered to a file named for its attempt inside " +
    "that directory, and the coding agent's `git add -A` would commit it to the branch and " +
    "the pull request.",
};

/**
 * The workspace host a fixed repository runs through: `sourceRepo` is a
 * repository on this machine the operator named, so the host cuts worktrees
 * from it directly, keeps every run's branch in it, and reaches no remote.
 * The run source is constant.
 */
export function hostForConfig(config: WorkspaceConfig, now: () => number = Date.now): WorkspaceHost {
  return localWorkspaceHost({
    root: config.root,
    remotes: { allow: [] },
    localRepositories: [config.sourceRepo],
    source: () => ({ kind: "repo", repo: config.sourceRepo, baseRef: config.baseRef }),
    ...(config.provisionTimeoutMs !== undefined ? { provisionTimeoutMs: config.provisionTimeoutMs } : {}),
    now,
  });
}

/**
 * Give this issue-phase a checkout of `config.sourceRepo`, or hand back the
 * one the last attempt left.
 *
 * Provisioned through the workspace host (`@flow-state-dev/workspace`), which
 * runs every git command: idempotent, never resets, forces or discards work,
 * one budget for the whole operation (`provisionTimeoutMs`, on `now`'s clock),
 * and a checkout whose branch was deleted, switched, or cut from another
 * repository is refused rather than recreated. The checkout is exactly
 * {@link checkoutPathFor}'s path and the branch lives in `sourceRepo`.
 */
export async function provisionCheckout(
  config: WorkspaceConfig,
  location: RunLocation,
  now: () => number = Date.now,
): Promise<Checkout> {
  const branch = branchFor(location);
  const place = await hostForConfig(config, now).provision(
    { kind: "repo", repo: config.sourceRepo, baseRef: config.baseRef },
    { place: placeFor(location), branch, ignored: ASK_MARKER_IGNORED },
  );
  return { path: place.cwd, branch, created: place.repo?.created ?? false };
}

/** A held checkout. Release it on every exit from the attempt that took it. */
export interface CheckoutLease {
  /** The lock file this acquisition created. */
  lockPath: string;
  /**
   * A token written INTO that lock file, unique to this acquisition. A value,
   * so the lease can live in the run's own state and be released from there,
   * and what stops a displaced holder from releasing its replacement's lock.
   */
  token: string;
}

/**
 * Release a checkout lease — the one place a lock this process took is
 * removed, called from every exit. Never unlinks a lock that is not this
 * acquisition's. Synchronous and idempotent.
 */
export function releaseCheckout(lease: CheckoutLease | undefined): void {
  if (lease === undefined) return;
  try {
    releaseLock({ path: lease.lockPath, token: lease.token });
  } catch {
    // A cleanup failure must never fail a run.
  }
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
   * Sized past the run's own wall-clock deadline plus provisioning, so a lock
   * is only ever declared stale once no live attempt could still be holding
   * it. That is what lets this work without a heartbeat.
   */
  staleAfterMs: number;
}

/**
 * Take exclusive ownership of a checkout for the whole attempt — **waiting**
 * for it, not failing on it (obligation B).
 *
 * - **Two live attempts never share a tree.** A lapsed lease does not stop the
 *   attempt that held it, and two coding agents in one checkout corrupt the
 *   artifact the run exists to produce.
 * - **Resolving contention never consumes a retry.** Every throw out of this
 *   worker spends one, so ordinary contention waits and only exceeding
 *   `waitMs` throws — a wedged process, correctly charged.
 *
 * Held across provisioning AND the run, which is why it is not the workspace
 * host's own lock (that one is held only while provisioning). Built on the
 * same lock file mechanism (`acquireLock` in `@flow-state-dev/workspace`):
 * atomic create, a stale steal that re-checks the file it judged, a token
 * release. No heartbeat: `staleAfterMs` outlasts the longest legitimate hold.
 * The lock sits BESIDE the checkout, so `git worktree add` never meets a
 * non-empty directory. A cancelled `signal` stops the wait at once.
 */
export async function acquireCheckout(
  checkoutPath: string,
  owner: string,
  bounds: OwnershipBounds,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<CheckoutLease> {
  const lease = await acquireLock(
    lockPathFor(checkoutPath),
    { waitMs: bounds.waitMs, pollMs: bounds.pollMs, staleAfterMs: bounds.staleAfterMs },
    { owner, now, ...(signal !== undefined ? { signal } : {}), what: `the checkout at ${checkoutPath}` },
  );
  return { lockPath: lease.path, token: lease.token };
}
