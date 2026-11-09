// FIX-2535.
/**
 * Workforce's internal subpath: names other FSD packages, goals and scripts
 * share with workforce, not an adopter's surface. A GitHub poll builds on
 * these (the provider key, the pinned thread key, and the helpers beside
 * GitHub's normalize).
 */
export {
  GITHUB_PROVIDER,
  githubLoginId,
  githubMentions,
  githubThreadKey
} from "./subscriptions/github/normalize";
export { githubRepositoryOf } from "./subscriptions/github/provider";
export { GITHUB_SERVICE_FLOW } from "./subscriptions/github/service-flow";
export { FOLLOWED_PULL_REQUEST_KINDS, pullRequestThread } from "./subscriptions/github/follow-pull-request";
export { DEFAULT_MAX_OWNER_RUNS } from "./subscriptions/service-flow";
