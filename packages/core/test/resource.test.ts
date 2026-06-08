import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResource, handler } from "../src";
import { defineResourceCollection } from "../src/types/resource-collection";
import { parseResourceTemplate } from "../src/resource-template/resource-template";

const stubTemplate = parseResourceTemplate("<system>Hello {{ state.name }}</system>");

const reactiveBlock = handler({ name: "react", execute: () => {} });

describe("defineResource", () => {
  it("throws when content and contentFile are both provided", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
      content: "inline",
      contentFile: "./file.md"
    })).toThrow("at most one content source");
  });

  it("throws when content and contentTemplate are both provided", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({}),
      content: "inline",
      contentTemplate: stubTemplate,
    })).toThrow("at most one content source");
  });

  it("throws when contentTemplate and contentTemplateRef are both provided", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({}),
      contentTemplate: stubTemplate,
      contentTemplateRef: "templates/analyst",
    })).toThrow("at most one content source");
  });

  it("throws when render is used with contentTemplate", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({}),
      contentTemplate: stubTemplate,
      render: (c) => c,
    })).toThrow("rejects render with contentTemplate");
  });

  it("throws when render is used with contentTemplateRef", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({}),
      contentTemplateRef: "templates/analyst",
      render: (c) => c,
    })).toThrow("rejects render with contentTemplate");
  });

  it("accepts a single contentTemplate source", () => {
    const res = defineResource({
      scope: "user",
      stateSchema: z.object({ name: z.string() }),
      contentTemplate: stubTemplate,
    });
    expect(res.contentTemplate).toBe(stubTemplate);
  });

  it("accepts a string path as contentTemplate", () => {
    const res = defineResource({
      scope: "user",
      stateSchema: z.object({ name: z.string() }),
      contentTemplate: "./templates/persona.md",
    });
    expect(res.contentTemplate).toBe("./templates/persona.md");
  });

  it("throws when string contentTemplate and contentFile are both provided", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({}),
      contentTemplate: "./templates/persona.md",
      contentFile: "./other.md",
    })).toThrow("at most one content source");
  });

  it("accepts a single contentTemplateRef source", () => {
    const res = defineResource({
      scope: "user",
      stateSchema: z.object({ name: z.string() }),
      contentTemplateRef: "templates/analyst",
    });
    expect(res.contentTemplateRef).toBe("templates/analyst");
  });

  it("accepts a block binding in reactTo", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { created: reactiveBlock },
    });
    expect(res.reactTo?.created).toBe(reactiveBlock);
  });

  it("throws when a reactTo binding is not a block", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { created: {} as never },
    })).toThrow("reactTo.created must be a block");
  });

  it("throws when a reactTo binding's when is not a function", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { updated: { block: reactiveBlock, when: "x" as never } },
    })).toThrow("reactTo.updated.when must be a function");
  });
});

describe("defineResourceCollection", () => {
  it("throws when contentTemplate and contentTemplateRef are both provided", () => {
    expect(() => defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: z.object({}),
      contentTemplate: stubTemplate,
      contentTemplateRef: "templates/analyst",
    })).toThrow("at most one template source");
  });

  it("accepts a single contentTemplate", () => {
    const col = defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      contentTemplate: stubTemplate,
    });
    expect(col.contentTemplate).toBe(stubTemplate);
  });

  it("accepts a string path as contentTemplate", () => {
    const col = defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      contentTemplate: "./templates/item.md",
    });
    expect(col.contentTemplate).toBe("./templates/item.md");
  });

  it("accepts a block binding in reactTo", () => {
    const col = defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { deleted: reactiveBlock },
    });
    expect(col.reactTo?.deleted).toBe(reactiveBlock);
  });

  it("throws when a reactTo binding is not a block", () => {
    expect(() => defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { deleted: {} as never },
    })).toThrow("reactTo.deleted must be a block");
  });
});
