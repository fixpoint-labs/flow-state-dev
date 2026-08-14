/**
 * Test doubles for the GitHub surface.
 *
 * Two of them, because the two halves of this directory need different things:
 *
 * - **`stubFetch`** — a route table returning recorded payloads. Used by the
 *   read path, where the question is only "does GitHub's shape map onto the
 *   world correctly", and the answer must not depend on a network.
 * - **`createFakeGitHub`** — stateful, and it enforces the one GitHub rule that
 *   actually bites: **one pending review per pull request**. A write path
 *   tested against a stub that always says 200 proves nothing about the failure
 *   mode this code exists to avoid.
 *
 * The fake also refuses to merge. Conductor never merges, and a test double
 * that would happily accept one hides a regression rather than catching it.
 */

import type { FetchLike } from "../../src/github/client";

export const OWNER = "acme";
export const REPO = "widgets";
export const BASE_URL = "https://api.test";
export const SELF_LOGIN = "conductor-bot";

/** `"METHOD /path"` with the base URL and query string stripped. */
function routeKey(method: string, url: string): string {
  const path = url.replace(BASE_URL, "").split("?")[0]!;
  return `${method} ${path}`;
}

/** What a stubbed route returns. A bare value is a 200 with that JSON body. */
export type StubRoute =
  | unknown
  | ((request: { method: string; path: string; body: unknown }) => unknown);

/** Every request a double received, in order — `"GET /repos/acme/widgets/pulls/7"`. */
export interface RecordedCalls {
  readonly calls: string[];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A `fetch` backed by a route table.
 *
 * @param routes Keyed `"METHOD /path"`. A missing route answers 404, which is a
 *   real case the reader handles (a guidance file the repo does not have).
 */
export function stubFetch(routes: Record<string, StubRoute>): FetchLike & RecordedCalls {
  const calls: string[] = [];
  const fn = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const key = routeKey(method, url);
    calls.push(key);
    if (!(key in routes)) return jsonResponse(404, { message: "Not Found" });
    const route = routes[key];
    const value =
      typeof route === "function"
        ? (route as (r: { method: string; path: string; body: unknown }) => unknown)({
            method,
            path: key.slice(method.length + 1),
            body: init?.body ? JSON.parse(init.body) : undefined,
          })
        : route;
    return jsonResponse(200, value);
  }) as FetchLike & RecordedCalls;
  (fn as { calls: string[] }).calls = calls;
  return fn;
}

/** GitHub's pull-request payload, with the fields conductor reads. */
export function pullPayload(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    state: "open",
    merged: false,
    merged_at: null,
    mergeable: true,
    head: { sha: "sha-head" },
    base: { ref: "main" },
    ...overrides,
  };
}

/** GitHub's review payload. */
export function reviewPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    user: { login: "alice", type: "User" },
    state: "COMMENTED",
    commit_id: "sha-head",
    submitted_at: "2026-08-14T10:00:00Z",
    ...overrides,
  };
}

/** One check run. `status: "completed"` plus a conclusion is a finished check. */
export function checkRun(status: string, conclusion: string | null = null) {
  return { status, conclusion };
}

/** The envelope the check-runs endpoint wraps its array in. */
export function checkRuns(...runs: ReturnType<typeof checkRun>[]) {
  return { total_count: runs.length, check_runs: runs };
}

/** GitHub's comment payload, shared by the two comment endpoints. */
export function commentPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 500,
    user: { login: "alice", type: "User" },
    created_at: "2026-08-14T11:00:00Z",
    body: "please rename this",
    ...overrides,
  };
}

interface FakeReview {
  id: number;
  state: string;
  body?: string;
}

/** A stateful GitHub that enforces the pending-review rule. */
export interface FakeGitHub {
  readonly fetch: FetchLike;
  readonly calls: string[];
  /** Reviews on the PR, pending ones included. */
  reviews(): readonly FakeReview[];
  /** Comment bodies created through the replies and issue-comment endpoints. */
  comments(): readonly string[];
  labels(): readonly string[];
}

/**
 * A GitHub that behaves like the real one where it matters.
 *
 * The rule it models: **a user may hold at most one pending (unsubmitted)
 * review per pull request.** Creating a review with no `event` leaves one
 * pending; any later review write on that PR then fails with 422 until it is
 * submitted. Getting this wrong in production looks like silently not
 * responding to feedback, so the double has to be able to produce it.
 */
export function createFakeGitHub(
  options: { readonly labels?: readonly string[] } = {},
): FakeGitHub {
  const calls: string[] = [];
  const reviews: FakeReview[] = [];
  const comments: string[] = [];
  let labels = [...(options.labels ?? [])];
  let nextId = 1;

  const pending = () => reviews.find((review) => review.state === "PENDING");

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(BASE_URL, "").split("?")[0]!;
    const body: Record<string, unknown> = init?.body ? JSON.parse(init.body) : {};
    calls.push(`${method} ${path}`);

    const repo = `/repos/${OWNER}/${REPO}`;

    if (method === "PUT" && /\/pulls\/\d+\/merge$/.test(path)) {
      throw new Error("conductor must never merge — no operation may call this endpoint");
    }

    if (method === "POST" && path === `${repo}/pulls`) {
      return jsonResponse(201, {
        number: 7,
        html_url: "https://github.com/acme/widgets/pull/7",
        head: { sha: "sha-head" },
      });
    }

    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(path)) {
      return jsonResponse(200, reviews);
    }

    if (method === "POST" && /\/pulls\/\d+\/reviews$/.test(path)) {
      if (pending()) {
        return jsonResponse(422, {
          message: "User can only have one pending review per pull request",
        });
      }
      const event = body.event;
      const review: FakeReview = {
        id: nextId++,
        // No `event` means the review is created but not submitted.
        state:
          event === "APPROVE"
            ? "APPROVED"
            : event === "REQUEST_CHANGES"
              ? "CHANGES_REQUESTED"
              : event === "COMMENT"
                ? "COMMENTED"
                : "PENDING",
        body: typeof body.body === "string" ? body.body : undefined,
      };
      reviews.push(review);
      if (review.body) comments.push(review.body);
      return jsonResponse(200, review);
    }

    const eventsMatch = /\/pulls\/\d+\/reviews\/(\d+)\/events$/.exec(path);
    if (method === "POST" && eventsMatch) {
      const target = reviews.find((review) => review.id === Number(eventsMatch[1]));
      if (!target || target.state !== "PENDING") {
        return jsonResponse(422, { message: "Review is not pending" });
      }
      target.state = "COMMENTED";
      return jsonResponse(200, target);
    }

    if (method === "POST" && /\/pulls\/\d+\/comments\/[^/]+\/replies$/.test(path)) {
      comments.push(String(body.body));
      return jsonResponse(201, { id: nextId++ });
    }

    if (method === "POST" && /\/issues\/\d+\/comments$/.test(path)) {
      comments.push(String(body.body));
      return jsonResponse(201, { id: nextId++ });
    }

    if (method === "POST" && /\/issues\/\d+\/labels$/.test(path)) {
      labels = [...new Set([...labels, ...((body.labels as string[]) ?? [])])];
      return jsonResponse(200, labels.map((name) => ({ name })));
    }

    const labelMatch = /\/issues\/\d+\/labels\/(.+)$/.exec(path);
    if (method === "DELETE" && labelMatch) {
      const name = decodeURIComponent(labelMatch[1]!);
      if (!labels.includes(name)) return jsonResponse(404, { message: "Label does not exist" });
      labels = labels.filter((label) => label !== name);
      return jsonResponse(200, labels.map((label) => ({ name: label })));
    }

    if (method === "GET" && /\/issues\/\d+\/labels$/.test(path)) {
      return jsonResponse(200, labels.map((name) => ({ name })));
    }

    return jsonResponse(404, { message: "Not Found" });
  };

  return {
    fetch: fetchImpl,
    calls,
    reviews: () => reviews,
    comments: () => comments,
    labels: () => labels,
  };
}
