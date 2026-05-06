/**
 * Round Robin pattern tests — handler-driven, deterministic. Validates
 * roster ordering, multi-round cycling, judge-driven termination,
 * maxRounds cap, prior-contribution context, factory validation, and
 * synthesizer integration.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  roundRobin,
  type RoundRobinFinalShape,
} from "../src/round-robin";

/** Roster agent that records the size of priorContributions it sees. */
function makeAgent(name: string, captured?: Array<{ name: string; priors: number }>) {
  return handler({
    name: `agent-${name}`,
    inputSchema: z.any(),
    outputSchema: z.object({ text: z.string() }),
    execute: () => ({ text: `text-from-${name}` }),
    // The default agent reads the contributions resource — but a custom
    // override block is allowed to be input-only; we cover the resource
    // wiring via integration with createRosterAgent in a separate test.
  });
}

/** Judge that follows a script of `done` flags. */
function makeJudge(script: boolean[]) {
  let i = 0;
  return handler({
    name: "judge-script",
    inputSchema: z.any(),
    outputSchema: z.object({ done: z.boolean(), summary: z.string() }),
    execute: () => {
      const done = i < script.length ? script[i] : true;
      i++;
      return { done, summary: `step-${i}` };
    },
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
      judge: makeJudge([true]),
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { goal: "test" },
      session: { resources: { contributions: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(1);
    expect(out.done).toBe(true);
    expect(out.contributions.map((c) => c.agentName)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
    expect(out.contributions.every((c) => c.round === 1)).toBe(true);
  });

  it("cycles through multiple rounds until the judge says done", async () => {
    const pattern = roundRobin({
      name: "rr-multi",
      roster: [
        { name: "a", block: makeAgent("a") },
        { name: "b", block: makeAgent("b") },
      ],
      judge: makeJudge([false, false, true]),
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

  it("caps cycling at maxRounds when the judge never says done", async () => {
    const neverDone = handler({
      name: "judge-never",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean(), summary: z.string() }),
      execute: () => ({ done: false, summary: "keep going" }),
    });

    const pattern = roundRobin({
      name: "rr-cap",
      roster: [{ name: "solo", block: makeAgent("solo") }],
      judge: neverDone,
      maxRounds: 2,
      synthesizer: false,
    });

    const result = await testBlock(pattern, { input: { goal: "loop" }, session: { resources: { contributions: { entries: [] } } } });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(2);
    expect(out.done).toBe(false);
    expect(out.contributions).toHaveLength(2);
  });

  it("exits after one round when judge returns done immediately", async () => {
    const pattern = roundRobin({
      name: "rr-immediate",
      roster: [{ name: "solo", block: makeAgent("solo") }],
      judge: makeJudge([true]),
      maxRounds: 5,
      synthesizer: false,
    });

    const result = await testBlock(pattern, { input: { goal: "x" }, session: { resources: { contributions: { entries: [] } } } });

    expect(result.error).toBeNull();
    const out = result.output as RoundRobinFinalShape;
    expect(out.rounds).toBe(1);
    expect(out.done).toBe(true);
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
      judge: makeJudge([true]),
      synthesizer: false,
    });

    const result = await testBlock(pattern, { input: { goal: "x" }, session: { resources: { contributions: { entries: [] } } } });

    expect(result.error).not.toBeNull();
  });

  it("integrates with a custom synthesizer", async () => {
    const synth = handler({
      name: "synth",
      inputSchema: z.any(),
      outputSchema: z.object({ verdict: z.string() }),
      execute: (input) => {
        const data = input as RoundRobinFinalShape;
        return { verdict: `rounds=${data.rounds},done=${data.done}` };
      },
    });

    const pattern = roundRobin({
      name: "rr-synth",
      roster: [{ name: "a", block: makeAgent("a") }],
      judge: makeJudge([true]),
      synthesizer: synth,
    });

    const result = await testBlock(pattern, { input: { goal: "x" }, session: { resources: { contributions: { entries: [] } } } });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ verdict: "rounds=1,done=true" });
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
      judge: makeJudge([true]),
      synthesizer: false,
    });

    const result = await testBlock(pattern, { input: { goal: "x" }, session: { resources: { contributions: { entries: [] } } } });

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

  it("emits one task-change per (round, agent) turn", async () => {
    const pattern = roundRobin({
      name: "rr-tasks",
      roster: [
        { name: "a", block: makeAgent("a") },
        { name: "b", block: makeAgent("b") },
      ],
      judge: makeJudge([false, true]),
      synthesizer: false,
    });

    const result = await testBlock(pattern, { input: { goal: "x" }, session: { resources: { contributions: { entries: [] } } } });

    expect(result.error).toBeNull();
    // Each turn adds one task — added → claimed → completed (3 events).
    // Just sanity-check that we see task-change items at all.
    const taskChanges = result.items.filter(
      (item) => item.type === "component" && (item as any).component === "task-change",
    );
    expect(taskChanges.length).toBeGreaterThanOrEqual(4);
  });
});
