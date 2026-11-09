// FIX-2535 D2.
/**
 * A coding session follows the GitHub pull request it opened from the moment
 * its record of opening it is written: the follower a host hands
 * harness-manager (`harnessManager({ onPullRequestRecorded })`). Each new row
 * in the session's pull-request record, written mid-turn as the harness's
 * create call settles, or by the turn-end branch check, subscribes the session
 * to that pull request through the one `subscribe` (ER-5), as the session's
 * own user, hearing its reviews, comments and CI. So a check that completes
 * before the opening turn ends is heard, and the agent never has to subscribe
 * itself. A merge or close ends the subscription (ER-7 as amended); the
 * session's other subscriptions stay.
 *
 * A pull request on a host other than `github.com` is not followed.
 */
import type { PullRequestFollower, RecordedPullRequest } from "@flow-state-dev/core/harness";
import type { BlockContext } from "@flow-state-dev/core/types";
import { subscriptionResources } from "../rows";
import { subscribe, type SubscribeOutcome, type SubscriptionProvider } from "../subscribe";
import { GITHUB_PROVIDER, githubThreadKey } from "./normalize";

/** The kinds a followed pull request is heard for. **Pinned.** */
export const FOLLOWED_PULL_REQUEST_KINDS = ["review", "comment", "check"] as const;

/** What {@link followPullRequest} is built with. */
export interface FollowPullRequestOptions {
  /** The providers a session may subscribe on; GitHub's must be among them. */
  readonly providers: readonly SubscriptionProvider[];
  /** Called with what each subscribe came to, for a host that records it. */
  readonly onFollowed?: (pr: RecordedPullRequest, outcome: SubscribeOutcome, ctx: BlockContext) => void | Promise<void>;
}

/** The thread a recorded pull request is followed on, or `undefined` when it isn't GitHub's. */
export function pullRequestThread(pr: Pick<RecordedPullRequest, "host" | "owner" | "name" | "number">): string | undefined {
  return pr.host.toLowerCase() === "github.com" ? githubThreadKey(`${pr.owner}/${pr.name}`, pr.number) : undefined;
}

/** Build the follower: each newly recorded GitHub pull request subscribes the session to it. */
export function followPullRequest(options: FollowPullRequestOptions): PullRequestFollower {
  const follower = async (ctx: BlockContext, pr: RecordedPullRequest): Promise<void> => {
    const thread = pullRequestThread(pr);
    if (thread === undefined) return;
    const outcome = await subscribe(ctx, options.providers, {
      provider: GITHUB_PROVIDER,
      thread,
      kinds: [...FOLLOWED_PULL_REQUEST_KINDS],
      interest: `Reviews, comments and CI on pull request #${pr.number}, which this session opened.`
    });
    await options.onFollowed?.(pr, outcome, ctx);
    if ("refused" in outcome) throw new Error(outcome.refused);
  };
  return Object.assign(follower, { resources: subscriptionResources });
}
