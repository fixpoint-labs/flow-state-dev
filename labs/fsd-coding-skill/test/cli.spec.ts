/**
 * The skill's runner: argv maps onto a declared door and runs it.
 */
import { describe, expect, it } from "vitest";
import { INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../../../packages/cursor/src/agent";
import { TESTED_SDK_VERSION } from "@flow-state-dev/cursor";
import { CliUsageError, parseArgs, runCli } from "../src/cli";
import { DOOR_PREFIX } from "../src/schemas";
import { scriptedCursor } from "./scripted-cursor";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

describe("parseArgs", () => {
  it("maps kebab doors onto the declared flow actions", () => {
    expect(parseArgs(["implement", "--task", "x"]).door).toBe("implement");
    expect(parseArgs(["fix", "--task", "x"]).door).toBe("fix");
    expect(parseArgs(["open-pr", "--task", "x"]).door).toBe("openPr");
    expect(parseArgs(["fix-fsd", "--repro", "boom"]).door).toBe("fixFsd");
  });

  it("refuses an undeclared door instead of inventing a path", () => {
    expect(() => parseArgs(["conductor", "--task", "x"])).toThrow(CliUsageError);
    expect(() => parseArgs(["workforce", "--task", "x"])).toThrow(/unknown door/);
  });

  it("refuses to run a task door without --task, or fix-fsd without --repro", () => {
    expect(() => parseArgs(["implement"])).toThrow(/--task/);
    expect(() => parseArgs(["fix-fsd", "--task", "x"])).toThrow(/--repro/);
  });
});

describe("runCli", () => {
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
