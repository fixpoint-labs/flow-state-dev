/**
 * Admission for the `task` and `internal` dispatch types (FIX-999 → the
 * message-protocol port).
 *
 * `resolveEntry` reads exactly one map per dispatch type — `flow.actions` for
 * `user`, `flow.internal` for `internal`, `flow.task` for `task`, and the
 * adapter's namespaced coordinate for `chat` / `webhook` / `schedule` — and
 * NEVER falls through to another type's map. The failure this file exists to
 * prevent is a fall-through: a task or internal dispatch whose name collides
 * with a public action must never resolve that action, whatever is missing
 * from its own type's map. Because the message's type comes from the trusted
 * `source` (stamped by an adapter or the dispatch seam, never a caller), a
 * caller cannot forge its way into a task, internal, chat, webhook or
 * schedule handler by naming one or by injecting a coordinate into `metadata`.
 *
 * The concurrency arbiter and the public re-entry allow-list both depend on
 * the same no-fallback rule, so this file also pins their halves of it: the
 * arbiter must read a dispatch's own entry policy and never a same-named
 * action's, and `task`/`internal` — dispatched only from inside a running
 * request, with no caller-facing entry at all — may never be re-entered
 * through a public retry/continue/resume route, even by a host that tries to
 * opt them in.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bindTaskDispatcher, defineFlow, handler, markDispatcher } from "@flow-state-dev/core";
import { resolveEntry } from "../../src/execution/resolve-entry";
import {
  CHAT_SOURCE,
  INTERNAL_SOURCE,
  SCHEDULED_SOURCE,
  TASK_SOURCE,
  WEBHOOK_SOURCE
} from "../../src/execution/transport-sources";
import { assertPublicReentrySources, isPublicReentryAllowed } from "../../src/routes/public-reentry";
import { createConcurrencyArbiter } from "../../src/transports/concurrency/arbiter";

const publicBlock = handler({
  name: "public-drain",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

const taskBlock = handler({
  name: "task-drain",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

const internalBlock = handler({
  name: "internal-drain",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

/**
 * A board's hand-off at a dispatcher seat, as `taskBoard()` installs it: a
 * block carrying a `task` address and the board's binding. The gate is the
 * identity here so the entry's block stays observable as the one declared —
 * this file is about which MAP resolves, not what the gate wraps.
 */
function boundHandOff(target: string) {
  const block = markDispatcher(
    handler({ name: `hand-off-${target}`, inputSchema: z.unknown(), execute: () => undefined }),
    { type: "task", target, session: "per-task" }
  );
  bindTaskDispatcher(block, { boardId: "b", gate: (entry) => entry });
  return block;
}

const otherBlock = handler({
  name: "other",
  inputSchema: z.object({}).passthrough(),
  execute: () => undefined
});

/**
 * A flow whose PUBLIC action, TASK entry and INTERNAL entry all share the
 * name "drain" — the same name a task or internal dispatch carries. This
 * collision is deliberate: it is what makes a fall-through observable. Only
 * the public action declares a `reject` concurrency policy, so an arbiter
 * that fell through would be caught inheriting it.
 */
function flowWithCollidingNames() {
  return defineFlow({
    kind: "board",
    actions: {
      drain: { block: publicBlock, concurrency: { policy: "reject", key: "session" } },
      handOff: { block: boundHandOff("drain") }
    },
    internal: { actions: { drain: { block: internalBlock } } },
    task: { actions: { drain: { block: taskBlock } } }
  })({ id: "board" });
}

describe("resolveEntry — task and internal never fall through to flow.actions", () => {
  const flow = flowWithCollidingNames();

  it("resolves a task source to flow.task[name]", () => {
    expect(resolveEntry(flow, "drain", TASK_SOURCE, undefined)?.block).toBe(taskBlock);
  });

  it("resolves an internal source to flow.internal[name]", () => {
    expect(resolveEntry(flow, "drain", INTERNAL_SOURCE, undefined)?.block).toBe(internalBlock);
  });

  it("leaves an ordinary caller dispatch resolving the public action, never the internal/task entry", () => {
    expect(resolveEntry(flow, "drain", "http", undefined)?.block).toBe(publicBlock);
    expect(resolveEntry(flow, "drain", undefined, undefined)?.block).toBe(publicBlock);
  });

  it("returns undefined when the type's own map lacks the name — even though it has OTHER entries and flow.actions has this one", () => {
    const partial = defineFlow({
      kind: "partial-maps",
      actions: { drain: { block: publicBlock }, handOff: { block: boundHandOff("other") } },
      internal: { actions: { other: { block: otherBlock } } },
      task: { actions: { other: { block: otherBlock } } }
    })({ id: "partial-maps" });

    expect(resolveEntry(partial, "drain", TASK_SOURCE, undefined)).toBeUndefined();
    expect(resolveEntry(partial, "drain", INTERNAL_SOURCE, undefined)).toBeUndefined();
  });

  it("returns undefined when the type's map does not exist at all", () => {
    const noMaps = defineFlow({
      kind: "no-maps",
      actions: { drain: { block: publicBlock } }
    })({ id: "no-maps" });

    expect(resolveEntry(noMaps, "drain", TASK_SOURCE, undefined)).toBeUndefined();
    expect(resolveEntry(noMaps, "drain", INTERNAL_SOURCE, undefined)).toBeUndefined();
  });
});

describe("resolveEntry — webhook/chat/scheduled need their own coordinate, never a name fallback", () => {
  const flow = defineFlow({
    kind: "coordinated",
    actions: { run: { block: publicBlock } },
    chat: { on: { mention: { block: internalBlock, input: () => ({}) } } },
    webhooks: { github: { on: { push: { block: taskBlock, input: () => ({}) } } } },
    schedules: { static: { nightly: { block: otherBlock, cron: "0 3 * * *" } } }
  })();

  it("resolves nothing for a webhook/chat/scheduled source with NO metadata coordinate", () => {
    expect(resolveEntry(flow, "mention", CHAT_SOURCE, undefined)).toBeUndefined();
    expect(resolveEntry(flow, "push", WEBHOOK_SOURCE, undefined)).toBeUndefined();
    expect(resolveEntry(flow, "nightly", SCHEDULED_SOURCE, undefined)).toBeUndefined();
    // Not even a fallback to the name carried alongside the (absent) coordinate.
    expect(resolveEntry(flow, "run", CHAT_SOURCE, undefined)).toBeUndefined();
  });

  it("resolves via the coordinate when one is present", () => {
    expect(resolveEntry(flow, "irrelevant", CHAT_SOURCE, { chat: { eventKey: "mention" } })?.block).toBe(
      internalBlock
    );
    expect(
      resolveEntry(flow, "irrelevant", WEBHOOK_SOURCE, {
        webhook: { provider: "github", eventType: "push" }
      })?.block
    ).toBe(taskBlock);
    expect(
      resolveEntry(flow, "irrelevant", SCHEDULED_SOURCE, { schedule: { scheduleId: "nightly" } })?.block
    ).toBe(otherBlock);
  });

  it("forged metadata.chat on an http source still resolves the named public action, not the chat entry", () => {
    const forged = { chat: { eventKey: "mention" } };
    expect(resolveEntry(flow, "run", "http", forged)?.block).toBe(publicBlock);
  });

  it("resolves nothing for a coordinate that names no binding — never falls back to the name", () => {
    // Each mismatch on its own axis: an unknown provider, an unknown event
    // under a known provider, a null eventType, an unknown chat key, and an
    // unknown schedule id. None of these fall through to `flow.actions[name]`
    // — the old `resolveActionCore` fell back here; `resolveEntry` never does.
    expect(
      resolveEntry(flow, "run", WEBHOOK_SOURCE, {
        webhook: { provider: "paypal", eventType: "push" }
      })
    ).toBeUndefined();
    expect(
      resolveEntry(flow, "run", WEBHOOK_SOURCE, {
        webhook: { provider: "github", eventType: "pull_request" }
      })
    ).toBeUndefined();
    expect(
      resolveEntry(flow, "run", WEBHOOK_SOURCE, { webhook: { provider: "github", eventType: null } })
    ).toBeUndefined();
    expect(resolveEntry(flow, "run", CHAT_SOURCE, { chat: { eventKey: "reaction" } })).toBeUndefined();
    expect(
      resolveEntry(flow, "run", SCHEDULED_SOURCE, { schedule: { scheduleId: "hourly" } })
    ).toBeUndefined();
  });

  it("resolves nothing on a flow that declares no webhooks/chat/schedules at all", () => {
    // The dynamic-schedule case too: no static coordinate to resolve, and the
    // carried core (not this lookup) is what handles it upstream.
    const bare = defineFlow({ kind: "bare", actions: { run: { block: publicBlock } } })();
    expect(
      resolveEntry(bare, "run", WEBHOOK_SOURCE, { webhook: { provider: "github", eventType: "push" } })
    ).toBeUndefined();
    expect(resolveEntry(bare, "run", CHAT_SOURCE, { chat: { eventKey: "mention" } })).toBeUndefined();
    expect(
      resolveEntry(bare, "run", SCHEDULED_SOURCE, { schedule: { scheduleId: "nightly" } })
    ).toBeUndefined();
    expect(resolveEntry(bare, "run", SCHEDULED_SOURCE, undefined)).toBeUndefined();
  });
});

describe("the concurrency arbiter reads a dispatch's own entry, never a same-named action's policy", () => {
  it("reads the task entry's own concurrency (none declared) for source \"task\" — not the public action's `reject`", () => {
    const flow = flowWithCollidingNames();
    const arbiter = createConcurrencyArbiter();

    const decision = arbiter.resolve(flow as never, "drain", {
      source: TASK_SOURCE,
      metadata: undefined,
      sessionId: "s_1",
      userId: "u_1"
    } as never);

    expect(decision.policy).not.toBe("reject");
  });

  it("reads the internal entry's own concurrency (none declared) for source \"internal\" — not the public action's `reject`", () => {
    const flow = flowWithCollidingNames();
    const arbiter = createConcurrencyArbiter();

    const decision = arbiter.resolve(flow as never, "drain", {
      source: INTERNAL_SOURCE,
      metadata: undefined,
      sessionId: "s_1",
      userId: "u_1"
    } as never);

    expect(decision.policy).not.toBe("reject");
  });

  it("reads flow.actions[name].concurrency for source \"http\"", () => {
    const flow = flowWithCollidingNames();
    const arbiter = createConcurrencyArbiter();

    const decision = arbiter.resolve(flow as never, "drain", {
      source: "http",
      metadata: undefined,
      sessionId: "s_1",
      userId: "u_1"
    } as never);

    expect(decision.policy).toBe("reject");
  });
});

describe("public re-entry — task and internal have no caller-facing entry, so they get no caller-facing re-entry", () => {
  it("refuses task and internal even when a host passes them as additionalSources", () => {
    expect(isPublicReentryAllowed(TASK_SOURCE, [TASK_SOURCE])).toBe(false);
    expect(isPublicReentryAllowed(INTERNAL_SOURCE, [INTERNAL_SOURCE])).toBe(false);
  });

  it("still admits today's public sources", () => {
    expect(isPublicReentryAllowed("http")).toBe(true);
    expect(isPublicReentryAllowed("mcp")).toBe(true);
    expect(isPublicReentryAllowed("chat")).toBe(true);
    expect(isPublicReentryAllowed("scheduled")).toBe(true);
  });

  it("keeps refusing webhook, and refuses an unrecognized source", () => {
    expect(isPublicReentryAllowed("webhook")).toBe(false);
    expect(isPublicReentryAllowed("some-third-party-transport")).toBe(false);
    expect(isPublicReentryAllowed("")).toBe(false);
  });

  it("assertPublicReentrySources throws, by name, on a host that tries to opt task or internal in", () => {
    expect(() => assertPublicReentrySources([TASK_SOURCE])).toThrow(/"task"/);
    expect(() => assertPublicReentrySources([INTERNAL_SOURCE])).toThrow(/"internal"/);
    // A source that was never restricted is untouched.
    expect(() => assertPublicReentrySources(["a-custom-transport"])).not.toThrow();
  });
});
