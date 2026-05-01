import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createEventActorsWorkspace,
  actor,
  eventActors,
  matchTopic,
  normalizeToEntries,
} from "../src/eventActors";

// ---------------------------------------------------------------------------
// Topic matching
// ---------------------------------------------------------------------------

describe("matchTopic", () => {
  it("matches single segment with *", () => {
    expect(matchTopic("observation:*", "observation:slack")).toBe(true);
    expect(matchTopic("observation:*", "observation:slack.msg")).toBe(false);
  });

  it("matches multi-segment with **", () => {
    expect(matchTopic("observation:**", "observation:slack")).toBe(true);
    expect(matchTopic("observation:**", "observation:slack.msg.edit")).toBe(true);
    expect(matchTopic("observation:**", "event:slack")).toBe(false);
  });

  it("matches segment-bounded * across colon and dot", () => {
    expect(matchTopic("*:slack", "event:slack")).toBe(true);
    expect(matchTopic("observation:slack.*", "observation:slack.message")).toBe(true);
    expect(matchTopic("observation:slack.*", "observation:slack.a.b")).toBe(false);
  });

  it("matches everything with **", () => {
    expect(matchTopic("**", "anything:goes")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeToEntries
// ---------------------------------------------------------------------------

describe("normalizeToEntries", () => {
  it("returns entries from a bare entry object", () => {
    const out = normalizeToEntries({ type: "x", topic: "y", body: "b" });
    expect(out).toEqual([{ type: "x", topic: "y", body: "b" }]);
  });

  it("returns entries from an array", () => {
    const out = normalizeToEntries([
      { type: "a", topic: "1", body: 1 },
      { type: "b", topic: "2", body: 2 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("unwraps { entries: [...] } wrappers", () => {
    const out = normalizeToEntries({
      entries: [
        { type: "a", topic: "1", body: 1 },
        { type: "b", topic: "2", body: 2 },
      ],
    });
    expect(out).toHaveLength(2);
  });

  it("drops non-entry candidates", () => {
    const out = normalizeToEntries(["string", null, { type: "ok", topic: "ok", body: 1 }]);
    expect(out).toEqual([{ type: "ok", topic: "ok", body: 1 }]);
  });

  it("returns [] for null/undefined", () => {
    expect(normalizeToEntries(null)).toEqual([]);
    expect(normalizeToEntries(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Actor descriptor
// ---------------------------------------------------------------------------

describe("actor", () => {
  it("freezes the descriptor", () => {
    const a = actor({
      name: "a",
      watch: ["**"],
      block: handler({
        name: "noop",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (i) => i,
      }),
    });
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("rejects empty watch", () => {
    expect(() =>
      actor({
        name: "a",
        watch: [],
        block: handler({
          name: "noop",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: (i) => i,
        }),
      })
    ).toThrow(/at least one watch pattern/i);
  });
});

// ---------------------------------------------------------------------------
// eventActors integration
// ---------------------------------------------------------------------------

describe("eventActors", () => {
  const entrySchema = z.object({
    type: z.string(),
    topic: z.string(),
    body: z.any(),
  });

  const emptyWorkspaceState = { entries: [] };

  function buildEventActors(options: {
    name: string;
    actors: Parameters<typeof eventActors>[0]["actors"];
    reEmit?: boolean;
    maxDepth?: number;
    concurrency?: number;
  }) {
    const rb = createEventActorsWorkspace({ name: options.name, entries: entrySchema });
    return eventActors({
      name: options.name,
      workspace: rb,
      actors: options.actors,
      ...(options.reEmit !== undefined ? { reEmit: options.reEmit } : {}),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    });
  }

  it("dispatches a single matching actor and appends the seed entry", async () => {
    const seen: unknown[] = [];
    const rec = handler({
      name: "rec",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (entry) => {
        seen.push(entry);
        return { ok: true };
      },
    });

    const a = actor({ name: "a", watch: ["request:**"], block: rec });
    const { emit } = buildEventActors({ name: "test1", actors: [a] });

    const result = await testBlock(emit, {
      input: { type: "request", topic: "query", body: "hi" },
      session: { resources: { eventedActors: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    expect(seen).toEqual([{ type: "request", topic: "query", body: "hi" }]);
  });

  it("only dispatches actors whose watch matches", async () => {
    const calls: string[] = [];
    function trackingActor(name: string, watch: string[]) {
      return actor({
        name,
        watch,
        block: handler({
          name: `${name}-h`,
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => {
            calls.push(name);
            return { ok: true };
          },
        }),
      });
    }

    const matching = trackingActor("matching", ["request:**"]);
    const other = trackingActor("other", ["event:**"]);

    const { emit } = buildEventActors({
      name: "test2",
      actors: [matching, other],
    });

    const result = await testBlock(emit, {
      input: { type: "request", topic: "query", body: "hi" },
      session: { resources: { eventedActors: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    expect(calls).toEqual(["matching"]);
  });

  it("dispatches multiple matching actors concurrently", async () => {
    const calls: string[] = [];
    const a1 = actor({
      name: "a1",
      watch: ["request:**"],
      block: handler({
        name: "a1-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          calls.push("a1");
          return { ok: true };
        },
      }),
    });
    const a2 = actor({
      name: "a2",
      watch: ["request:query"],
      block: handler({
        name: "a2-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          calls.push("a2");
          return { ok: true };
        },
      }),
    });

    const { emit } = buildEventActors({ name: "test3", actors: [a1, a2] });

    const result = await testBlock(emit, {
      input: { type: "request", topic: "query", body: "hi" },
      session: { resources: { eventedActors: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    expect(calls.sort()).toEqual(["a1", "a2"]);
  });

  it("reEmits actor entry-shaped output and cascades to next-tier actors", async () => {
    const tier1Calls: unknown[] = [];
    const tier2Calls: unknown[] = [];

    const tier1 = actor({
      name: "tier1",
      watch: ["request:**"],
      block: handler({
        name: "tier1-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (entry) => {
          tier1Calls.push(entry);
          return [{ type: "observation", topic: "found", body: "result-1" }];
        },
      }),
    });

    const tier2 = actor({
      name: "tier2",
      watch: ["observation:**"],
      block: handler({
        name: "tier2-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (entry) => {
          tier2Calls.push(entry);
          return { ok: true };
        },
      }),
    });

    const { emit } = buildEventActors({
      name: "test4",
      actors: [tier1, tier2],
      reEmit: true,
      maxDepth: 3,
      concurrency: 1,
    });

    const result = await testBlock(emit, {
      input: { type: "request", topic: "query", body: "seed" },
      session: { resources: { eventedActors: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    expect(tier1Calls).toHaveLength(1);
    expect(tier2Calls).toEqual([
      { type: "observation", topic: "found", body: "result-1" },
    ]);
  });

  it("respects maxDepth — does not dispatch beyond the cap", async () => {
    const tier3Calls: unknown[] = [];

    const tier1 = actor({
      name: "tier1",
      watch: ["request:**"],
      block: handler({
        name: "tier1-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [{ type: "observation", topic: "x", body: 1 }],
      }),
    });
    const tier2 = actor({
      name: "tier2",
      watch: ["observation:**"],
      block: handler({
        name: "tier2-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => [{ type: "finding", topic: "y", body: 2 }],
      }),
    });
    const tier3 = actor({
      name: "tier3",
      watch: ["finding:**"],
      block: handler({
        name: "tier3-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (entry) => {
          tier3Calls.push(entry);
          return { ok: true };
        },
      }),
    });

    const { emit } = buildEventActors({
      name: "test5",
      actors: [tier1, tier2, tier3],
      reEmit: true,
      maxDepth: 2, // tier3 (depth 3) should NOT fire
    });

    const result = await testBlock(emit, {
      input: { type: "request", topic: "query", body: "seed" },
      session: { resources: { eventedActors: emptyWorkspaceState } },
    });

    expect(result.error).toBeNull();
    expect(tier3Calls).toHaveLength(0);
  });

  it("rejects empty actor list", () => {
    const rb = createEventActorsWorkspace({ name: "empty", entries: entrySchema });
    expect(() =>
      eventActors({ name: "empty", workspace: rb, actors: [] })
    ).toThrow(/at least one actor/i);
  });
});
