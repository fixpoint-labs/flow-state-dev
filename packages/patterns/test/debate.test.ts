/**
 * Debate pattern tests — handler-driven for the chassis behaviors and
 * mockGenerator-driven for default debater/judge prompt rendering.
 * Covers: ordering, prior-argument visibility, judge-runs-once,
 * verdict propagation, synthesizer integration, factory validation,
 * audit task emission, and the bias-mitigation toggles.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { makeSchemaStrict } from "@flow-state-dev/core";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { z, type ZodTypeAny } from "zod";
import {
  debate,
  debateModeratorOutputSchema,
  formatTranscriptForJudge,
  type DebateContributionEntry,
  type DebateModeratorOutput,
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

  describe("moderator", () => {
    /**
     * Scripted moderator: each call returns the next entry from a fixed
     * list of decisions. Counts invocations so tests can assert it ran
     * once per completed round.
     */
    function makeScriptedModerator(decisions: DebateModeratorOutput[]) {
      let i = 0;
      let count = 0;
      const block = handler({
        name: "moderator-handler",
        inputSchema: z.any(),
        outputSchema: debateModeratorOutputSchema,
        execute: () => {
          count++;
          const next = decisions[Math.min(i, decisions.length - 1)]!;
          i++;
          return next;
        },
      });
      return { block, getCount: () => count };
    }

    function makeJudgeOnce() {
      let count = 0;
      const block = handler({
        name: "moderator-judge",
        inputSchema: z.any(),
        outputSchema: z.object({
          verdict: z.string(),
          winner: z.string().nullable(),
          reasoning: z.string(),
        }),
        execute: () => {
          count++;
          return { verdict: "v", winner: null, reasoning: "r" };
        },
      });
      return { block, getCount: () => count };
    }

    it("round 1 with moderator uses declared roster order", async () => {
      const moderator = makeScriptedModerator([
        // After round 1: only c speaks next round.
        { nextSpeakers: ["c"], newAngle: null, done: false },
        // After round 2: end.
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const judge = makeJudgeOnce();
      const pattern = debate({
        name: "deb-mod-r1",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
          { name: "c", stance: "neutral", block: makeDebater("c", "neutral") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: judge.block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.transcript.map((e) => `${e.round}:${e.agentName}`)).toEqual([
        "1:a",
        "1:b",
        "1:c",
        "2:c",
      ]);
      expect(out.rounds).toBe(2);
      expect(judge.getCount()).toBe(1);
    });

    it("dispatches the moderator's named speakers in declared order in subsequent rounds", async () => {
      const moderator = makeScriptedModerator([
        // After round 1: send d and a in that order.
        { nextSpeakers: ["d", "a"], newAngle: null, done: false },
        // Done after round 2.
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const pattern = debate({
        name: "deb-mod-dispatch",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
          { name: "c", stance: "neutral", block: makeDebater("c", "neutral") },
          { name: "d", stance: "wildcard", block: makeDebater("d", "wildcard") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.transcript.map((e) => `${e.round}:${e.agentName}`)).toEqual([
        "1:a",
        "1:b",
        "1:c",
        "1:d",
        "2:d",
        "2:a",
      ]);
    });

    it("debaters within a round see prior debaters' arguments (sequential visibility)", async () => {
      const seen: Array<{ name: string; round: number; priors: number }> = [];
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const pattern = debate({
        name: "deb-mod-visibility",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for", seen) },
          { name: "b", stance: "against", block: makeDebater("b", "against", seen) },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      // Round 1: a sees 0, b sees 1. Round 2: a sees 2, b sees 3.
      // The round-2 visibility numbers prove maxConcurrency: 1 is in
      // effect — under parallel execution both round-2 speakers would
      // see the same 2 priors.
      expect(seen).toEqual([
        { name: "a", round: 1, priors: 0 },
        { name: "b", round: 1, priors: 1 },
        { name: "a", round: 2, priors: 2 },
        { name: "b", round: 2, priors: 3 },
      ]);
    });

    it("renders newAngle into the next round's default debater prompt", async () => {
      const debaterMockA = mockGenerator({
        name: "deb-mod-angle-debater-a",
        script: [
          { structuredOutput: { text: "first-a" } },
          { structuredOutput: { text: "second-a" } },
        ],
      });
      const debaterMockB = mockGenerator({
        name: "deb-mod-angle-debater-b",
        script: [
          { structuredOutput: { text: "first-b" } },
          { structuredOutput: { text: "second-b" } },
        ],
      });
      const moderator = makeScriptedModerator([
        {
          nextSpeakers: ["a", "b"],
          newAngle: "What about latency under load?",
          done: false,
        },
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const judgeMock = mockGenerator({
        name: "deb-mod-angle-judge",
        script: [
          {
            structuredOutput: { verdict: "v", winner: null, reasoning: "r" },
          },
        ],
      });

      const pattern = debate({
        name: "deb-mod-angle",
        debaters: [
          { name: "a", stance: "for" },
          { name: "b", stance: "against" },
        ],
        maxRounds: 3,
        moderator: moderator.block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
        generators: {
          "deb-mod-angle-debater-a": debaterMockA,
          "deb-mod-angle-debater-b": debaterMockB,
          "deb-mod-angle-judge": judgeMock,
        },
      });

      expect(result.error).toBeNull();
      const round1A = JSON.stringify(debaterMockA.calls[0]?.input ?? "");
      const round2A = JSON.stringify(debaterMockA.calls[1]?.input ?? "");
      // Round 1 has no moderator decisions yet, so no angle block.
      expect(round1A).not.toContain("latency under load");
      // Round 2's debater prompt must reference the moderator's angle.
      expect(round2A).toContain("latency under load");
    });

    it("moderator done=true exits the loop early", async () => {
      const moderator = makeScriptedModerator([
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const judge = makeJudgeOnce();
      const pattern = debate({
        name: "deb-mod-done",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: judge.block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(1);
      expect(out.transcript).toHaveLength(2);
      expect(out.moderatorDecisions).toHaveLength(1);
      expect(out.moderatorDecisions[0]?.done).toBe(true);
      expect(judge.getCount()).toBe(1);
    });

    it("terminateWhen exits the loop early when no moderator is configured", async () => {
      const pattern = debate({
        name: "deb-terminate-no-mod",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        terminateWhen: (ctx) => {
          const state = ctx.sequencer!.state as { round: number };
          return state.round >= 2;
        },
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(2);
      expect(out.moderatorDecisions).toEqual([]);
    });

    it("terminateWhen exits the loop early with a moderator", async () => {
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
      ]);
      const pattern = debate({
        name: "deb-mod-terminate",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        terminateWhen: (ctx) => {
          const state = ctx.sequencer!.state as { round: number };
          return state.round >= 2;
        },
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(2);
    });

    it("maxRounds caps the loop when the moderator keeps signalling done=false", async () => {
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
      ]);
      const pattern = debate({
        name: "deb-mod-cap",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 3,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(3);
      expect(out.moderatorDecisions).toHaveLength(3);
    });

    it("rejects an unknown speaker name with the available-names list", async () => {
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["nobody"], newAngle: null, done: false },
      ]);
      const pattern = debate({
        name: "deb-mod-unknown",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).not.toBeNull();
      const msg = String(result.error?.message ?? "");
      expect(msg).toContain('unknown debater "nobody"');
      expect(msg).toContain("Available: a, b");
    });

    it("allows the moderator to request the same speaker twice in one round", async () => {
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["a", "a"], newAngle: null, done: false },
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const pattern = debate({
        name: "deb-mod-dup",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      // Round 1 (declared order) → a, b; then round 2 has a twice.
      expect(out.transcript.map((e) => `${e.round}:${e.agentName}`)).toEqual([
        "1:a",
        "1:b",
        "2:a",
        "2:a",
      ]);
    });

    it("moderatorDecisions is populated on raw output and equals rounds in length", async () => {
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["a"], newAngle: "first", done: false },
        { nextSpeakers: ["b"], newAngle: null, done: false },
        { nextSpeakers: [], newAngle: null, done: true },
      ]);
      const pattern = debate({
        name: "deb-mod-decisions",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(3);
      expect(out.moderatorDecisions).toHaveLength(3);
      expect(out.moderatorDecisions.map((d) => d.round)).toEqual([1, 2, 3]);
      expect(out.moderatorDecisions[0]?.newAngle).toBe("first");
      expect(out.moderatorDecisions[2]?.done).toBe(true);
    });

    it("moderatorDecisions is an empty array when no moderator is configured", async () => {
      const pattern = debate({
        name: "deb-no-mod-decisions",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 1,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.moderatorDecisions).toEqual([]);
    });

    it("the synthesizer receives moderatorDecisions on its input", async () => {
      let captured: DebateRawOutput | null = null;
      const synth = handler({
        name: "capture-synth",
        inputSchema: z.any(),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: (input) => {
          captured = input as DebateRawOutput;
          return { ok: true };
        },
      });
      const moderator = makeScriptedModerator([
        { nextSpeakers: [], newAngle: "x", done: true },
      ]);
      const pattern = debate({
        name: "deb-mod-synth",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 3,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: synth,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      expect(captured).not.toBeNull();
      expect(captured!.moderatorDecisions).toHaveLength(1);
      expect(captured!.moderatorDecisions[0]?.newAngle).toBe("x");
    });

    it("maxRounds=1 with moderator runs one round and records its decision", async () => {
      const moderator = makeScriptedModerator([
        // The moderator runs once before the loopBack predicate fires the
        // round-cap exit; its decision is stashed but never drives dispatch.
        { nextSpeakers: ["a", "b"], newAngle: null, done: false },
      ]);
      const pattern = debate({
        name: "deb-mod-one",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 1,
        moderator: moderator.block,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(1);
      expect(out.transcript).toHaveLength(2);
      expect(out.moderatorDecisions).toHaveLength(1);
    });

    it("a moderator that throws surfaces as a run error", async () => {
      const brokenModerator = handler({
        name: "moderator-broken",
        inputSchema: z.any(),
        outputSchema: debateModeratorOutputSchema,
        execute: () => {
          throw new Error("moderator-boom");
        },
      });
      const pattern = debate({
        name: "deb-mod-throws",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: brokenModerator,
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).not.toBeNull();
      expect(String(result.error?.message ?? "")).toContain("moderator-boom");
    });

    it("exits after round 2 when terminateWhen and moderator.done both fire", async () => {
      // Both mechanisms wired to end after round 2; the loopBack predicate's
      // short-circuit order (round cap → moderator.done → terminateWhen)
      // means moderator.done wins here, but exit happens regardless.
      const moderator = makeScriptedModerator([
        { nextSpeakers: ["a", "b"], newAngle: null, done: false }, // round 1 → continue
        { nextSpeakers: [], newAngle: null, done: true },          // round 2 → done
      ]);
      const pattern = debate({
        name: "deb-mod-and-terminate",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        moderator: moderator.block,
        terminateWhen: (ctx) => {
          const state = ctx.sequencer!.state as { round: number };
          return state.round >= 2;
        },
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).toBeNull();
      const out = result.output as DebateRawOutput;
      expect(out.rounds).toBe(2);
      // Both exit conditions are truthy after round 2; either is sufficient.
      expect(
        out.moderatorDecisions[out.moderatorDecisions.length - 1]?.done,
      ).toBe(true);
    });

    it("terminateWhen that throws propagates as a run error", async () => {
      const pattern = debate({
        name: "deb-terminate-throws",
        debaters: [
          { name: "a", stance: "for", block: makeDebater("a", "for") },
          { name: "b", stance: "against", block: makeDebater("b", "against") },
        ],
        maxRounds: 5,
        terminateWhen: () => {
          throw new Error("boom");
        },
        judge: makeJudgeOnce().block,
        synthesizer: false,
      });

      const result = await testBlock(pattern, {
        input: { question: "q" },
        session: { resources: { transcript: { entries: [] } } },
      });

      expect(result.error).not.toBeNull();
      expect(String(result.error?.message ?? "")).toContain("boom");
    });

    it("rejects moderator: false at factory construction", () => {
      expect(() =>
        debate({
          name: "deb-mod-false",
          debaters: [
            { name: "a", stance: "for" },
            { name: "b", stance: "against" },
          ],
          // Intentional misuse — runtime error path.
          moderator: false as any,
        }),
      ).toThrow(/moderator cannot be set to false/);
    });

    it("output schema retains its refinement and survives makeSchemaStrict cleanly", () => {
      // Guard against accidental removal of the .refine() guarding
      // nextSpeakers: [] + done: false.
      expect(
        (debateModeratorOutputSchema as any)._def?.typeName,
      ).toBe("ZodEffects");

      const strict = makeSchemaStrict(debateModeratorOutputSchema);
      const violations: string[] = [];
      const walk = (node: ZodTypeAny, path: string) => {
        const def = (node as any)._def;
        const t = def?.typeName as string | undefined;
        switch (t) {
          case "ZodOptional":
          case "ZodDefault":
            violations.push(`${path}: ${t} survived`);
            walk(def.innerType, path);
            break;
          case "ZodRecord":
            violations.push(`${path}: ZodRecord present`);
            break;
          case "ZodUnion":
          case "ZodDiscriminatedUnion": {
            const options = (def.options ?? []) as ZodTypeAny[];
            const allLiterals = options.every(
              (o) =>
                ((o as any)._def?.typeName as string | undefined) ===
                "ZodLiteral",
            );
            if (!allLiterals) {
              violations.push(`${path}: non-literal ${t}`);
            }
            options.forEach((opt, i) => walk(opt, `${path}|${i}`));
            break;
          }
          case "ZodNullable":
            walk(def.innerType, path);
            break;
          case "ZodEffects":
            walk(def.schema, path);
            break;
          case "ZodObject": {
            const shape = def.shape() as Record<string, ZodTypeAny>;
            for (const [k, v] of Object.entries(shape)) {
              walk(v, `${path}.${k}`);
            }
            break;
          }
          case "ZodArray":
            walk(def.type, `${path}[]`);
            break;
          default:
            break;
        }
      };
      walk(strict, "$");
      expect(violations).toEqual([]);
    });

    it("empty nextSpeakers with done=false is rejected by the moderator's output schema", () => {
      const parsed = debateModeratorOutputSchema.safeParse({
        nextSpeakers: [],
        newAngle: null,
        done: false,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => i.message).join("\n");
        expect(msg).toContain("non-empty nextSpeakers");
      }
    });
  });
});
