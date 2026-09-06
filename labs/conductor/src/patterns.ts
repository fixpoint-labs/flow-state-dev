/**
 * The remote-URL grammar `repoSlugFromRemote` matches against, in one place.
 *
 * **Reuse is the reason they live together rather than inline at the call
 * site.** A pattern spelled twice drifts once: `repoSlugFromRemote` has been
 * wrong about five different remote spellings — the host, the port, the casing,
 * a trailing slash and a bracketed IPv6 literal — and each fix had to be applied
 * to the URL form and the scp-like form separately because the two grammars sat
 * a line apart with nothing naming what they shared.
 *
 * Each constant carries the grammar's rationale. The parser that uses one keeps
 * its own doc for what it does with the result — the pattern's justification
 * travels with the pattern, the function's with the function.
 *
 * The identity grammar this file used to also hold is the manager's, and moved
 * with it to `@flow-state-dev/harness-manager`. Nothing here is shared with it:
 * naming a GitHub remote is this repository's business, deriving a checkout
 * identity is every host's.
 */


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
 * The transports that can name a repository `gh` is able to query.
 *
 * **An allow-list, because the failure is a plausible-looking selector rather
 * than a parse error.** The scheme used to be any RFC-shaped one, so
 * `file://localhost/owner/repo.git` parsed as the selector
 * `localhost/owner/repo` — the startup preflight accepted it, and the permanent
 * `gh` failure then arrived once per attempt, after each paid coding run. That
 * is the exact cost the preflight beside it exists to prevent.
 *
 * `file:` is not alone, which is why this is a list rather than one refusal:
 * `ftp:`, `ftps:` and `rsync:` are git transports too, and all three produced
 * the same confidently wrong selector. What separates the ones kept is that
 * each can address a remote GitHub host; none of the excluded ones can.
 */
const GH_QUERYABLE_SCHEMES = String.raw`(?:https?|ssh|git|git\+ssh)`;

/**
 * `scheme://[user@]host[:port]/owner/name`.
 *
 * **The port belongs to the host.** Matching it and discarding it sent an
 * Enterprise checkout on `:8443` to the same hostname on 443 — a different
 * server, silently.
 */
export const REMOTE_VIA_URL = new RegExp(
  String.raw`^(${GH_QUERYABLE_SCHEMES})://(?:[^@/]+@)?(${IPV6_HOST}(?::\d+)?|[^/:]+(?::\d+)?)/(.+)$`,
  "i",
);

/**
 * The schemes whose port is the port `gh` should talk to.
 *
 * **A port is only the API's when the transport is the API's.** An
 * `http://ghe.internal:8443/…` remote names an HTTP endpoint, so `:8443` is
 * where the API lives and carrying it through is required — dropping it sent an
 * Enterprise checkout to the same hostname on 443, a different server. But
 * `ssh://git@ghe.acme:2222/…` names an SSH daemon, and its API is on HTTPS
 * elsewhere; `gh -R host:2222/owner/repo` would query the SSH port and fail
 * once per attempt, after each paid run.
 *
 * The earlier fix was right about `:8443` and wrong to generalise from it. Both
 * halves of the rule are needed, and neither is the default.
 */
export const API_PORT_SCHEMES = /^https?$/i;

/**
 * A trailing `:port` on a host.
 *
 * Anchored at the end, which is what makes it safe for a bracketed IPv6
 * literal: `[2001:db8::1]:2222` loses the port, `[2001:db8::1]` ends in `]` and
 * is untouched, and the literal's own colons are never at the end.
 */
export const HOST_PORT = /:\d+$/;

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
