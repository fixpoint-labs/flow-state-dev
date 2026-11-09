/**
 * GitHub's poll on a busy or quiet pull request (FIX-2536 review): what a
 * conditional request or a long list must not hide.
 *
 * Why these matter: a finished CI run doesn't change the pull request, so a
 * poll that reads the head commit only from a fresh pull request never hears
 * `check` on a quiet PR, the commonest event there is. A list longer than one
 * page, read from its first page only, never shows the newest review or the
 * `closed` that ends a subscription. And an event rebuilt from a pull request
 * the poll didn't re-read must still carry the labels and privacy the screens
 * read, or a poll screens differently from push.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { githubSubscriptionProvider } from "../src/subscriptions";

const PR = "github:acme/api#412";
const SINCE = Date.parse("2026-11-09T10:00:00Z");
const at = (minutes: number) => new Date(SINCE + minutes * 60_000).toISOString();
const ctx = { session: { identity: { id: "s", userId: "alice", orgId: "acme" } } } as unknown as BlockContext;
const user = (login: string) => ({ login, type: "User" });

/** A fake GitHub: `api` by path, lists paged 100 at a time with a Link header, a 304 for an unchanged validator. */
function fakeGitHub(api: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    const u = new URL(url);
    const path = u.pathname;
    asked.push(`${path}${u.searchParams.has("page") ? `?page=${u.searchParams.get("page")}` : ""}`);
    if (!(path in api)) return new Response("{}", { status: 404 });
    const body = api[path];
    const page = Number(u.searchParams.get("page") ?? "1");
    const pages = Array.isArray(body) ? Math.max(1, Math.ceil(body.length / 100)) : 1;
    const slice = Array.isArray(body) ? body.slice((page - 1) * 100, page * 100) : body;
    const etag = `"${path}:${page}:${JSON.stringify(slice).length}"`;
    if (init.headers["if-none-match"] === etag) return new Response(null, { status: 304 });
    const headers: Record<string, string> = { etag };
    if (pages > 1) headers.link = `<https://api.github.com${path}?per_page=100&page=${pages}>; rel="last"`;
    return new Response(JSON.stringify(slice), { status: 200, headers });
  }) as unknown as typeof globalThis.fetch;
  return { asked, provider: githubSubscriptionProvider({ token: () => "t", fetch }) };
}

function prApi(): Record<string, unknown> {
  return {
    "/repos/acme/api": { full_name: "acme/api", private: true },
    "/repos/acme/api/issues/412": { number: 412, title: "Rename the handler", pull_request: {}, user: user("alice"), created_at: at(-600), labels: [{ name: "ci" }] },
    "/repos/acme/api/pulls/412": { number: 412, title: "Rename the handler", head: { sha: "abc" }, labels: [{ name: "ci" }] },
    "/repos/acme/api/issues/412/timeline": [],
    "/repos/acme/api/issues/412/comments": [],
    "/repos/acme/api/pulls/412/reviews": [],
    "/repos/acme/api/pulls/412/comments": [],
    "/repos/acme/api/commits/abc/check-runs": { check_runs: [] }
  };
}

describe("GitHub's poll, quiet and busy", () => {
  it("hears a check that finished on a quiet PR, whose pull request came back 304", async () => {
    const api = prApi();
    const { provider } = fakeGitHub(api);
    const first = await provider.poll!(PR, { since: SINCE }, ctx);
    if ("unchanged" in first) throw new Error("expected a first read");
    api["/repos/acme/api/commits/abc/check-runs"] = {
      check_runs: [{ id: 5, name: "ci", status: "completed", conclusion: "success", completed_at: at(4), app: { slug: "github-actions" } }]
    };
    const second = await provider.poll!(PR, { since: SINCE, etags: first.etags! }, ctx);
    if ("unchanged" in second) throw new Error("the finished check was hidden by an unchanged pull request");
    expect(second.events.map((e) => e.object.id)).toEqual(["check_run:5"]);
  });

  it("rebuilds an event with the labels and privacy of a pull request it didn't re-read", async () => {
    const api = prApi();
    const { provider } = fakeGitHub(api);
    const first = await provider.poll!(PR, { since: SINCE }, ctx);
    if ("unchanged" in first) throw new Error("expected a first read");
    api["/repos/acme/api/issues/412/comments"] = [{ id: 7, body: "LGTM", user: user("bob"), author_association: "MEMBER", created_at: at(2), updated_at: at(2) }];
    const second = await provider.poll!(PR, { since: SINCE, etags: first.etags! }, ctx);
    if ("unchanged" in second) throw new Error("expected the comment");
    const [comment] = second.events;
    expect(comment).toMatchObject({ audience: "private", labels: ["ci"] });
    expect(comment!.title).toContain("Rename the handler");
  });

  it("reads a list past its first page back to the mark: the newest review request and the close", async () => {
    const api = prApi();
    const old = Array.from({ length: 150 }, (_, i) => ({ event: "labeled", created_at: at(-500 + i), actor: user("alice") }));
    api["/repos/acme/api/issues/412/timeline"] = [
      ...old,
      { event: "review_requested", created_at: at(3), actor: user("alice"), requested_reviewer: user("bob") },
      { event: "closed", created_at: at(4), actor: user("alice") }
    ];
    const { provider, asked } = fakeGitHub(api);
    const result = await provider.poll!(PR, { since: SINCE }, ctx);
    if ("unchanged" in result) throw new Error("expected events");
    expect(result.events.map((e) => e.object.id).sort()).toEqual([`pull_request:${PR}:closed:`, `pull_request:${PR}:review_requested:bob`]);
    expect(result.events.find((e) => e.closes === true)).toBeDefined();
    // The walk stops at the mark: page 2 holds everything after it, so page 1's old items cost nothing more.
    expect(asked.filter((a) => a.startsWith("/repos/acme/api/issues/412/timeline"))).toEqual(["/repos/acme/api/issues/412/timeline", "/repos/acme/api/issues/412/timeline?page=2"]);
  });

  it("says so when a list is busier than the walk reads, instead of dropping what it didn't reach", async () => {
    const api = prApi();
    api["/repos/acme/api/issues/412/comments"] = Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1,
      body: "busy",
      user: user("bob"),
      author_association: "MEMBER",
      created_at: at(1),
      updated_at: at(1)
    }));
    const { provider } = fakeGitHub(api);
    const result = await provider.poll!(PR, { since: SINCE }, ctx);
    if ("unchanged" in result) throw new Error("expected events");
    expect(result.incomplete).toBe(true);
  });
});
