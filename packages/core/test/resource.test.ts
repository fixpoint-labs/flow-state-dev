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

  it("accepts a stateUpdated block binding in reactTo", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { stateUpdated: reactiveBlock },
    });
    expect(res.reactTo?.stateUpdated).toBe(reactiveBlock);
  });

  it("accepts a contentUpdated block binding in reactTo", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { contentUpdated: reactiveBlock },
    });
    expect(res.reactTo?.contentUpdated).toBe(reactiveBlock);
  });

  it("rejects created/deleted reactTo bindings on a single resource", () => {
    // Single resources have no create/delete lifecycle — only state/content
    // updates fire, so binding those kinds would be a silent no-op. Reject at
    // build time.
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { created: reactiveBlock },
    })).toThrow("does not support reactTo.created");
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { deleted: reactiveBlock },
    })).toThrow("does not support reactTo.deleted");
  });

  it("throws when a reactTo binding is not a block", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { stateUpdated: {} as never },
    })).toThrow("reactTo.stateUpdated must be a block");
  });

  it("throws when a reactTo binding's when is not a function", () => {
    expect(() => defineResource({
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { stateUpdated: { block: reactiveBlock, when: "x" as never } },
    })).toThrow("reactTo.stateUpdated.when must be a function");
  });

  describe("edges slot", () => {
    it("injects an edges field into the schema and default when edges:true", () => {
      const res = defineResource({
        scope: "session",
        edges: true,
        stateSchema: z.object({ facts: z.array(z.string()) }),
        default: { facts: [] },
      });
      const parsed = res.stateSchema.parse({ facts: [] });
      expect(parsed).toEqual({ facts: [], edges: [] });
      expect(res.default).toEqual({ facts: [], edges: [] });
    });

    it("accepts an object edges config", () => {
      const res = defineResource({
        scope: "session",
        edges: { vocabulary: ["drives"], maxEdges: 10 },
        stateSchema: z.object({ facts: z.array(z.string()) }),
      });
      expect(res.stateSchema.parse({ facts: [] })).toEqual({ facts: [], edges: [] });
    });

    it("throws when edges is declared on a non-object stateSchema", () => {
      expect(() => defineResource({
        scope: "session",
        edges: true,
        stateSchema: z.array(z.string()),
      })).toThrow(/object stateSchema/);
    });

    it("does not double-inject when the schema already declares edges", () => {
      const customEdges = z.array(z.object({ id: z.string() }));
      const res = defineResource({
        scope: "session",
        edges: true,
        stateSchema: z.object({ facts: z.array(z.string()), edges: customEdges }),
      });
      // The custom edges shape must survive — a bare {id} edge must parse.
      expect(res.stateSchema.parse({ facts: [], edges: [{ id: "x" }] }))
        .toEqual({ facts: [], edges: [{ id: "x" }] });
    });

    it("leaves schema and default untouched when edges is not declared", () => {
      const schema = z.object({ facts: z.array(z.string()) });
      const res = defineResource({
        scope: "session",
        stateSchema: schema,
        default: { facts: [] },
      });
      expect(res.stateSchema).toBe(schema);
      expect(res.default).toEqual({ facts: [] });
      expect(res.stateSchema.parse({ facts: [] })).toEqual({ facts: [] });
    });

    it("leaves default untouched when default already declares edges", () => {
      const res = defineResource({
        scope: "session",
        edges: true,
        stateSchema: z.object({ facts: z.array(z.string()) }),
        default: { facts: [], edges: [] },
      });
      expect(res.default).toEqual({ facts: [], edges: [] });
    });
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

  it("accepts a contentUpdated block binding in reactTo", () => {
    const col = defineResourceCollection({
      pattern: "items/*",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      reactTo: { contentUpdated: reactiveBlock },
    });
    expect(col.reactTo?.contentUpdated).toBe(reactiveBlock);
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
