import { describe, expect, it } from "vitest";
import { firstLineOfText, FALLBACK_TITLE_CHARS, NEW_SESSION_TITLE, sessionTitle } from "../src/lib/session-title";

// The sessions list shows the title the session's generator wrote. The first message is the
// fallback, and only for a session whose turn has ended with no generated title: a turn still
// running must not show the raw message, since the generator has not had its chance yet.
describe("sessionTitle", () => {
  it("shows the generated title once it has landed, even while a later turn runs", () => {
    expect(sessionTitle({ title: "Plan the billing migration", firstLine: "hi", running: true })).toBe("Plan the billing migration");
    expect(sessionTitle({ title: "Plan the billing migration", firstLine: "hi", running: false })).toBe("Plan the billing migration");
  });

  it("does not show the raw first message while the first turn runs and no title has landed", () => {
    expect(sessionTitle({ title: undefined, firstLine: "Can you check the login flow?", running: true })).toBe(NEW_SESSION_TITLE);
  });

  it("falls back to the first message only once a turn has ended with no generated title", () => {
    expect(sessionTitle({ title: undefined, firstLine: "Can you check the login flow?", running: false })).toBe("Can you check the login flow?");
  });

  it("treats a blank generated title as none, not as a title", () => {
    expect(sessionTitle({ title: "   ", firstLine: undefined, running: false })).toBe(NEW_SESSION_TITLE);
    expect(sessionTitle({ title: "  ", firstLine: "Check the build", running: false })).toBe("Check the build");
  });

  it("is New session for a session with no message and no title", () => {
    expect(sessionTitle({ title: undefined, firstLine: undefined, running: false })).toBe(NEW_SESSION_TITLE);
  });

  it("cuts a fallback title to the list's width", () => {
    const long = "x".repeat(FALLBACK_TITLE_CHARS + 20);
    expect(sessionTitle({ title: undefined, firstLine: long, running: false })).toHaveLength(FALLBACK_TITLE_CHARS);
  });
});

describe("firstLineOfText", () => {
  it("takes the first line, trimmed, so a multi-line message titles by its opening line", () => {
    expect(firstLineOfText("  Fix the sidebar  \nthen the tests")).toBe("Fix the sidebar");
  });
});
