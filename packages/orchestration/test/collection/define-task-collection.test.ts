/**
 * `defineTaskCollection` unit tests — the durable-collection declaration:
 * the additive marker over the resource-collection brand, id validation, and
 * the permissive task envelope with a typed `input` payload.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTaskCollection, isDefinedTaskCollection } from "../../src/tasks";
import { taskEnvelopeSchema } from "../../src/tasks/collection/define-task-collection";

describe("defineTaskCollection", () => {
  it("returns a resource collection with the additive task marker", () => {
    const todos = defineTaskCollection({ id: "todos", scope: "user" });
    // Keeps the ResourceCollection brand …
    expect((todos as { __brand?: string }).__brand).toBe("ResourceCollection");
    // … plus the additive marker carrying the id.
    expect(todos.__taskCollection.id).toBe("todos");
    expect(isDefinedTaskCollection(todos)).toBe(true);
    // Pattern is `<id>/**` (deep — task ids may contain slashes), scope passes through.
    expect(todos.pattern).toBe("todos/**");
    expect(todos.scope).toBe("user");
  });

  it("isDefinedTaskCollection rejects plain resource collections and objects", () => {
    expect(isDefinedTaskCollection({ __brand: "ResourceCollection" })).toBe(false);
    expect(isDefinedTaskCollection({})).toBe(false);
    expect(isDefinedTaskCollection(undefined)).toBe(false);
    expect(isDefinedTaskCollection(() => undefined)).toBe(false);
  });

  it("rejects ids with pattern tokens, path separators, or prototype keys", () => {
    expect(() => defineTaskCollection({ id: "bad*", scope: "user" })).toThrow(
      /plain literal/
    );
    expect(() => defineTaskCollection({ id: "a/b", scope: "user" })).toThrow(
      /plain literal/
    );
    expect(() => defineTaskCollection({ id: "[x]", scope: "user" })).toThrow(
      /plain literal/
    );
    expect(() => defineTaskCollection({ id: "__proto__", scope: "user" })).toThrow(
      /prototype member/
    );
    expect(() => defineTaskCollection({ id: "", scope: "user" })).toThrow(
      /non-empty/
    );
  });

  it("forwards maxInstances when provided", () => {
    const todos = defineTaskCollection({
      id: "capped",
      scope: "session",
      maxInstances: 5,
    });
    expect(todos.maxInstances).toBe(5);
  });

  it("taskEnvelopeSchema validates a full task with a typed, optional input", () => {
    const envelope = taskEnvelopeSchema(z.object({ topic: z.string() }));
    const base = {
      id: "t1",
      goal: "g",
      status: "pending" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    // input omitted round-trips as omitted (not a synthesized null).
    const omitted = envelope.parse(base);
    expect("input" in (omitted as object)).toBe(false);
    // input present is validated against the payload schema.
    expect(() =>
      envelope.parse({ ...base, input: { topic: "x" } })
    ).not.toThrow();
    expect(() => envelope.parse({ ...base, input: { topic: 1 } })).toThrow();
  });
});
