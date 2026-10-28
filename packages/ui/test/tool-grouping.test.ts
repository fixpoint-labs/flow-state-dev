/**
 * Tests for the tool-call label composition helper. The consecutive-group
 * walk itself lives in @flow-state-dev/react's ItemsRenderer (covered by
 * that package's tests) so the filters run before grouping.
 */

import { describe, it, expect } from "vitest";
import {
  composeToolCallsLabel,
  composeToolGroupLabel,
  TOOL_GROUP_DISTINCT_CAP,
  TOOL_GROUP_INTENT_CAP,
} from "../registry/components/tool-grouping";

describe("composeToolGroupLabel", () => {
  it("returns an empty string for no calls", () => {
    expect(composeToolGroupLabel([])).toBe("");
  });

  it("uses the singular phrase for a single mapped call", () => {
    expect(composeToolGroupLabel(["web_search"])).toBe("Ran a search");
  });

  it("uses the plural phrase for multiple calls of one tool", () => {
    expect(composeToolGroupLabel(["web_search", "web_search", "web_search"])).toBe(
      "Ran 3 searches"
    );
  });

  it("merges tools that share a singular phrase", () => {
    // web_search and search both → "ran a search"
    expect(composeToolGroupLabel(["web_search", "search"])).toBe("Ran 2 searches");
  });

  it("composes two distinct clauses with 'and' and no Oxford comma", () => {
    expect(composeToolGroupLabel(["write_file", "web_search", "web_search"])).toBe(
      "Wrote a file and ran 2 searches"
    );
  });

  it("composes three distinct clauses with Oxford comma", () => {
    expect(
      composeToolGroupLabel(["write_file", "web_search", "web_search", "fetch"])
    ).toBe("Wrote a file, ran 2 searches, and fetched a page");
  });

  it("collapses to 'Ran N tools' above the distinct-clause cap", () => {
    const names = [
      "web_search",
      "write_file",
      "fetch",
      "bash",
      "read_file", // 5 distinct clauses > cap of 4
    ];
    expect(names.length).toBeGreaterThan(TOOL_GROUP_DISTINCT_CAP);
    expect(composeToolGroupLabel(names)).toBe(`Ran ${names.length} tools`);
  });

  it("falls back to a generic phrase for unknown tool names", () => {
    expect(composeToolGroupLabel(["my_custom_tool"])).toBe("Ran `my_custom_tool`");
  });

  it("pluralises unknown tools using the generic phrase", () => {
    expect(composeToolGroupLabel(["my_custom_tool", "my_custom_tool"])).toBe(
      "Ran `my_custom_tool` 2 times"
    );
  });

  it("capitalises only the first word", () => {
    const label = composeToolGroupLabel(["web_search", "write_file"]);
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
    expect(label).toBe("Ran a search and wrote a file");
  });
});

describe("composeToolCallsLabel", () => {
  it("is the name-based label when no call stated an intent", () => {
    const calls = [{ name: "web_search" }, { name: "write_file" }];
    expect(composeToolCallsLabel(calls)).toBe("Ran a search and wrote a file");
    expect(composeToolCallsLabel([{ name: "Bash" }, { name: "Bash" }])).toBe("Ran `Bash` 2 times");
  });

  it("labels a run with what each call said it was doing", () => {
    expect(
      composeToolCallsLabel([
        { name: "Bash", intent: "List files" },
        { name: "Bash", intent: "Run tests" },
      ])
    ).toBe("List files · Run tests");
  });

  it("folds consecutive calls without an intent into one name-based phrase", () => {
    expect(
      composeToolCallsLabel([
        { name: "Bash", intent: "List files" },
        { name: "web_search" },
        { name: "web_search" },
        { name: "Bash", intent: "Run tests" },
      ])
    ).toBe("List files · Ran 2 searches · Run tests");
  });

  it("counts the phrases past the cap instead of listing them", () => {
    const calls = Array.from({ length: 10 }, (_, i) => ({ name: "Bash", intent: `Step ${i + 1}` }));
    expect(composeToolCallsLabel(calls)).toBe(
      `Step 1 · Step 2 · Step 3 · +${10 - TOOL_GROUP_INTENT_CAP} more`
    );
  });
});
