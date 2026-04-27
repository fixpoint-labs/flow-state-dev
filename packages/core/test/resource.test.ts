import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResource } from "../src";

describe("defineResource", () => {
  it("throws when content and contentFile are both provided", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      content: "inline",
      contentFile: "./file.md"
    })).toThrow("either content or contentFile");
  });
});
