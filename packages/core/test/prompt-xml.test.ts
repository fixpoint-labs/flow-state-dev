import { describe, expect, it } from "vitest";
import { renderTaggedContext, xmlTag } from "../src/prompt";

describe("xmlTag", () => {
  it("wraps content in a named tag", () => {
    expect(xmlTag("documents", "doc body")).toBe(
      "<documents>\n  doc body\n</documents>"
    );
  });

  it("returns empty string for null/undefined content", () => {
    expect(xmlTag("documents", null)).toBe("");
    expect(xmlTag("documents", undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(xmlTag("documents", "")).toBe("");
  });

  it("joins array content with newlines and filters empties", () => {
    expect(xmlTag("documents", ["a", "", "b"])).toBe(
      "<documents>\n  a\n  b\n</documents>"
    );
  });

  it("returns empty string for an array of empty strings", () => {
    expect(xmlTag("documents", ["", ""])).toBe("");
  });
});

describe("renderTaggedContext", () => {
  it("renders a single tag with string-leaf content", () => {
    expect(
      renderTaggedContext({ documents: ["doc body"] }, ["documents"])
    ).toBe("<documents>\n  doc body\n</documents>");
  });

  it("renders multiple tags in declared order", () => {
    expect(
      renderTaggedContext(
        { documents: ["a"], memory: ["b"] },
        ["documents", "memory"]
      )
    ).toBe(
      "<documents>\n  a\n</documents>\n<memory>\n  b\n</memory>"
    );
  });

  it("appends keys not in the order array using Object.keys order", () => {
    expect(
      renderTaggedContext(
        { documents: ["a"], memory: ["b"], extra: ["c"] },
        ["documents"]
      )
    ).toBe(
      "<documents>\n  a\n</documents>\n<memory>\n  b\n</memory>\n<extra>\n  c\n</extra>"
    );
  });

  it("omits keys with empty array content", () => {
    expect(
      renderTaggedContext(
        { documents: [], memory: ["b"] },
        ["documents", "memory"]
      )
    ).toBe("<memory>\n  b\n</memory>");
  });

  it("renders nested tags", () => {
    expect(
      renderTaggedContext(
        { memory: { "short-term": ["a"], "long-term": ["b"] } },
        ["memory"]
      )
    ).toBe(
      "<memory>\n  <short-term>\n    a\n  </short-term>\n  <long-term>\n    b\n  </long-term>\n</memory>"
    );
  });

  it("escapes <, >, & in string leaves by default", () => {
    expect(
      renderTaggedContext({ documents: ["a < b & c > d"] }, ["documents"])
    ).toBe("<documents>\n  a &lt; b &amp; c &gt; d\n</documents>");
  });

  it("does not escape when escape: false", () => {
    expect(
      renderTaggedContext(
        { documents: ["<b>hi</b>"] },
        ["documents"],
        { escape: false }
      )
    ).toBe("<documents>\n  <b>hi</b>\n</documents>");
  });

  it("supports compact emission with indent: ''", () => {
    expect(
      renderTaggedContext(
        { documents: ["body"] },
        ["documents"],
        { indent: "" }
      )
    ).toBe("<documents>body</documents>");
  });

  it("returns empty string when accumulator has no contributions", () => {
    expect(renderTaggedContext({}, [])).toBe("");
  });

  it("joins multiple values inside a tag with newlines", () => {
    expect(
      renderTaggedContext({ documents: ["a", "b", "c"] }, ["documents"])
    ).toBe("<documents>\n  a\n  b\n  c\n</documents>");
  });

  it("omits nested tags whose content is empty", () => {
    expect(
      renderTaggedContext(
        { memory: { "short-term": [], "long-term": ["b"] } },
        ["memory"]
      )
    ).toBe(
      "<memory>\n  <long-term>\n    b\n  </long-term>\n</memory>"
    );
  });
});
