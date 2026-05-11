/**
 * Tests for the shared `client` projection helpers used by resources and
 * collections. Covers both `validateClientProjection` (build-time) and
 * `resolveClientProjection` (request-time).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  resolveClientProjection,
  validateClientProjection,
} from "../src/utils/client-projection";
import { defineResource } from "../src/types/resource";
import { defineResourceCollection } from "../src/types/resource-collection";

const stateSchema = z.object({
  title: z.string(),
  body: z.string(),
  secret: z.string(),
});

describe("resolveClientProjection", () => {
  const state = { title: "T", body: "B", secret: "S" };

  it("returns identity when client is undefined", () => {
    expect(resolveClientProjection(undefined, state)).toEqual(state);
  });

  it("returns identity when no projection is declared", () => {
    expect(resolveClientProjection({ content: { read: true } }, state)).toEqual(state);
  });

  it("picks listed fields when `expose` is set", () => {
    expect(resolveClientProjection({ expose: ["title", "body"] }, state)).toEqual({
      title: "T",
      body: "B",
    });
  });

  it("omits listed fields when `exclude` is set", () => {
    expect(resolveClientProjection({ exclude: ["secret"] }, state)).toEqual({
      title: "T",
      body: "B",
    });
  });

  it("invokes `data` when set", () => {
    const result = resolveClientProjection(
      { data: (s) => ({ joined: `${s.title}:${s.body}` }) },
      state
    );
    expect(result).toEqual({ joined: "T:B" });
  });

  it("supports async `data`", async () => {
    const result = await resolveClientProjection(
      { data: async (s) => ({ title: s.title }) },
      state
    );
    expect(result).toEqual({ title: "T" });
  });
});

describe("validateClientProjection", () => {
  const stateSchema = z.object({ a: z.string(), b: z.number() });

  it("does nothing when client is undefined", () => {
    expect(() =>
      validateClientProjection({ definer: "x", ref: "y", stateSchema, client: undefined })
    ).not.toThrow();
  });

  it("does nothing when zero projection fields are set", () => {
    expect(() =>
      validateClientProjection({ definer: "x", ref: "y", stateSchema, client: {} })
    ).not.toThrow();
  });

  it("throws when two projection fields are set", () => {
    expect(() =>
      validateClientProjection({
        definer: "defineResource()",
        ref: "things",
        stateSchema,
        client: { expose: ["a"], data: (s) => s },
      })
    ).toThrow(/at most one.*expose, data/);
  });

  it("throws when three projection fields are set", () => {
    expect(() =>
      validateClientProjection({
        definer: "defineResource()",
        ref: "things",
        stateSchema,
        client: { expose: ["a"], exclude: ["b"], data: (s) => s },
      })
    ).toThrow(/expose, exclude, data/);
  });

  it("throws on unknown `expose` key with the valid-keys list", () => {
    expect(() =>
      validateClientProjection({
        definer: "defineResource()",
        ref: "things",
        stateSchema,
        client: { expose: ["bogus"] },
      })
    ).toThrow(/expose.*bogus.*Valid keys: a, b/);
  });

  it("throws on unknown `exclude` key", () => {
    expect(() =>
      validateClientProjection({
        definer: "defineResource()",
        ref: "things",
        stateSchema,
        client: { exclude: ["nope"] },
      })
    ).toThrow(/exclude.*nope.*Valid keys: a, b/);
  });

  it("silently skips validation when schema is a ZodUnion", () => {
    const unionSchema = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]);
    expect(() =>
      validateClientProjection({
        definer: "defineResource()",
        ref: "things",
        stateSchema: unionSchema,
        client: { expose: ["nothing-here"] },
      })
    ).not.toThrow();
  });
});

describe("defineResource client projection validation", () => {
  it("rejects `expose` + `data`", () => {
    expect(() =>
      defineResource({
        ref: "memo",
        scope: "session",
        stateSchema,
        client: {
          expose: ["title"],
          data: (s) => ({ title: s.title }),
        },
      })
    ).toThrow(/at most one/);
  });

  it("rejects an unknown `expose` key", () => {
    expect(() =>
      defineResource({
        ref: "memo",
        scope: "session",
        stateSchema,
        client: { expose: ["bogus" as never] },
      })
    ).toThrow(/Valid keys: body, secret, title/);
  });

  it("accepts a valid `expose` list", () => {
    const def = defineResource({
      ref: "memo",
      scope: "session",
      stateSchema,
      client: { expose: ["title", "body"] },
    });
    expect(def.client?.expose).toEqual(["title", "body"]);
  });

  it("accepts `exclude`", () => {
    const def = defineResource({
      ref: "memo",
      scope: "session",
      stateSchema,
      client: { exclude: ["secret"] },
    });
    expect(def.client?.exclude).toEqual(["secret"]);
  });

  it("accepts no projection (identity default)", () => {
    const def = defineResource({
      ref: "memo",
      scope: "session",
      stateSchema,
      client: { content: { read: true } },
    });
    expect(def.client?.expose).toBeUndefined();
    expect(def.client?.exclude).toBeUndefined();
    expect(def.client?.data).toBeUndefined();
  });
});

describe("defineResourceCollection client projection validation", () => {
  it("rejects `expose` + `exclude`", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "memos/*",
        scope: "session",
        stateSchema,
        client: {
          state: { read: true },
          expose: ["title"],
          exclude: ["secret"],
        },
      })
    ).toThrow(/at most one.*expose, exclude/);
  });

  it("rejects an unknown `exclude` key", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "memos/*",
        scope: "session",
        stateSchema,
        client: { state: { read: true }, exclude: ["bogus" as never] },
      })
    ).toThrow(/exclude.*bogus/);
  });

  it("accepts `expose` against a real schema", () => {
    const def = defineResourceCollection({
      pattern: "memos/*",
      scope: "session",
      stateSchema,
      client: { state: { read: true }, expose: ["title", "body"] },
    });
    expect(def.client?.expose).toEqual(["title", "body"]);
  });
});
