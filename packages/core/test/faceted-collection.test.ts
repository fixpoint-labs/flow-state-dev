/**
 * `defineFacetedCollection` build-time checks.
 *
 * Every misconfiguration here is one that would otherwise surface only at the
 * first write, or never: stale facets after a client edit, a reaction running
 * without the resources its evaluator reads, a key the reaction can't
 * address. Each is refused when the collection is defined, with its reason.
 * A valid config builds and calls nothing (no model is named or resolved).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  boolean,
  choice,
  defineFacetedCollection,
  defineResource,
  defineResourceCollection,
  evaluator,
  handler,
  type EvaluationModel,
} from "../src";

function countingModel(): EvaluationModel & { doEvaluate: ReturnType<typeof vi.fn> } {
  return {
    specificationVersion: "v4",
    provider: "mock.evaluation",
    modelId: "mock-evaluation",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: vi.fn(),
  } as unknown as EvaluationModel & { doEvaluate: ReturnType<typeof vi.fn> };
}

const questions = {
  topic: choice("Topic?", { billing: "b", outage: "o" }),
  urgent: boolean("Urgent?"),
};

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "tickets",
    pattern: "tickets/*",
    scope: "user" as const,
    stateSchema: z.object({ title: z.string() }),
    evaluator: evaluator({ name: "triage", model: countingModel(), questions }),
    ...overrides,
  };
}

const build = (overrides: Record<string, unknown> = {}) =>
  defineFacetedCollection(base(overrides) as Parameters<typeof defineFacetedCollection>[0]);

const noop = handler({ name: "noop", inputSchema: z.any(), execute: async () => undefined });

describe("VB: a valid config", () => {
  it("builds the collection, search, reindex and resources, and calls nothing", () => {
    const model = countingModel();
    const tickets = build({ evaluator: evaluator({ name: "triage", model, questions }) });
    expect(tickets.collection.pattern).toBe("tickets/*");
    expect(Object.keys(tickets.collection.stateSchema.shape).sort()).toEqual(["facets", "indexedAs", "title"]);
    expect(tickets.collection.reactTo?.contentUpdated).toBeDefined();
    expect(tickets.search.name).toBe("search-tickets");
    expect(tickets.reindex.name).toBe("reindex-tickets");
    expect(tickets.resources).toEqual({ tickets: tickets.collection });
    expect(model.doEvaluate).not.toHaveBeenCalled();
  });

  it("adds facets and indexedAs as nullable fields that default to null", () => {
    const parsed = build().collection.stateSchema.parse({ title: "t" });
    expect(parsed).toEqual({ title: "t", facets: null, indexedAs: null });
  });

  it("allows client reads and deletes", () => {
    const tickets = build({ client: { content: { read: true, delete: true }, state: { read: true } } });
    expect(tickets.collection.client).toBeDefined();
  });

  it("passes the app's own created / stateUpdated / deleted bindings through", () => {
    const tickets = build({ reactTo: { created: noop, stateUpdated: noop, deleted: noop } });
    expect(tickets.collection.reactTo?.created).toBe(noop);
    expect(tickets.collection.reactTo?.stateUpdated).toBe(noop);
    expect(tickets.collection.reactTo?.deleted).toBe(noop);
    expect(tickets.collection.reactTo?.contentUpdated).not.toBe(noop);
  });
});

describe("VB: refused when built", () => {
  it("BR-1: an evaluator slot holding another kind of block, with core's shared message", () => {
    expect(() => build({ evaluator: noop })).toThrow(
      /defineFacetedCollection "tickets": evaluator must be an evaluator block \(got handler "noop"\)\. Build one with/
    );
  });

  it("BR-2: questions computed per call", () => {
    const dynamic = evaluator({ name: "dyn", model: countingModel(), questions: () => questions });
    expect(() => build({ evaluator: dynamic })).toThrow(/computes its questions per call.*fixed questions object/);
  });

  it("BR-3: a contentUpdated binding, naming the utility as its owner", () => {
    expect(() => build({ reactTo: { contentUpdated: noop } })).toThrow(/reactTo\.contentUpdated.*owns that reaction/);
  });

  it("BR-4: client body creates or updates", () => {
    expect(() => build({ client: { content: { create: true } } })).toThrow(/client\.content\.create.*runs no reaction/);
    expect(() => build({ client: { content: { update: true } } })).toThrow(/client\.content\.update/);
  });

  it("BR-5: a stateSchema that isn't an object, or already declares facets or indexedAs", () => {
    expect(() => build({ stateSchema: z.string() })).toThrow(/stateSchema must be a z\.object/);
    expect(() => build({ stateSchema: z.object({ facets: z.any() }) })).toThrow(
      /already declares "facets".*delete them from your stateSchema/
    );
    expect(() => build({ stateSchema: z.object({ indexedAs: z.string() }) })).toThrow(/already declares "indexedAs"/);
  });

  it("BR-6: a question id of minConfidence", () => {
    const colliding = evaluator({
      name: "c",
      model: countingModel(),
      questions: { minConfidence: choice("?", { a: "a" }) },
    });
    expect(() => build({ evaluator: colliding })).toThrow(/"minConfidence".*collides with the search option/);
  });

  it("a read-only collection (writable: false): indexing writes state on every body write", () => {
    expect(() => build({ writable: false })).toThrow(/writable: false.*facets and indexedAs/);
    expect(() => build({ writable: true })).not.toThrow();
  });

  it("an evaluator whose input schema rejects the body string", () => {
    const objectInput = evaluator({
      name: "object-input",
      model: countingModel(),
      questions,
      inputSchema: z.object({ message: z.string() }),
      state: (input) => input.message,
    });
    expect(() => build({ evaluator: objectInput })).toThrow(/evaluator "object-input" can't take the body.*string/);
    const stringInput = evaluator({ name: "string-input", model: countingModel(), questions, inputSchema: z.string() });
    expect(() => build({ evaluator: stringInput })).not.toThrow();
    // A connector that adapts the body string is accepted.
    const adapted = objectInput.connectInput((body: string) => ({ message: body }));
    expect(() => build({ evaluator: adapted })).not.toThrow();
  });

  it("BR-26: a parameterized key pattern, naming wildcard patterns", () => {
    expect(() => build({ pattern: "[topic]/observations" })).toThrow(/has parameters.*wildcard pattern/);
  });

  it("BR-28: an evaluator with a flowConfigSchema", () => {
    const configured = evaluator({
      name: "configured",
      model: countingModel(),
      questions,
      flowConfigSchema: z.object({ tone: z.string() }),
    });
    expect(() => build({ evaluator: configured })).toThrow(/declares a flowConfigSchema/);
  });

  it("BR-28: an evaluator with a lazy single resource", () => {
    const lazy = defineResource({
      scope: "user",
      stateSchema: z.object({ n: z.number() }),
      default: { n: 0 },
      prefetchMode: "lazy",
    });
    const e = evaluator({ name: "lazy", model: countingModel(), questions, resources: { lazy } });
    expect(() => build({ evaluator: e })).toThrow(/declares "lazy" with prefetchMode: 'lazy'/);
  });

  it("BR-27: an evaluator resource under the collection's own accessor", () => {
    const other = defineResourceCollection({ pattern: "other/*", scope: "user", stateSchema: z.object({}) });
    const e = evaluator({ name: "clash", model: countingModel(), questions, resources: { tickets: other } });
    expect(() => build({ evaluator: e })).toThrow(/declares a resource under "tickets", the collection's own accessor/);
  });
});

describe("BR-27: the evaluator's declared resources are carried", () => {
  it("returns them beside the collection in resources", () => {
    const glossary = defineResourceCollection({ pattern: "glossary/*", scope: "user", stateSchema: z.object({}) });
    const e = evaluator({ name: "reads", model: countingModel(), questions, resources: { glossary } });
    const tickets = build({ evaluator: e });
    expect(tickets.resources).toEqual({ tickets: tickets.collection, glossary });
  });
});

describe("V8: the utility's fence", () => {
  /** Why a source breaks the fence; empty when it doesn't. */
  function fenceViolations(source: string): string[] {
    const problems: string[] = [];
    for (const [, spec] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (!spec!.startsWith(".") && spec !== "zod") problems.push(`imports ${spec}`);
    }
    if (/intentClassifier/.test(source)) problems.push("uses intentClassifier");
    if (/\bgenerator\s*\(/.test(source)) problems.push("builds a generator");
    return problems;
  }

  it("imports core modules and zod only, and builds no classifier of its own", () => {
    const source = readFileSync(join(__dirname, "../src/types/faceted-collection.ts"), "utf8");
    expect(fenceViolations(source)).toEqual([]);
  });

  it("negative control: a planted lab import, node builtin or generator is caught", () => {
    expect(fenceViolations(`import { x } from "@flow-state-dev/lab-typesafe-jev";`)).toEqual([
      "imports @flow-state-dev/lab-typesafe-jev",
    ]);
    expect(fenceViolations(`import { randomUUID } from "node:crypto";`)).toEqual(["imports node:crypto"]);
    expect(fenceViolations(`const g = generator({ name: "g" });`)).toEqual(["builds a generator"]);
    expect(fenceViolations(`utility.intentClassifier({})`)).toEqual(["uses intentClassifier"]);
  });
});
