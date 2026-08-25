/**
 * Replay safety for the memory helpers (FIX-995).
 *
 * Each case runs the real helper under `createReplayingRef`, which mirrors the
 * CAS retry loop: the updater runs once against a pre-conflict snapshot whose
 * result is discarded, then once against the state a concurrent writer left
 * behind, and only that second attempt commits.
 *
 * A helper that reports its outcome through a binding declared outside its
 * callback returns the *losing* attempt's answer here. Every case below fails
 * on the pre-FIX-995 implementations.
 */
import { createReplayingRef } from "@flow-state-dev/testing";
import { describe, it, expect } from "vitest";
import type { WorkingMemoryState, WorkingMemoryEntry } from "../src/working-memory.js";
import type { EpisodicMemoryState, Episode } from "../src/episodic-memory.js";
import type { SemanticMemoryState, SemanticFact } from "../src/semantic-memory.js";
import { add, evict, pin, unpin, refresh } from "../src/working-memory-helpers.js";
import { cullByTTL, markStale } from "../src/episodic-memory-helpers.js";
import {
  updateFact,
  reinforce,
  cullByEffectiveConfidence,
} from "../src/semantic-memory-helpers.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(id: string, over: Partial<WorkingMemoryEntry> = {}): WorkingMemoryEntry {
  return {
    id,
    content: `content-${id}`,
    importance: 0.5,
    salience: 0.5,
    pinned: false,
    addedAtTurn: 0,
    lastAccessedAtTurn: 0,
    durability: "session",
    category: "identity",
    ...over,
  } as WorkingMemoryEntry;
}

const wm = (entries: WorkingMemoryEntry[], currentTurn = 0): WorkingMemoryState =>
  ({ entries, currentTurn }) as WorkingMemoryState;

function episode(id: string, over: Partial<Episode> = {}): Episode {
  return {
    id,
    content: `ep-${id}`,
    occurredAtTurn: 0,
    encodedAt: new Date(0).toISOString(),
    durability: "persistent",
    stale: false,
    ...over,
  } as Episode;
}

const ep = (episodes: Episode[]): EpisodicMemoryState => ({ episodes }) as EpisodicMemoryState;

function fact(id: string, over: Partial<SemanticFact> = {}): SemanticFact {
  return {
    id,
    subject: "s",
    content: `fact-${id}`,
    confidence: 0.9,
    sourceEpisodeIds: [],
    lastReinforced: new Date(0).toISOString(),
    reinforcementCount: 0,
    createdAt: new Date(0).toISOString(),
    ...over,
  } as SemanticFact;
}

const sem = (facts: SemanticFact[]): SemanticMemoryState => ({ facts }) as SemanticMemoryState;

// ---------------------------------------------------------------------------
// Working memory
// ---------------------------------------------------------------------------

describe("working memory — replayed writes report the winning attempt", () => {
  it("evict() reports false when the winner no longer holds the entry", async () => {
    // Attempt 1 sees the entry and removes it; a concurrent writer removed it
    // first, so the committing attempt finds nothing to do.
    const ref = createReplayingRef(wm([entry("wm_1")]), wm([]));

    expect(await evict(ref as never, "wm_1")).toBe(false);
  });

  it("evict() still reports true when the winner does hold the entry", async () => {
    const ref = createReplayingRef(wm([entry("wm_1")]), wm([entry("wm_1")]));

    expect(await evict(ref as never, "wm_1")).toBe(true);
  });

  it("pin() reports false when the pin slots filled up underneath it", async () => {
    const winner = wm([
      entry("wm_1"),
      entry("p1", { pinned: true }),
      entry("p2", { pinned: true }),
    ]);
    const ref = createReplayingRef(wm([entry("wm_1")]), winner);

    expect(await pin(ref as never, "wm_1", { maxPinnedSlots: 2 })).toBe(false);
  });

  it("unpin() reports false when the winner no longer holds the entry", async () => {
    const ref = createReplayingRef(wm([entry("wm_1", { pinned: true })]), wm([]));

    expect(await unpin(ref as never, "wm_1")).toBe(false);
  });

  it("refresh() reports false when the winner no longer holds the entry", async () => {
    const ref = createReplayingRef(wm([entry("wm_1")]), wm([]));

    expect(await refresh(ref as never, "wm_1")).toBe(false);
  });

  it("add() stamps the entry from the turn that actually committed", async () => {
    // Decision 5's stale-read class: `addedAtTurn` was read from `ref.state`
    // before the callback, so a replay committed an entry stamped with the
    // losing attempt's turn — and returned that same stale record.
    const ref = createReplayingRef(wm([], 3), wm([], 9));

    const added = await add(ref as never, { content: "hello", importance: 0.5 });

    expect(added.addedAtTurn).toBe(9);
    expect(added.lastAccessedAtTurn).toBe(9);
    // and the record the caller got is the one that committed
    expect(ref.committed.entries.at(-1)).toEqual(added);
  });
});

// ---------------------------------------------------------------------------
// Episodic memory — the accumulator class
// ---------------------------------------------------------------------------

describe("episodic memory — accumulators report only the committed attempt", () => {
  const ttl = { persistentTurns: 1, persistentDays: 1, operator: "OR" as const };

  it("cullByTTL() returns exactly the winner's IDs, not both attempts' concatenated", async () => {
    // The observed failure was ["ep_a","ep_b","ep_b"] for an expected ["ep_b"]
    // — accumulated across attempts AND duplicated. Asserted as an exact array
    // on purpose: a length check would catch it, an `includes` check would not.
    const losing = ep([episode("ep_a"), episode("ep_b")]);
    const winning = ep([episode("ep_b")]);
    const ref = createReplayingRef(losing, winning);

    expect(await cullByTTL(ref as never, 100, Date.parse("2030-01-01"), ttl)).toEqual(["ep_b"]);
  });

  it("markStale() returns exactly the winner's IDs", async () => {
    const losing = ep([
      episode("ep_a", { durability: "permanent" }),
      episode("ep_b", { durability: "permanent" }),
    ]);
    const winning = ep([episode("ep_b", { durability: "permanent" })]);
    const ref = createReplayingRef(losing, winning);

    expect(await markStale(ref as never, Date.parse("2030-01-01"), 1)).toEqual(["ep_b"]);
  });

  it("cullByTTL() reports nothing when the winner has nothing left to cull", async () => {
    const ref = createReplayingRef(ep([episode("ep_a")]), ep([]));

    expect(await cullByTTL(ref as never, 100, Date.parse("2030-01-01"), ttl)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Semantic memory
// ---------------------------------------------------------------------------

describe("semantic memory — replayed writes report the winning attempt", () => {
  it("updateFact() reports undefined when the winner no longer holds the fact", async () => {
    const ref = createReplayingRef(sem([fact("f1")]), sem([]));

    expect(await updateFact(ref as never, "f1", "new", [])).toBeUndefined();
  });

  it("updateFact() returns the record built from the winner's state", async () => {
    const ref = createReplayingRef(
      sem([fact("f1", { reinforcementCount: 0 })]),
      sem([fact("f1", { reinforcementCount: 7 })])
    );

    const updated = await updateFact(ref as never, "f1", "new", []);

    expect(updated?.reinforcementCount).toBe(8);
  });

  it("reinforce() reports undefined when the winner no longer holds the fact", async () => {
    const ref = createReplayingRef(sem([fact("f1")]), sem([]));

    expect(await reinforce(ref as never, "f1", [])).toBeUndefined();
  });

  it("cullByEffectiveConfidence() returns exactly the winner's IDs", async () => {
    const losing = sem([fact("f_a", { confidence: 0.01 }), fact("f_b", { confidence: 0.01 })]);
    const winning = sem([fact("f_b", { confidence: 0.01 })]);
    const ref = createReplayingRef(losing, winning);

    expect(await cullByEffectiveConfidence(ref as never, Date.parse("2030-01-01"), 1, 0.5)).toEqual([
      "f_b",
    ]);
  });
});
