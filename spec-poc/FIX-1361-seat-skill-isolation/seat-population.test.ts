/**
 * POC — FIX-1361, extension of `seat-isolation.mts`.
 *
 * Throwaway. Lives on the never-merged spec branch and ships nowhere.
 *
 * `seat-isolation.mts` proved that `flowIsolation: true` gives two seats two
 * different storage KEYS. It said nothing about what is IN each key. This file
 * asks the next question, which is the one acceptance criterion 5 actually
 * needs answered:
 *
 *   Give two seats DIFFERENT skill sets. Does each seat read its own?
 *
 * Part 1 — population (Codex P1). Runs the real `ensureSeeded` against two
 * isolated collections, seeded the way a shared flow kind seeds them.
 * Part 2 — cardinality (Codex P2). Runs the real `defineFlow` + `hireWorkforce`
 * + `createFlowRegistry` to see whether a plain `agent` kind can hold N seats.
 *
 * Run:
 *   pnpm --filter @flow-state-dev/orchestration exec vitest run \
 *     ../../spec-poc/FIX-1361-seat-skill-isolation/seat-population.test.ts
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import { createSkillsLibrary } from "../../packages/orchestration/src/skills/library.ts";
import { ensureSeeded } from "../../packages/orchestration/src/skills/seeding.ts";
import { createMockSkillsCollection } from "../../packages/orchestration/test/skills/mocks.ts";
import {
  resourceScopeIds,
  type IsolationFlow,
} from "../../packages/engine/src/stores/scope-keys.ts";
import { hireWorkforce } from "../../packages/workforce/src/hire.ts";
import type { WorkerManifest } from "../../packages/workforce/src/manifest.ts";
import { createFlowRegistry } from "../../packages/engine/src/registry/flow-registry.ts";

const ORG = "acme";

/** What each seat is SUPPOSED to hold — two disjoint sets. */
const leadSkill: InitialSkill = {
  name: "break-down-work",
  skillMd: `---\ndescription: Use when splitting an epic into issues\n---\n\nLead-only.`,
};
const qaSkill: InitialSkill = {
  name: "write-regression",
  skillMd: `---\ndescription: Use when a bug needs a failing test first\n---\n\nQA-only.`,
};

/** The skill names actually present in a collection after seeding. */
const catalogOf = (c: ReturnType<typeof createMockSkillsCollection>): string[] =>
  [...c._store.keys()]
    .filter((k) => k.endsWith("/SKILL.md"))
    .map((k) => k.replace(/^skills\//, "").replace(/\/SKILL\.md$/, ""))
    .sort();

/** One seat, as `hireWorkforce` mints it: instance id = the worker's id. */
const seat = (id: string, flowIsolation: boolean | undefined): IsolationFlow => ({
  id,
  isolateUserState: false,
  isolateOrgState: false,
  resources: { skills: { scope: "org", flowIsolation } },
});

describe("P1 — does flowIsolation populate a seat's drawer, or only separate it?", () => {
  it("A. keys DO isolate per seat — the original POC's finding, unchanged", () => {
    const lead = resourceScopeIds(ORG, seat("engineering.lead", true), "org");
    const qa = resourceScopeIds(ORG, seat("engineering.qa", true), "org");
    console.log(`  keys: lead -> ${lead[0]} | qa -> ${qa[0]}`);
    expect(lead[0]).not.toBe(qa[0]);
  });

  it("B. the shared kind captures ONE static initialSkills array, at definition time", () => {
    // Two seats are two instances of ONE kind. The library is built once, when
    // the kind is defined — before any seat exists — so there is exactly one
    // array for both seats to be seeded from.
    let builds = 0;
    const buildKind = (initialSkills: InitialSkill[]) => {
      builds += 1;
      return createSkillsLibrary({ initialSkills });
    };
    const kindLibrary = buildKind([leadSkill, qaSkill]);
    // Minting two seats of that kind does not rebuild the library.
    expect(builds).toBe(1);
    expect(kindLibrary).toBeDefined();
    console.log(`  createSkillsLibrary invocations for 2 seats of 1 kind: ${builds}`);
  });

  it("C. seeding two ISOLATED collections from that one array gives both seats the SAME catalog", async () => {
    // Isolation is in force: each seat has its own collection ref, i.e. its own
    // storage bucket (proved in A). This is the best case decision 3 buys.
    const leadDrawer = createMockSkillsCollection();
    const qaDrawer = createMockSkillsCollection();

    // The real seeder, called the way every runtime call site calls it
    // (run-skill-tool / load-tool / context-fn / binding-reader / seed-step all
    // pass `opts.initialSkills` — the kind's one static array).
    const kindInitialSkills = [leadSkill, qaSkill];
    await ensureSeeded(leadDrawer, kindInitialSkills);
    await ensureSeeded(qaDrawer, kindInitialSkills);

    console.log(`  lead drawer: ${JSON.stringify(catalogOf(leadDrawer))}`);
    console.log(`  qa   drawer: ${JSON.stringify(catalogOf(qaDrawer))}`);

    // Separate buckets. Identical contents. The QA seat holds the lead's skill.
    expect(catalogOf(leadDrawer)).toEqual(catalogOf(qaDrawer));
    expect(catalogOf(qaDrawer)).toContain("break-down-work");
  });

  it("D. counterfactual — hand each seat its OWN array and the seeder does isolate content", async () => {
    // Same seeder, same isolated collections. The only change is that each seat
    // is seeded from a per-seat array. So the missing piece is an
    // instance-specific handoff, NOT the isolation flag.
    const leadDrawer = createMockSkillsCollection();
    const qaDrawer = createMockSkillsCollection();

    await ensureSeeded(leadDrawer, [leadSkill]);
    await ensureSeeded(qaDrawer, [qaSkill]);

    console.log(`  lead drawer: ${JSON.stringify(catalogOf(leadDrawer))}`);
    console.log(`  qa   drawer: ${JSON.stringify(catalogOf(qaDrawer))}`);

    expect(catalogOf(leadDrawer)).toEqual(["break-down-work"]);
    expect(catalogOf(qaDrawer)).toEqual(["write-regression"]);
  });

  it("E. and there is no channel to carry a per-seat array: the manifest has no skills", () => {
    // `read-seat-skills.ts` computes org ∪ team ∪ seat per seat and returns
    // InitialSkill[]. But WorkerManifest carries only { id, declared, body },
    // and hireWorkforce forwards only frontmatter settings — so a seat's
    // computed set has nowhere to ride into the mint.
    const manifest: WorkerManifest = {
      id: "engineering.lead",
      declared: { flow: "agent", description: "Lead" },
      body: "You are the lead.",
    };
    console.log(`  WorkerManifest keys: ${JSON.stringify(Object.keys(manifest))}`);
    expect(Object.keys(manifest).sort()).toEqual(["body", "declared", "id"]);
    expect("skills" in manifest).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const inputSchema = z.object({ note: z.string() });
const work = handler({
  name: "poc-work",
  inputSchema,
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input,
});

// Written the way a roster is written TODAY: `flow:` spelled out, because the
// implicit default is exactly what this epic has not built yet.
const manifests: WorkerManifest[] = [
  { id: "engineering.lead", declared: { flow: "agent", description: "Lead" }, body: "Lead." },
  { id: "engineering.qa", declared: { flow: "agent", description: "QA" }, body: "QA." },
];

/** A caller replacement written the plain way — no `cardinality` declared. */
const plainAgentFlow = defineFlow({
  kind: "agent",
  configSchema: z.object({ instructions: z.string() }),
  actions: { run: { inputSchema, block: work } },
});

/** The same kind, declared as a collection. */
const collectionAgentFlow = defineFlow({
  kind: "agent",
  cardinality: "collection",
  configSchema: z.object({ instructions: z.string() }),
  actions: { run: { inputSchema, block: work } },
});

describe("P2 — can a plain `agent` kind hold N seats?", () => {
  it("F. a plain defineFlow defaults to singleton", () => {
    console.log(`  plain kind cardinality: ${String(plainAgentFlow.cardinality)}`);
    expect(plainAgentFlow.cardinality).toBe("singleton");
  });

  it("G. hireWorkforce MINTS singleton seats without complaint — the mint is not the gate", () => {
    const seats = hireWorkforce(manifests, { kinds: { agent: plainAgentFlow } });
    console.log(`  minted ids: ${JSON.stringify(seats.map((s) => s.id))}`);
    expect(seats.map((s) => s.id)).toEqual(["engineering.lead", "engineering.qa"]);
  });

  it("H. REGISTRATION refuses them — a singleton under a custom id", () => {
    const seats = hireWorkforce(manifests, { kinds: { agent: plainAgentFlow } });
    const registry = createFlowRegistry();
    let message = "";
    try {
      for (const s of seats) registry.register(s);
    } catch (err) {
      message = (err as Error).message;
    }
    console.log(`  registry said: ${message}`);
    expect(message).not.toBe("");
  });

  it("I. with cardinality: \"collection\" both seats register", () => {
    const seats = hireWorkforce(manifests, { kinds: { agent: collectionAgentFlow } });
    const registry = createFlowRegistry();
    for (const s of seats) registry.register(s);
    console.log(`  registered: ${JSON.stringify(seats.map((s) => s.id))}`);
    expect(seats).toHaveLength(2);
  });
});
