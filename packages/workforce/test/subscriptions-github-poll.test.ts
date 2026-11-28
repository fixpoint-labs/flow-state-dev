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
import { describe, expect, it, vi } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { githubSubscriptionProvider, normalizeGitHubEvent } from "../src/service-flows";

const PR = "github:acme/api#412";
const REPO = "github:acme/api";
const SINCE = Date.parse("2026-11-09T10:00:00Z");
const at = (minutes: number) => new Date(SINCE + minutes * 60_000).toISOString();
const ctx = { session: { identity: { id: "s", userId: "alice", orgId: "acme" } } } as unknown as BlockContext;

const user = (login: string) => ({ login, type: "User" });
/** PR 412 as a check suite lists it: headed on this repository. */
const OUR_PR = { number: 412, head: { ref: "rename", repo: { url: "https://api.github.com/repos/acme/api" } }, base: { repo: { url: "https://api.github.com/repos/acme/api" } } };
const API: Record<string, unknown> = {
  "/repos/acme/api": { full_name: "acme/api", private: false },
  "/repos/acme/api/issues/412": { number: 412, title: "Rename the handler", pull_request: {}, user: user("alice"), created_at: at(-60), updated_at: at(3), labels: [] },
  "/repos/acme/api/pulls/412": { number: 412, title: "Rename the handler", head: { sha: "abc", ref: "rename", repo: { full_name: "Acme/API" } }, html_url: "https://github.com/acme/api/pull/412" },
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
      { id: 5, name: "ci", status: "completed", conclusion: "success", completed_at: at(4), check_suite: { id: 1 }, app: { slug: "github-actions", name: "GitHub Actions" } },
      { id: 6, name: "lint", status: "in_progress", check_suite: { id: 1 }, app: { slug: "github-actions" } }
    ]
  },
  // The suites on the head commit, each with the pull requests GitHub matched it to: what a check run's own object doesn't carry.
  "/repos/acme/api/commits/abc/check-suites": { check_suites: [{ id: 1, head_branch: "rename", pull_requests: [OUR_PR] }, { id: 2, head_branch: "elsewhere", pull_requests: [] }] },
  // The Actions workflow runs on the head commit, each naming its suite and the repository its head came from.
  "/repos/acme/api/actions/runs": { workflow_runs: [{ check_suite_id: 1, head_repository: { full_name: "Acme/API" } }] }
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

  // Anyone can open a pull request from a fork whose head is the same commit, and that fork's workflow
  // reports check runs on the commit in this repository. A run hears only checks from its own pull
  // request's branch on this repository, so a stranger can't turn a run's CI red.
  describe("whose check runs reach the pull request", () => {
    const failed = (id: number, suite: number) => ({ id, name: `job-${id}`, status: "completed", conclusion: "failure", completed_at: at(5), check_suite: { id: suite }, app: { slug: "github-actions", name: "GitHub Actions" } });
    const checksOf = async (extra: Record<string, unknown>) => {
      const { provider, asked } = fakeGitHub(extra);
      const result = await provider.poll!(PR, { since: SINCE }, ctx);
      if ("unchanged" in result) throw new Error("expected events");
      return { checks: result.events.filter((e) => e.kind === "check").map((e) => e.object.id), asked: asked.map((a) => a.path) };
    };

    it("delivers a same-repository pull request's failed check", async () => {
      const { checks } = await checksOf({ "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] } });
      expect(checks).toEqual(["check_run:7"]);
    });

    it("drops a run at the same commit from a suite on another branch", async () => {
      const { checks } = await checksOf({ "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1), failed(8, 2), failed(9, 3)] } });
      expect(checks, "suite 2 ran for another branch; suite 3 isn't listed").toEqual(["check_run:7"]);
    });

    it("delivers no check runs to a pull request whose head is a fork, even at a matching commit", async () => {
      const { checks, asked } = await checksOf({
        "/repos/acme/api/pulls/412": { number: 412, title: "Rename the handler", head: { sha: "abc", ref: "rename", repo: { full_name: "mallory/api" } } },
        "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] }
      });
      expect(checks).toEqual([]);
      expect(asked, "a fork's head isn't asked for its checks").not.toContain("/repos/acme/api/commits/abc/check-runs");
    });

    // A cursor kept before the head's branch was kept with it: the pull request answers 304, so it is read in full once.
    it("reads an unchanged pull request in full once when the cursor doesn't know whose head it is", async () => {
      const { provider, asked } = fakeGitHub({ "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] } });
      const first = await provider.poll!(PR, { since: SINCE }, ctx);
      if ("unchanged" in first) throw new Error("expected events");
      // No branch kept, and the check runs moved since (their validator dropped): a run finished.
      const legacy = Object.fromEntries(Object.entries(first.etags!).filter(([key]) => key !== "#head-ref" && !key.includes("check-runs")));
      asked.length = 0;
      const second = await provider.poll!(PR, { since: SINCE, etags: legacy }, ctx);
      if ("unchanged" in second) throw new Error("expected the check");
      expect(second.events.filter((e) => e.kind === "check").map((e) => e.object.id)).toEqual(["check_run:7"]);
      expect(asked.filter((a) => a.path === "/repos/acme/api/pulls/412").map((a) => a.ifNoneMatch)).toEqual([expect.any(String), null]);
      expect(second.etags!["#head-ref"]).toBe("rename");
    });

    // A fork can name its branch like ours. An Actions run counts only when its workflow run's head is this
    // repository; any other app's only when its suite lists this pull request headed here. Unknown: dropped.
    it("drops a github-actions run whose workflow run is headed on a fork, at a matching branch and commit", async () => {
      const { checks } = await checksOf({
        "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] },
        "/repos/acme/api/actions/runs": { workflow_runs: [{ check_suite_id: 1, head_repository: { full_name: "mallory/api" } }] }
      });
      expect(checks).toEqual([]);
    });

    it("drops a github-actions run when its workflow runs can't be read", async () => {
      const { checks } = await checksOf({ "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] }, "/repos/acme/api/actions/runs": FORBIDDEN });
      expect(checks).toEqual([]);
    });

    // Out of requests is not an answer: the Actions run waits for the next poll rather than being lost.
    it("retries a github-actions run on the next poll when its workflow runs were rate limited", async () => {
      const runs = { "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] } };
      const limited = fakeGitHub({ ...runs, "/repos/acme/api/actions/runs": RATE_LIMITED });
      const first = await limited.provider.poll!(PR, { since: SINCE }, ctx);
      if ("unchanged" in first) throw new Error("expected a read");
      expect(first.events.filter((e) => e.kind === "check"), "fails closed this poll").toEqual([]);
      expect(first.through, "the mark stays at the run").toBeLessThanOrEqual(Date.parse(at(5)));
      const second = await fakeGitHub(runs).provider.poll!(PR, { since: first.through, etags: first.etags! }, ctx);
      if ("unchanged" in second) throw new Error("the rate-limited run was never asked again");
      expect(second.events.filter((e) => e.kind === "check").map((e) => e.object.id)).toEqual(["check_run:7"]);
    });

    it("says once that a token can't read Actions, and moves on", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const runs = { "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] }, "/repos/acme/api/actions/runs": FORBIDDEN };
        const first = await fakeGitHub(runs).provider.poll!(PR, { since: SINCE }, ctx);
        if ("unchanged" in first) throw new Error("expected a read");
        expect(first.events.filter((e) => e.kind === "check")).toEqual([]);
        expect(first.through, "a permanent refusal advances the mark").toBeGreaterThan(Date.parse(at(5)));
        const said = () => warn.mock.calls.filter((c) => String(c[0]).includes("can't read GitHub Actions")).length;
        expect(said()).toBe(1);
        const next = { ...runs, "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(8, 1)] } };
        await fakeGitHub(next).provider.poll!(PR, { since: SINCE, etags: Object.fromEntries(Object.entries(first.etags!).filter(([k]) => !k.includes("check-runs"))) }, ctx);
        expect(said(), "once per subscription").toBe(1);
      } finally {
        warn.mockRestore();
      }
    });

    it("binds another app's suite to this pull request, not to a branch name", async () => {
      const vercel = (id: number, suite: number) => ({ ...failed(id, suite), app: { slug: "vercel", name: "Vercel" } });
      const { checks, asked } = await checksOf({
        "/repos/acme/api/commits/abc/check-runs": { check_runs: [vercel(7, 1), vercel(8, 4), vercel(9, 5)] },
        "/repos/acme/api/commits/abc/check-suites": {
          check_suites: [
            { id: 1, head_branch: "rename", pull_requests: [OUR_PR] },
            // On our branch name, with no entry for this pull request.
            { id: 4, head_branch: "rename", pull_requests: [] },
            // An entry for #412 headed elsewhere.
            { id: 5, head_branch: "rename", pull_requests: [{ ...OUR_PR, head: { ref: "rename", repo: { url: "https://api.github.com/repos/mallory/api" } } }] }
          ]
        }
      });
      expect(checks).toEqual(["check_run:7"]);
      expect(asked, "no workflow runs asked without an Actions run").not.toContain("/repos/acme/api/actions/runs");
    });

    it("delivers none when the head's repository is gone (a deleted fork)", async () => {
      const { checks } = await checksOf({
        "/repos/acme/api/pulls/412": { number: 412, title: "Rename the handler", head: { sha: "abc", ref: "rename", repo: null } },
        "/repos/acme/api/commits/abc/check-runs": { check_runs: [failed(7, 1)] }
      });
      expect(checks).toEqual([]);
    });
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
