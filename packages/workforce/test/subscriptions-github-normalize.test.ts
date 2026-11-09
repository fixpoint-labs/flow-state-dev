/**
 * GitHub's normalize (FIX-2535): a GitHub event, as a webhook delivers it or a
 * poll rebuilds it from the API, as the normalized events a service flow
 * routes.
 *
 * Why these matter: the object and version are what a subscription sees once.
 * A version read from the delivery would make a redelivery and a poll look new
 * (a session hears a review twice); a pull request versioned by its
 * `updated_at` would make a later API read look new too. Who sent it decides
 * the sender screen, which fails closed: an outsider's comment must not read
 * as a member's. And `addressed` is what FIX-2538 runs on in every mode, so a
 * quoted reply or a pasted snippet must never read as asking the agent.
 */
import { describe, expect, it } from "vitest";
import { followPullRequest, normalizeGitHubEvent } from "../src/subscriptions";
import { githubMentions, githubThreadKey, pullRequestThread } from "../src/internal";

const REPO = { full_name: "Acme/API", private: false };
const PR = { number: 412, title: "Rename the handler", html_url: "https://github.com/Acme/API/pull/412", labels: [{ name: "bug" }], user: { login: "Alice" } };
const member = { login: "Bob", type: "User" };

const review = (over: Record<string, unknown> = {}) => ({
  action: "submitted",
  repository: REPO,
  pull_request: PR,
  sender: member,
  review: { id: 77, body: "Looks good", state: "APPROVED", submitted_at: "2026-11-05T10:00:00Z", author_association: "MEMBER", html_url: "u" },
  ...over
});

const at = { received: 1_000 };

describe("normalizeGitHubEvent", () => {
  it("names a review by GitHub's own id, at its own time, on the repository and the pull request", () => {
    const [event] = normalizeGitHubEvent({ eventType: "pull_request_review", payload: review(), ...at });
    expect(event).toMatchObject({
      provider: "github",
      threads: ["github:acme/api", "github:acme/api#412"],
      kind: "review",
      object: { id: "review:77", version: Date.parse("2026-11-05T10:00:00Z") },
      sender: { id: "bob", name: "Bob", role: "member" },
      audience: "public",
      labels: ["bug"]
    });
  });

  it("gives a redelivery the same object and version, whatever its delivery id or arrival", () => {
    const first = normalizeGitHubEvent({ eventType: "pull_request_review", payload: review(), received: 1, deliveryId: "a" });
    const again = normalizeGitHubEvent({ eventType: "pull_request_review", payload: review(), received: 99_999, deliveryId: "b" });
    expect(again[0]!.object).toEqual(first[0]!.object);
  });

  it("maps who sent it from the acting object's association, failing closed", () => {
    const role = (association: string | undefined, sender = member) =>
      normalizeGitHubEvent({
        eventType: "issue_comment",
        payload: {
          action: "created",
          repository: REPO,
          issue: { ...PR, pull_request: {} },
          sender,
          comment: { id: 5, body: "hi", updated_at: "2026-11-05T10:00:00Z", ...(association === undefined ? {} : { author_association: association }) }
        },
        ...at
      })[0]!.sender.role;
    expect(role("OWNER")).toBe("member");
    expect(role("MEMBER")).toBe("member");
    expect(role("COLLABORATOR")).toBe("collaborator");
    expect(role("CONTRIBUTOR")).toBe("outsider");
    expect(role("NONE")).toBe("outsider");
    expect(role(undefined)).toBe("unknown");
    expect(role("MEMBER", { login: "codex[bot]", type: "Bot" })).toBe("bot");
  });

  it("makes a check on two pull requests one event per pull request, sent by the app that ran it", () => {
    const events = normalizeGitHubEvent({
      eventType: "check_run",
      payload: {
        action: "completed",
        repository: REPO,
        sender: { login: "pusher", type: "User" },
        check_run: {
          id: 9,
          name: "ci",
          conclusion: "failure",
          completed_at: "2026-11-05T10:00:00Z",
          app: { slug: "github-actions", name: "GitHub Actions" },
          pull_requests: [{ number: 412 }, { number: 413 }]
        }
      },
      ...at
    });
    expect(events.map((e) => e.threads.at(-1))).toEqual(["github:acme/api#412", "github:acme/api#413"]);
    expect(events.every((e) => e.object.id === "check_run:9" && e.kind === "check")).toBe(true);
    expect(events[0]!.sender).toMatchObject({ id: "github-actions", role: "bot" });
  });

  it("names a review request as an occurrence on the pinned thread key, so the webhook and a later API read agree", () => {
    const webhook = normalizeGitHubEvent({
      eventType: "pull_request",
      payload: {
        action: "review_requested",
        repository: REPO,
        sender: { login: "Alice", type: "User" },
        requested_reviewer: { login: "Carol" },
        pull_request: { ...PR, updated_at: "2026-11-05T10:00:00Z" }
      },
      ...at
    });
    // A poll rebuilds it from the timeline event: the pull request's own updated_at has since moved, the event's time hasn't.
    const poll = normalizeGitHubEvent({
      eventType: "pull_request",
      payload: {
        action: "review_requested",
        repository: { full_name: "acme/api", private: false },
        sender: { login: "alice", type: "User" },
        requested_reviewer: { login: "carol" },
        pull_request: { ...PR, updated_at: "2026-11-05T10:00:00Z" }
      },
      received: 5_000
    });
    expect(webhook[0]!.object).toEqual({ id: "pull_request:github:acme/api#412:review_requested:carol", version: Date.parse("2026-11-05T10:00:00Z") });
    expect(poll[0]!.object).toEqual(webhook[0]!.object);
  });

  it("closes the pull request's thread on a close, and only that thread", () => {
    const [event] = normalizeGitHubEvent({
      eventType: "pull_request",
      payload: { action: "closed", repository: REPO, sender: member, pull_request: { ...PR, merged: true, closed_at: "2026-11-05T11:00:00Z" } },
      ...at
    });
    expect(event).toMatchObject({ kind: "pull_request", closes: true, threads: ["github:acme/api", "github:acme/api#412"] });
    expect(event!.title).toContain("merged");
  });

  it("normalizes anything else to nothing", () => {
    expect(normalizeGitHubEvent({ eventType: "push", payload: { repository: REPO, sender: member }, ...at })).toEqual([]);
    expect(normalizeGitHubEvent({ eventType: "pull_request", payload: { action: "labeled", repository: REPO, sender: member, pull_request: PR }, ...at })).toEqual([]);
    expect(normalizeGitHubEvent({ eventType: "pull_request_review", payload: review({ action: "dismissed" }), ...at })).toEqual([]);
  });

  it("marks private repositories' events private, so delivery reads them again as the subscriber", () => {
    const [event] = normalizeGitHubEvent({ eventType: "pull_request_review", payload: review({ repository: { ...REPO, private: true } }), ...at });
    expect(event!.audience).toBe("private");
  });
});

describe("addressed: the event asks the app's agent", () => {
  const comment = (body: string) =>
    normalizeGitHubEvent(
      {
        eventType: "issue_comment",
        payload: {
          action: "created",
          repository: REPO,
          issue: PR,
          sender: member,
          comment: { id: 5, body, updated_at: "2026-11-05T10:00:00Z", author_association: "MEMBER" }
        },
        ...at
      },
      { agentHandles: ["acme-agent[bot]"] }
    )[0]!;

  // Whether a body asks the agent, by CommonMark's reading of code: a pasted snippet or a quoted reply asks no one, and
  // text a code construct only looks like it hides must still ask. Each case says why it reads as it does.
  const MENTIONS: ReadonlyArray<readonly [why: string, body: string, addressed: true | undefined]> = [
    ["a mention of an agent handle asks it", "@acme-agent please fix the test", true],
    ["a handle in any case, with [bot], asks it", "cc @Acme-Agent[bot]", true],
    ["a quoted reply asks no one", "> @acme-agent please fix\n\nI disagree with this", undefined],
    ["a fenced block hides its mention", "```\n@acme-agent run\n```", undefined],
    ["a code span hides its mention", "see `@acme-agent`", undefined],
    ["a double-backtick span holds a literal backtick, and its mention", "run ``@acme-agent `fix` `` here", undefined],
    ["a double-backtick span alone hides its mention", "``@acme-agent``", undefined],
    ["a closed span hides nothing after it", "``code`` then @acme-agent please", true],
    ["a stray backtick doesn't cross a blank line to the next paragraph", "Don`t merge yet.\n\n@acme-agent please fix the test, see `foo`", true],
    ["a stray backtick doesn't cross two blank lines either", "Don`t merge yet.\n\n@acme-agent please fix the test\n\nsee `foo`", true],
    ["an email address is no mention", "mail me at bob@acme-agent.dev", undefined],
    ["a mention of anyone else asks no agent", "@carol can you look?", undefined],
    ["a four-backtick fence holding a triple-backtick example hides it all", "````\n```\n@acme-agent\n```\n````", undefined],
    ["a tilde fence closes on tildes, not on the backticks it holds", "~~~\nuse ```\n~~~\n@acme-agent please fix", true],
    ["a tilde fence holding backticks hides its mention", "~~~\n```\n@acme-agent\n~~~", undefined],
    ["a closing fence shorter than the opener doesn't close it", "````\nexample\n```\n@acme-agent please\n````", undefined],
    ["a fence line with text after the run doesn't close it", "```\nx\n``` not a close\n@acme-agent please", undefined],
    ["an unclosed fence runs to the end of the body", "Before\n\n```js\n@acme-agent run", undefined],
    ["a backtick run whose info string holds a backtick is no fence", "```foo`bar\n@acme-agent please", true],
    ["a run indented four spaces is no fence", "Note:\n    ```\n@acme-agent please fix the test", true],
    ["a fence ends a paragraph, so a backtick before it pairs with nothing inside", "Don`t\n```\ncode\n```\n@acme-agent please", true]
  ];

  it.each(MENTIONS)("%s", (_why, body, addressed) => {
    expect(comment(body).addressed).toBe(addressed);
  });

  it("is set by assigning an agent handle or requesting its review", () => {
    const pr = (action: string, extra: Record<string, unknown>) =>
      normalizeGitHubEvent(
        {
          eventType: "pull_request",
          payload: { action, repository: REPO, sender: member, pull_request: { ...PR, updated_at: "2026-11-05T10:00:00Z" }, ...extra },
          ...at
        },
        { agentHandles: ["acme-agent"] }
      )[0]!;
    expect(pr("assigned", { assignee: { login: "acme-agent[bot]" } }).addressed).toBe(true);
    expect(pr("review_requested", { requested_reviewer: { login: "acme-agent" } }).addressed).toBe(true);
    expect(pr("review_requested", { requested_reviewer: { login: "carol" } }).addressed).toBeUndefined();
  });

  it("reads mentions outside quotes and code", () => {
    expect(githubMentions("hi @Bob and > not\n> @carol\n`@dave` @erin[bot]")).toEqual(["bob", "erin"]);
  });
});

describe("the thread key and the follower", () => {
  it("lower-cases the thread key as the pull-request record does", () => {
    expect(githubThreadKey("Acme/API", 412)).toBe("github:acme/api#412");
    expect(pullRequestThread({ host: "GitHub.com", owner: "Acme", name: "API", number: 412 })).toBe("github:acme/api#412");
    expect(pullRequestThread({ host: "ghe.acme.dev", owner: "acme", name: "api", number: 1 })).toBeUndefined();
  });

  it("declares the subscription collections it writes, so a coding task's request carries them", () => {
    expect(Object.keys(followPullRequest({ providers: [] }).resources ?? {})).toContain("workforceSubscriptions");
  });

  // A pull request the branch check first finds already closed or merged has had its closing
  // event, which ended only the subscriptions there were then: one made now would never end.
  it("doesn't subscribe to a pull request recorded already closed or merged, and still subscribes to an open one", async () => {
    const asked: string[] = [];
    const provider = { provider: "github", canRead: (thread: string) => (asked.push(thread), false) };
    const followed: string[] = [];
    const follow = followPullRequest({ providers: [provider], onFollowed: (pr) => void followed.push(pr.state ?? "") });
    const ctx = { session: { state: { workerId: "eng.coder" }, identity: { id: "s1", userId: "alice", orgId: "acme" } } } as never;
    const recorded = (number: number, state: string) => ({ host: "github.com", owner: "Acme", name: "API", number, url: `u${number}`, key: `k${number}`, state });
    await follow(ctx, recorded(1, "closed"));
    await follow(ctx, recorded(2, "merged"));
    expect(asked).toEqual([]);
    expect(followed).toEqual([]);
    await expect(follow(ctx, recorded(3, "open"))).rejects.toThrow(/not_readable/);
    expect(asked).toEqual(["github:acme/api#3"]);
    expect(followed).toEqual(["open"]);
  });
});
