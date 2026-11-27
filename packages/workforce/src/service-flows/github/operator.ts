/**
 * GitHub for routines on one operator's own token: a host run by one user
 * (a lab, a local app) follows GitHub with the token of whoever started it,
 * and for that user alone. `operatorGitHubToken` reads the token once at
 * start; `operatorGitHub` builds the routines' provider on it, which refuses a
 * GitHub routine asked for with no token, or by any other user, naming
 * `GITHUB_TOKEN`, so the token is never lent. With `reviewers`, it declares
 * the trusted reviewers' list screen, asked of GitHub with the
 * operator's token for the operator's own subscriptions only. Its
 * `reviewReplies` is the one poster a coding run's review replies go through
 * (`./review-replies`), on the same token, for the same user.
 *
 * Node-only (`operatorGitHubToken` asks `gh`): the server entry exports it,
 * the browser entry doesn't.
 */
import { execFileSync } from "node:child_process";
import type { BlockContext, EvaluationModel } from "@flow-state-dev/core/types";
import { githubSubscriptionProvider, type GitHubSubscriptionProvider } from "./provider";
import { reviewReplies, type ReviewReplies } from "./review-replies";
import { GITHUB_REVIEWERS_SCREEN, githubTrustedReviewersScreen, type GitHubTrustedReviewers } from "./trusted-reviewers";

/** How long `gh auth token` may take before the host starts with no token. */
const GH_TIMEOUT_MS = 10_000;

/**
 * The operator's GitHub token: `GITHUB_TOKEN`, else what `gh auth token`
 * answers, read once at start and never from a request. `undefined` when
 * neither has one.
 */
export function operatorGitHubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const named = env.GITHUB_TOKEN?.trim();
  if (named !== undefined && named !== "") return named;
  try {
    const signedIn = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: GH_TIMEOUT_MS }).trim();
    return signedIn === "" ? undefined : signedIn;
  } catch {
    return undefined;
  }
}

/** What {@link operatorGitHub} is built with. */
export interface OperatorGitHubOptions {
  /** The one user the token serves: the host's operator. */
  operator: string;
  /** The operator's token ({@link operatorGitHubToken}). Absent: every GitHub routine is refused. */
  token: string | undefined;
  /** GitHub's REST API root. Default GitHub's own; a check names its stub. */
  apiUrl?: string;
  /**
   * The trusted reviewers (`githubTrustedReviewers`): the provider declares their list
   * screen, first among its custom screens, for their follow to list.
   */
  reviewers?: GitHubTrustedReviewers;
  /** The model a routine's `interest` screen is judged on. Absent: a routine listing `interest` is refused. */
  interestModel?: string | EvaluationModel;
}

/** What {@link operatorGitHub} builds: the routines' provider, and the review replies' poster. */
export type OperatorGitHub = GitHubSubscriptionProvider & {
  /** The poster a coding run's review replies go through: hand it to `harnessManager({ replies })`. */
  readonly reviewReplies: ReviewReplies;
};

/**
 * GitHub's subscription provider, reading GitHub with the operator's token
 * for the operator alone. A GitHub routine asked for with no token, or by any
 * user but the operator, is refused at subscribe, naming `GITHUB_TOKEN`, and
 * saves nothing; a poll for anyone else reads nothing.
 */
export function operatorGitHub(options: OperatorGitHubOptions): OperatorGitHub {
  const { operator, token, apiUrl, reviewers, interestModel } = options;
  const reads = (ctx: BlockContext) => ctx.session.identity.userId === operator;
  const custom =
    reviewers === undefined
      ? undefined
      : {
          // Who may steer a run through its pull request, read from the list for each event. A user is asked
          // of GitHub with the operator's token, lent only to the operator's own subscriptions: decided on the
          // subscription's owner, since routing runs as the service. Declared first: a later screen goes after it.
          [GITHUB_REVIEWERS_SCREEN]: githubTrustedReviewersScreen({
            reviewers: reviewers.read,
            token: (_ctx, entry) => (entry.userId === operator ? token : undefined),
            ...(apiUrl === undefined ? {} : { apiUrl }),
            resources: reviewers.resources
          })
        };
  const screens =
    custom === undefined && interestModel === undefined
      ? undefined
      : { ...(interestModel === undefined ? {} : { interestModel }), ...(custom === undefined ? {} : { custom }) };
  const github = githubSubscriptionProvider({
    token: (ctx) => (reads(ctx) ? token : undefined),
    ...(apiUrl === undefined ? {} : { apiUrl }),
    ...(screens === undefined ? {} : { screens })
  });
  return {
    ...github,
    reviewReplies: reviewReplies({
      operator,
      token,
      ...(apiUrl === undefined ? {} : { apiUrl }),
      ...(reviewers === undefined ? {} : { reviewers: reviewers.read, resources: reviewers.resources })
    }),
    async canRead(key: string, ctx: BlockContext) {
      if (token === undefined) throw new Error("GitHub routines need GITHUB_TOKEN: set it, or sign in with `gh auth login`, and start the lab again. Nothing was saved.");
      if (!reads(ctx)) throw new Error(`GitHub routines read GitHub with this lab's GITHUB_TOKEN, which serves only ${operator}. Nothing was saved.`);
      return github.canRead(key, ctx);
    }
  };
}
