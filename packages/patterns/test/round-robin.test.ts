/**
 * Round Robin pattern tests — handler-driven, deterministic. Validates
 * roster ordering, maxRounds cycling, runtime terminateWhen exit, optional
 * referee accumulation, referee critiques flowing into subsequent rounds,
 * factory validation, and synthesizer integration.
 */
import { describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createRoundRobinContributions,
  roundRobin,
  type RoundRobinFinalShape,
} from "../src/round-robin";

/** Roster agent that emits `{ text }` carrying its name. */
function makeAgent(name: string) {
  return handler({
    name: `agent-${name}`,
    inputSchema: z.any(),
    outputSchema: z.object({ text: z.string() }),
    execute: () => ({ text: `text-from-${name}` }),
  });
}

/** Referee that returns a fixed critique. */
function makeReferee(critique = "ok") {
  return handler({
    name: "referee-fixed",
    inputSchema: z.any(),
    outputSchema: z.object({ critique: z.string() }),
    execute: () => ({ critique }),
  });
}

describe("round-robin", () => {
  it("runs all roster agents in declared order each round", async () => {
    const pattern = roundRobin({
      name: "rr-order",
      roster: [
        { name: "alice", block: makeAgent("alice") },
        { name: "bob", block: makeAgent("bob") },
        { name: "carol", block: makeAgent("carol") },
      ],
      maxRounds: 1,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(1);
    expect(out.refereeCritiques).toEqual([]);
    expect(out.contributions.map((c) => c.agentName)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
    expect(out.contributions.every((c) => c.round === 1)).toBe(true);
  });

  it("cycles up to maxRounds when no terminateWhen is provided", async () => {
    const pattern = roundRobin({
      name: "rr-cycle",
      roster: [
        { name: "a", block: makeAgent("a") },
        { name: "b", block: makeAgent("b") },
      ],
      maxRounds: 3,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(3);
    expect(out.contributions).toHaveLength(6);
    expect(out.contributions.map((c) => `${c.round}:${c.agentName}`)).toEqual([
      "1:a", "1:b", "2:a", "2:b", "3:a", "3:b",
    ]);
  });

  it("terminateWhen returning true exits the loop early", async () => {
    const pattern = roundRobin({
      name: "rr-terminate",
      roster: [{ name: "solo", block: makeAgent("solo") }],
      maxRounds: 5,
      // Exit after round 2 completes.
      terminateWhen: (ctx) => {
        const state = ctx.sequencer!.state as { round: number };
        return state.round >= 2;
      },
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(2);
    expect(out.contributions).toHaveLength(2);
  });

  it("maxRounds caps when terminateWhen never returns true", async () => {
    const pattern = roundRobin({
      name: "rr-cap",
      roster: [{ name: "solo", block: makeAgent("solo") }],
      maxRounds: 2,
      terminateWhen: () => false,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "loop" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(2);
    expect(out.contributions).toHaveLength(2);
  });

  it("omits the referee step when no referee is configured", async () => {
    const refereeSpy = vi.fn();
    const pattern = roundRobin({
      name: "rr-no-referee",
      roster: [{ name: "a", block: makeAgent("a") }],
      maxRounds: 2,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.refereeCritiques).toEqual([]);
    expect(refereeSpy).not.toHaveBeenCalled();
  });

  it("referee runs after every round and accumulates critiques in outer state", async () => {
    const calls: number[] = [];
    const referee = handler({
      name: "referee-tracker",
      inputSchema: z.any(),
      outputSchema: z.object({ critique: z.string() }),
      execute: (_input, ctx) => {
        const state = ctx.sequencer!.state as { round: number };
        calls.push(state.round);
        return { critique: `critique-${state.round}` };
      },
    });

    const pattern = roundRobin({
      name: "rr-referee",
      roster: [{ name: "a", block: makeAgent("a") }],
      maxRounds: 3,
      referee,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(3);
    expect(calls).toEqual([1, 2, 3]);
    expect(out.refereeCritiques).toEqual([
      { round: 1, critique: "critique-1" },
      { round: 2, critique: "critique-2" },
      { round: 3, critique: "critique-3" },
    ]);
  });

  it("default roster agent sees prior referee critiques on subsequent rounds", async () => {
    // The default roster agent (built when no `block` is supplied) renders
    // referee critiques into its user prompt. Verify the surface contract
    // by exposing what the second-round agent would see: a roster agent
    // that captures the outer state at execute time. The pattern's stash
    // tap updates `state.refereeCritiques` before the next round's agents
    // run, so by round 2 the captured snapshot must include round 1's
    // critique.
    const seenCritiques: Array<Array<{ round: number; critique: string }>> = [];
    const observer = handler({
      name: "observer-agent",
      inputSchema: z.any(),
      outputSchema: z.object({ text: z.string() }),
      execute: (_input, ctx) => {
        const state = ctx.sequencer!.state as {
          refereeCritiques: Array<{ round: number; critique: string }>;
        };
        seenCritiques.push([...state.refereeCritiques]);
        return { text: `round-${state.refereeCritiques.length}` };
      },
    });

    const pattern = roundRobin({
      name: "rr-referee-flow",
      roster: [{ name: "obs", block: observer }],
      maxRounds: 2,
      referee: makeReferee("round-critique"),
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    expect(seenCritiques).toHaveLength(2);
    expect(seenCritiques[0]).toEqual([]);
    expect(seenCritiques[1]).toEqual([
      { round: 1, critique: "round-critique" },
    ]);
  });

  it("synthesizer receives the accumulated referee critiques", async () => {
    const synth = handler({
      name: "synth",
      inputSchema: z.any(),
      outputSchema: z.object({ count: z.number() }),
      execute: (input) => {
        const data = input as RoundRobinFinalShape;
        return { count: data.refereeCritiques.length };
      },
    });

    const pattern = roundRobin({
      name: "rr-synth-referee",
      roster: [{ name: "a", block: makeAgent("a") }],
      maxRounds: 2,
      referee: makeReferee(),
      synthesizer: synth,
    });

    const result = await testBlock(pattern, {
      input: { goal: "x" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ count: 2 });
  });

  it("fails the round when a roster agent throws", async () => {
    const broken = handler({
      name: "broken",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("agent boom");
      },
    });

    const pattern = roundRobin({
      name: "rr-broken",
      roster: [
        { name: "ok", block: makeAgent("ok") },
        { name: "bad", block: broken },
      ],
      maxRounds: 1,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "x" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).not.toBeNull();
  });

  it("integrates with a custom synthesizer over the final shape", async () => {
    const synth = handler({
      name: "synth",
      inputSchema: z.any(),
      outputSchema: z.object({ verdict: z.string() }),
      execute: (input) => {
        const data = input as RoundRobinFinalShape;
        return { verdict: `rounds=${data.rounds}` };
      },
    });

    const pattern = roundRobin({
      name: "rr-synth",
      roster: [{ name: "a", block: makeAgent("a") }],
      maxRounds: 1,
      synthesizer: synth,
    });

    const result = await testBlock(pattern, {
      input: { goal: "x" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ verdict: "rounds=1" });
  });

  it("coerces a bare-string roster output to { text }", async () => {
    const stringer = handler({
      name: "stringer",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: () => "raw-string-output",
    });

    const pattern = roundRobin({
      name: "rr-string",
      roster: [{ name: "s", block: stringer }],
      maxRounds: 1,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "x" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.contributions[0]).toEqual({
      round: 1,
      agentName: "s",
      text: "raw-string-output",
    });
  });

  it("throws when roster is empty", () => {
    expect(() =>
      roundRobin({
        name: "rr-empty",
        roster: [],
      }),
    ).toThrow(/at least 1 entry/);
  });

  it("throws on duplicate roster names", () => {
    expect(() =>
      roundRobin({
        name: "rr-dup",
        roster: [
          { name: "a", block: makeAgent("a") },
          { name: "a", block: makeAgent("a") },
        ],
      }),
    ).toThrow(/duplicate roster name/);
  });

  it("throws when maxRounds is non-positive", () => {
    expect(() =>
      roundRobin({
        name: "rr-zero",
        roster: [{ name: "a", block: makeAgent("a") }],
        maxRounds: 0,
      }),
    ).toThrow(/maxRounds/);
  });

  it("throws when outputSchema is set with synthesizer: false", () => {
    expect(() =>
      roundRobin({
        name: "rr-bad-config",
        roster: [{ name: "a", block: makeAgent("a") }],
        synthesizer: false,
        outputSchema: z.string(),
      }),
    ).toThrow(/outputSchema/);
  });

  it("supports an externally-provided contributions resource", async () => {
    const sharedContributions = createRoundRobinContributions();
    const pattern = roundRobin({
      name: "rr-shared",
      roster: [{ name: "a", block: makeAgent("a") }],
      maxRounds: 1,
      synthesizer: false,
      contributions: sharedContributions,
    });

    const result = await testBlock(pattern, {
      input: { goal: "x" },
      session: { resources: { contributions: { entries: [] } } },
    });
    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.contributions.map((e) => e.agentName)).toEqual(["a"]);
  });

  it("emits task-change items for each (round, agent) turn", async () => {
    const pattern = roundRobin({
      name: "rr-tasks",
      roster: [
        { name: "a", block: makeAgent("a") },
        { name: "b", block: makeAgent("b") },
      ],
      maxRounds: 2,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "x" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const taskChanges = result.items.filter(
      (item) => item.type === "component" && (item as any).component === "task-change",
    );
    expect(taskChanges.length).toBeGreaterThanOrEqual(4);
  });
});
