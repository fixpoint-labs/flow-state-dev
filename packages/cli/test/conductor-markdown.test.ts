import { describe, expect, it } from "vitest";
import { askHintLine, layoutMarkdown, paintInline, renderMarkdown } from "../src/conductor/markdown";
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

  it("keeps numbered list markers so a reply of 1 or 2 still matches the question", () => {
    const lines = layoutMarkdown("1. proveFn\n2. askProve", 40);
    expect(lines).toEqual(["1. proveFn", "2. askProve"]);
    expect(lines.join("\n")).not.toContain("•");
  });

  it("flattens a table's first row for the board ASK hint", () => {
    expect(askHintLine("| export | meaning |\n| --- | --- |\n| proveFn | the function |")).toBe(
      "export  meaning",
    );
    expect(askHintLine("## Which export?\n\n1. proveFn")).toBe("Which export?");
  });

  it("lays out a markdown table as columns, not a pipe paragraph", () => {
    const lines = layoutMarkdown(
      ["| export | meaning |", "| --- | --- |", "| proveFn | the function |", "| askProve | the other |"].join(
        "\n",
      ),
      40,
    );
    expect(lines[0]).toMatch(/export\s+meaning/);
    expect(lines.some((line) => /proveFn\s+the function/.test(line))).toBe(true);
    expect(lines.join("\n")).not.toContain("|");
    expect(lines.join("\n")).not.toContain("---");
  });
});
