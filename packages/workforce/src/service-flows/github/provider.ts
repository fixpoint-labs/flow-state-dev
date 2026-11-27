// FIX-2535; epic FIX-2471 ER-4.
/**
 * GitHub as a subscription provider: who may read a thread, who the running
 * user is on GitHub, and what happened on a thread since its poll last looked. Each asks GitHub's API as the running request's own user, on a
 * token the app supplies for that user (ER-4): a repository the user can't
 * read is refused at subscribe, a private event is read again as its
 * subscriber before it is delivered, and a poll reads only what its user can.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { SubscriptionScreens } from "../../subscriptions/screens";
import type { SubscriptionProvider } from "../../subscriptions/subscribe";
import { redact } from "../../error-reporter/redact";
import { GITHUB_PROVIDER, githubLoginId } from "./normalize";
import { pollGitHubThread } from "./poll";

/** What {@link githubSubscriptionProvider} is built with. */
export interface GitHubSubscriptionProviderOptions {
  /** The running user's GitHub token, from the app's own store; none reads nothing. Never from the request's input. */
  token(ctx: BlockContext): string | undefined | Promise<string | undefined>;
  /** GitHub's REST API root. Default `https://api.github.com` (a GitHub Enterprise host names its own). */
  readonly apiUrl?: string;
  /**
   * The GitHub App's bot login, when the app is a GitHub App
   * (`acme-agent[bot]`): the agent handle `githubServiceFlow` asks by default.
   */
  readonly appBotLogin?: string;
  /** The `fetch` it calls. Default the global one. */
  readonly fetch?: typeof fetch;
  /**
   * The app's own screens on GitHub: its custom functions, and the model the
   * `interest` screen asks. Without an `interestModel`, a subscription that
   * lists `interest` is refused.
   */
  readonly screens?: SubscriptionScreens;
}

/** GitHub's provider: a {@link SubscriptionProvider}, with the App's bot login when it has one. */
export interface GitHubSubscriptionProvider extends SubscriptionProvider {
  /** The App's bot login as an id (`acme-agent`), when the app is a GitHub App. */
  readonly agentHandle?: string;
}

/** `owner/repo` from a GitHub thread key (`github:owner/repo` or `…#412`), or `undefined`. */
export function githubRepositoryOf(thread: string): string | undefined {
  const match = /^github:([^/#\s]+)\/([^/#\s]+)(?:#\d+)?$/.exec(thread);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/** Build GitHub's subscription provider. */
export function githubSubscriptionProvider(options: GitHubSubscriptionProviderOptions): GitHubSubscriptionProvider {
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const call = async (ctx: BlockContext, path: string, etag?: string): Promise<Response | undefined> => {
    const token = await options.token(ctx);
    if (token === undefined || token.length === 0) return undefined;
    try {
      return await (options.fetch ?? fetch)(`${api}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(etag === undefined ? {} : { "if-none-match": etag })
        }
      });
    } catch (error) {
      // Fetch failures may carry request headers; neither poll diagnostics nor stored errors may keep the bearer.
      const safe = new Error(redact(error instanceof Error ? error.message : String(error), [token]));
      safe.name = error instanceof Error ? error.name : "Error";
      throw safe;
    }
  };
  const agentHandles = options.appBotLogin === undefined ? [] : [githubLoginId(options.appBotLogin)];
  return {
    // FIX-2536: as the polling user, since the poll schedule's mark.
    poll: (thread, cursor, ctx) => pollGitHubThread(call, thread, cursor, ctx, { agentHandles }),
    provider: GITHUB_PROVIDER,
    ...(options.screens === undefined ? {} : { screens: options.screens }),
    ...(options.appBotLogin === undefined ? {} : { agentHandle: githubLoginId(options.appBotLogin) }),
    async canRead(thread, ctx) {
      const repository = githubRepositoryOf(thread);
      if (repository === undefined) return false;
      try {
        return (await call(ctx, `/repos/${repository}`))?.ok === true;
      } catch {
        return false;
      }
    },
    async self(ctx) {
      try {
        const res = await call(ctx, "/user");
        if (res?.ok !== true) return undefined;
        const login = ((await res.json()) as { login?: unknown }).login;
        return typeof login === "string" && login.length > 0 ? githubLoginId(login) : undefined;
      } catch {
        return undefined;
      }
    }
  };
}
