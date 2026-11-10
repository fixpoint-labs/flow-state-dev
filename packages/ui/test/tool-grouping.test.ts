/**
 * Tests for the tool-call label composition helper. The consecutive-group
 * walk itself lives in @flow-state-dev/react's ItemsRenderer (covered by
 * that package's tests) so the filters run before grouping.
 */

import { describe, it, expect } from "vitest";
import {
  composeToolCallsLabel,
  composeToolGroupLabel,
  knownToolVerbs,
  TOOL_GROUP_DISTINCT_CAP,
  TOOL_VERB_MAP,
  TOOL_GROUP_INTENT_CAP,
  toolRunOpen,
  toolRunState,
  toolStepState,
  withToolState,
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

  it("reads each coding harness's tools the same: a command is a command on Claude Code, Codex and Cursor", () => {
    expect(composeToolGroupLabel(["Bash", "command_execution", "shell"])).toBe("Ran 3 commands");
    expect(composeToolGroupLabel(["Edit", "edit", "MultiEdit"])).toBe("Edited 3 files");
    expect(composeToolGroupLabel(["Read", "read"])).toBe("Read 2 files");
    expect(composeToolGroupLabel(["Grep", "grep"])).toBe("Searched the code 2 times");
    expect(composeToolGroupLabel(["Edit", "file_change", "edit"])).toBe("Edited 3 files");
  });

  it("capitalises only the first word", () => {
    const label = composeToolGroupLabel(["web_search", "write_file"]);
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
    expect(label).toBe("Ran a search and wrote a file");
  });
});

describe("knownToolVerbs", () => {
  it("finds a tool's entry by its exact name or in lower case, as the group labels do", () => {
    expect(knownToolVerbs("readProjectSource")?.present).toBe("reading a file");
    expect(knownToolVerbs("Bash")?.present).toBe("running a command");
    expect(knownToolVerbs("Bash")).toBe(TOOL_VERB_MAP.bash);
  });

  it("knows nothing of a tool outside the map, so a caller never repeats its name", () => {
    expect(knownToolVerbs("private-token")).toBeUndefined();
  });

  it("gives every entry a phrase for a call under way", () => {
    for (const [tool, verbs] of Object.entries(TOOL_VERB_MAP)) {
      expect(verbs.present, tool).toMatch(/^[a-z]+ing\b/);
    }
  });
});

describe("composeToolCallsLabel", () => {
  it("is the name-based label when no call stated an intent", () => {
    const calls = [{ name: "web_search" }, { name: "write_file" }];
    expect(composeToolCallsLabel(calls)).toBe("Ran a search and wrote a file");
    expect(composeToolCallsLabel([{ name: "Bash" }, { name: "Bash" }])).toBe("Ran 2 commands");
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

describe("workforce and task tools in a run", () => {
  // A project read is a read: it merges with any other read of a file.
  it("reads a run of project reads and a search as files read and code searched", () => {
    expect(composeToolGroupLabel([...Array(5).fill("readProjectSource"), "read_file", "grepProjectSource"])).toBe(
      "Read 6 files and searched the code"
    );
  });

  it("names the task tools by what they did, a board-qualified one as its base", () => {
    expect(composeToolGroupLabel(["createTask_tasks", "createTask", "getTask"])).toBe("Started 2 tasks and checked on a task");
    expect(composeToolGroupLabel(["sendMessage", "reportProgress"])).toBe("Sent a message and noted progress");
  });
});

describe("a run's state", () => {
  it("reads a done call whose result was refused as failed, and a thrown one too", () => {
    expect(toolStepState("done", "readProjectSource", { kind: "refused", reason: "not-a-member", message: "m" })).toBe("error");
    expect(toolStepState("done", "readProjectSource", { kind: "read", path: "a", status: "missing" })).toBe("error");
    expect(toolStepState("failed", "Bash")).toBe("error");
    expect(toolStepState("done", "grepProjectSource", { kind: "grep", matches: [], cut: null })).toBe("completed");
    // Running and waiting are the call's status; no result is read yet.
    expect(toolStepState("running", "createTask", { ok: false, error: "x" })).toBe("running");
    expect(toolStepState("waiting", "suspendForUser")).toBe("waiting");
  });

  it("is failed over waiting over running over done", () => {
    expect(toolRunState(["completed", "running", "error"])).toBe("error");
    expect(toolRunState(["running", "waiting"])).toBe("waiting");
    expect(toolRunState(["completed", "running"])).toBe("running");
    expect(toolRunState(["completed"])).toBe("completed");
  });

  it("says the state in words, counting failures in a run", () => {
    expect(withToolState("Reading a.ts", "running")).toBe("Reading a.ts…");
    expect(withToolState("Read a.ts", "error")).toBe("Read a.ts (failed)");
    expect(withToolState("Read 6 files", "error", 1, 6)).toBe("Read 6 files (1 failed)");
    expect(withToolState("Ask for your answer", "waiting")).toBe("Ask for your answer (waiting)");
    expect(withToolState("Read a.ts", "completed")).toBe("Read a.ts");
  });

  // Steps show while a turn works and fold away once it is over, whatever the outcome.
  it("is open only while running", () => {
    expect(toolRunOpen("running")).toBe(true);
    for (const state of ["completed", "error", "waiting"] as const) expect(toolRunOpen(state)).toBe(false);
  });
});
