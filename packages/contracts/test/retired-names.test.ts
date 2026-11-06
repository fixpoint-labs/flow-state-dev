/**
 * The retired-name helper: one message for every refusal, naming what replaces
 * the name and the version that removes the refusal, so an adopter who meets
 * one knows what to write and how long the warning lasts.
 */
import { describe, expect, it } from "vitest";
import {
  RetiredNameError,
  readRetired,
  refuseRetired,
  refuseRetiredValue,
  retiredNames
} from "../src/internal";

const TABLE = retiredNames("@flow-state-dev/example", {
  oldKey: { replacement: "`newKey`", removeIn: "0.9.0" },
  goneKey: { drop: "nothing reads it", removeIn: "0.9.0" },
  oldValue: { replacement: '"newValue"', readAs: "newValue", removeIn: "0.9.0" }
});

describe("the retired-name helper", () => {
  it("refuses a retired key, naming its replacement and the removal version", () => {
    expect(() => refuseRetired(TABLE, { oldKey: 1 }, "createThing")).toThrow(
      'createThing: "oldKey" was retired. Use `newKey`. This refusal is removed in @flow-state-dev/example 0.9.0.'
    );
  });

  it("says to drop a retired key nothing replaces", () => {
    expect(() => refuseRetired(TABLE, { goneKey: 1 }, "createThing")).toThrow(
      'createThing: "goneKey" was retired. Drop it: nothing reads it. This refusal is removed in @flow-state-dev/example 0.9.0.'
    );
  });

  it("throws a RetiredNameError that carries the entry", () => {
    let thrown: unknown;
    try {
      refuseRetiredValue(TABLE, "oldValue", "ctx.thing", "kind");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RetiredNameError);
    expect(thrown).toMatchObject({
      name: "RetiredNameError",
      retired: "oldValue",
      replacement: '"newValue"',
      package: "@flow-state-dev/example",
      removeIn: "0.9.0",
      message: 'ctx.thing: kind "oldValue" was retired. Use "newValue". This refusal is removed in @flow-state-dev/example 0.9.0.'
    });
  });

  it("looks up only the entries an entry point names", () => {
    expect(() => refuseRetired(TABLE, { goneKey: 1 }, "createThing", ["oldKey"])).not.toThrow();
    expect(() => refuseRetiredValue(TABLE, "oldValue", "ctx.thing", "kind", ["oldKey"])).not.toThrow();
  });

  it("passes what the table does not hold, and inherited names", () => {
    expect(() => refuseRetired(TABLE, { newKey: 1 }, "createThing")).not.toThrow();
    expect(() => refuseRetired(TABLE, undefined, "createThing")).not.toThrow();
    expect(() => refuseRetiredValue(TABLE, "toString", "ctx.thing")).not.toThrow();
    expect(() => refuseRetiredValue(TABLE, 3, "ctx.thing")).not.toThrow();
  });

  it("reads a stored retired value as its replacement, and anything else unchanged", () => {
    expect(readRetired(TABLE, "oldValue")).toBe("newValue");
    expect(readRetired(TABLE, "newValue")).toBe("newValue");
    expect(readRetired(TABLE, "oldKey")).toBe("oldKey");
  });
});
