// FIX-2935.
/**
 * The two path encoders: how an identity becomes a directory name.
 *
 * Two, on purpose, and both here so nothing else in the framework writes one.
 *
 * - **The scope folder** ({@link scopeFolder}): where a bash tool keeps a
 *   scope's files, `.fsdev/workspaces/<scope>/<segments>`. Each segment is
 *   `enc-<readable>-<12 hex>`, the format bash folders have always had, so an
 *   existing folder resolves to the same path.
 * - **The checkout encoder** ({@link encodeSegment}, {@link tenantSegment}):
 *   the principal's components of a harness checkout path, a full SHA-256 over
 *   UTF-16LE.
 *
 * They are not merged because the scope-folder digest goes through UTF-8,
 * which maps every lone surrogate and U+FFFD to one value. Bash folders keep
 * that format so files do not move; a checkout cannot, because two principals
 * would share a tree, a branch and a lock.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { scopeComponents, type ScopeName, type ScopePrincipal } from "./scope-identity";

// ---------------------------------------------------------------------------
// The scope folder
// ---------------------------------------------------------------------------

// BP-031.
/**
 * A scope id as a directory name it is safe to join onto a root.
 *
 * Scope ids reach here from caller-controllable input: the action route takes
 * `requestId` and `sessionId` straight off the request body, validating only
 * that they are strings. `scopeId` then becomes a path segment under
 * `.fsdev/workspaces/`, so `../../` in one puts a run's workspace outside the
 * workspaces root entirely — and `userId`/`orgId`, which DO come from a
 * verified principal, fall back to the session id when absent.
 *
 * **Every id is encoded. There is no pass-through branch**, and its absence is
 * the point rather than an oversight. Keeping ordinary ids readable meant a
 * second namespace that had to stay disjoint from the encoded one, and that
 * disjointness failed three times in a row: an encoding was itself a valid
 * unencoded id; an over-long id was a filename nothing could write; and on a
 * case-insensitive filesystem — macOS APFS, Windows — `ENC-a-b-<digest>` and
 * `enc-a-b-<digest>` name one directory while spelling two registry keys, so
 * two runs shared files while each believed it was isolated.
 *
 * Encoding everything removes the second namespace instead of guarding it
 * again. The digest is over the exact original and hex folds to itself, so two
 * ids that differ at all still differ here, case-insensitive filesystems
 * included. The readable prefix is a convenience for whoever reads `ls`; the
 * digest is what makes the name mean one workspace.
 *
 * The cost is that this renames existing local workspaces once. Named in the
 * changeset; they hold a run's scratch, not durable state.
 */
const ENCODED_PREFIX = "enc-";

/**
 * An id with everything but `[A-Za-z0-9_-]` replaced by `-`: readable, never
 * unique. A run name or folder takes it as a label beside a digest, never alone.
 */
export function readableSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "-");
}

function folderSegment(id: string): string {
  const safe = readableSegment(id).slice(0, 40) || "id";
  const digest = createHash("sha256").update(id, "utf-8").digest("hex").slice(0, 12);
  return `${ENCODED_PREFIX}${safe}-${digest}`;
}

/**
 * One path segment for a component, absence included.
 *
 * `ABSENT_SEGMENT` is chosen so `folderSegment` cannot produce it: an id
 * spelled `enc-none` comes out as `enc-enc-none-<digest>`. Nothing a caller
 * can send lands on the marker.
 */
const ABSENT_SEGMENT = `${ENCODED_PREFIX}none`;

function componentSegment(component: string | undefined): string {
  return component === undefined ? ABSENT_SEGMENT : folderSegment(component);
}

/**
 * The directory a scope's name takes under `.fsdev/workspaces`. A request's
 * folder is `run`, the name bash has always given it; renaming it would move
 * every existing run folder.
 */
const SCOPE_DIRECTORY: Record<ScopeName, string> = { request: "run", session: "session", user: "user", org: "org" };

// BP-031.
/**
 * The folder one instance of `scope` keeps its files in, under `root`.
 *
 * `root/.fsdev/workspaces/<scope>/<segments>`, one segment per component of
 * {@link scopeComponents}, so the folder splits exactly where the scope does:
 * by tenant for a request or session, never for a user or org. Every segment
 * is encoded, so no id, however hostile, names a folder outside `root`.
 *
 * @example
 *   scopeFolder(process.cwd(), "session", principalFromContext(ctx))
 */
export function scopeFolder(root: string, scope: ScopeName, principal: ScopePrincipal): string {
  return path.join(
    root,
    ".fsdev",
    "workspaces",
    SCOPE_DIRECTORY[scope],
    ...scopeComponents(scope, principal).map(componentSegment),
  );
}

// ---------------------------------------------------------------------------
// The checkout encoder
// ---------------------------------------------------------------------------

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
