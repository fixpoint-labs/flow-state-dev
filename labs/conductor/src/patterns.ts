/**
 * Every regular expression this lab matches against, in one place.
 *
 * Two reasons they live together rather than inline at their call sites.
 *
 * **Reuse.** A pattern spelled twice drifts once. `repoSlugFromRemote` has been
 * wrong about five different remote spellings — the host, the port, the casing,
 * a trailing slash and a bracketed IPv6 literal — and each fix had to be applied
 * to the URL form and the scp-like form separately because the two grammars sat
 * a line apart with nothing naming what they shared.
 *
 * **Comparison.** {@link OWNED_SEGMENT} and {@link DERIVED_IDENTITY} differ by a
 * single `+`, and that difference is load-bearing. Sitting in different
 * functions in different halves of a file, it read as a typo. Adjacent, with the
 * difference stated, it reads as the decision it is.
 *
 * Each constant carries the grammar's rationale. The validator or parser that
 * uses one keeps its own doc for why it validates or what it does with the
 * result — the pattern's justification travels with the pattern, the
 * function's with the function.
 */

/**
 * A segment of an identifier THIS lab issues — an epic, an issue key, a phase.
 *
 * Letters and digits, separated by single `-` or `_`. The bounds are measured,
 * not stylistic:
 *
 * - **No dots.** These segments become git refs as well as path components, and
 *   `git check-ref-format` rejects a name ending in `.` or `.lock`. A grammar
 *   that accepts one is worse than a strict one: the row is claimed, the
 *   checkout then fails to create, the attempt is charged, and the retry budget
 *   is spent on a configuration error no retry can fix.
 * - **No repeated separator.** `--` is the identity delimiter, so allowing it
 *   inside a segment lets two different (issue, phase) pairs collide on one task
 *   id, one checkout and one branch.
 *
 * Identifiers someone ELSE issues (user ids, tenant ids) are encoded rather than
 * validated — see `encodeSegment`, which explains why a grammar is the wrong
 * instrument there.
 */
export const OWNED_SEGMENT = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/;

/**
 * A finished identity used as ONE path segment or ref component, whole.
 *
 * **The `+` is the whole difference from {@link OWNED_SEGMENT}, and it is
 * deliberate.** A *component* is joined with others, so it must not contain the
 * identity delimiter — a repeated separator would forge a frame. A *derived
 * identity* is already built (a board collection id, say) and lands between `/`
 * separators rather than inside a join, so it may legitimately carry `--`. What
 * it still may never do is anything a path or a git ref forbids, which is why
 * the rest of the grammar is identical.
 *
 * Conflating the two is what made the first version of this reject its own
 * output.
 */
export const DERIVED_IDENTITY = /^[A-Za-z0-9]+(?:[_-]+[A-Za-z0-9]+)*$/;

/**
 * Trailing slashes on a remote URL, stripped BEFORE {@link GIT_SUFFIX}.
 *
 * Order matters and cost a review round: `…/repo.git/` stripped in the other
 * order keeps its suffix, so the selector names a repository called `repo.git`,
 * `gh` finds no pull requests for `repo`, and a finished run is reported
 * unfinished and retried until the budget is gone.
 */
export const TRAILING_SLASHES = /\/+$/;

/** The `.git` a clone URL may end with. Stripped after {@link TRAILING_SLASHES}. */
export const GIT_SUFFIX = /\.git$/;

/**
 * A bracketed IPv6 literal — the ONE piece both remote grammars share.
 *
 * It is factored out because it was missing from both and had to be added to
 * both: without it each host class stops at the literal's first colon and the
 * whole URL fails to parse, which since the startup preflight consumes this
 * parser is a conductor that refuses to build on a remote `gh` queries fine.
 *
 * The class excludes `/` so a local path can never satisfy the scp-like form.
 */
const IPV6_HOST = String.raw`\[[^\]/]+\]`;

/**
 * `scheme://[user@]host[:port]/owner/name`.
 *
 * **The port belongs to the host.** Matching it and discarding it sent an
 * Enterprise checkout on `:8443` to the same hostname on 443 — a different
 * server, silently.
 */
export const REMOTE_VIA_URL = new RegExp(
  String.raw`^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]+@)?(${IPV6_HOST}(?::\d+)?|[^/:]+(?::\d+)?)/(.+)$`,
);

/**
 * `[user@]host:owner/name` — scp-like, and NOT a path.
 *
 * **The name class is deliberately narrower than the URL form's.** `[^/:]+`
 * there is safe because a scheme and `//` have already anchored the match; here
 * the pattern starts at the string, so a permissive class would swallow paths.
 * `(?!/)` after the colon excludes `/tmp/x:y` on top of that — a path has a
 * slash before its colon.
 *
 * No port arm: scp-like syntax has no place to put one.
 */
export const REMOTE_VIA_SCP = new RegExp(
  String.raw`^(?:[^@/]+@)?(${IPV6_HOST}|[A-Za-z0-9._-]+):(?!/)(.+)$`,
);
