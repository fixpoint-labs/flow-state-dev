import { describe, expect, it } from "vitest";
import { forwardConductorArgv } from "../src/commands/conductor";
import { HELP_TEXT, parseArgv, parseCommand } from "../src/conductor/parse";

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
  });

  it("keeps the answer text intact, including quotes", () => {
    expect(parseCommand('/answer Q1 "leave the symlink"')).toEqual({
      ok: true,
      command: { kind: "answer", question: "Q1", text: "leave the symlink" },
    });
  });

  it("refuses a verb that is missing its required argument", () => {
    expect(parseCommand("seed")).toMatchObject({ ok: false });
    expect(parseCommand("answer Q1")).toMatchObject({ ok: false });
    expect(parseCommand("/nope")).toMatchObject({ ok: false, message: "unknown command: nope" });
  });
});

describe("parseArgv", () => {
  it("opens the TUI when there is no verb", () => {
    expect(parseArgv([]).invocation).toEqual({ mode: "tui" });
    expect(parseArgv(["tui", "FIX-1"]).invocation).toEqual({ mode: "tui", issue: "FIX-1" });
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

  it("puts Commander-owned --phase back on the line seed reads", () => {
    const parsed = parseArgv(forwardConductorArgv(["seed", "FIX-1"], { phase: "review" }));
    expect(parsed.invocation).toEqual({
      mode: "headless",
      json: false,
      command: { kind: "seed", issue: "FIX-1", phase: "review" },
    });
  });
});

describe("HELP_TEXT", () => {
  it("names --phase with the other flags", () => {
    expect(HELP_TEXT).toMatch(/--phase <name>/);
    expect(HELP_TEXT).toContain("FAIL band");
    expect(HELP_TEXT).toContain("request stream");
  });
});
