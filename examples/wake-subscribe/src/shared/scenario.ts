/**
 * One GitHub desk, two ways an event finds a session.
 *
 * Not a product noun. Host registers the GitHub provider once. Then:
 *   1. a session subscribes to a specific issue / pull request
 *   2. one webhook fans in; worker route rules pick the session / seat
 *
 * A channel poke is Workforce Layer 2 leftover — not an L1 binding.
 */

export const GITHUB_PROVIDER = "github";
/** Value of `X-GitHub-Event`. */
export const GITHUB_ISSUES_EVENT = "issues";
export const GITHUB_PULL_REQUEST_EVENT = "pull_request";
export const GITHUB_ISSUE_COMMENT_EVENT = "issue_comment";

/** 1. Per-session subscribe. The reviewer kind has no `webhooks.on`. */
export const SESSION_REVIEWER_KIND = "pr-reviewer";
export const SESSION_TRIAGE_KIND = "pr-triage";

/** 2. Fan-in desk owns the compiled webhook. Seats do not. */
export const FANIN_DESK_KIND = "github-desk";
export const FANIN_INTAKE_KIND = "github-intake";
export const FANIN_REVIEWER_KIND = "github-reviewer";
export const FANIN_TRIAGE_KIND = "github-triage";
