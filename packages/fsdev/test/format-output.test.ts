import { describe, expect, it } from "vitest";
import { formatOutput } from "../src/format-output";

describe("formatOutput", () => {
  it("formats object as indented JSON", () => {
    const result = formatOutput({ key: "value" });
    expect(result).toBe('{\n  "key": "value"\n}');
  });

  it("formats nested objects", () => {
    const result = formatOutput({ a: { b: 1 } });
    expect(JSON.parse(result)).toEqual({ a: { b: 1 } });
  });

  it("formats arrays", () => {
    const result = formatOutput([1, 2, 3]);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it("formats null", () => {
    expect(formatOutput(null)).toBe("null");
  });
});
