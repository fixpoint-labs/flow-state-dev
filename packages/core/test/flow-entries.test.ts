/**
 * Typed entries on the flow: `internal`, `tasks`, the address walk, and the
 * one keyed lookup with no fallback.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, dispatcher, generator, handler, resolveEntry, sequencer } from "../src";
import { TASK_ENTRY, markDispatcher, markTaskEntry } from "../src/types/dispatch";

const noop = handler({ name: "noop", inputSchema: z.unknown(), execute: () => null });
const wake = handler({ name: "wake", inputSchema: z.object({ reason: z.string() }), execute: () => null });

const wakeEpic = dispatcher({
  name: "wake-epic",
  type: "internal",
  target: "wake",
  session: { id: () => "s_epic" }
});

describe("internal entries", () => {
  it("declares an internal entry the instance and the blueprint both carry", () => {
    const flow = defineFlow({
      kind: "with-internal",
      actions: { run: { block: noop } },
      internal: { wake: { block: wake } }
    });
    expect(flow.internal?.wake.block).toBe(wake);
    expect(flow().internal?.wake.block).toBe(wake);
  });

  it("is absent on a flow that declares none", () => {
    const flow = defineFlow({ kind: "plain", actions: { run: { block: noop } } });
    expect(flow.internal).toBeUndefined();
    expect(flow().internal).toBeUndefined();
    expect(flow().tasks).toBeUndefined();
  });

  it("refuses an entry with no block, by name", () => {
    expect(() =>
      defineFlow({
        kind: "no-block",
        actions: {},
        internal: { wake: {} as never }
      })
    ).toThrow(/internal entry "wake" has no block/);
  });

  it("validates an entry's concurrency policy like an action's", () => {
    expect(() =>
      defineFlow({
        kind: "bad-policy",
        actions: {},
        internal: { wake: { block: wake, concurrency: "debounce" as never } }
      })
    ).toThrow(/internal entry "wake"/);
  });

  it("is definition-only: an instance option is refused", () => {
    const flow = defineFlow({ kind: "instance-internal", actions: {} });
    expect(() => flow({ internal: { wake: { block: wake } } } as never)).toThrow(
      /"internal", which is not an instance option/
    );
  });
});

describe("the address walk", () => {
  it("accepts a dispatcher whose target the flow declares", () => {
    expect(() =>
      defineFlow({
        kind: "resolves",
        actions: { run: { block: sequencer({ name: "run" }).step(wakeEpic) } },
        internal: { wake: { block: wake } }
      })
    ).not.toThrow();
  });

  it("refuses a dispatcher whose target the flow does not declare, naming both", () => {
    expect(() =>
      defineFlow({
        kind: "unresolved",
        actions: { run: { block: sequencer({ name: "run" }).step(wakeEpic) } }
      })
    ).toThrow(/block "wake-epic", which dispatches to internal:"wake"/);
  });

  it("does not let an action with the same name stand in for the missing entry", () => {
    // No fallback: `actions.wake` is a `user` entry and cannot satisfy an
    // `internal` address.
    expect(() =>
      defineFlow({
        kind: "no-fallback",
        actions: { wake: { block: wake }, run: { block: sequencer({ name: "run" }).step(wakeEpic) } }
      })
    ).toThrow(/declares no such entry/);
  });

  it("reaches a dispatcher through a rescue handler", () => {
    expect(() =>
      defineFlow({
        kind: "via-rescue",
        actions: { run: { block: noop.rescue([{ block: wakeEpic }]) } }
      })
    ).toThrow(/dispatches to internal:"wake"/);
  });

  it("reaches a dispatcher handed to a model as a tool", () => {
    const agent = generator({
      name: "agent",
      model: "openai/gpt-5.4-mini",
      prompt: "decide",
      tools: [wakeEpic]
    });
    expect(() => defineFlow({ kind: "via-tool", actions: { run: { block: agent } } })).toThrow(
      /dispatches to internal:"wake"/
    );
  });

  it("reaches a dispatcher a `forEach` factory declares through `blocks`", () => {
    // A factory-built iteration is invisible to the walk on its own — the
    // block does not exist until `forEach` runs. `blocks` is how the factory
    // declares what it can produce, so the address check still covers it.
    const pool = sequencer({ name: "pool" }).forEach(
      () => [1, 2],
      () => sequencer({ name: "worker" }).step(wakeEpic),
      { blocks: [wakeEpic] }
    );
    expect(() => defineFlow({ kind: "via-factory", actions: { run: { block: pool } } })).toThrow(
      /dispatches to internal:"wake"/
    );
    expect(() =>
      defineFlow({
        kind: "via-factory-declared",
        actions: { run: { block: pool } },
        internal: { wake: { block: wake } }
      })
    ).not.toThrow();
  });

  it("reads `blocks` as options in the two-argument shape too", () => {
    // `forEach(factory, { blocks })` — no connector, no concurrency knob. The
    // trailing object must still be read as options, or it is taken for the
    // per-item block and the declaration is silently dropped.
    const pool = sequencer({ name: "pool", inputSchema: z.array(z.number()) }).forEach(
      () => sequencer({ name: "worker" }).step(wakeEpic),
      { blocks: [wakeEpic] }
    );
    expect(() => defineFlow({ kind: "via-factory-two-arg", actions: { run: { block: pool } } })).toThrow(
      /dispatches to internal:"wake"/
    );
  });

  it("cannot see a factory-built iteration that declares nothing", () => {
    // The contrast that makes the assertion above able to fail: without
    // `blocks`, the same pool defines cleanly and the missing entry would
    // surface only when the dispatcher ran.
    const pool = sequencer({ name: "pool" }).forEach(
      () => [1, 2],
      () => sequencer({ name: "worker" }).step(wakeEpic)
    );
    expect(() => defineFlow({ kind: "via-factory-silent", actions: { run: { block: pool } } })).not.toThrow();
  });

  it("reaches a dispatcher inside an internal entry's own block", () => {
    const chained = dispatcher({
      name: "chain",
      type: "internal",
      target: "missing",
      session: { key: () => "k" }
    });
    expect(() =>
      defineFlow({
        kind: "nested",
        actions: {},
        internal: { wake: { block: sequencer({ name: "wake-seq" }).step(chained) } }
      })
    ).toThrow(/internal:"missing"/);
  });
});

describe("task entries", () => {
  const entryFor = (boardId: string) => markTaskEntry({ block: noop }, { boardId });
  const handOff = (target: string, boardId: string) =>
    markDispatcher(
      handler({ name: `hand-off-${target}`, inputSchema: z.unknown(), execute: () => null }),
      { type: "task", target, boardId }
    );

  it("accepts entries a board produced and mirrors them on the blueprint", () => {
    const flow = defineFlow({
      kind: "board-entries",
      actions: { run: { block: sequencer({ name: "run" }).step(handOff("implement", "issues")) } },
      tasks: { implement: entryFor("issues") }
    });
    expect(flow.tasks?.implement[TASK_ENTRY]).toEqual({ boardId: "issues" });
    expect(flow().tasks?.implement.block).toBe(noop);
  });

  it("refuses a hand-written task entry", () => {
    expect(() =>
      defineFlow({
        kind: "raw-task",
        actions: {},
        tasks: { implement: { block: noop } as never }
      })
    ).toThrow(/task entry "implement" was not produced by a task board/);
  });

  it("refuses a hand-off to a task entry the flow does not declare", () => {
    expect(() =>
      defineFlow({
        kind: "no-task-entry",
        actions: { run: { block: sequencer({ name: "run" }).step(handOff("implement", "issues")) } }
      })
    ).toThrow(/hands off to task:"implement".*declares no such task entry/);
  });

  it("refuses a hand-off whose entry belongs to another board", () => {
    expect(() =>
      defineFlow({
        kind: "shadowed",
        actions: { run: { block: sequencer({ name: "run" }).step(handOff("implement", "issues")) } },
        tasks: { implement: entryFor("reviews") }
      })
    ).toThrow(/belongs to board "reviews"/);
  });

  it("is definition-only: an instance option is refused", () => {
    const flow = defineFlow({ kind: "instance-tasks", actions: {} });
    expect(() => flow({ tasks: { implement: entryFor("issues") } } as never)).toThrow(
      /"tasks", which is not an instance option/
    );
  });
});

describe("resolveEntry — one lookup, no fallback", () => {
  const flow = defineFlow({
    kind: "lookup",
    actions: { chat: { block: noop }, wake: { block: noop } },
    internal: { wake: { block: wake }, status: { block: noop } },
    tasks: { implement: markTaskEntry({ block: noop }, { boardId: "issues" }) },
    chat: { on: { mention: { block: noop, input: () => ({}) } } },
    webhooks: { github: { on: { push: { block: noop, input: () => ({}) } } } },
    schedules: { static: { nightly: { block: noop, cron: "0 3 * * *" } } }
  })();

  it("reads each type's own map", () => {
    expect(resolveEntry(flow, "user", "chat")?.block).toBe(noop);
    expect(resolveEntry(flow, "internal", "wake")?.block).toBe(wake);
    expect(resolveEntry(flow, "task", "implement")?.block).toBe(noop);
    expect(resolveEntry(flow, "chat", "any", { chat: { eventKey: "mention" } })?.block).toBe(noop);
    expect(
      resolveEntry(flow, "webhook", "any", { webhook: { provider: "github", eventType: "push" } })
        ?.block
    ).toBe(noop);
    expect(
      resolveEntry(flow, "schedule", "any", { schedule: { scheduleId: "nightly" } })?.block
    ).toBe(noop);
  });

  it("never resolves another type's map", () => {
    // `wake` exists as a user action AND an internal entry; each type sees only its own.
    expect(resolveEntry(flow, "user", "wake")?.block).toBe(noop);
    expect(resolveEntry(flow, "internal", "wake")?.block).toBe(wake);
    // `status` is internal only; `chat` is user only; `implement` is task only.
    expect(resolveEntry(flow, "user", "status")).toBeUndefined();
    expect(resolveEntry(flow, "internal", "chat")).toBeUndefined();
    expect(resolveEntry(flow, "user", "implement")).toBeUndefined();
    expect(resolveEntry(flow, "task", "wake")).toBeUndefined();
  });

  it("refuses a protocol-owned type with no coordinate rather than reading the name", () => {
    expect(resolveEntry(flow, "chat", "chat")).toBeUndefined();
    expect(resolveEntry(flow, "webhook", "push")).toBeUndefined();
    expect(resolveEntry(flow, "schedule", "nightly")).toBeUndefined();
    expect(resolveEntry(flow, "webhook", "any", { webhook: { provider: "github" } })).toBeUndefined();
  });

  it("resolves nothing for a name that spells an inherited member", () => {
    expect(resolveEntry(flow, "user", "constructor")).toBeUndefined();
    expect(resolveEntry(flow, "internal", "__proto__")).toBeUndefined();
    expect(resolveEntry(flow, "task", "toString")).toBeUndefined();
  });
});
