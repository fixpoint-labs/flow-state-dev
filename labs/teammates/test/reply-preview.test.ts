import { describe, expect, it } from "vitest";
import { isLongReply, LONG_REPLY_CHARS, LONG_REPLY_LINES, replyPreview } from "../src/lib/reply-preview";

describe("reply excerpts", () => {
  it("makes a bounded excerpt from prose instead of raw headings, pipes and link markup", () => {
    const preview = replyPreview("# Findings\n\nSearch is **ready** via [Parallel](https://example.com).\n\n| key | value |\n| --- | --- |\n" + "Evidence from the source. ".repeat(40));
    expect(preview).toMatch(/^Search is ready via Parallel\./);
    expect(preview.length).toBeLessThanOrEqual(361);
    expect(preview).not.toMatch(/\||\*\*|https:/);
    expect(replyPreview("```ts\nconst value = 1;\n```")).toBe("const value = 1;");
    expect(replyPreview("# Ready to ship")).toBe("Ready to ship");
    expect(replyPreview("Updated `my_file.ts` with **passing** checks.")).toBe("Updated my_file.ts with passing checks.");
    expect(replyPreview("~~~sh\ngit status --short\n~~~")).toBe("git status --short");
    expect(replyPreview("One\nTwo\nThree\nFour")).toBe("One Two Three…");
    expect(replyPreview("")).toBe("");
  });

  it("keeps an unclosed fence's code as the excerpt while it is still streaming", () => {
    expect(replyPreview("```ts\nconst value = 1;")).toBe("const value = 1;");
  });

  it("calls a reply long past either line, characters or lines", () => {
    expect(isLongReply("a".repeat(LONG_REPLY_CHARS))).toBe(false);
    expect(isLongReply("a".repeat(LONG_REPLY_CHARS + 1))).toBe(true);
    expect(isLongReply(Array.from({ length: LONG_REPLY_LINES }, () => "x").join("\n"))).toBe(false);
    expect(isLongReply(Array.from({ length: LONG_REPLY_LINES + 1 }, () => "x").join("\n"))).toBe(true);
  });
});
