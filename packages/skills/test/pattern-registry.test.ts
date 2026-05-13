import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createPatternRegistry,
  type PatternFactory,
} from "../src/pattern-registry";

function fakeFactory(key: string): PatternFactory {
  return {
    key,
    configSchema: z.object({}).passthrough(),
    fromConfig: async () => ({}) as never,
  };
}

describe("createPatternRegistry", () => {
  it("looks up factories by key", () => {
    const reg = createPatternRegistry([fakeFactory("task-board"), fakeFactory("supervisor")]);
    expect(reg.get("task-board")?.key).toBe("task-board");
    expect(reg.get("supervisor")?.key).toBe("supervisor");
    expect(reg.get("missing")).toBeUndefined();
  });

  it("lists every registered factory", () => {
    const reg = createPatternRegistry([fakeFactory("a"), fakeFactory("b")]);
    expect(reg.list().map((f) => f.key).sort()).toEqual(["a", "b"]);
  });

  it("rejects duplicate keys at construction time", () => {
    expect(() =>
      createPatternRegistry([fakeFactory("dup"), fakeFactory("dup")]),
    ).toThrow(/duplicate factory key/);
  });
});
