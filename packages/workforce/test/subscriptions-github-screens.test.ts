/**
 * GitHub's provider carries the app's screens.
 *
 * Why it matters: without them a GitHub subscription that lists the
 * `interest` screen is always refused (`no_interest_model`), so an app can only
 * follow a whole repository unjudged, and every review and comment on it lands
 * in the subscriber's conversation.
 */
import { describe, expect, it } from "vitest";
import { githubLoginsListed, githubSubscriptionProvider, githubTrustedReviewersScreen } from "../src/service-flows";
import { event } from "./subscriptions-harness";
import { subscriptionInputRefusal } from "../src/subscriptions/subscribe";

const judged = { provider: "github", thread: "github:acme/api", kinds: ["review", "comment"], screens: [{ screen: "interest" as const }] };

describe("githubSubscriptionProvider's screens", () => {
  it("accepts an interest subscription once given a model to judge it", () => {
    const github = githubSubscriptionProvider({ token: () => "t", screens: { interestModel: "typesafe-ai/jev" } });
    expect(github.screens?.interestModel).toBe("typesafe-ai/jev");
    expect(subscriptionInputRefusal([github], judged)).toBeUndefined();
  });

  it("still refuses one with no model to judge it", () => {
    expect(subscriptionInputRefusal([githubSubscriptionProvider({ token: () => "t" })], judged)).toMatch(/^no_interest_model:/);
  });

  it("runs the app's custom screens, and lists them", () => {
    const github = githubSubscriptionProvider({
      token: () => "t",
      screens: { custom: { bots: { describe: "only bots", screen: () => undefined } } }
    });
    expect(subscriptionInputRefusal([github], { ...judged, screens: [{ screen: "custom", name: "bots" }] })).toBeUndefined();
  });

});

// FIX-2789; FIX-2873.
describe("githubTrustedReviewersScreen", () => {
  // Why: a comment that passes it steers a coding run that has Bash and a push, so only a listed bot,
  // or a listed login that can write to the repository, passes, and the list is read each time.
  const permissions: Record<string, { status: number; body?: unknown }> = {
    "jhoffner": { status: 200, body: { permission: "admin", role_name: "admin" } },
    "maintainer": { status: 200, body: { permission: "write", role_name: "maintain" } },
    "reader": { status: 200, body: { permission: "read", role_name: "read" } },
    "stranger": { status: 404, body: { message: "Not Found" } },
    "flaky": { status: 502, body: {} }
  };
  const asked: string[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    asked.push(`${url} ${(init?.headers as Record<string, string>).authorization}`);
    const login = /collaborators\/([^/]+)\/permission$/.exec(url)?.[1] ?? "";
    const answer = permissions[login] ?? { status: 404 };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  }) as typeof fetch;
  let listed = ["jhoffner", "Maintainer", "reader", "stranger", "flaky", "deploy-bot", "Greptile-Apps[bot]"];
  const screen = githubTrustedReviewersScreen({ reviewers: () => listed, token: () => "operator-token", apiUrl: "https://gh.test/", fetch: fakeFetch });
  const from = (id: string, role: "member" | "collaborator" | "bot" = "member") =>
    event({ threads: ["github:acme/api", "github:acme/api#412"], sender: { id, name: id, role } });
  const run = (id: string, role?: "member" | "collaborator" | "bot") => screen.screen(from(id, role), {} as never, {} as never);

  it("passes a listed login that can write, asking GitHub with the token for this repository", async () => {
    expect(await run("jhoffner")).toBeUndefined();
    expect(await run("maintainer")).toBeUndefined();
    expect(asked).toContain("https://gh.test/repos/acme/api/collaborators/jhoffner/permission Bearer operator-token");
  });

  it("refuses a listed login that can't write, or that GitHub doesn't know as a collaborator", async () => {
    expect(await run("reader")).toBe('"reader" can\'t write to acme/api');
    expect(await run("stranger")).toBe('"stranger" can\'t write to acme/api');
  });

  it("refuses an unlisted login, and passes a listed bot, without asking GitHub", async () => {
    const before = asked.length;
    expect(await run("octocat")).toBe('"octocat" isn\'t a trusted reviewer');
    expect(await run("greptile-apps", "bot")).toBeUndefined();
    expect(asked.length).toBe(before);
  });

  it("keeps users and bots apart: a bot named like a listed user, and a user named like a listed bot, are refused", async () => {
    // `deploy-bot` is listed as a user; `greptile-apps` only as a bot.
    expect(await run("deploy-bot", "bot")).toBe('bot "deploy-bot" isn\'t a trusted reviewer');
    expect(await run("greptile-apps")).toBe('"greptile-apps" isn\'t a trusted reviewer');
  });

  it("reads the list for each event, so an edit applies to the next one", async () => {
    expect(await run("jhoffner")).toBeUndefined();
    listed = ["maintainer"];
    expect(await run("jhoffner")).toBe('"jhoffner" isn\'t a trusted reviewer');
    listed = ["jhoffner", "Maintainer", "reader", "stranger", "flaky", "deploy-bot", "Greptile-Apps[bot]"];
  });

  it("throws when GitHub can't be asked, so the event is refused as failed, never passed", async () => {
    await expect(run("flaky")).rejects.toThrow(/502/);
    const tokenless = githubTrustedReviewersScreen({ reviewers: () => ["jhoffner"], token: () => undefined, fetch: fakeFetch });
    await expect(tokenless.screen(from("jhoffner"), {} as never, {} as never)).rejects.toThrow(/no token/);
  });

  it("stops the permission lookup when the request is cancelled", async () => {
    const signals: unknown[] = [];
    const screen = githubTrustedReviewersScreen({
      reviewers: () => ["jhoffner"],
      token: () => "t",
      fetch: (async (url: string, init?: RequestInit) => (signals.push(init?.signal), fakeFetch(url, init))) as typeof fetch,
    });
    const stop = new AbortController();
    await screen.screen(from("jhoffner"), { userId: "operator" } as never, { signal: stop.signal } as never);
    expect(signals).toEqual([stop.signal]);
  });

  it("asks for the token for the subscription it screens, so an app lends its token only to the subscriptions it chooses", async () => {
    // Routing runs as the service, not the subscriber: the subscription's own owner is what decides.
    const owners: string[] = [];
    const operatorOnly = githubTrustedReviewersScreen({
      reviewers: () => ["jhoffner"],
      token: (_ctx, entry) => (owners.push(entry.userId), entry.userId === "operator" ? "operator-token" : undefined),
      apiUrl: "https://gh.test/",
      fetch: fakeFetch,
    });
    expect(await operatorOnly.screen(from("jhoffner"), { userId: "operator" } as never, {} as never)).toBeUndefined();
    await expect(operatorOnly.screen(from("jhoffner"), { userId: "someone-else" } as never, {} as never)).rejects.toThrow(/no token/);
    expect(owners).toEqual(["operator", "someone-else"]);
  });
});

describe("githubLoginsListed", () => {
  it("reads one login per list item, and nothing from prose or headings", () => {
    expect(githubLoginsListed("# Trusted reviewers\n\nWho may steer a coder.\n\n- jhoffner\n* @Octo-Reviewer\n- two words\n")).toEqual(["jhoffner", "octo-reviewer"]);
    expect(githubLoginsListed(null)).toEqual([]);
  });
});
