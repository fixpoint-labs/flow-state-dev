import { describe, expect, it } from "vitest";
import { forwardConductorArgv } from "../src/commands/conductor";
import {
  HELP_TEXT,
  parseArgv,
  parseCommand,
  slashArgPrefix,
  slashMatches,
} from "../src/conductor/parse";

describe("parseCommand", () => {
  it("parses slash and bare verbs as the same command", () => {
    expect(parseCommand("/seed FIX-1")).toEqual({
      ok: true,
      command: { kind: "seed", issue: "FIX-1" },
    });
    expect(parseCommand("seed FIX-1 --phase review")).toEqual({
      ok: true,
      command: { kind: "seed", issue: "FIX-1", phase: "review" },
    });
    expect(parseCommand("seed FIX-1 Rename getSession in the docs")).toEqual({
      ok: true,
      command: {
        kind: "seed",
        issue: "FIX-1",
        brief: "Rename getSession in the docs",
      },
    });
    expect(parseCommand("seed FIX-1 --phase implement Rename getSession")).toEqual({
      ok: true,
      command: {
        kind: "seed",
        issue: "FIX-1",
        phase: "implement",
        brief: "Rename getSession",
      },
    });
    expect(parseCommand("seed FIX-1 -- --phase is the ticket")).toEqual({
      ok: true,
      command: { kind: "seed", issue: "FIX-1", brief: "--phase is the ticket" },
    });
  });

  it("keeps the answer text intact, including quotes and apostrophes", () => {
    expect(parseCommand('/answer Q1 "leave the symlink"')).toEqual({
      ok: true,
      command: { kind: "answer", question: "Q1", text: "leave the symlink" },
    });
    expect(parseCommand("/answer Q1 don't change the path")).toEqual({
      ok: true,
      command: { kind: "answer", question: "Q1", text: "don't change the path" },
    });
    expect(parseCommand("/answer Q1 -- --json")).toEqual({
      ok: true,
      command: { kind: "answer", question: "Q1", text: "--json" },
    });
  });

  it("refuses a verb that is missing its required argument", () => {
    expect(parseCommand("seed")).toMatchObject({ ok: false });
    expect(parseCommand("answer Q1")).toMatchObject({ ok: false });
    expect(parseCommand("/nope")).toMatchObject({ ok: false, message: "unknown command: nope" });
  });

  it("treats an unslashed line that is not a verb as talk", () => {
    expect(parseCommand("retry the failed rows")).toEqual({
      ok: true,
      command: { kind: "steer", message: "retry the failed rows" },
    });
    expect(parseCommand("/steer start FIX-1")).toEqual({
      ok: true,
      command: { kind: "steer", message: "start FIX-1" },
    });
    expect(parseArgv(["retry", "the", "failed", "rows"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "steer", message: "retry the failed rows" },
    });
  });

  it("parses /find with and without a query", () => {
    expect(parseCommand("/find")).toEqual({ ok: true, command: { kind: "find" } });
    expect(parseCommand("/find src/foo.ts")).toEqual({
      ok: true,
      command: { kind: "find", query: "src/foo.ts" },
    });
    expect(parseCommand("find tool Write")).toEqual({
      ok: true,
      command: { kind: "find", query: "tool Write" },
    });
  });
});

describe("parseArgv", () => {
  it("opens the TUI when there is no verb", () => {
    expect(parseArgv([]).invocation).toEqual({ mode: "tui" });
    expect(parseArgv(["tui", "FIX-1"]).invocation).toEqual({ mode: "tui", issue: "FIX-1" });
    expect(parseArgv(["find"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "find" },
    });
  });

  it("treats a verb as headless, and --json as a flag not a word", () => {
    const parsed = parseArgv(["status", "FIX-1", "--json"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.invocation).toEqual({
      mode: "headless",
      json: true,
      command: { kind: "status", issue: "FIX-1" },
    });
  });

  it("treats abort and stop as the same verb", () => {
    expect(parseCommand("abort LIVE-1")).toEqual({
      ok: true,
      command: { kind: "abort", issue: "LIVE-1" },
    });
    expect(parseCommand("/stop")).toEqual({
      ok: true,
      command: { kind: "abort" },
    });
    expect(parseArgv(["abort", "LIVE-1"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "abort", issue: "LIVE-1" },
    });
  });

  it("keeps an apostrophe and a literal --json in a tokenized answer", () => {
    expect(parseArgv(["answer", "Q1", "don't change the path"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "answer", question: "Q1", text: "don't change the path" },
    });
    expect(parseArgv(["answer", "Q1", "--", "--json"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "answer", question: "Q1", text: "--json" },
    });
    expect(parseArgv(["answer", "Q1", "keep --json"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "answer", question: "Q1", text: "keep --json" },
    });
  });

  it("puts Commander-owned --phase back on the line seed reads", () => {
    const parsed = parseArgv(forwardConductorArgv(["seed", "FIX-1"], { phase: "review" }));
    expect(parsed.invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "seed", issue: "FIX-1", phase: "review" },
    });
  });

  it("takes words after the issue id as the seed brief", () => {
    expect(parseArgv(["seed", "FIX-1", "Rename", "getSession"]).invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "seed", issue: "FIX-1", brief: "Rename getSession" },
    });
    expect(
      parseArgv(
        forwardConductorArgv(["seed", "FIX-1", "Rename", "getSession"], { phase: "review" }),
      ).invocation,
    ).toEqual({
      mode: "headless",
      json: false,
      command: {
        kind: "seed",
        issue: "FIX-1",
        phase: "review",
        brief: "Rename getSession",
      },
    });
  });
});

describe("HELP_TEXT", () => {
  it("names --phase with the other flags", () => {
    expect(HELP_TEXT).toMatch(/--phase <name>/);
    expect(HELP_TEXT).toContain("FAIL band");
    expect(HELP_TEXT).toContain("that attempt's files");
    expect(HELP_TEXT).toContain("request stream");
    expect(HELP_TEXT).toContain("fsdev conductor abort");
    expect(HELP_TEXT).toContain("x or Ctrl-C stops it");
    expect(HELP_TEXT).toContain("Ctrl-T expands the todo list");
    expect(HELP_TEXT).toContain("Letters talk");
    expect(HELP_TEXT).toContain("Enter queues it");
    expect(HELP_TEXT).toContain("/find [text]");
    expect(HELP_TEXT).toContain("older / newer match");
    expect(HELP_TEXT).toContain("complete the selected slash verb or board id");
    expect(HELP_TEXT).toContain("named issue also prints last tool, files, hunk, todo");
    expect(HELP_TEXT).toContain("--json adds now/files/hunk/todo");
    expect(HELP_TEXT).toContain("compact think · line");
    expect(HELP_TEXT).toContain("fsdev conductor steer");
    expect(HELP_TEXT).toContain("talk to the coordinator");
    expect(HELP_TEXT).toContain("Letters talk");
    expect(HELP_TEXT).toContain("r still refreshes");
    expect(HELP_TEXT).toContain("Letters are the answer, not board keys");
    expect(HELP_TEXT).toContain("A new question rings the terminal bell and selects that row when you are not typing");
    expect(HELP_TEXT).toContain("A row that finishes rings the terminal bell and selects that row when you are not typing");
    expect(HELP_TEXT).toContain("errored or cancelled row is spent");
    expect(HELP_TEXT).toContain("More lines — or words after the id — are the brief attempt 1 reads");
    expect(HELP_TEXT).toContain("seed <issue> [--phase implement] [brief…]");
    expect(HELP_TEXT).toContain("lines, then prior compose");
    expect(HELP_TEXT).toContain("move in the line while composing");
    expect(HELP_TEXT).toContain("new line while composing");
    expect(HELP_TEXT).toContain("start / end of the current compose line");
    expect(HELP_TEXT).toContain("leave the board (stops a run that is still going");
    expect(HELP_TEXT).toContain("the shell comes back without waiting for it to finish");
    expect(HELP_TEXT).toContain("Reopening the board selects the row you left, per session and epic.");
    expect(HELP_TEXT).toContain("The terminal tab shows running, waiting, and failed counts.");
    expect(HELP_TEXT).toContain("eight rows around the selection so the prompt stays on screen");
    expect(HELP_TEXT).toContain("Ctrl-C leaves when nothing is running");
    expect(HELP_TEXT).toContain("CONDUCTOR_CONFIG");
  });
});

describe("slashMatches", () => {
  it("lists prefix matches until a space starts the arguments", () => {
    expect(slashMatches("/")).toContain("status");
    expect(slashMatches("/")).toContain("seed");
    expect(slashMatches("/s")).toEqual(["status", "seed", "steer", "start"]);
    expect(slashMatches("/ste")).toEqual(["steer"]);
    expect(slashMatches("/sta")).toEqual(["status", "start"]);
    expect(slashMatches("/status")).toEqual(["status"]);
    expect(slashMatches("/status FIX-1")).toEqual([]);
    expect(slashMatches("status")).toEqual([]);
  });

  it("reads the first board-id argument after a space", () => {
    expect(slashArgPrefix("/status")).toBeNull();
    expect(slashArgPrefix("/status ")).toEqual({ verb: "status", prefix: "" });
    expect(slashArgPrefix("/status FIX")).toEqual({ verb: "status", prefix: "fix" });
    expect(slashArgPrefix("/status FIX-1 extra")).toBeNull();
    expect(slashArgPrefix("/seed ")).toBeNull();
    expect(slashArgPrefix("/answer Q")).toEqual({ verb: "answer", prefix: "q" });
    expect(slashArgPrefix("/answer Q hello")).toBeNull();
  });
});
