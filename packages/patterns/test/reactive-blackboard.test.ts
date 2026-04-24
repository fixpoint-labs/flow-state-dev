import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  reactiveBlackboard,
  actor,
  mesh,
  matchTopic,
  compilePattern,
  createReactiveBlackboard,
  reactiveBlackboardStateSchema,
  emitControlSchema,
  createAppendEntry,
  normalizeToEntries,
} from "../src/reactive-blackboard";
import type {
  ActorConfig,
  Actor,
  ReactiveBlackboardState,
} from "../src/reactive-blackboard";

// ---------------------------------------------------------------------------
// Test entry schema
// ---------------------------------------------------------------------------

const entrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("observation"),
    topic: z.string(),
    body: z.any(),
  }),
  z.object({
    type: z.literal("event"),
    topic: z.string(),
    body: z.any(),
  }),
  z.object({
    type: z.literal("request"),
    topic: z.string(),
    body: z.any(),
  }),
]);

const emptyBoardState: ReactiveBlackboardState = { entries: [] };

// ---------------------------------------------------------------------------
// matchTopic
// ---------------------------------------------------------------------------

describe("matchTopic", () => {
  describe("exact matches", () => {
    it("matches exact type:topic", () => {
      expect(matchTopic("observation:slack", "observation:slack")).toBe(true);
    });

    it("rejects non-matching exact", () => {
      expect(matchTopic("observation:slack", "event:slack")).toBe(false);
    });
  });

  describe("single wildcard (*)", () => {
    it("matches single segment in topic position", () => {
      expect(matchTopic("observation:*", "observation:slack")).toBe(true);
      expect(matchTopic("observation:*", "observation:email")).toBe(true);
    });

    it("does not match across segment boundaries", () => {
      expect(matchTopic("observation:*", "observation:slack.message")).toBe(
        false
      );
    });

    it("matches single segment in type position", () => {
      expect(matchTopic("*:slack", "observation:slack")).toBe(true);
      expect(matchTopic("*:slack", "event:slack")).toBe(true);
    });

    it("matches within dotted topics", () => {
      expect(matchTopic("observation:slack.*", "observation:slack.message")).toBe(
        true
      );
      expect(matchTopic("observation:slack.*", "observation:slack.alert")).toBe(
        true
      );
    });

    it("does not match deeper nesting with single wildcard", () => {
      expect(
        matchTopic("observation:slack.*", "observation:slack.a.b")
      ).toBe(false);
    });
  });

  describe("globstar (**)", () => {
    it("matches any depth", () => {
      expect(matchTopic("observation:**", "observation:slack")).toBe(true);
      expect(matchTopic("observation:**", "observation:slack.message")).toBe(
        true
      );
      expect(
        matchTopic("observation:**", "observation:slack.message.edit")
      ).toBe(true);
    });

    it("matches everything", () => {
      expect(matchTopic("**", "observation:slack")).toBe(true);
      expect(matchTopic("**", "event:anything.at.all")).toBe(true);
    });

    it("does not match across colon boundary for typed globstar", () => {
      expect(matchTopic("observation:**", "event:slack")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty pattern matches empty key", () => {
      expect(matchTopic("", "")).toBe(true);
    });

    it("empty pattern does not match non-empty key", () => {
      expect(matchTopic("", "observation:slack")).toBe(false);
    });

    it("caches compiled patterns", () => {
      const r1 = compilePattern("observation:*");
      const r2 = compilePattern("observation:*");
      expect(r1).toBe(r2);
    });
  });
});

// ---------------------------------------------------------------------------
// actor()
// ---------------------------------------------------------------------------

describe("actor", () => {
  it("creates a frozen actor descriptor", () => {
    const body = handler({
      name: "test-body",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => ({ ok: true }),
    });

    const a = actor({ name: "monitor", watch: ["observation:*"], body });

    expect(a.name).toBe("monitor");
    expect(a.watch).toEqual(["observation:*"]);
    expect(a.body).toBe(body);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("throws if watch patterns are empty", () => {
    const body = handler({
      name: "test-body",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => ({ ok: true }),
    });

    expect(() => actor({ name: "bad", watch: [], body })).toThrow(
      "at least one watch pattern"
    );
  });
});

// ---------------------------------------------------------------------------
// reactiveBlackboard()
// ---------------------------------------------------------------------------

describe("reactiveBlackboard", () => {
  it("creates a blackboard resource definition", () => {
    const rb = reactiveBlackboard({ name: "test", entries: entrySchema });
    expect(rb.blackboard).toBeDefined();
    expect(rb.blackboard).toHaveProperty("stateSchema");
  });
});

// ---------------------------------------------------------------------------
// mesh()
// ---------------------------------------------------------------------------

describe("mesh", () => {
  it("throws if actors array is empty", () => {
    const rb = reactiveBlackboard({ name: "test", entries: entrySchema });
    expect(() =>
      mesh({ name: "bad", blackboard: rb, actors: [] })
    ).toThrow("at least one actor");
  });

  it("returns emit block, blackboard, and frozen actors", () => {
    const body = handler({
      name: "noop",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => ({ ok: true }),
    });
    const a = actor({ name: "watcher", watch: ["**"], body });
    const rb = reactiveBlackboard({ name: "test", entries: entrySchema });
    const m = mesh({ name: "test", blackboard: rb, actors: [a] });

    expect(m.emit).toBeDefined();
    expect(m.emit).toHaveProperty("name");
    expect(m.blackboard).toBe(rb.blackboard);
    expect(m.actors).toHaveLength(1);
    expect(Object.isFrozen(m.actors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mesh().emit integration tests
// ---------------------------------------------------------------------------

describe("mesh emit", () => {
  describe("basic fan-out", () => {
    it("fans out to a single matching actor", async () => {
      const received: unknown[] = [];
      const rb = reactiveBlackboard({ name: "basic", entries: entrySchema });
      const monitor = actor({
        name: "monitor",
        watch: ["observation:*"],
        body: handler({
          name: "monitor-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            received.push(input);
            return { processed: true };
          },
        }),
      });

      const m = mesh({ name: "basic", blackboard: rb, actors: [monitor] });

      const entry = {
        type: "observation",
        topic: "slack",
        body: { text: "hello" },
      };

      const result = await testBlock(m.emit, {
        input: entry,
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(entry);
    });

    it("fans out to multiple matching actors", async () => {
      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];
      const rb = reactiveBlackboard({ name: "multi", entries: entrySchema });

      const actorA = actor({
        name: "actor-a",
        watch: ["observation:*"],
        body: handler({
          name: "body-a",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            receivedA.push(input);
            return { a: true };
          },
        }),
      });

      const actorB = actor({
        name: "actor-b",
        watch: ["observation:slack"],
        body: handler({
          name: "body-b",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            receivedB.push(input);
            return { b: true };
          },
        }),
      });

      const m = mesh({
        name: "multi",
        blackboard: rb,
        actors: [actorA, actorB],
      });

      const entry = {
        type: "observation",
        topic: "slack",
        body: { text: "hi" },
      };

      const result = await testBlock(m.emit, {
        input: entry,
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      expect(receivedA).toHaveLength(1);
      expect(receivedB).toHaveLength(1);
    });

    it("selectively matches actors based on topic", async () => {
      const receivedSlack: unknown[] = [];
      const receivedEmail: unknown[] = [];
      const rb = reactiveBlackboard({ name: "selective", entries: entrySchema });

      const slackWatcher = actor({
        name: "slack-watcher",
        watch: ["observation:slack.*"],
        body: handler({
          name: "slack-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            receivedSlack.push(input);
            return { ok: true };
          },
        }),
      });

      const emailWatcher = actor({
        name: "email-watcher",
        watch: ["observation:email.*"],
        body: handler({
          name: "email-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            receivedEmail.push(input);
            return { ok: true };
          },
        }),
      });

      const m = mesh({
        name: "selective",
        blackboard: rb,
        actors: [slackWatcher, emailWatcher],
      });

      // Emit a slack observation — only slackWatcher should fire
      const result = await testBlock(m.emit, {
        input: {
          type: "observation",
          topic: "slack.message",
          body: { text: "hello" },
        },
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      expect(receivedSlack).toHaveLength(1);
      expect(receivedEmail).toHaveLength(0);
    });
  });

  describe("no match scenario", () => {
    it("appends entry even when no actors match", async () => {
      const rb = reactiveBlackboard({ name: "nomatch", entries: entrySchema });
      const watcher = actor({
        name: "watcher",
        watch: ["event:*"],
        body: handler({
          name: "watcher-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => ({ ok: true }),
        }),
      });

      const m = mesh({ name: "nomatch", blackboard: rb, actors: [watcher] });

      // Emit an observation — watcher only watches events
      const entry = {
        type: "observation",
        topic: "slack",
        body: { text: "ignored" },
      };
      const result = await testBlock(m.emit, {
        input: entry,
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      // Entry should still be appended to the resource
      expect(result.output).toEqual(entry);
    });
  });

  describe("entry persistence", () => {
    it("appends entry to the blackboard resource", async () => {
      let observedEntries: unknown[] = [];
      const rb = reactiveBlackboard({ name: "persist", entries: entrySchema });

      const observer = actor({
        name: "observer",
        watch: ["**"],
        body: handler({
          name: "observer-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          sessionResources: { reactiveBlackboard: rb.blackboard },
          execute: (_input, ctx) => {
            // Read the resource to verify the entry was appended
            const state = (ctx.session.resources as any).reactiveBlackboard
              .state as ReactiveBlackboardState;
            observedEntries = [...state.entries];
            return { ok: true };
          },
        }),
      });

      const m = mesh({ name: "persist", blackboard: rb, actors: [observer] });

      const entry = {
        type: "observation",
        topic: "test",
        body: { data: 42 },
      };

      const result = await testBlock(m.emit, {
        input: entry,
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      // The observer actor reads the resource after append — entry should be there
      expect(observedEntries).toHaveLength(1);
      expect(observedEntries[0]).toEqual(entry);
    });
  });

  describe("failure isolation", () => {
    it("one actor failing does not prevent other actors from running", async () => {
      const successReceived: unknown[] = [];
      const rb = reactiveBlackboard({ name: "isolate", entries: entrySchema });

      const failingActor = actor({
        name: "failing",
        watch: ["observation:*"],
        body: handler({
          name: "failing-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => {
            throw new Error("Actor failed!");
          },
        }),
      });

      const successActor = actor({
        name: "success",
        watch: ["observation:*"],
        body: handler({
          name: "success-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            successReceived.push(input);
            return { ok: true };
          },
        }),
      });

      const m = mesh({
        name: "isolate",
        blackboard: rb,
        actors: [failingActor, successActor],
      });

      const entry = {
        type: "observation",
        topic: "test",
        body: { data: "fail-test" },
      };

      // The emit itself should succeed — failures are isolated
      const result = await testBlock(m.emit, {
        input: entry,
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      expect(successReceived).toHaveLength(1);
    });
  });

  describe("UX emissions", () => {
    it("emits status message on entry emission", async () => {
      const rb = reactiveBlackboard({ name: "ux", entries: entrySchema });
      const noop = actor({
        name: "noop",
        watch: ["**"],
        body: handler({
          name: "noop-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => ({ ok: true }),
        }),
      });

      const m = mesh({ name: "ux", blackboard: rb, actors: [noop] });

      const result = await testBlock(m.emit, {
        input: {
          type: "observation",
          topic: "slack",
          body: { text: "hi" },
        },
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      const statusItems = result.items.filter((item) => item.type === "status");
      // activeStatusMessage renders a user-friendly "Considering <topic>..."
      // line at append-block start — the topic is the identifying piece for
      // the UI indicator; the full type:topic key lives on the emitted entry
      // component for the devtool trace.
      expect(
        statusItems.some((s) =>
          (s as any).message?.includes("Considering slack")
        )
      ).toBe(true);
    });
  });

  describe("actor body receives correct entry", () => {
    it("passes the full entry object to the actor body", async () => {
      let receivedInput: unknown = null;
      const rb = reactiveBlackboard({ name: "input", entries: entrySchema });

      const inspector = actor({
        name: "inspector",
        watch: ["event:**"],
        body: handler({
          name: "inspector-body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (input) => {
            receivedInput = input;
            return { inspected: true };
          },
        }),
      });

      const m = mesh({ name: "input", blackboard: rb, actors: [inspector] });

      const entry = {
        type: "event",
        topic: "system.startup",
        body: { version: "1.0", timestamp: 12345 },
      };

      const result = await testBlock(m.emit, {
        input: entry,
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      expect(receivedInput).toEqual(entry);
    });
  });

  describe("concurrency", () => {
    it("respects custom concurrency setting", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const rb = reactiveBlackboard({
        name: "concurrency",
        entries: entrySchema,
      });

      // Create actors that track concurrent execution
      const actors = Array.from({ length: 6 }, (_, i) =>
        actor({
          name: `actor-${i}`,
          watch: ["observation:*"],
          body: handler({
            name: `body-${i}`,
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async () => {
              currentConcurrent += 1;
              maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
              // Small delay to allow overlap
              await new Promise((r) => setTimeout(r, 10));
              currentConcurrent -= 1;
              return { ok: true };
            },
          }),
        })
      );

      const m = mesh({
        name: "concurrency",
        blackboard: rb,
        actors,
        concurrency: 2,
      });

      const result = await testBlock(m.emit, {
        input: {
          type: "observation",
          topic: "test",
          body: {},
        },
        session: { resources: { reactiveBlackboard: emptyBoardState } },
      });

      expect(result.error).toBeNull();
      // With concurrency=2, max concurrent should not exceed 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeToEntries
// ---------------------------------------------------------------------------

describe("normalizeToEntries", () => {
  it("returns empty array for null/undefined", () => {
    expect(normalizeToEntries(null)).toEqual([]);
    expect(normalizeToEntries(undefined)).toEqual([]);
  });

  it("returns empty array for strings", () => {
    expect(normalizeToEntries("hello")).toEqual([]);
  });

  it("returns empty array for objects without required fields", () => {
    expect(normalizeToEntries({ foo: "bar" })).toEqual([]);
    expect(normalizeToEntries({ type: "x" })).toEqual([]); // missing topic, body
    expect(normalizeToEntries({ type: "x", topic: "y" })).toEqual([]); // missing body
  });

  it("wraps a single valid entry in an array", () => {
    const entry = { type: "obs", topic: "t1", body: "data" };
    expect(normalizeToEntries(entry)).toEqual([entry]);
  });

  it("passes through a valid array", () => {
    const entries = [
      { type: "obs", topic: "t1", body: "a" },
      { type: "finding", topic: "t2", body: "b" },
    ];
    expect(normalizeToEntries(entries)).toEqual(entries);
  });

  it("filters out invalid items from a mixed array", () => {
    const valid = { type: "obs", topic: "t1", body: "ok" };
    const result = normalizeToEntries([valid, "string", null, { type: "x" }, 42]);
    expect(result).toEqual([valid]);
  });

  it("returns empty array for empty array input", () => {
    expect(normalizeToEntries([])).toEqual([]);
  });

  it("unwraps { entries: [...] } wrapper", () => {
    const entries = [
      { type: "obs", topic: "t1", body: "a" },
      { type: "finding", topic: "t2", body: "b" },
    ];
    expect(normalizeToEntries({ entries })).toEqual(entries);
  });

  it("returns empty for { entries: [] }", () => {
    expect(normalizeToEntries({ entries: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// re-emission
// ---------------------------------------------------------------------------

describe("re-emission", () => {
  it("chains actors via re-emitted entries", async () => {
    const received: Record<string, unknown[]> = { a: [], b: [] };
    const rb = reactiveBlackboard({ name: "chain", entries: entrySchema });

    // Actor A watches requests, returns an observation entry
    const actorA = actor({
      name: "actor-a",
      watch: ["request:**"],
      body: handler({
        name: "body-a",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          received.a.push(input);
          return [{ type: "observation", topic: "found", body: "data from A" }];
        },
      }),
    });

    // Actor B watches observations — should fire on A's re-emitted entry
    const actorB = actor({
      name: "actor-b",
      watch: ["observation:**"],
      body: handler({
        name: "body-b",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          received.b.push(input);
          return { processed: true };
        },
      }),
    });

    const m = mesh({
      name: "chain",
      blackboard: rb,
      actors: [actorA, actorB],
      reEmit: true,
      maxDepth: 3,
    });

    const result = await testBlock(m.emit, {
      input: { type: "request", topic: "query", body: "test question" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    expect(result.error).toBeNull();
    // A fired on the request
    expect(received.a).toHaveLength(1);
    // B fired on A's re-emitted observation
    expect(received.b).toHaveLength(1);
    expect(received.b[0]).toEqual({
      type: "observation",
      topic: "found",
      body: "data from A",
    });
  });

  it("does not re-emit when reEmit is false (default)", async () => {
    const receivedB: unknown[] = [];
    const rb = reactiveBlackboard({ name: "no-reemit", entries: entrySchema });

    const actorA = actor({
      name: "actor-a",
      watch: ["request:**"],
      body: handler({
        name: "body-a",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [{ type: "observation", topic: "x", body: "data" }],
      }),
    });

    const actorB = actor({
      name: "actor-b",
      watch: ["observation:**"],
      body: handler({
        name: "body-b",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          receivedB.push(input);
          return { ok: true };
        },
      }),
    });

    const m = mesh({
      name: "no-reemit",
      blackboard: rb,
      actors: [actorA, actorB],
      // reEmit defaults to false
    });

    await testBlock(m.emit, {
      input: { type: "request", topic: "query", body: "test" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    // B should NOT fire — A's output is discarded without reEmit
    expect(receivedB).toHaveLength(0);
  });

  it("respects maxDepth", async () => {
    const depths: number[] = [];
    let callCount = 0;
    const rb = reactiveBlackboard({ name: "depth", entries: entrySchema });

    // Actor that always re-emits the same type it watches — would loop
    // infinitely without maxDepth
    const looper = actor({
      name: "looper",
      watch: ["event:**"],
      body: handler({
        name: "looper-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          callCount += 1;
          depths.push(callCount);
          return [{ type: "event", topic: "loop", body: `iteration ${callCount}` }];
        },
      }),
    });

    const m = mesh({
      name: "depth",
      blackboard: rb,
      actors: [looper],
      reEmit: true,
      maxDepth: 3, // depth 1, 2 re-emit; depth 3 stops
    });

    await testBlock(m.emit, {
      input: { type: "event", topic: "start", body: "go" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    // Depth 1: fires on initial entry, re-emits → depth 2: fires, re-emits → depth 3: fires, no re-emit
    expect(callCount).toBe(3);
  });

  it("handles multiple entries from a single actor", async () => {
    const receivedB: unknown[] = [];
    const rb = reactiveBlackboard({ name: "multi-entry", entries: entrySchema });

    const actorA = actor({
      name: "actor-a",
      watch: ["request:**"],
      body: handler({
        name: "body-a",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [
          { type: "observation", topic: "one", body: "first" },
          { type: "observation", topic: "two", body: "second" },
          { type: "observation", topic: "three", body: "third" },
        ],
      }),
    });

    const actorB = actor({
      name: "actor-b",
      watch: ["observation:**"],
      body: handler({
        name: "body-b",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          receivedB.push(input);
          return { ok: true };
        },
      }),
    });

    const m = mesh({
      name: "multi-entry",
      blackboard: rb,
      actors: [actorA, actorB],
      reEmit: true,
      maxDepth: 3,
    });

    await testBlock(m.emit, {
      input: { type: "request", topic: "query", body: "test" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    // B should fire 3 times — once per re-emitted observation
    expect(receivedB).toHaveLength(3);
    expect(receivedB.map((e: any) => e.topic)).toEqual(
      expect.arrayContaining(["one", "two", "three"])
    );
  });

  it("handles empty/non-entry actor output gracefully", async () => {
    const rb = reactiveBlackboard({ name: "empty", entries: entrySchema });

    const actorA = actor({
      name: "actor-a",
      watch: ["request:**"],
      body: handler({
        name: "body-a",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => "just a string", // not an entry
      }),
    });

    const m = mesh({
      name: "empty",
      blackboard: rb,
      actors: [actorA],
      reEmit: true,
    });

    const result = await testBlock(m.emit, {
      input: { type: "request", topic: "query", body: "test" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    // Should complete without error — normalizeToEntries returns []
    expect(result.error).toBeNull();
  });

  it("selectively dispatches re-emitted entries to matching actors only", async () => {
    const receivedObs: unknown[] = [];
    const receivedEvt: unknown[] = [];
    const rb = reactiveBlackboard({ name: "selective", entries: entrySchema });

    const producer = actor({
      name: "producer",
      watch: ["request:**"],
      body: handler({
        name: "producer-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [
          { type: "observation", topic: "x", body: "obs" },
        ],
      }),
    });

    const obsWatcher = actor({
      name: "obs-watcher",
      watch: ["observation:**"],
      body: handler({
        name: "obs-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          receivedObs.push(input);
          return { ok: true };
        },
      }),
    });

    const evtWatcher = actor({
      name: "evt-watcher",
      watch: ["event:**"],
      body: handler({
        name: "evt-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          receivedEvt.push(input);
          return { ok: true };
        },
      }),
    });

    const m = mesh({
      name: "selective",
      blackboard: rb,
      actors: [producer, obsWatcher, evtWatcher],
      reEmit: true,
    });

    await testBlock(m.emit, {
      input: { type: "request", topic: "q", body: "test" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    // obsWatcher fires on re-emitted observation
    expect(receivedObs).toHaveLength(1);
    // evtWatcher does NOT fire — no event entries were emitted
    expect(receivedEvt).toHaveLength(0);
  });

  it("fan-out multiplication: 1 request → 2 observations → 4 findings", async () => {
    let findingCount = 0;
    const rb = reactiveBlackboard({ name: "fanout", entries: entrySchema });

    const explorer = actor({
      name: "explorer",
      watch: ["request:**"],
      body: handler({
        name: "explorer-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [
          { type: "observation", topic: "a", body: "obs-a" },
          { type: "observation", topic: "b", body: "obs-b" },
        ],
      }),
    });

    const analyst = actor({
      name: "analyst",
      watch: ["observation:**"],
      body: handler({
        name: "analyst-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input: any) => [
          { type: "event", topic: `finding-from-${input.topic}`, body: "analysis" },
          { type: "event", topic: `extra-from-${input.topic}`, body: "more" },
        ],
      }),
    });

    const counter = actor({
      name: "counter",
      watch: ["event:**"],
      body: handler({
        name: "counter-body",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          findingCount += 1;
          return { counted: true };
        },
      }),
    });

    const m = mesh({
      name: "fanout",
      blackboard: rb,
      actors: [explorer, analyst, counter],
      reEmit: true,
      maxDepth: 4,
    });

    const result = await testBlock(m.emit, {
      input: { type: "request", topic: "query", body: "test" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    expect(result.error).toBeNull();
    // 1 request → 2 observations → 2×2 = 4 events → counter fires 4 times
    expect(findingCount).toBe(4);
  });

  it("appends all re-emitted entries to the blackboard resource", async () => {
    let finalEntries: unknown[] = [];
    const rb = reactiveBlackboard({ name: "persist", entries: entrySchema });

    const actorA = actor({
      name: "actor-a",
      watch: ["request:**"],
      body: handler({
        name: "body-a",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [
          { type: "observation", topic: "x", body: "from-a" },
        ],
      }),
    });

    // Actor B reads the resource to capture final state
    const actorB = actor({
      name: "actor-b",
      watch: ["observation:**"],
      body: handler({
        name: "body-b",
        inputSchema: z.any(),
        outputSchema: z.any(),
        sessionResources: { reactiveBlackboard: rb.blackboard },
        execute: (_input, ctx) => {
          const state = (ctx.session.resources as any).reactiveBlackboard
            .state as ReactiveBlackboardState;
          finalEntries = [...state.entries];
          return { ok: true };
        },
      }),
    });

    const m = mesh({
      name: "persist",
      blackboard: rb,
      actors: [actorA, actorB],
      reEmit: true,
    });

    await testBlock(m.emit, {
      input: { type: "request", topic: "query", body: "test" },
      session: { resources: { reactiveBlackboard: emptyBoardState } },
    });

    // Should have 2 entries: the original request + the re-emitted observation
    expect(finalEntries).toHaveLength(2);
    expect(finalEntries[0]).toEqual({
      type: "request",
      topic: "query",
      body: "test",
    });
    expect(finalEntries[1]).toEqual({
      type: "observation",
      topic: "x",
      body: "from-a",
    });
  });
});

// ---------------------------------------------------------------------------
// createAppendEntry (exported for remixing)
// ---------------------------------------------------------------------------

describe("createAppendEntry", () => {
  it("is exported and creates a handler", () => {
    const board = createReactiveBlackboard();
    const appendBlock = createAppendEntry("test", board);
    expect(appendBlock).toBeDefined();
    expect(appendBlock.name).toBe("test-append");
  });
});

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

describe("schema exports", () => {
  it("exports reactiveBlackboardStateSchema", () => {
    expect(reactiveBlackboardStateSchema).toBeDefined();
    const parsed = reactiveBlackboardStateSchema.parse({});
    expect(parsed.entries).toEqual([]);
  });

  it("exports emitControlSchema", () => {
    expect(emitControlSchema).toBeDefined();
    const parsed = emitControlSchema.parse({});
    expect(parsed.emissionCount).toBe(0);
  });
});
