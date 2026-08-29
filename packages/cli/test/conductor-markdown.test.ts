import { describe, expect, it } from "vitest";
import { layoutMarkdown, paintInline, renderMarkdown } from "../src/conductor/markdown";
import { stripAnsi } from "../src/conductor/theme";

describe("renderMarkdown", () => {
  it("keeps headings, lists, and code spans as separate lines", () => {
    const lines = renderMarkdown(
      [
        "## Which export?",
        "",
        "Use `proveFn` or **askProve**.",
        "",
        "- first choice",
        "- second choice",
      ].join("\n"),
      40,
    );
    const plain = lines.map(stripAnsi);
    expect(plain[0]).toBe("Which export?");
    expect(plain.some((line) => line.includes("proveFn"))).toBe(true);
    expect(plain).toContain("• first choice");
    expect(plain).toContain("• second choice");
    expect(lines.join("\n")).toContain("\x1b[");
  });

  it("does not collapse a multi-paragraph question into one wrap", () => {
    const lines = renderMarkdown("First paragraph.\n\nSecond paragraph.", 40);
    expect(lines.map(stripAnsi)).toEqual(["First paragraph.", "", "Second paragraph."]);
  });

  it("lays out the same blocks without ANSI", () => {
    const lines = layoutMarkdown("## Title\n\n- one\n- two", 40);
    expect(lines).toEqual(["Title", "", "• one", "• two"]);
    expect(lines.join("\n")).not.toContain("\x1b[");
  });

  it("paints inline code and links", () => {
    expect(stripAnsi(paintInline("use `foo`"))).toBe("use foo");
    expect(paintInline("use `foo`")).toContain("\x1b[");
    expect(paintInline("[docs](https://example.com)")).toContain("\x1b]8;;https://example.com");
    expect(stripAnsi(paintInline("[docs](https://example.com)"))).toBe("docs");
  });
});
