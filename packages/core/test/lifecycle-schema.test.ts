import { describe, it, expect } from "vitest";
import { z } from "zod";
import { lifecycleSchema } from "../src/helpers/lifecycle-schema";

describe("lifecycleSchema", () => {
  it("fills nullable timestamp/error defaults from a status-only partial", () => {
    const schema = z.object({
      ...lifecycleSchema(["pending", "writing", "published"]),
      title: z.string(),
    });

    const parsed = schema.parse({ status: "writing", title: "Memo" });
    expect(parsed).toEqual({
      status: "writing",
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      title: "Memo",
    });
  });

  it("accepts supplied ISO-string timestamps and an error message", () => {
    const schema = z.object(lifecycleSchema(["pending", "error"]));
    const parsed = schema.parse({
      status: "error",
      startedAt: "2026-06-06T00:00:00.000Z",
      errorMessage: "boom",
    });
    expect(parsed.startedAt).toBe("2026-06-06T00:00:00.000Z");
    expect(parsed.completedAt).toBeNull();
    expect(parsed.errorMessage).toBe("boom");
  });

  it("rejects a status outside the declared set", () => {
    const schema = z.object(lifecycleSchema(["pending", "published"]));
    expect(() => schema.parse({ status: "writing" })).toThrow();
  });
});
