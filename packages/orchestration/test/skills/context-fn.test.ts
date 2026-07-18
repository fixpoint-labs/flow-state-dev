/**
 * Tests for the skills catalog / active-skill dynamic context formatters.
 * The critical behavior here is that `buildSkillsCatalogContext` must seed
 * `initialSkills` into the collection on its first render — otherwise the
 * catalog renders empty on turn 1, the model sees "no skills", never calls
 * runSkill, and seeding never runs (chicken-and-egg).
 */
import { describe, expect, it } from "vitest";
import type { InitialSkill } from "@flow-state-dev/core";
import {
  buildActiveSkillsContext,
  buildSkillsCatalogContext,
} from "../../src/skills/context-fn";
import { _resetSeedingCache } from "../../src/skills/seeding";
import { createMockSkillsCollection } from "./mocks";

function buildCtx(collection: ReturnType<typeof createMockSkillsCollection>) {
  return {
    session: {
      identity: { id: "s1", userId: "u1" },
      state: { activeSkills: [] },
    },
    org: {
      identity: { id: "p1" },
    },
    user: {},
    // Unified resource registry — collection's intrinsic scope routes
    // reads/writes at runtime; tests don't need per-scope bags.
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
  } as never;
}

describe("buildSkillsCatalogContext", () => {
  it("seeds initialSkills on the first render so the catalog is populated on turn 1", async () => {
    const collection = createMockSkillsCollection();
    // Drop any cached seeder state from earlier tests using this ref shape.
    _resetSeedingCache(collection);

    const initialSkills: InitialSkill[] = [
      {
        name: "check-news",
        skillMd: "---\ndescription: Check the latest news\n---\n\nBody",
      },
    ];
    const formatter = buildSkillsCatalogContext({
      collectionKey: "skills",
      mountPath: "skills",
      initialSkills,
    });

    const ctx = buildCtx(collection);
    const out = await formatter(undefined, ctx);

    expect(out).toContain("check-news");
    expect(out).toContain("Check the latest news");
    // The skill was written to the collection during the render.
    expect(collection.getOptional("check-news/SKILL.md")).toBeDefined();
  });

  it("is idempotent — subsequent renders don't re-seed", async () => {
    const collection = createMockSkillsCollection();
    _resetSeedingCache(collection);

    const initialSkills: InitialSkill[] = [
      {
        name: "example",
        skillMd: "---\ndescription: Example\n---\n\nBody",
      },
    ];
    const formatter = buildSkillsCatalogContext({
      collectionKey: "skills",
      mountPath: "skills",
      initialSkills,
    });

    const ctx = buildCtx(collection);
    await formatter(undefined, ctx);

    // Delete the skill from the collection, simulating a user deletion.
    await collection.delete("example/SKILL.md");

    // Second render must NOT re-seed — `_meta.seededNames` already records
    // the skill, so the deletion sticks.
    const second = await formatter(undefined, ctx);
    expect(second).not.toContain("example");
    expect(collection.getOptional("example/SKILL.md")).toBeUndefined();
  });

  it("returns the empty-state description when no initialSkills are configured and the collection is empty", async () => {
    const collection = createMockSkillsCollection();
    _resetSeedingCache(collection);

    const formatter = buildSkillsCatalogContext({
      collectionKey: "skills",
      mountPath: "skills",
    });

    const out = await formatter(undefined, buildCtx(collection));
    expect(out).toMatch(/No skills are currently available/);
  });
});

describe("buildActiveSkillsContext", () => {
  it("returns null when no skills are active", async () => {
    const collection = createMockSkillsCollection();
    const formatter = buildActiveSkillsContext({
      collectionKey: "skills",
      mountPath: "skills",
    });
    const out = await formatter(undefined, buildCtx(collection));
    expect(out).toBeNull();
  });
});
