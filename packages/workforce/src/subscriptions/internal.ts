// FIX-2535.
/**
 * The subscription names workforce's `/internal` subpath carries: what other
 * FSD packages, goals and scripts share with workforce (a GitHub poll builds
 * on these), not an adopter's surface.
 */
export { GITHUB_PROVIDER, githubLoginId, githubMentions, githubThreadKey } from "./github/normalize";
export { githubRepositoryOf } from "./github/provider";
export { GITHUB_SERVICE_FLOW } from "./github/service-flow";
export { FOLLOWED_PULL_REQUEST_KINDS, pullRequestThread } from "./github/follow-pull-request";
export { DEFAULT_MAX_OWNER_RUNS } from "./service-flow";
// FIX-2536: polling's mechanics and the config seed, for goals and FIX-2614's declared routines.
export { SUBSCRIPTION_POLL_HANDLER, SUBSCRIPTION_POLLS_PATTERN, SUBSCRIPTION_POLLS_RESOURCE } from "./keys";
export {
  DEFAULT_POLL_MINUTES,
  POLL_CADENCES,
  POLL_GIVE_UP_AFTER,
  assertPollCadence,
  pollCron,
  pollKeyOf,
  subscriptionPolling
} from "./poll";
export {
  SUBSCRIPTION_SEED_ENTRY,
  configSubscriptionId,
  declaredSubscriptionSchema,
  isConfigSubscriptionId,
  seedSubscription,
  type SeedOutcome
} from "./seed";
export { pollGitHubThread, type GitHubCall } from "./github/poll";
