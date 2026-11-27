/**
 * GitHub on the operator's own token: the token is read once, from
 * `GITHUB_TOKEN` first, and lent to nobody. A routine the operator asks for
 * reads GitHub with it; one asked for by anyone else, or with no token, is
 * refused naming `GITHUB_TOKEN`, before GitHub is asked anything.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { operatorGitHub, operatorGitHubToken } from "../src/index";
import { normalizeGitHubEvent } from "../src/service-flows";
import { screenRefusal } from "../src/subscriptions";

const as = (userId: string) => ({ session: { identity: { userId } } }) as unknown as BlockContext;

/** A fetch that records each GitHub call's bearer and answers the repository readable. */
function github() {
  const bearers: string[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    bearers.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(JSON.stringify({ id: 1, full_name: "acme/app", private: false }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { bearers, fetch };
}

describe("the operator's GitHub token", () => {
  it("is GITHUB_TOKEN when set, trimmed", () => {
    expect(operatorGitHubToken({ GITHUB_TOKEN: "  ghp_operator \n" })).toBe("ghp_operator");
  });
});

describe("GitHub on the operator's token", () => {
  it("reads GitHub with the token for the operator", async () => {
    const calls = github();
    const real = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      await operatorGitHub({ operator: "u_op", token: "ghp_op" }).canRead("github:acme/app#1", as("u_op"));
    } finally {
      globalThis.fetch = real;
    }
    expect(calls.bearers.length).toBeGreaterThan(0);
    expect(new Set(calls.bearers)).toEqual(new Set(["Bearer ghp_op"]));
  });

  it("refuses anyone else's routine, naming the token, and asks GitHub nothing", async () => {
    const calls = github();
    const real = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      await expect(operatorGitHub({ operator: "u_op", token: "ghp_op" }).canRead("github:acme/app#1", as("u_other"))).rejects.toThrow(/GITHUB_TOKEN, which serves only u_op/);
    } finally {
      globalThis.fetch = real;
    }
    expect(calls.bearers).toEqual([]);
  });

  it("refuses every routine with no token, naming GITHUB_TOKEN", async () => {
    await expect(operatorGitHub({ operator: "u_op", token: undefined }).canRead("github:acme/app#1", as("u_op"))).rejects.toThrow(/need GITHUB_TOKEN/);
  });
});

/**
 * The coding agents' own GitHub account (`agentToken`). The operator's token
 * asks GitHub "who am I" as the operator, so without it the own screen drops
 * every comment the operator writes on a run's pull request. With it, the
 * subscription's self is the agents' account: the operator's comments are
 * heard, and the agents' own are dropped as their own action.
 */
describe("the agents' GitHub account as a subscription's self", () => {
  /** GitHub's `/user`, answering by bearer; anything else readable. */
  const whoAmI = (logins: Record<string, string>) =>
    (async (url: string, init?: RequestInit) => {
      const bearer = new Headers(init?.headers).get("authorization") ?? "";
      if (new URL(url).pathname === "/user") return new Response(JSON.stringify({ login: logins[bearer] }), { status: 200 });
      return new Response(JSON.stringify({ full_name: "acme/app" }), { status: 200 });
    }) as typeof globalThis.fetch;
  const commentBy = (login: string) =>
    normalizeGitHubEvent({
      eventType: "issue_comment",
      payload: {
        action: "created",
        issue: { number: 1, title: "t", labels: [], user: { login: "fsd-agent", type: "User" }, pull_request: {} },
        comment: { id: 7, body: "please rename it", user: { login, type: "User" }, author_association: "COLLABORATOR", created_at: "2026-11-27T10:00:00Z" },
        repository: { full_name: "acme/app", private: false },
        sender: { login, type: "User" }
      },
      received: 0
    })[0]!;
  const ownScreen = async (options: { agentToken?: string }, sender: string) => {
    const real = globalThis.fetch;
    globalThis.fetch = whoAmI({ "Bearer ghp_op": "jhoffner", "Bearer ghp_agent": "fsd-agent" });
    try {
      const self = await operatorGitHub({ operator: "u_op", token: "ghp_op", ...options }).self!(as("u_op"), { sessionId: "s" });
      // The own screen reads only who the subscriber is.
      const entry = { screens: [], userId: "u_op", orgId: "o", ...(self === undefined ? {} : { self }) };
      return { self, refused: screenRefusal("own", commentBy(sender), entry as never, { trustedBots: [] }) };
    } finally {
      globalThis.fetch = real;
    }
  };

  it("with an agent account, hears the operator and drops the agents' own comment", async () => {
    expect(await ownScreen({ agentToken: "ghp_agent" }, "jhoffner")).toEqual({ self: "fsd-agent", refused: undefined });
    expect((await ownScreen({ agentToken: "ghp_agent" }, "fsd-agent")).refused).toBe("the subscriber's own action");
  });

  it("without one, self is the operator, as before: the operator's own comment is dropped", async () => {
    expect(await ownScreen({}, "jhoffner")).toEqual({ self: "jhoffner", refused: "the subscriber's own action" });
  });

  it("asks who the agents are only for the operator's own subscriptions", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = whoAmI({ "Bearer ghp_agent": "fsd-agent" });
    try {
      expect(await operatorGitHub({ operator: "u_op", token: "ghp_op", agentToken: "ghp_agent" }).self!(as("u_other"), { sessionId: "s" })).toBeUndefined();
    } finally {
      globalThis.fetch = real;
    }
  });
});
