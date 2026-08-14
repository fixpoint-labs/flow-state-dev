/**
 * The GitHub REST client conductor reads and writes through.
 *
 * Deliberately thin: a token, a `fetch`, pagination, and typed errors. It is
 * **not** a connector layer and must not grow into one — every domain concept
 * (a PR fact, a signal, a review submission) lives in a sibling module that
 * happens to call this. What this file owns is the three things every caller
 * would otherwise reimplement: auth headers, `Link`-header pagination, and
 * turning a non-2xx response into an error carrying enough detail to act on.
 *
 * `fetch` is injected rather than reached for globally so the whole GitHub
 * surface is testable against recorded payloads with no network in the suite.
 */

import { createIdentity, type ConductorIdentity, type IdentityOptions } from "./identity";

/** The subset of `fetch` this client uses. Injected so tests need no network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<Response>;

/** A non-2xx response from the GitHub API, with enough detail to branch on. */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly url: string;
  /** Response body, truncated. GitHub puts the actionable reason here. */
  readonly body: string;

  constructor(init: { status: number; method: string; url: string; body: string }) {
    super(`GitHub ${init.method} ${init.url} failed with ${init.status}: ${init.body}`);
    this.name = "GitHubApiError";
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
  }
}

/**
 * True when GitHub refused a write because the caller already holds an
 * unsubmitted (pending) review on the pull request.
 *
 * This is the one GitHub failure conductor must handle rather than surface: a
 * dangling pending review makes every subsequent review write fail, which looks
 * exactly like silently not responding to feedback. See `./operations`.
 */
export function isPendingReviewConflict(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) return false;
  if (error.status !== 422) return false;
  return /pending review/i.test(error.body);
}

/** Max characters of a failing response body retained on the error. */
const BODY_LIMIT = 1000;

/** Default GitHub REST base. Overridable for GitHub Enterprise and for tests. */
const DEFAULT_BASE_URL = "https://api.github.com";

export interface GitHubClientOptions extends IdentityOptions {
  readonly owner: string;
  readonly repo: string;
  /** A token with `repo` scope. Never logged. */
  readonly token: string;
  readonly baseUrl?: string;
  /** Defaults to `globalThis.fetch`. Injected in tests. */
  readonly fetch?: FetchLike;
}

/** What every GitHub-facing module in conductor is handed. */
export interface GitHubClient {
  readonly owner: string;
  readonly repo: string;
  /** Who counts as a bot, and who conductor itself is. Read by `./identity`. */
  readonly identity: ConductorIdentity;
  /** Build a path under `/repos/{owner}/{repo}` — `path("pulls", 7)`. */
  path(...segments: readonly (string | number)[]): string;
  /**
   * One request. Resolves to the parsed JSON body, or `undefined` for a 204.
   *
   * @throws {GitHubApiError} on any non-2xx response.
   */
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T>;
  /**
   * Follow `Link: rel="next"` to exhaustion and concatenate the results.
   *
   * @param path First page's path. A `per_page` is added when absent.
   * @param select Pulls the array out of a page for endpoints that wrap it in
   *   an envelope (check-runs returns `{ total_count, check_runs }`). Defaults
   *   to treating the page itself as the array.
   */
  paginate<T>(path: string, select?: (page: unknown) => readonly T[]): Promise<T[]>;
}

/** Pull the `rel="next"` URL out of a `Link` header, or `null` at the last page. */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1]!;
  }
  return null;
}

/** Add `per_page=100` unless the caller already chose a page size. */
function withPageSize(url: string): string {
  return url.includes("per_page=") ? url : `${url}${url.includes("?") ? "&" : "?"}per_page=100`;
}

/**
 * Create the client.
 *
 * @param options Repo coordinates, the token, and conductor's own identity.
 * @returns A client every other module in `src/github` takes as its first argument.
 */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const identity = createIdentity(options);

  const absolute = (path: string) => (path.startsWith("http") ? path : `${baseUrl}${path}`);

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const url = absolute(path);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${options.token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "flow-state-dev-conductor",
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await doFetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GitHubApiError({
        status: response.status,
        method,
        url,
        body: text.slice(0, BODY_LIMIT),
      });
    }
    return response;
  }

  return {
    owner: options.owner,
    repo: options.repo,
    identity,

    path(...segments) {
      return `/repos/${options.owner}/${options.repo}/${segments.join("/")}`;
    },

    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await send(method, path, body);
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },

    async paginate<T>(
      path: string,
      select?: (page: unknown) => readonly T[],
    ): Promise<T[]> {
      const out: T[] = [];
      let next: string | null = withPageSize(path);
      while (next) {
        const response: Response = await send("GET", next);
        const text = await response.text();
        const page: unknown = text ? JSON.parse(text) : [];
        const rows = select ? select(page) : (page as readonly T[]);
        if (Array.isArray(rows)) out.push(...rows);
        next = nextLink(response.headers.get("link"));
      }
      return out;
    },
  };
}
