/**
 * Owner-private admission at registration: the startup fence.
 *
 * A registry that has never held a flow declaring an owner-private collection
 * refuses nothing on its account. Once it holds one, it refuses every flow,
 * held or incoming, that declares another collection in the same scope whose
 * pattern can reach the owner-private collection's keys. It never disarms.
 *
 * The collection here is a generic one, `notes/[owner]/[id]`, so these tests
 * pin Engine's contract without any package's key shape. Messages are
 * asserted whole: a wording change is a behaviour change for anyone matching
 * on it.
 *
 * Every registry, armed or not, refuses a single resource whose storage key
 * has a segment beginning `~`: that segment names an owner, and a single
 * resource's key is the same for every caller.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineCapability,
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler,
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowRegistry } from "../src";

const NOTES = "notes/[owner]/[id]";

const overlap = (pattern: string, owned = NOTES): string =>
  `Collection pattern "${pattern}" can reach the rows of owner-private collection "${owned}". ` +
  `Only that collection reads or writes them, each for the user it belongs to.`;

const held = (id: string): string => ` Flow "${id}" declares it and is already registered.`;

/** pattern → the complete refusal in a registry armed by `notes/[owner]/[id]` at org scope, or `null` when admitted. */
const CORPUS: ReadonlyArray<readonly [string, string | null]> = [
  ["notes/[owner]/meta", overlap("notes/[owner]/meta")],
  ["notes/**", overlap("notes/**")],
  ["**", overlap("**")],
  ["[tenant]/**", overlap("[tenant]/**")],
  ["*/**", overlap("*/**")],
  ["[a]/[b]/[c]", overlap("[a]/[b]/[c]")],
  ["[tenant]/notes/[id]", overlap("[tenant]/notes/[id]")],
  // The owner-private pattern itself, declared without `ownerPrivate`.
  [NOTES, overlap(NOTES)],
  ["notes/*", null],
  ["files/**", null],
  ["[a]/[b]", null],
  ["[a]/[b]/[c]/[d]", null],
  ["drafts/[owner]/[id]", null],
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

/** A fresh owner-private collection object each call, so no test leans on object identity. */
function ownerPrivate(
  options: { pattern?: string; param?: string; scope?: "org" | "user" | "session" } = {},
) {
  return defineResourceCollection({
    pattern: options.pattern ?? NOTES,
    ownerPrivate: { param: options.param ?? "owner" },
    scope: options.scope ?? "org",
    flowIsolation: false,
    stateSchema: z.object({}).passthrough(),
  });
}

const overlapping = (kind: string, pattern: string, scope: string = "org") =>
  flowWith(kind, { wide: { pattern, scope } });

function refusal(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("owner-private admission · a registry that never held one", () => {
  it.each(CORPUS)("admits %s", (pattern) => {
    const registry = createFlowRegistry();
    registry.register(overlapping(`unarmed-${++n}`, pattern));
    expect(registry.list()).toHaveLength(1);
  });

  it("admits the owner-private pattern declared without ownerPrivate: an ordinary pattern here", () => {
    const registry = createFlowRegistry();
    registry.register(
      flowWith("copy", {
        notes: defineResourceCollection({ pattern: NOTES, scope: "org", stateSchema: z.object({}).passthrough() }),
      }),
    );
    expect(registry.get("copy")).toBeDefined();
  });
});

describe("owner-private admission · armed", () => {
  it.each(CORPUS)("owner-private first, then %s: the complete message, or admitted", (pattern, message) => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate() }));
    expect(refusal(() => registry.register(overlapping("late", pattern)))).toBe(message);
    expect(registry.get("late") !== undefined).toBe(message === null);
  });

  it.each(CORPUS.filter(([, message]) => message !== null))(
    "%s first, then the owner-private collection: refused, naming the earlier flow, and nothing changes",
    (pattern, message) => {
      const registry = createFlowRegistry();
      registry.register(overlapping("early", pattern));
      const thrown = refusal(() => registry.register(flowWith("private", { notes: ownerPrivate() })));
      expect(thrown).toBe(`${message}${held("early")}`);
      expect(registry.list().map((flow) => flow.id)).toEqual(["early"]);
      // Still unarmed: the refused declaration armed nothing.
      registry.register(overlapping("after", "[a]/[b]/[c]"));
      expect(registry.get("after")).toBeDefined();
    },
  );

  it("refuses one flow that declares both the owner-private collection and an overlapping one", () => {
    const registry = createFlowRegistry();
    const both = flowWith("both", { notes: ownerPrivate(), wide: { pattern: "[tenant]/**", scope: "org" } });
    expect(refusal(() => registry.register(both))).toBe(overlap("[tenant]/**"));
    expect(registry.list()).toEqual([]);
  });

  it("stays armed after the declaring flow is unregistered: the rows outlive it", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate() }));
    expect(registry.unregister("private")).toBe(true);
    expect(refusal(() => registry.register(overlapping("later", "[a]/[b]/[c]")))).toBe(overlap("[a]/[b]/[c]"));
  });

  it("admits the same declaration on several flows, a spread copy of it, and a collection beside it", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private-a", { notes: ownerPrivate() }));
    registry.register(flowWith("private-b", { notes: ownerPrivate() }));
    registry.register(flowWith("private-c", { mine: { ...ownerPrivate() } }));
    registry.register(overlapping("beside", "notes/*"));
    expect(registry.list().map((flow) => flow.id)).toEqual(["beside", "private-a", "private-b", "private-c"]);
  });

  it("refuses a second owner-private collection in the scope that reaches the first, in either order", () => {
    for (const other of [
      { pattern: "notes/[author]/[id]", param: "author" },
      { pattern: "[area]/[owner]/[id]", param: "owner" },
      { pattern: "notes/[id]/[owner]", param: "owner" },
    ]) {
      const first = createFlowRegistry();
      first.register(flowWith("private", { notes: ownerPrivate() }));
      expect(refusal(() => first.register(flowWith("other", { other: ownerPrivate(other) })))).toBe(
        overlap(other.pattern),
      );

      const reversed = createFlowRegistry();
      reversed.register(flowWith("other", { other: ownerPrivate(other) }));
      expect(refusal(() => reversed.register(flowWith("private", { notes: ownerPrivate() })))).toBe(
        overlap(NOTES, other.pattern),
      );
    }
  });

  it("admits a collection in another scope, which cannot reach the rows, whatever its pattern", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate() }));
    registry.register(overlapping("session-wide", "[tenant]/**", "session"));
    registry.register(flowWith("user-copy", { notes: ownerPrivate({ scope: "user" }) }));
    expect(registry.list().map((flow) => flow.id)).toEqual(["private", "session-wide", "user-copy"]);

    const reversed = createFlowRegistry();
    reversed.register(overlapping("user-wide", "**", "user"));
    reversed.register(flowWith("private", { notes: ownerPrivate() }));
    expect(reversed.get("private")).toBeDefined();
  });

  it("checks held flows against an owner-private collection that arrives after the registry is armed", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate() }));
    registry.register(overlapping("drafts-wide", "drafts/**"));
    expect(
      refusal(() =>
        registry.register(flowWith("drafts", { drafts: ownerPrivate({ pattern: "drafts/[owner]/[id]" }) })),
      ),
    ).toBe(`${overlap("drafts/**", "drafts/[owner]/[id]")}${held("drafts-wide")}`);
    expect(registry.get("drafts")).toBeUndefined();
  });

  it("checks a flow registered at runtime, with a pin, like any other", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate() }));
    expect(refusal(() => registry.register(overlapping("hired", "notes/**"), { pin: { orgId: "acme" } }))).toBe(
      overlap("notes/**"),
    );
  });

  it("refuses a bracketed segment the key matcher reads as a parameter, though it names none", () => {
    // `[a-b]` is not a nameable parameter, but the matcher still reads it as
    // one segment of anything, so `[a-b]/[b]/[c]` reaches `notes/~alice/x`.
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate() }));
    expect(refusal(() => registry.register(overlapping("odd", "[a-b]/[b]/[c]")))).toBe(overlap("[a-b]/[b]/[c]"));
  });

  it("registerMany arms on the owner-private collection and refuses a later overlap in the same batch", () => {
    const registry = createFlowRegistry();
    expect(
      refusal(() => registry.registerMany([flowWith("private", { notes: ownerPrivate() }), overlapping("wide", "**")])),
    ).toBe(overlap("**"));
    expect(registry.list().map((flow) => flow.id)).toEqual(["private"]);
  });

  it("arms on an owner-private collection that reaches the flow through a block's capability", () => {
    const notesCapability = defineCapability({ name: "private-notes", resources: { notes: ownerPrivate() } });
    const block = handler({
      name: "uses-private-notes",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      uses: [notesCapability],
      execute: () => ({ ok: true }),
    });
    const flow = defineFlow({ kind: "capable", actions: { go: { inputSchema: z.object({}), block } } })();
    expect(Object.values(flow.resources ?? {}).some((entry) => "ownerPrivate" in (entry as object))).toBe(true);

    const registry = createFlowRegistry();
    registry.register(flow);
    expect(refusal(() => registry.register(overlapping("wide", "notes/**")))).toBe(overlap("notes/**"));
  });
});

describe("owner-private admission · a single resource keyed with a segment beginning ~", () => {
  const marked = (accessor: string, key: string): string =>
    `Resource "${accessor}" has storage key "${key}", with a segment beginning "~". ` +
    `That segment is reserved for the user an owner-private collection's row belongs to, ` +
    `and a single resource's key is the same for every user.`;

  const single = (scope: "org" | "user" | "session", ref?: string) =>
    defineResource({
      ...(ref === undefined ? {} : { ref }),
      scope,
      stateSchema: z.object({}).passthrough(),
      default: {},
    });

  const SCOPES = ["org", "user", "session"] as const;

  it.each(SCOPES)("refuses one at %s scope in a registry that never held an owner-private collection", (scope) => {
    const registry = createFlowRegistry();
    const thrown = refusal(() =>
      registry.register(flowWith("forger", { seat: single(scope, "notes/~bob/seat") })),
    );
    expect(thrown).toBe(marked("seat", "notes/~bob/seat"));
    expect(registry.list()).toEqual([]);
  });

  it.each(SCOPES)("refuses one at %s scope in an armed registry", (scope) => {
    const registry = createFlowRegistry();
    registry.register(flowWith("private", { notes: ownerPrivate({ scope: scope === "session" ? "org" : scope }) }));
    const thrown = refusal(() =>
      registry.register(flowWith("forger", { seat: single(scope, "notes/~bob/seat") })),
    );
    expect(thrown).toBe(marked("seat", "notes/~bob/seat"));
    expect(registry.list().map((flow) => flow.id)).toEqual(["private"]);
  });

  it("refuses one with no ref whose accessor, and so its key, begins ~", () => {
    const registry = createFlowRegistry();
    expect(refusal(() => registry.register(flowWith("forger", { "~x": single("user") })))).toBe(marked("~x", "~x"));
    expect(registry.list()).toEqual([]);
  });

  it("refuses one that reaches the flow through a block's capability", () => {
    const forging = defineCapability({ name: "forging", resources: { seat: single("org", "notes/~bob/seat") } });
    const block = handler({
      name: "uses-forging",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      uses: [forging],
      execute: () => ({ ok: true }),
    });
    const flow = defineFlow({ kind: "capable-forger", actions: { go: { inputSchema: z.object({}), block } } })();
    const registry = createFlowRegistry();
    expect(refusal(() => registry.register(flow))).toBe(marked("seat", "notes/~bob/seat"));
  });

  it("admits a key with no segment beginning ~, wherever else a ~ sits, and reads the key the runtime writes", () => {
    const registry = createFlowRegistry();
    registry.register(
      flowWith("ordinary", {
        plain: single("org", "notes/bob/seat"),
        inner: single("user", "a~b"),
        trailing: single("org", "notes/bob~"),
        bare: single("session"),
        // The accessor is not the key when a ref is set.
        "~alias": single("org", "aliased"),
      }),
    );
    expect(registry.get("ordinary")).toBeDefined();
  });
});
