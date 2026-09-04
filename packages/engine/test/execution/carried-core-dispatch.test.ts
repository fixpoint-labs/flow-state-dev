/**
 * A carried action core cannot smuggle in a dispatch this flow cannot route
 * (FIX-982 → the message-protocol port).
 *
 * A dynamic schedule (`schedules.resolve`) produces its handler block at
 * dispatch time, so that block is not reachable from the flow definition and
 * `defineFlow`'s address walk never sees it. If it contains a `dispatcher()`
 * whose target the flow does not declare, nothing catches that until the
 * dispatcher actually runs and the seam refuses `no-entry` — after the
 * request has already been admitted and, for a task hand-off, after a row has
 * already been claimed. That is the class this epic keeps closing: work that
 * stalls without erroring.
 *
 * The refusal moves to the moment the core is adopted — before any block
 * runs, so before anything is claimed — where the check is exact: this block
 * dispatches to an address the flow does not declare.
 *
 * The same traversal `defineFlow` makes — composition through `childBlocks`,
 * plus a generator's static `tools` array — so a dispatcher handed to a model
 * as a tool inside a carried core is caught on the same terms as one at the
 * top level.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, dispatcher, generator, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../../src";
import { createMockModelResolver } from "@flow-state-dev/testing";

const SCHEDULED_SOURCE = "scheduled";

/** A dispatcher whose target no flow in this file declares. */
function missingDispatch() {
  return dispatcher({
    name: "wake-missing",
    type: "internal",
    target: "missing",
    session: { key: () => "k" }
  });
}

/** A flow with no `internal` entries — the case a resolver smuggles a dispatch into. */
function plainFlow() {
  return defineFlow({
    kind: "carried-core",
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: handler({ name: "plain-action", execute: () => ({ ok: true }) })
      }
    }
  } as never)({ id: "carried-core" });
}

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function runCarried(
  flow: ReturnType<typeof plainFlow>,
  core: { block: unknown; onCompleted?: unknown; onErrored?: unknown }
) {
  return runAction({
    flow,
    actionName: "resolved-at-dispatch" as never,
    input: {},
    userId: "u_1",
    sessionId: "s_1",
    source: SCHEDULED_SOURCE,
    metadata: { schedule: { scheduleId: "nightly" } },
    resolvedActionCore: core as never,
    stores: createInMemoryStores(),
    runtimeConfig: baseRuntimeConfig()
  });
}

describe("a dispatch-time core carrying an unroutable dispatch is refused by name", () => {
  // REJECTS rather than resolving with an `error`, and that is the right shape:
  // the core is adopted before the request is registered, so there is no record
  // to fail. The dispatch itself fails — nothing claimed, nothing written,
  // nothing left behind to recover.
  it("refuses when the root block IS the dispatcher", async () => {
    await expect(runCarried(plainFlow(), { block: missingDispatch() as never })).rejects.toThrow(
      /wake-missing/
    );
  });

  it("names the address, so the message points at what would not run", async () => {
    await expect(runCarried(plainFlow(), { block: missingDispatch() as never })).rejects.toThrow(
      /internal:"missing"/
    );
  });

  it("names the flow, so an operator knows which definition is missing the entry", async () => {
    await expect(runCarried(plainFlow(), { block: missingDispatch() as never })).rejects.toThrow(
      /carried-core/
    );
  });

  it("refuses a dispatcher reached only through the root block's composition (childBlocks)", async () => {
    const wrapped = handler({ name: "ordinary-root-3", execute: () => ({ ok: true }) }).rescue([
      { block: missingDispatch() }
    ]);
    await expect(runCarried(plainFlow(), { block: wrapped as never })).rejects.toThrow(
      /wake-missing/
    );
  });

  it("refuses a dispatcher mounted on the core's onCompleted observer", async () => {
    // `runAction` executes the observers as real blocks, so a dispatcher under
    // one dispatches exactly as one under the root. Checking only `core.block`
    // left the observers as a way in.
    await expect(
      runCarried(plainFlow(), {
        block: handler({ name: "ordinary-root", execute: () => ({ ok: true }) }) as never,
        onCompleted: missingDispatch() as never
      })
    ).rejects.toThrow(/wake-missing/);
  });

  it("refuses a dispatcher mounted on the core's onErrored observer", async () => {
    await expect(
      runCarried(plainFlow(), {
        block: handler({ name: "ordinary-root-2", execute: () => ({ ok: true }) }) as never,
        onErrored: missingDispatch() as never
      })
    ).rejects.toThrow(/wake-missing/);
  });

  it("refuses a dispatcher reachable only through a generator's static tools array", async () => {
    const agent = generator({
      name: "agent",
      model: "openai/gpt-5.4-mini",
      prompt: "decide",
      tools: [missingDispatch()]
    });
    await expect(runCarried(plainFlow(), { block: agent as never })).rejects.toThrow(
      /wake-missing/
    );
  });

  it("allows a carried core whose dispatcher target the flow already declares", async () => {
    // THE CONTROL, and the reason the check compares the resolved address
    // rather than merely asking "does this core carry any dispatch". A
    // resolver may legitimately return a core built around a dispatcher whose
    // target the flow ALSO declares statically — refusing that would outlaw
    // the combination rather than the hole. The dispatcher sits behind a
    // `.rescue()` so this run never actually reaches the seam — the check
    // under test is the definition-time address walk, not execution.
    const work = handler({ name: "work", execute: () => null });
    const guarded = handler({ name: "ordinary-root-4", execute: () => ({ ok: true }) }).rescue([
      {
        block: dispatcher({
          name: "wake-work",
          type: "internal",
          target: "work",
          session: { key: () => "k" }
        })
      }
    ]);
    const flow = defineFlow({
      kind: "carried-core",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({ name: "plain-action", execute: () => ({ ok: true }) })
        }
      },
      internal: { actions: { work: { block: work } } }
    } as never)({ id: "carried-core" });

    const result = await runCarried(flow as never, { block: guarded as never });
    expect(result.error).toBeUndefined();
  });

  it("leaves a carried core that dispatches nothing alone", async () => {
    const result = await runCarried(plainFlow(), {
      block: handler({ name: "ordinary-scheduled-handler", execute: () => ({ ok: true }) }) as never
    });
    expect(result.error).toBeUndefined();
  });
});
