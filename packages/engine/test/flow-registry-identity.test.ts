/**
 * Flow registry identity: cardinality admission and exact global-id lookup.
 *
 * Four groups — admission, lookup, legacy compatibility, and the schema
 * transaction — each written to fail on a misselection, an invalid admission,
 * or a lost compatibility, not on map layout.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowRegistry, FlowIdentityConflictError } from "../src";

function define(kind: string, cardinality?: "singleton" | "collection") {
  return defineFlow({
    kind,
    ...(cardinality !== undefined ? { cardinality } : {}),
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler<Record<string, never>, { marker: string }>({
          name: `${kind}-run`,
          execute: () => ({ marker: kind })
        })
      }
    }
  });
}

describe("flow registry admission", () => {
  it("refuses a singleton instantiated under a custom id and names the collection declaration", () => {
    const registry = createFlowRegistry();
    const evalLabelled = define("reports")({ id: "eval" });
    // Direct execution keeps the label; only registration refuses it.
    expect(evalLabelled.id).toBe("eval");

    expect(() => registry.register(evalLabelled)).toThrow(FlowIdentityConflictError);
    expect(() => registry.register(evalLabelled)).toThrow(/cardinality: "collection"/);
    expect(registry.list()).toEqual([]);
  });

  it("refuses a duplicate id across kinds and keeps the first reachable", () => {
    const registry = createFlowRegistry();
    const engineer = define("engineer", "collection");
    const billing = define("billing", "collection");
    registry.register(engineer({ id: "shared" }));

    let error: unknown;
    try {
      registry.register(billing({ id: "shared" }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FlowIdentityConflictError);
    expect((error as FlowIdentityConflictError).reason).toBe("duplicate-id");
    expect(registry.get("shared")?.kind).toBe("engineer");
    expect(registry.list()).toHaveLength(1);
  });

  it("refuses one kind under both cardinalities, whichever registers first", () => {
    const registry = createFlowRegistry();
    registry.register(define("engineer", "collection")({ id: "engineer-a" }));
    const singletonFirst = createFlowRegistry();
    singletonFirst.register(define("engineer")());

    // Structural singleton of a kind already registered as a collection.
    const hand: FlowInstance = { ...define("engineer")(), cardinality: "singleton" };
    expect(() => registry.register(hand)).toThrow(/cardinality/);
    expect(registry.get("engineer")).toBeUndefined();

    expect(() =>
      singletonFirst.register(define("engineer", "collection")({ id: "engineer-b" }))
    ).toThrow(/cardinality/);
    expect(singletonFirst.get("engineer-b")).toBeUndefined();
  });
});

describe("flow registry lookup", () => {
  it("resolves a collection member by its exact id and never by the bare kind", () => {
    const registry = createFlowRegistry();
    const engineer = define("engineer", "collection");
    registry.register(engineer({ id: "engineer-a" }));
    // A lone member is still not the kind's answer.
    expect(registry.get("engineer")).toBeUndefined();
    expect(registry.get("engineer-a")?.id).toBe("engineer-a");

    registry.register(engineer({ id: "engineer-b" }));
    expect(registry.get("engineer")).toBeUndefined();
    expect(registry.get("engineer-b")?.id).toBe("engineer-b");
  });

  it("does not pick a member by registration order", () => {
    const later = createFlowRegistry();
    const engineer = define("engineer", "collection");
    later.register(engineer({ id: "engineer-b" }));
    later.register(engineer({ id: "engineer-a" }));
    expect(later.get("engineer")).toBeUndefined();
    expect(later.get("engineer-a")?.id).toBe("engineer-a");
    expect(later.list().map((f) => f.id)).toEqual(["engineer-a", "engineer-b"]);
  });

  it("lets an exact id win a kind-name collision", () => {
    const registry = createFlowRegistry();
    const engineer = define("engineer", "collection");
    const billing = define("billing", "collection");
    registry.register(engineer({ id: "engineer-a" }));
    registry.register(engineer({ id: "engineer-b" }));
    registry.register(billing({ id: "engineer" }));

    expect(registry.get("engineer")?.kind).toBe("billing");

    const without = createFlowRegistry();
    without.register(engineer({ id: "engineer-a" }));
    without.register(engineer({ id: "engineer-b" }));
    expect(without.get("engineer")).toBeUndefined();
  });

  it("admits a collection member whose id is its own kind, as an exact id", () => {
    const registry = createFlowRegistry();
    const engineer = define("engineer", "collection");
    registry.register(engineer({ id: "engineer" }));
    registry.register(engineer({ id: "engineer-a" }));
    expect(registry.get("engineer")?.id).toBe("engineer");
    expect(registry.get("engineer-a")?.id).toBe("engineer-a");
  });
});

describe("flow registry legacy compatibility", () => {
  it("admits a structural instance without cardinality only when id equals kind, normalized to singleton", () => {
    const registry = createFlowRegistry();
    const { cardinality: _dropped, ...legacy } = define("legacy")();
    registry.register(legacy as unknown as FlowInstance);
    expect(registry.get("legacy")?.cardinality).toBe("singleton");

    const { cardinality: _dropped2, ...custom } = define("legacy-custom")({ id: "custom-id" });
    expect(() => registry.register(custom as unknown as FlowInstance)).toThrow(FlowIdentityConflictError);
    expect(registry.get("custom-id")).toBeUndefined();
  });
});

describe("flow registry schema transaction", () => {
  it("leaves lookup and listing unchanged when a schema conflict refuses an otherwise unique id", () => {
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "a",
        actions: {},
        user: { stateSchema: z.object({ theme: z.string() }) }
      })()
    );
    expect(() =>
      registry.register(
        defineFlow({
          kind: "b",
          actions: {},
          user: { stateSchema: z.object({ theme: z.number() }) }
        })()
      )
    ).toThrow(/incompatible/);
    expect(registry.get("b")).toBeUndefined();
    expect(registry.list().map((f) => f.id)).toEqual(["a"]);
    expect(registry.describeSharedSchemas().participants.user).toEqual(["a"]);
  });

  it("registerMany keeps the admitted prefix when a later element fails", () => {
    const registry = createFlowRegistry();
    const engineer = define("engineer", "collection");
    expect(() =>
      registry.registerMany([
        engineer({ id: "one" }),
        engineer({ id: "two" }),
        engineer({ id: "one" }),
        engineer({ id: "three" })
      ])
    ).toThrow(FlowIdentityConflictError);
    expect(registry.list().map((f) => f.id)).toEqual(["one", "two"]);
  });
});
