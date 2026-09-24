/**
 * Roster admission at registration: the startup fence.
 *
 * A registry that has never held Workforce's branded private roster writer
 * refuses nothing on the roster's account. Once it holds one, it refuses every
 * flow, held or incoming, that declares a collection whose pattern can reach a
 * user-owned roster row, with the messages below. It never disarms.
 *
 * The corpus is the characterization set the change was designed against. Its
 * messages were recorded from the registration path before the check moved to
 * Engine, and are asserted whole: a wording change is a behaviour change for
 * anyone matching on it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import {
  HIRED_ROSTER_PRIVATE_PATTERN,
  markHiredRosterPrivateCollection,
  type FlowInstance,
} from "@flow-state-dev/core/types";
import { createFlowRegistry } from "../src";

const overlapMessage = (pattern: string): string =>
  `Collection pattern "${pattern}" can read user-owned roster rows on the server. ` +
  `Declare "workforce/roster/*" for the org roster. ` +
  `A deep pattern such as "workforce/roster/**" is refused.`;

const REDECLARED =
  `Collection pattern "workforce/roster/[owner]/[seat]" is the workforce roster writer and cannot be redeclared. ` +
  `User-owned roster rows are read through the hire and fire helpers, for the caller only.`;

const BROWSER_READ =
  `Collection pattern "workforce/roster/[owner]/[seat]" must not enable a browser read. ` +
  `User-owned roster rows stay off the browser collection.`;

/** pattern → the complete refusal message in an armed registry, or `null` when admitted. */
const CORPUS: ReadonlyArray<readonly [string, string | null]> = [
  ["workforce/roster/[owner]/notes", overlapMessage("workforce/roster/[owner]/notes")],
  ["workforce/roster/**", overlapMessage("workforce/roster/**")],
  ["workforce/**", overlapMessage("workforce/**")],
  ["workforce/roster/[owner]/[seat]", REDECLARED],
  ["**", overlapMessage("**")],
  ["[tenant]/**", overlapMessage("[tenant]/**")],
  ["[a]/[b]/[c]/[d]", overlapMessage("[a]/[b]/[c]/[d]")],
  ["*/**", overlapMessage("*/**")],
  ["workforce/roster/*", null],
  ["files/**", null],
  ["[tenant]/notes/[id]", null],
  ["[a]/[b]/[c]", null],
];

let n = 0;
const ping = () => {
  n += 1;
  return handler({
    name: `ping-${n}`,
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true }),
  });
};

/** A flow whose resources are set after definition, so registration is measured on its own. */
function flowWith(kind: string, resources: Record<string, unknown>): FlowInstance {
  const flow = defineFlow({
    kind,
    actions: { ping: { inputSchema: z.object({}), block: ping() } },
  })();
  (flow as { resources: unknown }).resources = resources;
  return flow;
}

function writer(options: { browserRead?: boolean } = {}) {
  return markHiredRosterPrivateCollection(
    defineResourceCollection({
      pattern: HIRED_ROSTER_PRIVATE_PATTERN,
      scope: "org",
      flowIsolation: false,
      stateSchema: z.object({}).passthrough(),
      ...(options.browserRead ? { client: { state: { read: true } } } : {}),
    }),
  );
}

const overlapping = (kind: string, pattern: string) =>
  flowWith(kind, { notes: { pattern, scope: "org" } });

function refusal(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("roster admission · a registry that never held the writer", () => {
  it.each(CORPUS)("admits %s", (pattern) => {
    const registry = createFlowRegistry();
    registry.register(overlapping(`unarmed-${++n}`, pattern));
    expect(registry.list()).toHaveLength(1);
  });

  it("admits an unbranded copy of the writer's pattern, which is an ordinary pattern here", () => {
    const registry = createFlowRegistry();
    registry.register(
      flowWith("copy", {
        roster: defineResourceCollection({
          pattern: HIRED_ROSTER_PRIVATE_PATTERN,
          scope: "org",
          stateSchema: z.object({}).passthrough(),
        }),
      }),
    );
    expect(registry.get("copy")).toBeDefined();
  });
});

describe("roster admission · armed by the writer", () => {
  it.each(CORPUS)("writer first, then %s: the complete message, or admitted", (pattern, message) => {
    const registry = createFlowRegistry();
    registry.register(flowWith("writer", { roster: writer() }));
    expect(refusal(() => registry.register(overlapping("late", pattern)))).toBe(message);
    expect(registry.get("late") !== undefined).toBe(message === null);
  });

  it.each(CORPUS.filter(([, message]) => message !== null))(
    "%s first, then the writer: the writer is refused, naming the earlier flow, and nothing changes",
    (pattern, message) => {
      const registry = createFlowRegistry();
      registry.register(overlapping("early", pattern));
      const thrown = refusal(() => registry.register(flowWith("writer", { roster: writer() })));
      expect(thrown).toBe(`${message} Flow "early" declares it and is already registered.`);
      expect(registry.list().map((flow) => flow.id)).toEqual(["early"]);
      // Still unarmed: the refused writer armed nothing.
      registry.register(overlapping("after", "[a]/[b]/[c]/[d]"));
      expect(registry.get("after")).toBeDefined();
    },
  );

  it("refuses one flow that declares both the writer and an overlapping collection", () => {
    const registry = createFlowRegistry();
    const both = flowWith("both", { roster: writer(), wide: { pattern: "[tenant]/**", scope: "org" } });
    expect(refusal(() => registry.register(both))).toBe(overlapMessage("[tenant]/**"));
    expect(registry.list()).toEqual([]);
  });

  it("refuses a writer with a browser read, with nothing else registered", () => {
    const registry = createFlowRegistry();
    expect(refusal(() => registry.register(flowWith("reader", { roster: writer({ browserRead: true }) })))).toBe(
      BROWSER_READ,
    );
    expect(registry.list()).toEqual([]);
  });

  it("stays armed after the writer's flow is unregistered", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("writer", { roster: writer() }));
    expect(registry.unregister("writer")).toBe(true);
    expect(refusal(() => registry.register(overlapping("later", "[a]/[b]/[c]/[d]")))).toBe(
      overlapMessage("[a]/[b]/[c]/[d]"),
    );
  });

  it("admits two writers on two flows, and a writer beside the browser roster", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("writer-a", { roster: writer() }));
    registry.register(flowWith("writer-b", { roster: writer() }));
    registry.register(flowWith("browser", { roster: { pattern: "workforce/roster/*", scope: "org" } }));
    expect(registry.list().map((flow) => flow.id)).toEqual(["browser", "writer-a", "writer-b"]);
  });

  it("checks a flow registered at runtime, with a pin, like any other", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("writer", { roster: writer() }));
    expect(
      refusal(() => registry.register(overlapping("hired", "workforce/roster/**"), { pin: { orgId: "acme" } })),
    ).toBe(overlapMessage("workforce/roster/**"));
  });

  it("registerMany arms on the writer and refuses a later overlap in the same batch", () => {
    const registry = createFlowRegistry();
    expect(
      refusal(() =>
        registry.registerMany([
          flowWith("writer", { roster: writer() }),
          overlapping("wide", "**"),
        ]),
      ),
    ).toBe(overlapMessage("**"));
    expect(registry.list().map((flow) => flow.id)).toEqual(["writer"]);
  });
});
