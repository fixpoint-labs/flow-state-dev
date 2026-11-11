// FIX-2535.
/**
 * The service-flow names workforce's `/internal` subpath carries: what other
 * FSD packages, goals and scripts share with workforce (a GitHub poll builds
 * on these), not an adopter's surface.
 */
export { GITHUB_PROVIDER, githubLoginId, githubMentions, githubThreadKey } from "./github/normalize";
export { githubRepositoryOf } from "./github/provider";
export { GITHUB_SERVICE_FLOW } from "./github/service-flow";
export { FOLLOWED_PULL_REQUEST_KINDS, pullRequestThread } from "./github/follow-pull-request";
export { DEFAULT_MAX_OWNER_RUNS } from "./service-flow";
// FIX-2630.
export { INTERNAL_PROVIDER, INTERNAL_SERVICE_FLOW, internalThreadKey } from "./internal-events/topics";
