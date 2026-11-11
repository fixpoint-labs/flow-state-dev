// FIX-2623.
/**
 * `defineView`: a view is refused at definition time when a
 * screen would otherwise meet the mistake at run time: an untyped answer, a
 * scope that doesn't exist, a key that isn't a function, or a flow `views`
 * entry that isn't a view.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineView, handler, sequencer, type ViewOutput } from "../src";

const entries = handler({
  name: "rows",
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({ id: z.string(), n: z.number() })),
  execute: () => [{ id: "a", n: 1 }]
});

describe("defineView", () => {
  it("returns a frozen view carrying its scope, block, key and description", () => {
    const key = (entry: { id: string }) => entry.id;
    const view = defineView({ scope: "user", block: entries, key, description: "the rows" });
    expect(view).toMatchObject({ kind: "view", scope: "user", block: entries, key, description: "the rows" });
    expect(Object.isFrozen(view)).toBe(true);
  });

  it("types its answer from the block's output schema", () => {
    const view = defineView({ scope: "org", block: entries });
    expectTypeOf<ViewOutput<typeof view>>().toEqualTypeOf<Array<{ id: string; n: number }>>();
  });

  it("refuses a block with no output schema, so an answer is never untyped", () => {
    const untyped = handler({ name: "untyped", inputSchema: z.object({}), execute: () => ({}) });
    expect(() => defineView({ scope: "user", block: untyped })).toThrow(/declares no output schema/);
    const open = handler({ name: "open", inputSchema: z.object({}), outputSchema: z.unknown(), execute: () => ({}) });
    expect(() => defineView({ scope: "user", block: open })).toThrow(/declares no output schema/);
  });

  it("takes a sequencer whose last step is typed", () => {
    const seq = sequencer({ name: "seq", inputSchema: z.object({}) }).step(entries);
    expect(() => defineView({ scope: "user", block: seq })).not.toThrow();
  });

  it("refuses a scope that isn't session, user or org, and a key that isn't a function", () => {
    expect(() => defineView({ scope: "request" as never, block: entries })).toThrow(/not "session", "user" or "org"/);
    expect(() => defineView({ scope: "user", block: entries, key: "id" as never })).toThrow(/not a function/);
    expect(() => defineView({ scope: "user", block: {} as never })).toThrow(/not a block/);
  });
});

describe("a flow's views", () => {
  it("are carried on the instance", () => {
    const view = defineView({ scope: "user", block: entries });
    const flow = defineFlow({ kind: "desk", actions: {}, views: { rows: view } })();
    expect(flow.views).toEqual({ rows: view });
  });

  it("refuses an entry that isn't a view, naming it", () => {
    expect(() => defineFlow({ kind: "desk", actions: {}, views: { rows: entries as never } })()).toThrow(
      /view "rows" is not a view/
    );
  });
});
