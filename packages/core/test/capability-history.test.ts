/**
 * A capability's `history` preset key (FIX-1613): a query a capability adds to
 * every `ctx.session.items.history()` read of the generator that installs it.
 *
 * The case it exists for is a history summary: the summary stands for the turns
 * up to its mark, so the generator must read only the turns after it, however
 * that generator reads history (the `history: true` default, or a function slot
 * such as Workforce's `routedTaskHistory`).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability } from "../src/capability";
import { generator } from "../src/blocks/generator";
import { handler } from "../src/blocks/handler";
import type { BlockContext } from "../src";
import type { ItemQuery } from "../src/types";
import { createMockContext, runForTest } from "./helpers";

function contextRecording(queries: (ItemQuery | undefined)[]) {
  return createMockContext({
    resolveModel: () =>
      ({
        modelId: "mock",
        async generate() {
          return { text: "ok" };
        }
      }) as any,
    session: {
      items: {
        history: async (query?: ItemQuery) => {
          queries.push(query);
          return [];
        }
      }
    } as unknown as BlockContext["session"]
  });
}

const afterTurnThree = defineCapability({
  name: "afterTurnThree",
  presets: {
    default: ["history"],
    history: { history: { afterRequestId: "req_3" } }
  }
});

describe("capability history preset key", () => {
  it("narrows the generator's default history read", async () => {
    const queries: (ItemQuery | undefined)[] = [];
    const block = generator({ name: "answer", model: "mock", prompt: "p", history: true, uses: [afterTurnThree] });

    await runForTest(block, "hi", contextRecording(queries));

    expect(queries).toEqual([{ afterRequestId: "req_3" }]);
  });

  it("reaches a history function slot's own read, with the slot's keys on top", async () => {
    const queries: (ItemQuery | undefined)[] = [];
    const block = generator({
      name: "answer",
      model: "mock",
      prompt: "p",
      history: (_input, ctx) => ctx.session.items.history({ limit: { turns: 2 } }),
      uses: [afterTurnThree]
    });

    await runForTest(block, "hi", contextRecording(queries));

    expect(queries).toEqual([{ afterRequestId: "req_3", limit: { turns: 2 } }]);
  });

  it("lets the block's explicit key win over the capability's", async () => {
    const queries: (ItemQuery | undefined)[] = [];
    const block = generator({
      name: "answer",
      model: "mock",
      prompt: "p",
      history: (_input, ctx) => ctx.session.items.history({ afterRequestId: "req_1" }),
      uses: [afterTurnThree]
    });

    await runForTest(block, "hi", contextRecording(queries));

    expect(queries).toEqual([{ afterRequestId: "req_1" }]);
  });

  it("resolves a function of the context at run time", async () => {
    const queries: (ItemQuery | undefined)[] = [];
    const fromRequest = defineCapability({
      name: "fromRequest",
      presets: {
        default: ["history"],
        history: { history: (ctx: BlockContext) => ({ afterRequestId: `after_${ctx.request.identity.id}` }) }
      }
    });
    const block = generator({ name: "answer", model: "mock", prompt: "p", history: true, uses: [fromRequest] });

    await runForTest(block, "hi", contextRecording(queries));

    expect(queries).toEqual([{ afterRequestId: "after_req_1" }]);
  });

  it("is off when the preset is switched off", async () => {
    const queries: (ItemQuery | undefined)[] = [];
    const block = generator({
      name: "answer",
      model: "mock",
      prompt: "p",
      history: true,
      uses: [afterTurnThree.presets({ history: false })]
    });

    await runForTest(block, "hi", contextRecording(queries));

    expect(queries).toEqual([undefined]);
  });

  it("reads the same through a dynamic uses entry as a static one when two capabilities share a dependency", async () => {
    const shared = defineCapability({ name: "shared", presets: { default: ["history"], history: { history: { afterRequestId: "c" } } } });
    const narrows = defineCapability({
      name: "narrows",
      uses: [shared],
      presets: { default: ["history"], history: { history: { afterRequestId: "b" } } }
    });
    const alsoShared = defineCapability({ name: "alsoShared", uses: [shared] });
    const top = defineCapability({ name: "top", uses: [narrows, alsoShared] });
    const read = async (uses: never) => {
      const queries: (ItemQuery | undefined)[] = [];
      await runForTest(generator({ name: "answer", model: "mock", prompt: "p", history: true, uses }), "hi", contextRecording(queries));
      return queries;
    };

    const fixed = await read([top] as never);
    const dynamic = await read([() => [top]] as never);

    // The shared dependency is reached twice, but its query counts once, so
    // the one that depends on it still wins.
    expect(fixed).toEqual([{ afterRequestId: "b" }]);
    expect(dynamic).toEqual(fixed);
  });

  it("is refused on a block that is not a generator", () => {
    expect(() =>
      handler({ name: "h", inputSchema: z.any(), uses: [afterTurnThree], execute: () => "ok" })
    ).toThrow(/declares history, but the consuming block is a handler/);
  });
});
