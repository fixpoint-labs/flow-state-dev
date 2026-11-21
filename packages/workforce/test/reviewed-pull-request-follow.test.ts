/**
 * Following a run's pull request on a public repository: anyone can comment
 * there, and the run acts on what it hears with a push. So an app hears only
 * the reviewers it lists, by GitHub login, and with nobody listed it follows
 * nothing at all, never every sender (FIX-2869).
 */
import { describe, expect, it } from "vitest";
import { githubReviewerLogins, reviewedPullRequestFollow } from "../src";

describe("githubReviewerLogins", () => {
  it("lists nobody when the setting is unset or blank, so nothing is followed", () => {
    expect(githubReviewerLogins(undefined)).toBeUndefined();
    expect(githubReviewerLogins(" , ")).toBeUndefined();
  });

  it("reads comma-separated logins as GitHub sends a sender's id: lower-cased, a bot's without its [bot], once each", () => {
    expect(githubReviewerLogins("JHoffner, greptile-apps[bot] ,cursor[bot],jhoffner")).toEqual(["jhoffner", "greptile-apps", "cursor"]);
  });
});

describe("reviewedPullRequestFollow", () => {
  const github = { provider: "github", canRead: () => false };

  it("gives no follower when nobody is listed, rather than one that hears every sender", () => {
    expect(reviewedPullRequestFollow(github, undefined)).toBeUndefined();
    expect(reviewedPullRequestFollow(github, [])).toBeUndefined();
  });

  it("builds a follower on the installation it is handed when reviewers are listed", () => {
    const build = reviewedPullRequestFollow(github, ["jhoffner"]);
    expect(typeof build).toBe("function");
  });
});
