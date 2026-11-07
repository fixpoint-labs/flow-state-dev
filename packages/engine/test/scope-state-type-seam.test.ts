/**
 * The session state a block's `ctx` is typed with is the state a run reads.
 *
 * Two statements describe how block- and capability-declared session state
 * merge: the type a block's `ctx.session.state` carries (its own schema
 * intersected with each capability's in `uses`), and the runtime merge
 * `defineFlow` fills a fresh session's defaults from
 * (`mergeScopeStateSchemas`). Each case reads a fresh session's whole state in
 * a handler and asserts both: the value a run reads, and the type the block
 * was given for it. If either statement drifts, a block reads a field its type
 * doesn't name, or is typed with one a run never fills.
 *
 * The type assertions are checked by this package's `typecheck` (it compiles
 * `test/**`); the value assertions by `vitest`.
 */
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";
import { createResponseEmitter } from "../src/host";

/** A capability that declares session state with a default. */
const tags = defineCapability({
  name: "seam-tags",
  sessionStateSchema: z.object({ tags: z.array(z.string()).default(["new"]) })
});

/** A capability that declares no session state: it contributes none. */
const plain = defineCapability({ name: "seam-plain" });

/** Run `block` once on a fresh session and return its output. */
async function readFresh(kind: string, block: BlockDefinition<any, any>): Promise<unknown> {
  const flow = defineFlow({ kind, actions: { read: { inputSchema: z.object({}), block } } })();
  const result = await runAction({
    orgId: "org_seam",
    flow,
    actionName: "read",
    input: {},
    userId: "user_seam",
    sessionId: `sess_${kind}`,
    stores: createInMemoryStores(),
    responseEmitter: createResponseEmitter({ requestId: `req_${kind}` }),
    runtimeConfig: {}
  });
  expect(result.error).toBeUndefined();
  return result.output;
}

describe("a block's session state type is the state a run reads", () => {
  it("a block's own fields and a capability's, and nothing else", async () => {
    const block = handler({
      name: "own-and-capability",
      inputSchema: z.object({}),
      sessionStateSchema: z.object({ count: z.number().default(0) }),
      uses: [tags, plain],
      execute: (_input, ctx) => {
        expectTypeOf(ctx.session.state).toEqualTypeOf<Readonly<{ count: number; tags: string[] }>>();
        return { ...ctx.session.state };
      }
    });
    expect(await readFresh("seam-own-and-capability", block)).toEqual({ count: 0, tags: ["new"] });
  });

  it("a capability's fields alone, when the block declares none", async () => {
    const block = handler({
      name: "capability-only",
      inputSchema: z.object({}),
      uses: [tags],
      execute: (_input, ctx) => {
        expectTypeOf(ctx.session.state.tags).toEqualTypeOf<string[]>();
        return { ...ctx.session.state };
      }
    });
    expect(await readFresh("seam-capability-only", block)).toEqual({ tags: ["new"] });
  });

  it("one field declared identically by the block and its capability reads once, with one type", async () => {
    const block = handler({
      name: "identical",
      inputSchema: z.object({}),
      sessionStateSchema: z.object({ tags: z.array(z.string()).default(["new"]) }),
      uses: [tags],
      execute: (_input, ctx) => {
        expectTypeOf(ctx.session.state).toEqualTypeOf<Readonly<{ tags: string[] }>>();
        return { ...ctx.session.state };
      }
    });
    expect(await readFresh("seam-identical", block)).toEqual({ tags: ["new"] });
  });

  it("one field the block and its capability type differently: no type reads it, and the flow refuses it", () => {
    const modeAsNumber = defineCapability({
      name: "seam-mode",
      sessionStateSchema: z.object({ mode: z.number().default(1) })
    });
    const block = handler({
      name: "conflict",
      inputSchema: z.object({}),
      sessionStateSchema: z.object({ mode: z.string().default("chat") }),
      uses: [modeAsNumber],
      execute: (_input, ctx) => {
        expectTypeOf(ctx.session.state.mode).toBeNever();
        return {};
      }
    });
    expect(() =>
      defineFlow({ kind: "seam-conflict", actions: { read: { inputSchema: z.object({}), block } } })()
    ).toThrow(/session\.state\.mode/);
  });
});
