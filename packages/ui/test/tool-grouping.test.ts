/**
 * Tests for the tool-call label composition helper. The consecutive-group
 * walk itself lives in @flow-state-dev/react's ItemsRenderer (covered by
 * that package's tests) so the filters run before grouping.
 */

import { describe, it, expect } from "vitest";
import {
  composeToolCallsLabel,
  composeToolGroupLabel,
  toolIntent,
  toolSubject,
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

describe("toolIntent", () => {
  it("reads Bash's description as the call's intent", () => {
    expect(toolIntent("Bash", { command: "ls src", description: "List files in src" })).toBe(
      "List files in src"
    );
  });

  it("has no intent when the description is missing or blank", () => {
    expect(toolIntent("Bash", { command: "ls" })).toBeUndefined();
    expect(toolIntent("Bash", { command: "ls", description: "   " })).toBeUndefined();
  });

  it("reads the description of any shell tool, whatever it is named", () => {
    expect(toolIntent("shell", { command: "ls", description: "List files" })).toBe("List files");
    expect(toolIntent("command_execution", { command: "ls", description: "List files" })).toBe("List files");
  });

  // A `description` on an arbitrary tool can be a payload (an issue body),
  // so only tools known to state intent there are read.
  it("ignores a description argument on a tool that does not state intent", () => {
    expect(toolIntent("create_issue", { description: "## Problem\n..." })).toBeUndefined();
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

describe("toolSubject", () => {
  it("names a shell call by the first line of its command, in code", () => {
    expect(toolSubject("shell", { command: "git log --oneline\ngit diff" })).toEqual({ text: "git log --oneline", code: true });
    expect(toolSubject("command_execution", { command: ["ls", "-la"] })).toEqual({ text: "ls -la", code: true });
  });

  it("skips a leading cd so the command that does the work is what shows", () => {
    expect(toolSubject("shell", { command: "cd /a/b/c && git diff --stat" })).toEqual({ text: "git diff --stat", code: true });
    expect(toolSubject("shell", { command: 'cd "/a b" ; cd src && pnpm test' })).toEqual({ text: "pnpm test", code: true });
    expect(toolSubject("shell", { command: "cd /a/b\ngit log -3" })).toEqual({ text: "git log -3", code: true });
  });

  it("keeps a command that is only a cd", () => {
    expect(toolSubject("shell", { command: "cd /a/b" })).toEqual({ text: "cd /a/b", code: true });
  });

  it("names a file or search call by verb and target, shortening deep paths", () => {
    expect(toolSubject("read", { path: "src/a.ts" })).toEqual({ text: "Read src/a.ts", code: false });
    expect(toolSubject("Read", { file_path: "/a/b/c/d/e.ts" })).toEqual({ text: "Read …/c/d/e.ts", code: false });
    expect(toolSubject("grep", { pattern: "foo" })).toEqual({ text: 'Grep "foo"', code: false });
  });

  it("title-cases a tool it was never told about, dropping web_ and _file", () => {
    expect(toolSubject("fetch_page", { url: "https://a.dev" })).toEqual({ text: "Fetch Page https://a.dev", code: false });
    expect(toolSubject("web_fetch", { url: "https://a.dev" })).toEqual({ text: "Fetch https://a.dev", code: false });
    expect(toolSubject("create_file", { path: "a.ts" })).toEqual({ text: "Create a.ts", code: false });
    expect(toolSubject("web_search", { query: "x" })).toEqual({ text: 'Search "x"', code: false });
  });

  it("maps only ls and multiedit to a different verb", () => {
    expect(toolSubject("ls", { path: "src" })).toEqual({ text: "List src", code: false });
    expect(toolSubject("MultiEdit", { file_path: "a.ts" })).toEqual({ text: "Edit a.ts", code: false });
  });

  it("names an MCP tool by its server and tool, whatever args it carries", () => {
    const named = { text: "Calling MCP tool Linear Get Issue", code: false };
    expect(toolSubject("mcp__linear__get_issue", { query: "FIX-1" })).toEqual(named);
    expect(toolSubject("mcp__linear__get_issue", { id: "FIX-1" })).toEqual(named);
    expect(toolSubject("mcp__linear__get_issue", {})).toEqual(named);
  });

  it("prefers the search term over the directory a search ran in", () => {
    expect(toolSubject("Grep", { pattern: "foo", path: "src" })).toEqual({ text: 'Grep "foo"', code: false });
  });

  it("says nothing for a tool with no recognisable arg", () => {
    expect(toolSubject("custom", { command: "x" })).toBeUndefined();
    expect(toolSubject("read", {})).toBeUndefined();
    expect(toolSubject("shell", null)).toBeUndefined();
  });

  it("clips a long command to one line", () => {
    const out = toolSubject("shell", { command: "x".repeat(200) });
    expect(out?.text.length).toBe(80);
    expect(out?.text.endsWith("…")).toBe(true);
  });
});
