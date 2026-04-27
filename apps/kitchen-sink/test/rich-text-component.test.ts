import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";

import {
  copyeditGenerator,
  improveGenerator,
  changeToneGenerator,
  translateGenerator,
  summarizeGenerator,
  expandGenerator,
  fixCodeGenerator,
} from "../flows/rich-text-component/generators";
import {
  copyeditInputSchema,
  improveInputSchema,
  changeToneInputSchema,
  translateInputSchema,
  summarizeInputSchema,
  expandInputSchema,
  fixCodeInputSchema,
} from "../flows/rich-text-component/schemas";

const testFlow = defineFlow({
  kind: "rich-text-component-test",
  actions: {
    copyedit:   { inputSchema: copyeditInputSchema,   block: copyeditGenerator   },
    improve:    { inputSchema: improveInputSchema,    block: improveGenerator    },
    changeTone: { inputSchema: changeToneInputSchema, block: changeToneGenerator },
    translate:  { inputSchema: translateInputSchema,  block: translateGenerator  },
    summarize:  { inputSchema: summarizeInputSchema,  block: summarizeGenerator  },
    expand:     { inputSchema: expandInputSchema,     block: expandGenerator     },
    fixCode:    { inputSchema: fixCodeInputSchema,    block: fixCodeGenerator    },
  },
})({ id: "test" });

describe("rich-text-component flow", () => {
  it("copyedit streams corrected text", async () => {
    const fixture = mockGenerator({
      name: "copyedit-generator",
      script: [{ text: "The cat sat on the mat." }],
    });
    const result = await testBlock(copyeditGenerator, {
      input: { text: "the cat sat on teh mat" },
      flow: testFlow,
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
      flow: testFlow,
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
      flow: testFlow,
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
      flow: testFlow,
      generators: { "translate-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("summarize streams a medium-length summary", async () => {
    const fixture = mockGenerator({
      name: "summarize-generator",
      script: [{ text: "Concise summary." }],
    });
    const result = await testBlock(summarizeGenerator, {
      input: { text: "Some long passage of text that needs summarizing.", length: "medium" },
      flow: testFlow,
      generators: { "summarize-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("summarize accepts an explicit length", async () => {
    const fixture = mockGenerator({
      name: "summarize-generator",
      script: [{ text: "Very short." }],
    });
    const result = await testBlock(summarizeGenerator, {
      input: { text: "Some long passage of text.", length: "short" },
      flow: testFlow,
      generators: { "summarize-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("expand handles optional context", async () => {
    const fixture = mockGenerator({
      name: "expand-generator",
      script: [{ text: "Elaborated text." }],
    });
    const result = await testBlock(expandGenerator, {
      input: { text: "Brief idea.", context: "Audience: engineers." },
      flow: testFlow,
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
      flow: testFlow,
      generators: { "expand-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("fixCode streams corrected code", async () => {
    const fixture = mockGenerator({
      name: "fix-code-generator",
      script: [{ text: "const x = 1;" }],
    });
    const result = await testBlock(fixCodeGenerator, {
      input: { text: "const x = 1", language: "typescript" },
      flow: testFlow,
      generators: { "fix-code-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("fixCode works without a language hint", async () => {
    const fixture = mockGenerator({
      name: "fix-code-generator",
      script: [{ text: "const x = 1;" }],
    });
    const result = await testBlock(fixCodeGenerator, {
      input: { text: "const x = 1" },
      flow: testFlow,
      generators: { "fix-code-generator": fixture },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBeDefined();
  });

  it("rejects empty text via Zod", () => {
    const result = copyeditInputSchema.safeParse({ text: "" });
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
