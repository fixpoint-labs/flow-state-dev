/**
 * Tests for the helpers that name a tool call from its name and args.
 */

import { describe, it, expect } from "vitest";
import { toolIntent, toolSubject } from "../registry/components/tool-naming";

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

  it("keeps the file's own name when a long folder (a run's worktree) is on its path", () => {
    const hash = `tasks--h${"5".repeat(64)}`;
    expect(toolSubject("edit", { path: `/tmp/r/t0/${hash}/README.md` })?.text).toBe("Edit …/README.md");
    expect(toolSubject("edit", { path: `/tmp/r/${hash}/src/components/Conversation.tsx` })?.text).toBe("Edit …/src/components/Conversation.tsx");
  });

  it("names a Codex file change by the files it touched", () => {
    expect(toolSubject("file_change", { changes: [{ path: "/w/src/components/Conversation.tsx", kind: "update" }] })?.text).toBe("Edit …/src/components/Conversation.tsx");
    expect(toolSubject("file_change", { changes: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }] })?.text).toBe("Edit a.ts and 2 more");
    expect(toolSubject("file_change", { changes: [] })).toBeUndefined();
  });
});
