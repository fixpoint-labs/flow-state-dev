import { describe, expect, it } from "vitest";
import {
  createIntentSelector,
  createIntentSlashMatch,
  createIntentKeywordMatch,
  createIntentClassifierGenerator,
  createIntentClassifierSequencer,
  createApplyIntent,
  createApplyClassifierResult,
  intentSourceSchema,
  matchedSkillSchema,
  intentResultSchema,
  intentSequencerStateSchema,
  intentRequestStateSchema,
  intentSessionStateSchema,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_SKILLS,
} from "../src";

describe("intentSelector — public API surface", () => {
  it("exports schemas with the documented shape", () => {
    expect(intentSourceSchema.options).toEqual([
      "slash",
      "keyword",
      "classifier",
      "manual-override",
    ]);

    const matched = matchedSkillSchema.parse({
      name: "linear",
      source: "slash",
    });
    expect(matched.input).toBe("");
    expect(matched.confidence).toBeUndefined();

    const intent = intentResultSchema.parse({
      activeSkills: [],
      intentSource: "classifier",
    });
    expect(intent.activeSkills).toEqual([]);
    expect(intent.intentSource).toBe("classifier");
  });

  it("exports the documented default thresholds", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.65);
    expect(DEFAULT_MAX_SKILLS).toBe(20);
  });

  it("intentSequencerStateSchema defaults are wired correctly", () => {
    const initial = intentSequencerStateSchema.parse({});
    expect(initial.resolved).toBe(false);
    expect(initial.skills).toEqual([]);
    expect(initial.classifierConfidence).toBeNull();
    expect(initial.source).toBeNull();
  });

  it("intentRequestStateSchema accepts a shape with optional intent", () => {
    expect(intentRequestStateSchema.parse({}).intent).toBeUndefined();
    const populated = intentRequestStateSchema.parse({
      intent: { activeSkills: [], intentSource: "classifier" },
    });
    expect(populated.intent?.intentSource).toBe("classifier");
  });

  it("intentSessionStateSchema accepts a partial projection", () => {
    expect(intentSessionStateSchema.parse({}).activeSkills).toBeUndefined();
    const populated = intentSessionStateSchema.parse({
      activeSkills: [{ name: "x", input: "", source: "keyword" }],
    });
    expect(populated.activeSkills).toHaveLength(1);
  });
});

describe("intentSelector — block construction", () => {
  it("createIntentSelector returns a sequencer block", () => {
    const block = createIntentSelector();
    expect(block.kind).toBe("sequencer");
    expect(block.name).toBe("intent-selector");
  });

  it("respects the name override", () => {
    const block = createIntentSelector({ name: "my-selector" });
    expect(block.name).toBe("my-selector");
  });

  it("creates the LLM tier by default", () => {
    expect(() => createIntentSelector({ enableLlmClassifier: true })).not.toThrow();
  });

  it("can disable the LLM classifier", () => {
    expect(() =>
      createIntentSelector({ enableLlmClassifier: false }),
    ).not.toThrow();
  });

  it("createIntentSlashMatch returns a handler block", () => {
    const block = createIntentSlashMatch({
      collectionKey: "skills",
      scope: "project",
    });
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("intent-slash-match");
  });

  it("createIntentKeywordMatch returns a handler block", () => {
    const block = createIntentKeywordMatch({
      collectionKey: "skills",
      scope: "project",
    });
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("intent-keyword-match");
  });

  it("createIntentClassifierGenerator returns a generator block with trace agent type", () => {
    const block = createIntentClassifierGenerator({
      collectionKey: "skills",
      scope: "project",
    });
    expect(block.kind).toBe("generator");
    expect(block.name).toBe("intent-classifier");
    expect((block.config as { agentType?: string }).agentType).toBe("trace");
  });

  it("createIntentClassifierSequencer wraps the generator + apply handler", () => {
    const block = createIntentClassifierSequencer({
      collectionKey: "skills",
      scope: "project",
    });
    expect(block.kind).toBe("sequencer");
  });

  it("createApplyIntent returns a handler block", () => {
    const block = createApplyIntent();
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("apply-intent");
  });

  it("createApplyClassifierResult returns a handler block", () => {
    const block = createApplyClassifierResult({
      collectionKey: "skills",
      scope: "project",
    });
    expect(block.kind).toBe("handler");
    expect(block.name).toBe("apply-classifier-result");
  });
});
