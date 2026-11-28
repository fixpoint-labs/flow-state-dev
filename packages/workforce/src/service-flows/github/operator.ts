/**
 * GitHub for routines on one operator's own token: a host run by one user
 * (a lab, a local app) follows GitHub with the token of whoever started it,
 * and for that user alone. `operatorGitHubToken` reads the token once at
 * start; `operatorGitHub` builds the routines' provider on it, which refuses a
 * GitHub routine asked for with no token, or by any other user, naming
 * `GITHUB_TOKEN`, so the token is never lent. With `reviewers`, it declares
 * the trusted reviewers' list screen, asked of GitHub with the
 * operator's token for the operator's own subscriptions only.
 *
 * Node-only (`operatorGitHubToken` asks `gh`): the server entry exports it,
 * the browser entry doesn't.
 */
import { execFileSync } from "node:child_process";
import type { BlockContext, EvaluationModel } from "@flow-state-dev/core/types";
import { redact } from "../../error-reporter/redact";
import { githubSubscriptionProvider, type GitHubSubscriptionProvider } from "./provider";
import { GITHUB_REVIEWERS_SCREEN, githubTrustedReviewersScreen, type GitHubTrustedReviewers } from "./trusted-reviewers";

/** How long `gh auth token` may take before the host starts with no token. */
const GH_TIMEOUT_MS = 10_000;

/**
 * The operator's GitHub token: `GITHUB_TOKEN`, else what `gh auth token`
 * answers, read once at start and never from a request. `undefined` when
 * neither has one.
 */
export function operatorGitHubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readOperatorGitHubToken(env).token;
}

/** Runs `gh` with `args` and answers its stdout; throws as `execFileSync` does (`code`, `signal`, `status`). */
export type GhRunner = (args: readonly string[], timeoutMs: number) => string;

const runGh: GhRunner = (args, timeoutMs) => execFileSync("gh", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs });

/** Where {@link readOperatorGitHubToken} found the token, and why it found none. Never the token in words. */
export interface OperatorGitHubTokenRead {
  readonly token: string | undefined;
  /** `"GITHUB_TOKEN"` (the environment, which wins over `gh`), `"gh auth token"`, or `undefined` with none. */
  readonly source: "GITHUB_TOKEN" | "gh auth token" | undefined;
  /** With no token: why `gh auth token` gave none (not on this process's PATH, timed out, signed out). */
  readonly problem?: string;
}

/**
 * {@link operatorGitHubToken}, saying where the token came from, so a host can
 * log it: a stale `GITHUB_TOKEN` in the server's environment wins over a working
 * `gh` sign-in, and `gh` runs under the server's own PATH and keychain, not a
 * terminal's. `run` stands in for `gh` in a test.
 */
export function readOperatorGitHubToken(env: NodeJS.ProcessEnv = process.env, run: GhRunner = runGh): OperatorGitHubTokenRead {
  const named = env.GITHUB_TOKEN?.trim();
  if (named !== undefined && named !== "") return { token: named, source: "GITHUB_TOKEN" };
  try {
    const signedIn = run(["auth", "token"], GH_TIMEOUT_MS).trim();
    return signedIn === "" ? { token: undefined, source: undefined, problem: "`gh auth token` answered nothing" } : { token: signedIn, source: "gh auth token" };
  } catch (error) {
    const failed = error as { code?: string; signal?: string; status?: number };
    const problem =
      failed.code === "ENOENT"
        ? "`gh` is not on this server's PATH"
        : failed.signal === "SIGTERM" || failed.code === "ETIMEDOUT"
          ? `\`gh auth token\` took longer than ${GH_TIMEOUT_MS / 1_000}s`
          : `\`gh auth token\` failed${failed.status === undefined ? "" : ` (exit ${failed.status})`}: is \`gh\` signed in for this server's user?`;
    return { token: undefined, source: undefined, problem };
  }
}

/**
 * One cheap authenticated call (`GET /user`) with `token`: who GitHub says it
 * is, or why it refused. For a host's start-up line: a token GitHub refuses
 * fails every poll. Never throws.
 */
export async function checkGitHubToken(
  token: string,
  options: { apiUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<{ ok: true; login: string } | { ok: false; reason: string }> {
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  try {
    const res = await (options.fetch ?? fetch)(`${api}/user`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(options.timeoutMs ?? GH_TIMEOUT_MS)
    });
    if (!res.ok) return { ok: false, reason: `GitHub answered ${res.status}${res.status === 401 ? " (the token is invalid or expired)" : ""}` };
    const login = ((await res.json()) as { login?: unknown }).login;
    return typeof login === "string" ? { ok: true, login } : { ok: false, reason: "GitHub named no login" };
  } catch (error) {
    return { ok: false, reason: redact(`couldn't reach GitHub: ${error instanceof Error ? error.message : String(error)}`, [token]) };
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

/**
 * GitHub's subscription provider, reading GitHub with the operator's token
 * for the operator alone. A GitHub routine asked for with no token, or by any
 * user but the operator, is refused at subscribe, naming `GITHUB_TOKEN`, and
 * saves nothing; a poll for anyone else reads nothing.
 */
export function operatorGitHub(options: OperatorGitHubOptions): GitHubSubscriptionProvider {
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
    async canRead(key: string, ctx: BlockContext) {
      if (token === undefined) throw new Error("GitHub routines need GITHUB_TOKEN: set it, or sign in with `gh auth login`, and start the lab again. Nothing was saved.");
      if (!reads(ctx)) throw new Error(`GitHub routines read GitHub with this lab's GITHUB_TOKEN, which serves only ${operator}. Nothing was saved.`);
      return github.canRead(key, ctx);
    }
  };
}
