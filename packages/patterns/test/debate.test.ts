/**
 * Debate pattern tests — handler-driven for the chassis behaviors and
 * mockGenerator-driven for default debater/judge prompt rendering.
 * Covers: ordering, prior-argument visibility, judge-runs-once,
 * verdict propagation, synthesizer integration, factory validation,
 * audit task emission, and the bias-mitigation toggles.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  debate,
  formatTranscriptForJudge,
  type DebateContributionEntry,
  type DebateRawOutput,
} from "../src/debate";

/** Handler debater that returns `${stance}-r${round}-from-${name}` and records what it saw. */
function makeDebater(
  name: string,
  stance: string,
  seenSizes?: Array<{ name: string; round: number; priors: number }>,
) {
  return handler({
    name: `debater-${name}`,
    inputSchema: z.any(),
    outputSchema: z.object({ text: z.string() }),
    sequencerStateSchema: z.object({
      question: z.string().default(""),
      round: z.number().default(0),
    }),
    resources: {
      // Re-declare a session resource so we can read priors. Schema-light.
      // The pattern installs the canonical writable resource; this
      // handler reads through ctx.resources by name.
    },
    execute: (_input, ctx) => {
      const round = (ctx.sequencer!.state as { round: number }).round;
      const trans = (ctx.resources as any).transcript?.state ??
        (ctx.session?.resources as any)?.transcript ??
        { entries: [] };
      const priors = (trans.entries ?? []).length;
      seenSizes?.push({ name, round, priors });
      return { text: `${stance}-r${round}-from-${name}` };
    },
  });
}

/** Judge that always returns the same canned verdict and counts invocations. */
function makeJudge(verdict: { verdict: string; winner: string | null; reasoning: string }) {
  let count = 0;
  const block = handler({
    name: "judge-handler",
    inputSchema: z.any(),
    outputSchema: z.object({
      verdict: z.string(),
      winner: z.string().nullable(),
      reasoning: z.string(),
    }),
    execute: () => {
      count++;
      return verdict;
    },
  });
  return { block, getCount: () => count };
}

describe("debate", () => {
  it("runs every debater in declared order each round", async () => {
    const pattern = debate({
      name: "deb-order",
      debaters: [
        { name: "alice", stance: "for", block: makeDebater("alice", "for") },
        { name: "bob", stance: "against", block: makeDebater("bob", "against") },
      ],
      maxRounds: 2,
      judge: makeJudge({ verdict: "alice", winner: "for", reasoning: "r" }).block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "is X true?" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as DebateRawOutput;
    expect(out.rounds).toBe(2);
    expect(out.transcript.map((e) => `${e.round}:${e.agentName}`)).toEqual([
      "1:alice",
      "1:bob",
      "2:alice",
      "2:bob",
    ]);
    expect(out.transcript.every((e) => ["for", "against"].includes(e.stance))).toBe(true);
  });

  it("each debater sees all prior arguments from this and prior rounds", async () => {
    const seen: Array<{ name: string; round: number; priors: number }> = [];
    const pattern = debate({
      name: "deb-priors",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for", seen) },
        { name: "b", stance: "against", block: makeDebater("b", "against", seen) },
      ],
      maxRounds: 2,
      judge: makeJudge({ verdict: "v", winner: null, reasoning: "r" }).block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    // Round 1: a sees 0, b sees 1 (a-r1).
    // Round 2: a sees 2 (a-r1, b-r1), b sees 3 (a-r1, b-r1, a-r2).
    expect(seen).toEqual([
      { name: "a", round: 1, priors: 0 },
      { name: "b", round: 1, priors: 1 },
      { name: "a", round: 2, priors: 2 },
      { name: "b", round: 2, priors: 3 },
    ]);
  });

  it("supports three debaters", async () => {
    const pattern = debate({
      name: "deb-three",
      debaters: [
        { name: "a", stance: "aggressive", block: makeDebater("a", "aggressive") },
        { name: "b", stance: "conservative", block: makeDebater("b", "conservative") },
        { name: "c", stance: "neutral", block: makeDebater("c", "neutral") },
      ],
      maxRounds: 1,
      judge: makeJudge({ verdict: "v", winner: "neutral", reasoning: "r" }).block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as DebateRawOutput;
    expect(out.transcript).toHaveLength(3);
    expect(out.transcript.map((e) => e.agentName)).toEqual(["a", "b", "c"]);
  });

  it("runs the judge exactly once at the end", async () => {
    const j = makeJudge({ verdict: "v", winner: "for", reasoning: "r" });
    const pattern = debate({
      name: "deb-judge-once",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for") },
        { name: "b", stance: "against", block: makeDebater("b", "against") },
      ],
      maxRounds: 3,
      judge: j.block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as DebateRawOutput;
    expect(out.rounds).toBe(3);
    expect(j.getCount()).toBe(1);
  });

  it("propagates the judge's verdict into the raw output", async () => {
    const j = makeJudge({ verdict: "X is true", winner: "for", reasoning: "because" });
    const pattern = debate({
      name: "deb-verdict",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for") },
        { name: "b", stance: "against", block: makeDebater("b", "against") },
      ],
      maxRounds: 1,
      judge: j.block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "is X true?" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as DebateRawOutput;
    expect(out.verdict).toEqual({
      verdict: "X is true",
      winner: "for",
      reasoning: "because",
    });
    expect(out.question).toBe("is X true?");
  });

  it("supports winner=null synthesis verdicts", async () => {
    const j = makeJudge({
      verdict: "both have merit",
      winner: null,
      reasoning: "synthesis",
    });
    const pattern = debate({
      name: "deb-synth-verdict",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for") },
        { name: "b", stance: "against", block: makeDebater("b", "against") },
      ],
      maxRounds: 1,
      judge: j.block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const out = result.output as DebateRawOutput;
    expect(out.verdict.winner).toBeNull();
  });

  it("integrates with a custom synthesizer", async () => {
    const synth = handler({
      name: "deb-synth",
      inputSchema: z.any(),
      outputSchema: z.object({ summary: z.string() }),
      execute: (input) => {
        const data = input as DebateRawOutput;
        return { summary: data.verdict.verdict.toUpperCase() };
      },
    });
    const pattern = debate({
      name: "deb-synth-integration",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for") },
        { name: "b", stance: "against", block: makeDebater("b", "against") },
      ],
      maxRounds: 1,
      judge: makeJudge({ verdict: "yes", winner: "for", reasoning: "r" }).block,
      synthesizer: synth,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ summary: "YES" });
  });

  it("fails the round when a debater throws", async () => {
    const broken = handler({
      name: "broken",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("boom");
      },
    });
    const pattern = debate({
      name: "deb-broken",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for") },
        { name: "b", stance: "against", block: broken },
      ],
      maxRounds: 1,
      judge: makeJudge({ verdict: "v", winner: null, reasoning: "r" }).block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).not.toBeNull();
  });

  it("emits one task per (round, debater) turn", async () => {
    const pattern = debate({
      name: "deb-tasks",
      debaters: [
        { name: "a", stance: "for", block: makeDebater("a", "for") },
        { name: "b", stance: "against", block: makeDebater("b", "against") },
      ],
      maxRounds: 2,
      judge: makeJudge({ verdict: "v", winner: null, reasoning: "r" }).block,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
    });

    expect(result.error).toBeNull();
    const taskChanges = result.items.filter(
      (item) => item.type === "component" && (item as any).component === "task-change",
    );
    // 2 rounds × 2 debaters = 4 turns; each turn emits at least one
    // task-change item.
    expect(taskChanges.length).toBeGreaterThanOrEqual(4);
  });

  describe("factory validation", () => {
    it("throws when debaters has fewer than 2 entries", () => {
      expect(() =>
        debate({
          name: "deb-too-few",
          debaters: [{ name: "a", stance: "for" }],
        }),
      ).toThrow(/at least 2 entries/);
    });

    it("throws when a debater has an empty stance", () => {
      expect(() =>
        debate({
          name: "deb-no-stance",
          debaters: [
            { name: "a", stance: "" },
            { name: "b", stance: "against" },
          ],
        }),
      ).toThrow(/non-empty stance/);
    });

    it("throws on duplicate debater names", () => {
      expect(() =>
        debate({
          name: "deb-dup",
          debaters: [
            { name: "a", stance: "for" },
            { name: "a", stance: "against" },
          ],
        }),
      ).toThrow(/duplicate debater name/);
    });

    it("throws when maxRounds is non-positive", () => {
      expect(() =>
        debate({
          name: "deb-zero",
          debaters: [
            { name: "a", stance: "for" },
            { name: "b", stance: "against" },
          ],
          maxRounds: 0,
        }),
      ).toThrow(/maxRounds/);
    });

    it("throws when outputSchema is set with synthesizer: false", () => {
      expect(() =>
        debate({
          name: "deb-bad",
          debaters: [
            { name: "a", stance: "for" },
            { name: "b", stance: "against" },
          ],
          synthesizer: false,
          outputSchema: z.string(),
        }),
      ).toThrow(/outputSchema/);
    });
  });

  describe("formatTranscriptForJudge helper", () => {
    const entries: DebateContributionEntry[] = [
      { round: 1, agentName: "a", stance: "for", text: "A1" },
      { round: 1, agentName: "b", stance: "against", text: "B1" },
      { round: 2, agentName: "a", stance: "for", text: "A2" },
      { round: 2, agentName: "b", stance: "against", text: "B2" },
    ];

    it("renders stance-tagged transcript when anonymized", () => {
      const text = formatTranscriptForJudge(entries, {
        anonymize: true,
        shuffle: false,
      });
      expect(text).toContain("[for] A1");
      expect(text).toContain("[against] B1");
      // No agent-name attribution prefix like "[a, ...]".
      expect(text).not.toMatch(/\[a,/);
      expect(text).not.toMatch(/\[b,/);
    });

    it("renders name + stance when not anonymized", () => {
      const text = formatTranscriptForJudge(entries, {
        anonymize: false,
        shuffle: false,
      });
      expect(text).toContain("[a, for] A1");
      expect(text).toContain("[b, against] B1");
    });

    it("shuffles deterministically with an injected RNG", () => {
      // Seeded RNG: returns a fixed sequence so two runs match exactly.
      const seq = [0.9, 0.1, 0.7, 0.4, 0.2, 0.6, 0.8, 0.3];
      const make = () => {
        let i = 0;
        return () => seq[i++ % seq.length]!;
      };
      const a = formatTranscriptForJudge(entries, {
        anonymize: true,
        shuffle: true,
        random: make(),
      });
      const b = formatTranscriptForJudge(entries, {
        anonymize: true,
        shuffle: true,
        random: make(),
      });
      expect(a).toBe(b);
    });
  });

  it("default debater prompt is stance-tagged but not name-tagged", async () => {
    // Two-round debate so the second round's prompt has a non-empty
    // prior-arguments block and we can verify name-anonymization.
    const debaterMock = mockGenerator({
      name: "deb-prompts-debater-a",
      script: [
        { structuredOutput: { text: "first-a" } },
        { structuredOutput: { text: "second-a" } },
      ],
    });
    const debaterMockB = mockGenerator({
      name: "deb-prompts-debater-b",
      script: [
        { structuredOutput: { text: "first-b" } },
        { structuredOutput: { text: "second-b" } },
      ],
    });
    const judgeMock = mockGenerator({
      name: "deb-prompts-judge",
      script: [
        {
          structuredOutput: { verdict: "v", winner: "for", reasoning: "r" },
        },
      ],
    });

    const pattern = debate({
      name: "deb-prompts",
      debaters: [
        { name: "a", stance: "for" },
        { name: "b", stance: "against" },
      ],
      maxRounds: 2,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
      generators: {
        "deb-prompts-debater-a": debaterMock,
        "deb-prompts-debater-b": debaterMockB,
        "deb-prompts-judge": judgeMock,
      },
    });

    expect(result.error).toBeNull();

    // Inspect debater B's round-2 prompt: it should reference stances
    // [for] / [against] but not the debater names "a" / "b".
    const round2BMessages = JSON.stringify(debaterMockB.calls[1]?.input ?? "");
    expect(round2BMessages).toContain("[for]");
    expect(round2BMessages).toContain("[against]");
    // Not super-strict — names are stable identifiers and could appear
    // in framework metadata; we assert they're not in the rendered
    // user text by checking for explicit "a:" / "b:" attribution.
    expect(round2BMessages).not.toMatch(/\ba: /);
    expect(round2BMessages).not.toMatch(/\bb: /);
  });

  it("default judge anonymizes by default and de-anonymizes when toggled off", async () => {
    const debaterMockA = mockGenerator({
      name: "deb-anon-debater-a",
      script: [{ structuredOutput: { text: "A says" } }],
    });
    const debaterMockB = mockGenerator({
      name: "deb-anon-debater-b",
      script: [{ structuredOutput: { text: "B says" } }],
    });
    const judgeMock = mockGenerator({
      name: "deb-anon-judge",
      script: [
        {
          structuredOutput: { verdict: "v", winner: "for", reasoning: "r" },
        },
      ],
    });

    const pattern = debate({
      name: "deb-anon",
      debaters: [
        { name: "alpha", stance: "for" },
        { name: "beta", stance: "against" },
      ],
      maxRounds: 1,
      synthesizer: false,
    });

    const result = await testBlock(pattern, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
      generators: {
        "deb-anon-debater-alpha": debaterMockA,
        "deb-anon-debater-beta": debaterMockB,
        "deb-anon-judge": judgeMock,
      },
    });

    expect(result.error).toBeNull();
    const judgeMessages = JSON.stringify(judgeMock.calls[0]?.input ?? "");
    // Anonymized: stances present, names absent.
    expect(judgeMessages).toContain("[for]");
    expect(judgeMessages).toContain("[against]");
    expect(judgeMessages).not.toContain("alpha");
    expect(judgeMessages).not.toContain("beta");

    // Now run with anonymization off; judge prompt should include names.
    const debaterMockA2 = mockGenerator({
      name: "deb-anon2-debater-alpha",
      script: [{ structuredOutput: { text: "A says" } }],
    });
    const debaterMockB2 = mockGenerator({
      name: "deb-anon2-debater-beta",
      script: [{ structuredOutput: { text: "B says" } }],
    });
    const judgeMock2 = mockGenerator({
      name: "deb-anon2-judge",
      script: [
        {
          structuredOutput: { verdict: "v", winner: "for", reasoning: "r" },
        },
      ],
    });
    const pattern2 = debate({
      name: "deb-anon2",
      debaters: [
        { name: "alpha", stance: "for" },
        { name: "beta", stance: "against" },
      ],
      maxRounds: 1,
      anonymizeTranscript: false,
      synthesizer: false,
    });
    const result2 = await testBlock(pattern2, {
      input: { question: "q" },
      session: { resources: { transcript: { entries: [] } } },
      generators: {
        "deb-anon2-debater-alpha": debaterMockA2,
        "deb-anon2-debater-beta": debaterMockB2,
        "deb-anon2-judge": judgeMock2,
      },
    });
    expect(result2.error).toBeNull();
    const judgeMessages2 = JSON.stringify(judgeMock2.calls[0]?.input ?? "");
    expect(judgeMessages2).toContain("alpha");
    expect(judgeMessages2).toContain("beta");
  });
});
