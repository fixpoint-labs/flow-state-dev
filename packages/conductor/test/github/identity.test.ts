/**
 * `isHumanActor` — the guard the whole signal path rests on.
 *
 * Two failures it exists to prevent, and both are expensive: a bot review
 * satisfying an approval gate, and conductor reading its own comment back as
 * new feedback (a loop that bills on every turn). Every decision below is made
 * from the author record GitHub sets; none is made from what was written.
 */

import { describe, expect, it } from "vitest";
import { createIdentity, isHumanActor } from "../../src/github/identity";

const identity = createIdentity({
  selfLogin: "conductor-bot",
  botLogins: ["CodeRabbit", "vercel"],
});

describe("who counts as a human", () => {
  it("accepts an ordinary user", () => {
    expect(isHumanActor({ login: "alice", type: "User" }, identity)).toBe(true);
  });

  it("rejects an account GitHub types as a Bot", () => {
    expect(isHumanActor({ login: "renovate", type: "Bot" }, identity)).toBe(false);
  });

  it("rejects a [bot] login even when the type says User", () => {
    // App installations frequently report `type: "User"`; the suffix is the
    // reliable structural tell.
    expect(isHumanActor({ login: "dependabot[bot]", type: "User" }, identity)).toBe(false);
  });

  it("rejects a configured bot login, case-insensitively", () => {
    expect(isHumanActor({ login: "coderabbit", type: "User" }, identity)).toBe(false);
    expect(isHumanActor({ login: "VERCEL", type: "User" }, identity)).toBe(false);
  });

  it("rejects conductor itself, case-insensitively", () => {
    // The loop guard: conductor answering a reviewer must not read its own
    // answer as new feedback.
    expect(isHumanActor({ login: "Conductor-Bot", type: "User" }, identity)).toBe(false);
  });

  it("rejects anything a GitHub App performed", () => {
    expect(
      isHumanActor({ login: "alice", type: "User" }, identity, { viaGitHubApp: true }),
    ).toBe(false);
  });

  it("rejects an unattributable author", () => {
    // Biased toward dropping: a missed comment is picked up on the next poll,
    // where a gate satisfied by nobody is not recoverable.
    expect(isHumanActor(null, identity)).toBe(false);
    expect(isHumanActor(undefined, identity)).toBe(false);
    expect(isHumanActor({ login: "", type: "User" }, identity)).toBe(false);
    expect(isHumanActor({ type: "User" }, identity)).toBe(false);
  });

  it("treats an unconfigured self-login as no self, not as matching everything", () => {
    const bare = createIdentity();
    expect(isHumanActor({ login: "alice", type: "User" }, bare)).toBe(true);
    expect(isHumanActor({ login: "someone[bot]", type: "User" }, bare)).toBe(false);
  });
});
