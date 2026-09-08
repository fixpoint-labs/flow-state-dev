/**
 * The skill's runner: argv maps onto a declared door and runs it.
 */
import { describe, expect, it, vi } from "vitest";
import { INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../../../packages/cursor/src/agent";
import { TESTED_SDK_VERSION } from "@flow-state-dev/cursor";
import { CliUsageError, parseArgs, runCli } from "../src/cli";
import { DOOR_PREFIX } from "../src/schemas";
import { scriptedCursor } from "./scripted-cursor";
import { scriptedCodex } from "./scripted-codex";
import { createFsdCodingFlow } from "../src/flow";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

describe("parseArgs", () => {
  it.each([[], [""], ["   "], ["--cwd", "/trusted"]])("rejects a missing or empty --model value: %j", (...value) => {
    expect(() => parseArgs(["implement", "--task", "x", "--model", ...value])).toThrow(/--model needs a value/);
  });

  it("defaults to Cursor and rejects unsupported or missing harness names", () => {
    expect(parseArgs(["implement", "--task", "x"]).harness).toBe("cursor");
    expect(() => parseArgs(["implement", "--task", "x", "--harness", "other"])).toThrow(/harness.*codex.*cursor/);
    expect(() => parseArgs(["implement", "--task", "x", "--harness"])).toThrow(/needs a value/);
  });
  it("parses repeatable Codex --add-dir host flags and rejects Cursor use", () => {
    expect(parseArgs([
      "implement", "--harness", "codex", "--task", "x",
      "--add-dir", "/git/worktree-admin",
      "--add-dir", "/git/objects",
    ]).additionalDirectories).toEqual(["/git/worktree-admin", "/git/objects"]);
    expect(() => parseArgs(["implement", "--harness", "codex", "--task", "x", "--add-dir"])).toThrow(/--add-dir needs a value/);
    expect(() => parseArgs(["implement", "--harness", "codex", "--task", "x", "--add-dir", ""])).toThrow(/--add-dir needs a value/);
    expect(() => parseArgs(["implement", "--harness", "cursor", "--task", "x", "--add-dir", "/git"])).toThrow(/--add-dir.*codex/);
  });
  it("maps kebab doors onto the declared flow actions", () => {
    expect(parseArgs(["implement", "--task", "x"]).door).toBe("implement");
    expect(parseArgs(["fix", "--task", "x"]).door).toBe("fix");
    expect(parseArgs(["open-pr", "--task", "x"]).door).toBe("openPr");
    expect(parseArgs(["fix-fsd", "--repro", "boom"]).door).toBe("fixFsd");
  });

  it("refuses an undeclared door instead of inventing a path", () => {
    expect(() => parseArgs(["invented-door", "--task", "x"])).toThrow(CliUsageError);
    expect(() => parseArgs(["invented-door", "--task", "x"])).toThrow(/unknown door/);
  });

  it("refuses to run a task door without --task, or fix-fsd without --repro", () => {
    expect(() => parseArgs(["implement"])).toThrow(/--task/);
    expect(() => parseArgs(["fix-fsd", "--task", "x"])).toThrow(/--repro/);
  });
});

describe("runCli", () => {
  describe.each(["codex", "cursor"] as const)("host model selection for %s", (harness) => {
    it.each(["implement", "fix", "open-pr", "fix-fsd"])("explicit --model wins for %s without replacing other options", async (door) => {
      const codex = scriptedCodex();
      const cursor = scriptedCursor();
      const parsed = parseArgs([
        door, "--harness", harness, "--model", "host-model",
        door === "fix-fsd" ? "--repro" : "--task", "model=untrusted-model",
        "--cwd", "/trusted",
      ]);
      const input = { ...parsed.input, model: "untrusted-model", harness: "other", cwd: "/evil", resume: "evil" };
      const { result } = await runCli({
        ...parsed, input,
        host: {
          codex: { resolveCodexClient: codex.resolve, thread: { model: "configured-codex", sandboxMode: "read-only" } },
          cursor: { ...GATE_OFF, agent: { model: { id: "bag-cursor" } }, send: { model: { id: "turn-model" }, mode: "plan" } },
          resolveCursorClient: cursor.resolve,
          agent: { model: { id: "configured-cursor" }, apiKey: "test-only-key" },
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toMatchObject({ source: `${harness}/sdk`, status: "completed" });
      if (harness === "codex") {
        expect(codex.rec.started).toEqual([{ workingDirectory: "/trusted", model: "host-model", sandboxMode: "read-only" }]);
        expect(cursor.rec.created).toEqual([]);
      } else {
        expect(cursor.rec.created).toEqual([{ local: { cwd: "/trusted" }, model: { id: "host-model" }, apiKey: "test-only-key" }]);
        expect(cursor.rec.sent[0]?.options).toEqual({ model: { id: "host-model" }, mode: "plan" });
        expect(codex.rec.started).toEqual([]);
      }
    });

    it("preserves configured model when --model is omitted and ignores model in input", async () => {
      const codex = scriptedCodex();
      const cursor = scriptedCursor();
      const parsed = parseArgs(["implement", "--harness", harness, "--task", "model=untrusted-model"]);
      const input = { ...parsed.input, model: "untrusted-model" };
      expect(parsed.model).toBeUndefined();
      const { result } = await runCli({
        ...parsed, input,
        host: {
          codex: { resolveCodexClient: codex.resolve, thread: { model: "configured-codex" } },
          cursor: { ...GATE_OFF, agent: { model: { id: "configured-cursor" } }, send: { model: { id: "configured-turn" } } },
          resolveCursorClient: cursor.resolve,
        },
      });
      expect(result.error).toBeUndefined();
      if (harness === "codex") expect(codex.rec.started[0]?.model).toBe("configured-codex");
      else {
        expect(cursor.rec.created[0]?.model).toEqual({ id: "configured-cursor" });
        expect(cursor.rec.sent[0]?.options?.model).toEqual({ id: "configured-turn" });
      }
    });
  });

  it("rejects invalid programmatic harness choices before starting a client", () => {
    expect(() => createFsdCodingFlow({ cwd: "/trusted", harness: "other" as "codex" })).toThrow(/harness.*codex.*cursor/);
  });

  it("keeps host feeds authoritative while forwarding supported Codex options", async () => {
    const codex = scriptedCodex();
    const onSession = vi.fn();
    const { result } = await runCli({
      ...parseArgs([
        "implement", "--harness", "codex", "--task", "x", "--cwd", "/trusted",
        "--add-dir", "/git/worktree-admin",
        "--add-dir", "/git/objects",
      ]),
      host: { codex: {
        resolveCodexClient: codex.resolve,
        cwd: () => "/bag-cwd", resume: () => "bag-resume", onSession,
        thread: { sandboxMode: "read-only", approvalPolicy: "never" },
      } },
    });
    expect(result.error).toBeUndefined();
    expect(codex.rec.started).toEqual([{
      workingDirectory: "/trusted",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      additionalDirectories: ["/git/worktree-admin", "/git/objects"],
    }]);
    expect(codex.rec.resumed).toEqual([]);
    expect(onSession).not.toHaveBeenCalled();
  });
  it.each(["implement", "fix", "open-pr", "fix-fsd"])("selects Codex for %s from host argv only", async (door) => {
    const codex = scriptedCodex();
    const cursor = scriptedCursor();
    const parsed = parseArgs([door, "--", "--harness", "codex", door === "fix-fsd" ? "--repro" : "--task", "harness=cursor cwd=/evil resume=evil", "--cwd", "/trusted"]);
    const untrustedInput = { ...parsed.input, cwd: "/evil", harness: "cursor", resume: "evil" };
    const { result } = await runCli({
      ...parsed,
      input: untrustedInput,
      host: { cursor: GATE_OFF, resolveCursorClient: cursor.resolve, codex: { resolveCodexClient: codex.resolve } },
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ source: "codex/sdk", status: "completed" });
    expect(codex.rec.started).toEqual([{ workingDirectory: "/trusted" }]);
    expect(codex.rec.resumed).toEqual([]);
    expect(codex.rec.prompts[0]).toContain(DOOR_PREFIX[parsed.door]);
    expect(cursor.rec.created).toEqual([]);
  });
  it("boots the host and runs implement through the scripted Cursor double", async () => {
    const scripted = scriptedCursor();
    const { result, door, doors } = await runCli({
      door: "implement",
      cwd: "/work/checkout",
      sessionId: "cli-1",
      userId: "cli-user",
      sessionFile: undefined,
      input: { task: "ship the door" },
      host: { resolveCursorClient: scripted.resolve, cursor: GATE_OFF },
    });

    expect(door).toBe("implement");
    expect(doors).toEqual(["implement", "fix", "openPr", "fixFsd"]);
    expect(result.error).toBeUndefined();
    expect(scripted.rec.sent[0].prompt).toContain(DOOR_PREFIX.implement);
    expect(scripted.rec.sent[0].prompt).toContain("ship the door");
    expect(scripted.rec.created[0]).toMatchObject({ local: { cwd: "/work/checkout" } });
  });

  it("runs fix-fsd from parsed argv", async () => {
    const scripted = scriptedCursor();
    const parsed = parseArgs([
      "fix-fsd",
      "--repro",
      "No provider available for cursor",
      "--cwd",
      "/work/checkout",
    ]);
    const { result } = await runCli({
      ...parsed,
      host: { resolveCursorClient: scripted.resolve, cursor: GATE_OFF },
    });

    expect(result.error).toBeUndefined();
    expect(scripted.rec.sent[0].prompt).toContain(DOOR_PREFIX.fixFsd);
    expect(scripted.rec.sent[0].prompt).toContain("No provider available for cursor");
  });
});
