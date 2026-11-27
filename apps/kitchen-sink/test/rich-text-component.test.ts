import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock, testFlow } from "@flow-state-dev/testing";

import {
  copyeditGenerator,
  improveGenerator,
  changeToneGenerator,
  translateGenerator,
  expandGenerator,
  personalizeGenerator,
} from "../flows/rich-text-component/generators";
import {
  textInputSchema,
  changeToneInputSchema,
  translateInputSchema,
  summarizeInputSchema,
} from "../flows/rich-text-component/schemas";
import flow from "../flows/rich-text-component/flow";

describe("rich-text-component flow", () => {
  it("copyedit streams corrected text", async () => {
    const fixture = mockGenerator({
      name: "copyedit-generator",
      script: [{ text: "The cat sat on the mat." }],
    });
    const result = await testBlock(copyeditGenerator, {
      input: { text: "the cat sat on teh mat" },
      flow,
      generators: { "copyedit-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
    const message = result.items.find((i) => i.type === "message");
    expect(message).toBeDefined();
  });

  it("improve streams revised text", async () => {
    const fixture = mockGenerator({
      name: "improve-generator",
      script: [{ text: "Refined prose." }],
    });
    const result = await testBlock(improveGenerator, {
      input: { text: "rough draft" },
      flow,
      generators: { "improve-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
    const message = result.items.find((i) => i.type === "message");
    expect(message).toBeDefined();
  });

  it("changeTone composes tone + text into the user message", async () => {
    const fixture = mockGenerator({
      name: "change-tone-generator",
      script: [{ text: "Pleased to share the update." }],
    });
    const result = await testBlock(changeToneGenerator, {
      input: { text: "heres the update", tone: "professional" },
      flow,
      generators: { "change-tone-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("translate composes language + text into the user message", async () => {
    const fixture = mockGenerator({
      name: "translate-generator",
      script: [{ text: "El gato se sentó en la alfombra." }],
    });
    const result = await testBlock(translateGenerator, {
      input: { text: "the cat sat on the mat", language: "Spanish" },
      flow,
      generators: { "translate-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it.each([
    { input: { text: "Long passage" }, guidance: "1 paragraph (~80 words)" },
    { input: { text: "Long passage", length: "short" }, guidance: "1-2 sentences (~30 words)" },
    { input: { text: "Long passage", length: "long" }, guidance: "3-4 paragraphs (~200 words)" },
  ])("summarizes with the guidance $guidance", async ({ input, guidance }) => {
    const fixture = mockGenerator({
      name: "summarize-generator",
      script: [{ text: "Concise summary." }],
    });
    const result = await testFlow({
      flow,
      action: "summarize",
      userId: "reader",
      input,
      generators: { "summarize-generator": fixture },
    });
    expect(result.status).toBe("completed");
    expect(fixture.calls[0]?.input).toContainEqual({ role: "system", content: expect.stringContaining(guidance) });
  });

  it("expand handles optional context", async () => {
    const fixture = mockGenerator({
      name: "expand-generator",
      script: [{ text: "Elaborated text." }],
    });
    const result = await testBlock(expandGenerator, {
      input: { text: "Brief idea.", context: "Audience: engineers." },
      flow,
      generators: { "expand-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("expand works without context", async () => {
    const fixture = mockGenerator({
      name: "expand-generator",
      script: [{ text: "Elaborated text without extra context." }],
    });
    const result = await testBlock(expandGenerator, {
      input: { text: "Brief idea." },
      flow,
      generators: { "expand-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it.each([
    { input: { text: "const x = 1" }, guidance: "Infer the language from the code." },
    { input: { text: "const x = 1", language: "typescript" }, guidance: "The code is typescript." },
  ])("fixes code with the guidance $guidance", async ({ input, guidance }) => {
    const fixture = mockGenerator({
      name: "fix-code-generator",
      script: [{ text: "const x = 1;" }],
    });
    const result = await testFlow({
      flow,
      action: "fixCode",
      userId: "reader",
      input,
      generators: { "fix-code-generator": fixture },
    });
    expect(result.status).toBe("completed");
    expect(fixture.calls[0]?.input).toContainEqual({ role: "system", content: expect.stringContaining(guidance) });
  });

  it("personalize streams text without errors when memories are empty", async () => {
    const fixture = mockGenerator({
      name: "personalize-generator",
      script: [{ text: "Welcome." }],
    });
    const result = await testBlock(personalizeGenerator, {
      input: { text: "Welcome." },
      flow,
      generators: { "personalize-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("personalize runs with seeded user-scoped semantic memories", async () => {
    const fixture = mockGenerator({
      name: "personalize-generator",
      script: [{ text: "Welcome, Alex — hope your work in Berlin is going well." }],
    });
    const result = await testBlock(personalizeGenerator, {
      input: { text: "Welcome." },
      flow,
      user: {
        resources: {
          semanticMemory: {
            facts: [
              {
                id: "f1",
                subject: "user",
                content: "User's name is Alex.",
                category: "identity",
                confidence: 0.9,
                reinforcementCount: 3,
                createdAtTurn: 1,
                lastReinforcedAtTurn: 1,
              },
              {
                id: "f2",
                subject: "user",
                content: "User lives in Berlin.",
                category: "location",
                confidence: 0.8,
                reinforcementCount: 1,
                createdAtTurn: 2,
                lastReinforcedAtTurn: 2,
              },
            ],
          },
        },
      },
      generators: { "personalize-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
    const message = result.items.find((i) => i.type === "message");
    expect(message).toBeDefined();
  });

  it("rejects empty text via Zod", () => {
    const result = textInputSchema.safeParse({ text: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty tone via Zod", () => {
    const result = changeToneInputSchema.safeParse({ text: "x", tone: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty language via Zod", () => {
    const result = translateInputSchema.safeParse({ text: "x", language: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid summarize length via Zod", () => {
    const result = summarizeInputSchema.safeParse({ text: "x", length: "huge" });
    expect(result.success).toBe(false);
  });

  it("defaults summarize length to medium when omitted", () => {
    const result = summarizeInputSchema.parse({ text: "x" });
    expect(result.length).toBe("medium");
  });
});
