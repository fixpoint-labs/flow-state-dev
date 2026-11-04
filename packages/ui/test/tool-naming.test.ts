/**
 * Tests for the helpers that name a tool call from its name and args.
 */

import { describe, it, expect } from "vitest";
import { toolBaseName, toolIntent, toolOutcome, toolSubject } from "../registry/components/tool-naming";

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

// A person watching a worker should see what each step acted on: six project
// reads must not read as six "Read a project file" lines, and no tool should
// read as its raw name.
describe("toolSubject for workforce and task tools", () => {
  const line = (name: string, args: unknown, output?: unknown) => toolSubject(name, args, output)?.text;

  it("names a project read by its path, and the lines it asked for", () => {
    expect(line("readProjectSource", { path: "src/billing/ledger.ts" })).toBe("Read src/billing/ledger.ts");
    expect(line("readProjectSource", { path: "a.ts", startLine: 3, endLine: 9 })).toBe("Read a.ts, lines 3-9");
    expect(line("readProjectSource", { path: "a.ts", startLine: 4, endLine: 4 })).toBe("Read a.ts, line 4");
    expect(line("readProjectSource", { path: "a.ts", startLine: 4, endLine: null })).toBe("Read a.ts, from line 4");
  });

  it("names a search by its pattern, and its match count once it has a result", () => {
    expect(line("grepProjectSource", { pattern: "LEDGER" })).toBe('Search "LEDGER"');
    expect(line("grepProjectSource", { pattern: "LEDGER", prefix: "src" })).toBe('Search "LEDGER" in src');
    const grep = (n: number, cut: unknown = null) => ({ kind: "grep", matches: Array.from({ length: n }, () => ({})), cut });
    expect(line("grepProjectSource", { pattern: "x" }, grep(0))).toBe('Search "x" · no matches');
    expect(line("grepProjectSource", { pattern: "x" }, grep(1))).toBe('Search "x" · 1 match');
    expect(line("grepProjectSource", { pattern: "x" }, grep(10))).toBe('Search "x" · 10 matches');
    expect(line("grepProjectSource", { pattern: "x" }, grep(50, { left: 3, by: "matches" }))).toBe('Search "x" · 50+ matches');
    // A refused search has no count to give.
    expect(line("grepProjectSource", { pattern: "x" }, { kind: "refused", reason: "no-project", message: "m" })).toBe('Search "x"');
  });

  it("names a listing by its pattern, else the project's files, and its count", () => {
    expect(line("globProjectSource", { pattern: "src/**" }, { kind: "glob", paths: ["a", "b"], cut: null })).toBe("List src/** · 2 files");
    expect(line("globProjectSource", { pattern: null })).toBe("List the project's files");
    expect(line("globProjectSource", {}, { kind: "glob", paths: [], cut: null })).toBe("List the project's files · no files");
  });

  it("names a task by its title, else its goal, never its id", () => {
    expect(line("createTask", { title: "Fix the login copy", goal: "The login page says..." })).toBe("Start a task: Fix the login copy");
    expect(line("createTask", { goal: "Fix the login copy" })).toBe("Start a task: Fix the login copy");
    expect(line("getTask", { id: "task_9f2" })).toBe("Check on a task");
    expect(line("getTask", { id: "task_9f2" }, { ok: true, task: { id: "task_9f2", goal: "g", title: "Fix the login copy" } })).toBe(
      'Check on "Fix the login copy"'
    );
  });

  // Two boards sharing a block qualify its tools by board (orchestration's `taskToolSuffix`).
  it("reads a board-qualified task tool as its base, and leaves other underscored names alone", () => {
    expect(line("createTask_tasks", { title: "Fix the login copy", goal: "g" })).toBe("Start a task: Fix the login copy");
    expect(line("updateTask_eng_feature_work", { id: "t" })).toBe("Update a task");
    expect(toolBaseName("createTask_tasks")).toBe("createTask");
    expect(toolBaseName("read_file")).toBe("read_file");
    expect(toolBaseName("constructor_x")).toBe("constructor_x");
  });

  it("says who a message went to, and what the other tools did, in plain words", () => {
    expect(line("sendMessage", { to: "eng.taker", text: "hi" })).toBe("Message eng.taker");
    expect(line("sendMessage", { to: { task: "task_1" }, text: "hi" })).toBe("Message the worker on a task");
    expect(line("sendMessage", { to: { session: "s_1" }, text: "hi" })).toBe("Message a conversation");
    expect(line("reportProgress", { statusNote: "Drafted the copy" })).toBe("Note progress: Drafted the copy");
    expect(line("reportProgress", { output: {} })).toBe("Note progress");
    expect(line("suspendForUser", { kind: "review", prompt: "p", title: "The new copy" })).toBe("Ask for your review: The new copy");
    expect(line("suspendForUser", { kind: "approval", prompt: "p" })).toBe("Ask for your approval");
    expect(line("holdTaskForUser", { question: "Which region?" })).toBe("Ask you a question");
    expect(line("updateTask", { id: "t" })).toBe("Update a task");
    expect(line("listTasks", {})).toBe("Look over the tasks");
    expect(line("consultSessionHistory", { session: "s", question: "q" })).toBe("Read a conversation");
  });

  it("gives every one of the twelve tools words, even before its args arrive", () => {
    const twelve = [
      "readProjectSource", "grepProjectSource", "globProjectSource", "createTask", "getTask", "updateTask",
      "listTasks", "holdTaskForUser", "suspendForUser", "sendMessage", "reportProgress", "consultSessionHistory",
    ];
    for (const name of twelve) {
      const text = line(name, undefined);
      expect(text, name).toBeDefined();
      expect(text, name).not.toContain(name);
    }
  });
});

describe("toolOutcome", () => {
  it("is failed for each shape a tool refuses in", () => {
    expect(toolOutcome("createTask", { ok: false, error: "nope" })).toBe("failed");
    expect(toolOutcome("grepProjectSource", { kind: "refused", reason: "not-a-member", message: "m" })).toBe("failed");
    // A send that waited on a reply its message never got to give.
    expect(toolOutcome("sendMessage", { status: "failed", sent: "msg_1", error: "undeliverable" })).toBe("failed");
    expect(toolOutcome("readProjectSource", { kind: "read", path: "a.ts", status: "missing" })).toBe("failed");
    expect(toolOutcome("readProjectSource", { kind: "read", path: "a", status: "directory" })).toBe("failed");
  });

  it("is ok for a result that worked, including a search that found nothing", () => {
    expect(toolOutcome("readProjectSource", { kind: "read", path: "a.ts", status: "ok" })).toBe("ok");
    expect(toolOutcome("grepProjectSource", { kind: "grep", matches: [], cut: null })).toBe("ok");
    expect(toolOutcome("createTask", { ok: true, taskId: "t" })).toBe("ok");
    expect(toolOutcome("custom", "done")).toBe("ok");
    expect(toolOutcome("custom", undefined)).toBe("ok");
  });

  // A top-level status is the call's only in the waited send's shape; otherwise it is a task's.
  it("does not read a task's status as the call's", () => {
    expect(toolOutcome("createTask", { ok: true, taskId: "t", status: "held" })).toBe("ok");
    expect(toolOutcome("getTask", { ok: true, task: { id: "t", status: "failed" } })).toBe("ok");
    expect(toolOutcome("custom", { status: "failed" })).toBe("ok");
    // A read's status counts only on the read tool.
    expect(toolOutcome("custom", { kind: "read", status: "missing" })).toBe("ok");
  });
});
