/**
 * Following a run's pull request on a public repository: anyone can comment
 * there, and the run acts on what it hears with a push. So an app hears only
 * the reviewers it lists, by GitHub login, and with nobody listed it follows
 * nothing at all, never every sender. A listed reviewer is heard whoever they
 * are, a review bot or someone outside the project, and nobody else is.
 */
import { describe, expect, it } from "vitest";
import { githubReviewers, reviewedPullRequestFollow } from "../src";
import { bootSubscriptionsHost, event, github } from "./subscriptions-harness";

describe("githubReviewers", () => {
  it("lists nobody when the setting is unset or blank, so nothing is followed", () => {
    expect(githubReviewers(undefined)).toBeUndefined();
    expect(githubReviewers(" , ")).toBeUndefined();
  });

  it("reads comma-separated logins as GitHub sends a sender's id, once each, and keeps which are bots", () => {
    expect(githubReviewers("JHoffner, greptile-apps[bot] ,Cursor[bot],jhoffner")).toEqual({ users: ["jhoffner"], bots: ["greptile-apps", "cursor"] });
  });
});

describe("reviewedPullRequestFollow", () => {
  it("gives no follower when nobody is listed, rather than one that hears every sender", () => {
    expect(reviewedPullRequestFollow(github, undefined)).toBeUndefined();
    expect(reviewedPullRequestFollow(github, { users: [], bots: [] })).toBeUndefined();
  });

  it("delivers a listed reviewer's review, a listed bot's and a listed outsider's, and no one else's", async () => {
    const reviewers = githubReviewers("bob-gh, greptile-apps[bot], outside-dev")!;
    const host = bootSubscriptionsHost({ follower: reviewedPullRequestFollow(github, reviewers), service: { trustedBots: reviewers.bots } });
    try {
      const session = await host.follower("alice");
      const ran = await host.act("alice", session, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      expect((ran as { error?: unknown }).error).toBeUndefined();
      const from = (id: string, role: "member" | "bot" | "outsider") => event({ text: `review by ${id}`, sender: { id, name: id, role } });
      for (const review of [from("bob-gh", "member"), from("greptile-apps", "bot"), from("outside-dev", "outsider"), from("octocat", "member"), from("codex", "bot"), from("stranger", "outsider")]) {
        await host.route(review);
      }
      const heard = (await host.heard(session)).join("\n");
      for (const listed of ["bob-gh", "greptile-apps", "outside-dev"]) expect(heard).toContain(`review by ${listed}`);
      for (const unlisted of ["octocat", "codex", "stranger"]) expect(heard).not.toContain(`review by ${unlisted}`);
    } finally {
      await host.dispose();
    }
  });

  // A bot's id is its app slug with `[bot]` dropped, the same form as a user's login, so a user who
  // registers a listed bot's name must not pass as that bot on a public repository.
  it("refuses a user whose login is a listed bot's name, and still hears the bot and the listed users", async () => {
    const reviewers = githubReviewers("bob-gh, greptile-apps[bot]")!;
    const host = bootSubscriptionsHost({ follower: reviewedPullRequestFollow(github, reviewers), service: { trustedBots: reviewers.bots } });
    try {
      const session = await host.follower("alice");
      await host.act("alice", session, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      await host.route(event({ text: "from the impostor outside", sender: { id: "greptile-apps", name: "greptile-apps", role: "outsider" } }));
      await host.route(event({ text: "from the impostor inside", sender: { id: "greptile-apps", name: "greptile-apps", role: "member" } }));
      await host.route(event({ text: "from the real bot", sender: { id: "greptile-apps", name: "greptile-apps", role: "bot" } }));
      await host.route(event({ text: "from bob", sender: { id: "bob-gh", name: "bob-gh", role: "member" } }));
      await host.route(event({ text: "from a bot named bob", sender: { id: "bob-gh", name: "bob-gh", role: "bot" } }));
      await host.route(event({ text: "from a trusted bot named bob", sender: { id: "codex", name: "codex", role: "bot" } }));
      const heard = (await host.heard(session)).join("\n");
      expect(heard).toContain("from the real bot");
      expect(heard).toContain("from bob");
      expect(heard).not.toContain("from the impostor");
      expect(heard).not.toContain("from a bot named bob");
      expect(heard).not.toContain("from a trusted bot");
    } finally {
      await host.dispose();
    }
  });

  it("with only users listed, refuses a bot the service trusts whose id is a listed user's login", async () => {
    const reviewers = githubReviewers("codex")!;
    // The harness's service trusts the bot `codex`; the reviewer list names a user `codex`.
    const host = bootSubscriptionsHost({ follower: reviewedPullRequestFollow(github, reviewers) });
    try {
      const session = await host.follower("alice");
      await host.act("alice", session, "respond", { message: "opened it [follow-pr:412]" }, "follower");
      await host.route(event({ text: "from the bot codex", sender: { id: "codex", name: "codex", role: "bot" } }));
      await host.route(event({ text: "from the user codex", sender: { id: "codex", name: "codex", role: "outsider" } }));
      const heard = (await host.heard(session)).join("\n");
      expect(heard).toContain("from the user codex");
      expect(heard).not.toContain("from the bot codex");
    } finally {
      await host.dispose();
    }
  });
});
