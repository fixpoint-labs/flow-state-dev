// FIX-2535; epic FIX-2471 ER-4.
/**
 * GitHub as a subscription provider: who may read a thread, and who the running
 * user is on GitHub. Both ask GitHub's API as the running request's own user,
 * on a token the app supplies for that user (ER-4): a repository the user
 * can't read is refused at subscribe, and a private event is read again as its
 * subscriber before it is delivered.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { SubscriptionProvider } from "../subscribe";
import { GITHUB_PROVIDER, githubLoginId } from "./normalize";

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
  const call = async (ctx: BlockContext, path: string): Promise<Response | undefined> => {
    const token = await options.token(ctx);
    if (token === undefined || token.length === 0) return undefined;
    return (options.fetch ?? fetch)(`${api}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
    });
  };
  return {
    provider: GITHUB_PROVIDER,
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
