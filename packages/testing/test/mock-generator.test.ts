import { describe, expect, it } from "vitest";
import { mockGenerator } from "../src";

describe("mockGenerator", () => {
  it("returns scripted steps in order and supports reset", () => {
    const mock = mockGenerator({
      name: "gpt-test",
      script: [
        { text: "one" },
        { structuredOutput: { done: true } }
      ]
    });

    expect(mock.next()).toEqual({ text: "one" });
    expect(mock.next()).toEqual({ structuredOutput: { done: true } });
    expect(mock.next()).toBeUndefined();

    mock.reset();

    expect(mock.next()).toEqual({ text: "one" });
  });
});
