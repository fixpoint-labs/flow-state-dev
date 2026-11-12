/**
 * `runBy` and `canWrite` on a user or org collection: a client writes its
 * entries only through the flow `runBy` names. The refusals are the same ones a
 * single resource gets at start (the org rule above all), plus the shapes the
 * default write flow can't serve for entries.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResourceCollection } from "../src";

const projectSchema = z.object({ name: z.string().default(""), lead: z.string().default("") });

describe("runBy on a collection", () => {
  it("lets a user collection take the default write flow with no write rule: its entries are its owner's", () => {
    const drafts = defineResourceCollection({
      pattern: "drafts/*",
      scope: "user",
      stateSchema: projectSchema,
      client: { state: { read: true } },
      runBy: "default"
    });
    expect(drafts.runBy).toBe("default");
  });

  it("refuses an org collection on the default write flow with no canWrite, naming it and the fix", () => {
    // Without the rule, every member of the org could write every entry, and nobody chose that.
    expect(() =>
      defineResourceCollection({
        pattern: "projects/*",
        scope: "org",
        stateSchema: projectSchema,
        client: { state: { read: true } },
        runBy: "default"
      })
    ).toThrow(/org resource "projects\/\*".*canWrite.*canWrite: \(\) => true/s);
  });

  it("gives an entry's canWrite the key, and no prev on a create and no next on a delete", () => {
    const projects = defineResourceCollection({
      pattern: "projects/*",
      scope: "org",
      stateSchema: projectSchema,
      client: { state: { read: true } },
      runBy: "default",
      canWrite: ({ key, prev, next }) => key === "projects/a" && (prev === undefined || next === undefined)
    });
    expect(projects.canWrite?.({ key: "projects/a", prev: undefined, next: { name: "", lead: "" }, userId: "u", orgId: "o" })).toBe(
      true
    );
    expect(projects.canWrite?.({ key: "projects/b", prev: { name: "", lead: "" }, next: undefined, userId: "u", orgId: "o" })).toBe(
      false
    );
  });

  it("refuses runBy on a collection whose entries the client can't read: a write carries the version it read", () => {
    expect(() =>
      defineResourceCollection({ pattern: "drafts/*", scope: "user", stateSchema: projectSchema, client: {}, runBy: "default" })
    ).toThrow(/"drafts\/\*".*state: \{ read: true \}/);
  });

  it("refuses the default write flow on a collection that refuses writes or evicts entries", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "drafts/*",
        scope: "user",
        stateSchema: projectSchema,
        client: { state: { read: true } },
        writable: false,
        runBy: "default"
      })
    ).toThrow(/"drafts\/\*".*writable: false/);
    expect(() =>
      defineResourceCollection({
        pattern: "drafts/*",
        scope: "user",
        stateSchema: projectSchema,
        client: { state: { read: true } },
        maxInstances: 5,
        eviction: "lru",
        runBy: "default"
      } as never)
    ).toThrow(/"drafts\/\*".*evict/);
  });

  it("refuses runBy on a session collection and canWrite without runBy, as on a single resource", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "drafts/*",
        scope: "session",
        stateSchema: projectSchema,
        client: { state: { read: true } },
        runBy: "default"
      })
    ).toThrow(/runBy.*user or org/);
    expect(() =>
      defineResourceCollection({
        pattern: "drafts/*",
        scope: "user",
        stateSchema: projectSchema,
        client: { state: { read: true } },
        canWrite: () => true
      })
    ).toThrow(/canWrite.*runBy/);
  });
});
