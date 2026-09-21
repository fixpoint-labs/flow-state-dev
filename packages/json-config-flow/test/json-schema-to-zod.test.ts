import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "../src/json-schema-to-zod";

describe("jsonSchemaToZod", () => {
  it("converts object + enum string", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        intent: { type: "string", enum: ["plan", "chat"] },
        message: { type: "string" },
      },
      required: ["intent", "message"],
    });

    expect(schema.parse({ intent: "plan", message: "hi" })).toEqual({
      intent: "plan",
      message: "hi",
    });
    expect(() => schema.parse({ intent: "other", message: "hi" })).toThrow();
    expect(() => schema.parse({ intent: "plan" })).toThrow();
  });

  it("converts arrays and numbers", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        scores: { type: "array", items: { type: "number" } },
      },
      required: ["scores"],
    });
    expect(schema.parse({ scores: [1, 2.5] })).toEqual({ scores: [1, 2.5] });
  });

  it("supports anyOf unions", () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(schema.parse("x")).toBe("x");
    expect(schema.parse(3)).toBe(3);
  });
});
