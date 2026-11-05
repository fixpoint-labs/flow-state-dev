import { describe, expect, it } from "vitest";
import { firstLineOfText, FALLBACK_TITLE_CHARS, NEW_SESSION_TITLE, sessionTitle } from "../src/lib/session-title";

// The sessions list shows the title the session's generator wrote, a sidechain of its turn. Until
// one lands, the first message's first line stands in, as it always has, so a session is never
// untitled while it has a message.
describe("sessionTitle", () => {
  it("shows the generated title over the first message once it has landed", () => {
    expect(sessionTitle({ title: "Plan the billing migration", firstLine: "hi" })).toBe("Plan the billing migration");
  });

  it("falls back to the first message's first line until a generated title lands", () => {
    expect(sessionTitle({ title: undefined, firstLine: "Can you check the login flow?" })).toBe("Can you check the login flow?");
  });

  it("treats a blank generated title as none, so the fallback shows", () => {
    expect(sessionTitle({ title: "   ", firstLine: "Check the build" })).toBe("Check the build");
    expect(sessionTitle({ title: "   ", firstLine: undefined })).toBe(NEW_SESSION_TITLE);
  });

  it("is New session for a session with no message and no title", () => {
    expect(sessionTitle({ title: undefined, firstLine: undefined })).toBe(NEW_SESSION_TITLE);
  });

  it("cuts a fallback title to the list's width", () => {
    const long = "x".repeat(FALLBACK_TITLE_CHARS + 20);
    expect(sessionTitle({ title: undefined, firstLine: long })).toHaveLength(FALLBACK_TITLE_CHARS);
  });
});

describe("firstLineOfText", () => {
  it("takes the first line, trimmed, so a multi-line message titles by its opening line", () => {
    expect(firstLineOfText("  Fix the sidebar  \nthen the tests")).toBe("Fix the sidebar");
  });
});
