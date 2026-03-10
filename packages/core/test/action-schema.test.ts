import { describe, expect, it } from "vitest";
import { z } from "zod";
import { serializeActionSchema } from "../src/schema/action-schema";

describe("serializeActionSchema", () => {
  it("serializes a simple object with a required string field", () => {
    const schema = z.object({ message: z.string() });
    expect(serializeActionSchema(schema)).toEqual({
      type: "object",
      fields: {
        message: { type: "string", required: true }
      }
    });
  });

  it("serializes string with min/max constraints", () => {
    const schema = z.object({ name: z.string().min(1).max(100) });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        name: { type: "string", required: true, minLength: 1, maxLength: 100 }
      }
    });
  });

  it("serializes number with min/max constraints", () => {
    const schema = z.object({ count: z.number().min(0).max(100) });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        count: { type: "number", required: true, min: 0, max: 100 }
      }
    });
  });

  it("serializes boolean field", () => {
    const schema = z.object({ flag: z.boolean() });
    expect(serializeActionSchema(schema)).toEqual({
      type: "object",
      fields: {
        flag: { type: "boolean", required: true }
      }
    });
  });

  it("serializes enum field with values", () => {
    const schema = z.object({ mode: z.enum(["chat", "plan", "review"]) });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        mode: { type: "enum", required: true, enumValues: ["chat", "plan", "review"] }
      }
    });
  });

  it("serializes optional field as required: false", () => {
    const schema = z.object({ note: z.string().optional() });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        note: { type: "string", required: false }
      }
    });
  });

  it("serializes field with default value", () => {
    const schema = z.object({ mode: z.string().default("chat") });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        mode: { type: "string", required: false, default: "chat" }
      }
    });
  });

  it("serializes enum with default", () => {
    const schema = z.object({ mode: z.enum(["chat", "plan"]).default("chat") });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        mode: { type: "enum", required: false, default: "chat", enumValues: ["chat", "plan"] }
      }
    });
  });

  it("serializes nested object fields", () => {
    const schema = z.object({
      metadata: z.object({
        source: z.string(),
        count: z.number()
      })
    });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        metadata: {
          type: "object",
          required: true,
          fields: {
            source: { type: "string", required: true },
            count: { type: "number", required: true }
          }
        }
      }
    });
  });

  it("serializes array with item type", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        tags: { type: "array", required: true, itemType: "string" }
      }
    });
  });

  it("returns unsupported for non-object top-level schema", () => {
    expect(serializeActionSchema(z.string())).toEqual({ type: "unsupported" });
    expect(serializeActionSchema(z.number())).toEqual({ type: "unsupported" });
  });

  it("serializes z.unknown() field as unknown type", () => {
    const schema = z.object({ data: z.unknown() });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        data: { type: "unknown", required: true }
      }
    });
  });

  it("preserves .describe() text", () => {
    const schema = z.object({
      goal: z.string().describe("The analysis goal")
    });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        goal: { type: "string", required: true, description: "The analysis goal" }
      }
    });
  });

  it("handles mixed required, optional, and defaulted fields", () => {
    const schema = z.object({
      message: z.string().min(1),
      mode: z.enum(["chat", "plan"]).default("chat"),
      context: z.string().optional(),
      verbose: z.boolean()
    });
    const result = serializeActionSchema(schema);
    expect(result).toEqual({
      type: "object",
      fields: {
        message: { type: "string", required: true, minLength: 1 },
        mode: { type: "enum", required: false, default: "chat", enumValues: ["chat", "plan"] },
        context: { type: "string", required: false },
        verbose: { type: "boolean", required: true }
      }
    });
  });
});
