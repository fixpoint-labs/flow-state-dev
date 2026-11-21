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
 * itself. A merge or close reaches the session too, whoever made it, so a task
 * waiting on its pull request wakes, and then ends the
 * subscription (ER-7 as amended); the session's other subscriptions stay.
 * The subscription names the run's task, so a task that fails or is
 * cancelled ends it too.
 *
 * A pull request on a host other than `github.com` is not followed, nor one
 * recorded already closed or merged.
 */
import type { FollowingRun, PullRequestFollower, RecordedPullRequest } from "@flow-state-dev/core/harness";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { WorkerInstallation } from "../../workers/installation";
import { installationPolling, pollingOn } from "../../subscriptions/poll";
import { subscriptionResources } from "../../subscriptions/rows";
import { subscribe, type SubscribeInput, type SubscribeOutcome, type SubscriptionProvider } from "../../subscriptions/subscribe";
import { GITHUB_PROVIDER, githubThreadKey } from "./normalize";
import type { GitHubReviewers } from "./trusted-reviewers";

/** The kinds a followed pull request is heard for. **Pinned.** */
export const FOLLOWED_PULL_REQUEST_KINDS = ["review", "comment", "check"] as const;

/** What {@link followPullRequest} is built with. */
export interface FollowPullRequestOptions {
  /** The providers a session may subscribe on; GitHub's must be among them. */
  readonly providers: readonly SubscriptionProvider[];
  /** Called with what each subscribe came to, for a host that records it. */
  readonly onFollowed?: (pr: RecordedPullRequest, outcome: SubscribeOutcome, ctx: BlockContext) => void | Promise<void>;
  /**
   * The app's installation, when the app polls: following a pull request makes
   * the user's poll for it once `hireWorkforce` was given `routines.poll`.
   */
  readonly installation?: WorkerInstallation;
  /**
   * The screens the follow lists, for a host whose coding session acts on
   * what it hears: an event they refuse never reaches the session (a custom
   * screen such as `githubTrustedReviewersScreen`, declared on the
   * provider). Absent: every sender the sender screen passes.
   */
  readonly screens?: SubscribeInput["screens"];
  /**
   * Also hear senders outside the project (not members, collaborators or
   * trusted bots). Only with a screen that names who is heard, such as an
   * `allow` list: on its own it lets anyone through.
   */
  readonly outsiders?: true;
}

/** The thread a recorded pull request is followed on, or `undefined` when it isn't GitHub's. */
export function pullRequestThread(pr: Pick<RecordedPullRequest, "host" | "owner" | "name" | "number">): string | undefined {
  return pr.host.toLowerCase() === "github.com" ? githubThreadKey(`${pr.owner}/${pr.name}`, pr.number) : undefined;
}

/** Build the follower: each newly recorded GitHub pull request subscribes the session to it. */
export function followPullRequest(options: FollowPullRequestOptions): PullRequestFollower {
  // A removed key fails loudly: dropped quietly, it would let every sender through (BP-030).
  if (Object.hasOwn(options, "allow")) {
    throw new Error("followPullRequest no longer takes `allow`; list a screen in `screens`, such as the custom screen githubTrustedReviewersScreen builds.");
  }
  const screens = options.screens;
  const follower = async (ctx: BlockContext, pr: RecordedPullRequest, run?: FollowingRun): Promise<void> => {
    const thread = pullRequestThread(pr);
    // Recorded already closed or merged (the branch check found it late): its closing event has
    // passed, so nothing would end a subscription made now.
    if (thread === undefined || pr.state === "closed" || pr.state === "merged") return;
    const polling = options.installation === undefined ? undefined : pollingOn(options.installation);
    const outcome = await subscribe(
      ctx,
      options.providers,
      {
        provider: GITHUB_PROVIDER,
        thread,
        kinds: [...FOLLOWED_PULL_REQUEST_KINDS],
        ...(screens === undefined ? {} : { screens }),
        ...(options.outsiders === true ? { outsiders: true as const } : {}),
        interest: `Reviews, comments and CI on pull request #${pr.number}, which this session opened.`
      },
      undefined,
      // Its close reaches the session, so a task waiting on the pull request wakes (FIX-2535 D3).
      // The run's task, when it works one: its failure or cancel ends the follow.
      { hearsClose: true, ...(run?.taskId === undefined ? {} : { taskId: run.taskId }), ...(polling === undefined ? {} : { polling }) }
    );
    await options.onFollowed?.(pr, outcome, ctx);
    if ("refused" in outcome) throw new Error(outcome.refused);
  };
  return Object.assign(follower, {
    resources: options.installation === undefined ? subscriptionResources : { ...subscriptionResources, ...installationPolling(options.installation).resources }
  });
}

/**
 * A pull-request follower for the harness kit (`harnesses({ onPullRequestRecorded })`)
 * that hears only `reviewers`. On a public repository anyone can comment, and a
 * run acts on what it hears with a push, so with nobody listed this is
 * `undefined` and nothing is followed, never every sender. A listed reviewer is
 * heard whether or not they are in the project. A listed bot is heard only once
 * the GitHub service flow trusts it too: pass `reviewers.bots` as its `trustedBots`.
 */
export function reviewedPullRequestFollow(
  github: SubscriptionProvider,
  reviewers: GitHubReviewers | undefined
): ((installation: WorkerInstallation) => PullRequestFollower) | undefined {
  if (reviewers === undefined || reviewers.ids.length === 0) return undefined;
  const ids = [...reviewers.ids];
  return (installation) => followPullRequest({ providers: [github], installation, screens: [{ screen: "allow", ids }], outsiders: true });
}
