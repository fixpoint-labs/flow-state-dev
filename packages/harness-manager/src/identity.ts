/**
 * The grammar for identifiers the manager itself issues.
 *
 * Two constants, and they live together because **the difference between them
 * is a single `+` and that difference is load-bearing.** Sitting in different
 * files it reads as a typo; adjacent, with the difference stated, it reads as
 * the decision it is. Each carries its own rationale, so the validator that
 * uses one keeps its doc for why it validates rather than for what the pattern
 * means.
 *
 * Every value matched here is one this package derived — an epic, an issue key,
 * a phase, a board collection id. Identifiers someone ELSE issues (user ids,
 * tenant ids) are encoded rather than validated; `encodeSegment` in
 * `./workspace` explains why a grammar is the wrong instrument there.
 */

/**
 * A segment of an identifier the MANAGER issues — an epic, an issue key, a phase.
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
 * **Two differences from {@link OWNED_SEGMENT}, and both are deliberate.**
 *
 * - **The `+`.** A *component* is joined with others, so it must not contain
 *   the identity delimiter — a repeated separator would forge a frame. A
 *   *derived identity* is already built (a board collection id, say) and lands
 *   between `/` separators rather than inside a join, so it may legitimately
 *   carry `--`.
 * - **A single interior `.`.** A board a channel holds is named
 *   `<channel>.<board>` (`eng.feature.work`), and the id is used as is — never
 *   translated, because `eng-feature-work` may already be another board's id.
 *   One dot between two runs of letters and digits is something both a path and
 *   a git ref accept; `..`, a leading or trailing dot and a separator are not,
 *   and the grammar cannot spell any of them.
 *
 * What the grammar cannot express is git's one remaining rule for a ref
 * component: it may not end in `.lock`. That is {@link LOCK_SUFFIX}, checked
 * beside this pattern wherever it is.
 *
 * Every id the old grammar (no dot) accepted is still accepted and derives the
 * same string, since nothing is rewritten. Conflating a component with an
 * identity is what made the first version of this reject its own output.
 */
export const DERIVED_IDENTITY = /^[A-Za-z0-9]+(?:(?:[_-]+|\.)[A-Za-z0-9]+)*$/;

/**
 * The ending a git ref component may not have, in any case.
 *
 * Case-insensitive because the derived identity is folded to lower case before
 * it becomes a path or a branch, so `x.LOCK` reaches git as `x.lock`.
 */
export const LOCK_SUFFIX = /\.lock$/i;
