// FIX-2536.
/**
 * GitHub's poll: a PR's activity, read from GitHub's REST API as
 * the polling user, rebuilt into the payloads GitHub's normalize reads.
 *
 * Why these matter: a session that is both pushed and polled hears each event
 * once only if a poll names each object at the same version a webhook names it
 * (ER-8): a review by its id and submit time, a review request by the time it
 * was asked. And a quiet thread must cost conditional requests that come back
 * `304`, not a full re-read of the PR every five minutes.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { githubSubscriptionProvider, normalizeGitHubEvent } from "../src/service-flows";

const PR = "github:acme/api#412";
const REPO = "github:acme/api";
const SINCE = Date.parse("2026-11-09T10:00:00Z");
const at = (minutes: number) => new Date(SINCE + minutes * 60_000).toISOString();
const ctx = { session: { identity: { id: "s", userId: "alice", orgId: "acme" } } } as unknown as BlockContext;

const user = (login: string) => ({ login, type: "User" });
const API: Record<string, unknown> = {
  "/repos/acme/api": { full_name: "acme/api", private: false },
  "/repos/acme/api/issues/412": { number: 412, title: "Rename the handler", pull_request: {}, user: user("alice"), created_at: at(-60), updated_at: at(3), labels: [] },
  "/repos/acme/api/pulls/412": { number: 412, title: "Rename the handler", head: { sha: "abc" }, html_url: "https://github.com/acme/api/pull/412" },
  "/repos/acme/api/issues/412/timeline": [
    { event: "review_requested", created_at: at(1), actor: user("alice"), requested_reviewer: user("bob") },
    { event: "labeled", created_at: at(1), actor: user("alice") }
  ],
  "/repos/acme/api/issues/412/comments": [{ id: 7, body: "LGTM", user: user("bob"), author_association: "MEMBER", created_at: at(2), updated_at: at(2) }],
  "/repos/acme/api/pulls/412/reviews": [
    { id: 90, state: "APPROVED", body: "Ship it", user: user("bob"), author_association: "MEMBER", submitted_at: at(3) },
    { id: 80, state: "COMMENTED", body: "old", user: user("bob"), author_association: "MEMBER", submitted_at: at(-30) }
  ],
  "/repos/acme/api/pulls/412/comments": [],
  "/repos/acme/api/commits/abc/check-runs": {
    check_runs: [
      { id: 5, name: "ci", status: "completed", conclusion: "success", completed_at: at(4), app: { slug: "github-actions", name: "GitHub Actions" } },
      { id: 6, name: "lint", status: "in_progress", app: { slug: "github-actions" } }
    ]
  }
};

/** The repository's lists a repo-wide poll reads: PR 412 moved after the mark, and it has no new issue comments. */
const REPO_API: Record<string, unknown> = {
  "/repos/acme/api/issues": [API["/repos/acme/api/issues/412"]],
  "/repos/acme/api/issues/comments": [],
  "/repos/acme/api/pulls/comments": [
    { id: 33, body: "Nit: rename", user: user("bob"), author_association: "MEMBER", pull_request_url: "https://api.github.com/repos/acme/api/pulls/412", created_at: at(2), updated_at: at(2) }
  ]
};

/** A path the fake answers with a bare status (a token without that permission: `403`). */
const FORBIDDEN = Symbol("forbidden");
/** A path the fake answers `403` with GitHub's rate-limit header: out of requests, not of permission. */
const RATE_LIMITED = Symbol("rate-limited");

function fakeGitHub(extra: Record<string, unknown> = {}) {
  const api = { ...API, ...extra };
  const asked: Array<{ path: string; ifNoneMatch: string | null }> = [];
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    const path = new URL(url).pathname;
    asked.push({ path, ifNoneMatch: init.headers["if-none-match"] ?? null });
    if (init.headers["if-none-match"] === `"${path}"`) return new Response(null, { status: 304 });
    if (!(path in api)) return new Response("{}", { status: 404 });
    if (api[path] === FORBIDDEN) return new Response("{}", { status: 403 });
    if (api[path] === RATE_LIMITED) return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    return new Response(JSON.stringify(api[path]), { status: 200, headers: { etag: `"${path}"` } });
  }) as unknown as typeof globalThis.fetch;
  return { asked, provider: githubSubscriptionProvider({ token: () => "t", fetch }) };
}

describe("GitHub's poll", () => {
  it("rebuilds a PR's reviews, comments, checks and review requests since the mark, named as push names them", async () => {
    const { provider } = fakeGitHub();
    const result = await provider.poll!(PR, { since: SINCE }, ctx);
    if ("unchanged" in result) throw new Error("expected events");
    const named = result.events.map((e) => `${e.kind} ${e.object.id}@${e.object.version}`).sort();
    expect(named).toEqual(
      [
        `check check_run:5@${Date.parse(at(4))}`,
        `comment issue_comment:7@${Date.parse(at(2))}`,
        `pull_request pull_request:${PR}:review_requested:bob@${Date.parse(at(1))}`,
        `review review:90@${Date.parse(at(3))}`
      ].sort()
    );
    // Every event is this thread's, as its own user read it.
    expect(result.events.every((e) => e.threads.includes(PR))).toBe(true);
  });

  it("answers unchanged when every conditional request comes back 304", async () => {
    const { provider, asked } = fakeGitHub();
    const first = await provider.poll!(PR, { since: SINCE }, ctx);
    if ("unchanged" in first) throw new Error("expected events");
    asked.length = 0;
    const second = await provider.poll!(PR, { since: SINCE, etags: first.etags! }, ctx);
    expect(second).toEqual({ unchanged: true });
    expect(asked.every((a) => a.ifNoneMatch !== null)).toBe(true);
  });

  // A webhook puts a PR's review on the repository thread too: a repo-wide subscription with no webhook must hear it.
  it("rebuilds a repo-wide thread's PR reviews and review comments since the mark, named and threaded as push names them", async () => {
    const { provider } = fakeGitHub(REPO_API);
    const result = await provider.poll!(REPO, { since: SINCE }, ctx);
    if ("unchanged" in result) throw new Error("expected events");
    const polled = result.events.filter((e) => e.kind === "review" || e.kind === "comment");
    const repository = API["/repos/acme/api"];
    const pr = API["/repos/acme/api/issues/412"];
    const reviews = API["/repos/acme/api/pulls/412/reviews"] as Array<Record<string, unknown>>;
    const pushed = [
      ...normalizeGitHubEvent({ eventType: "pull_request_review", payload: { action: "submitted", review: reviews[0], pull_request: pr, repository, sender: user("bob") }, received: 0 }),
      ...normalizeGitHubEvent({
        eventType: "pull_request_review_comment",
        payload: { action: "created", comment: (REPO_API["/repos/acme/api/pulls/comments"] as unknown[])[0], pull_request: pr, repository, sender: user("bob") },
        received: 0
      })
    ];
    const named = (events: typeof polled) => events.map((e) => ({ kind: e.kind, object: e.object, threads: [...e.threads].sort() })).sort((a, b) => a.object.id.localeCompare(b.object.id));
    // The review before the mark (id 80) is not delivered again.
    expect(named(polled)).toEqual(named(pushed));
    expect(polled.every((e) => e.threads.includes(REPO) && e.threads.includes(PR))).toBe(true);
  });

  // A fine-grained token can read issues and not pull requests: the repository poll still hears its issues.
  it("still delivers a repo-wide thread's issue events when the token can't read pull requests", async () => {
    const issue = { number: 9, title: "Deploy is blocked", labels: [], user: user("alice"), author_association: "MEMBER", created_at: at(1), updated_at: at(1), state: "open" };
    const { provider } = fakeGitHub({
      "/repos/acme/api/issues": [issue, API["/repos/acme/api/issues/412"]],
      "/repos/acme/api/issues/comments": [],
      "/repos/acme/api/pulls/comments": FORBIDDEN,
      "/repos/acme/api/pulls/412/reviews": FORBIDDEN
    });
    const result = await provider.poll!(REPO, { since: SINCE }, ctx);
    if ("unchanged" in result) throw new Error("expected the issue");
    expect(result.events.map((e) => e.kind)).toContain("issue");
    expect(result.events.some((e) => e.kind === "review" || e.kind === "comment")).toBe(false);
  });

  // A rate-limited 403 is not a missing permission: read as nothing new, the mark would move past reviews never read.
  it("fails a repo-wide poll whose pull-request read is rate limited, so the mark stays put", async () => {
    const { provider } = fakeGitHub({
      "/repos/acme/api/issues": [API["/repos/acme/api/issues/412"]],
      "/repos/acme/api/issues/comments": [],
      "/repos/acme/api/pulls/comments": [],
      "/repos/acme/api/pulls/412/reviews": RATE_LIMITED
    });
    await expect(provider.poll!(REPO, { since: SINCE }, ctx)).rejects.toThrow(/answered 403/);
  });
});
