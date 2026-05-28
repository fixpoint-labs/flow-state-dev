/**
 * Integration tests for PromptFile-sourced generator prompts.
 *
 * Drives a generator built from `definePromptFile(parsePromptFile(...))` through
 * a capturing mock model and asserts the assembled system/user messages plus
 * the trace-capture additions (`templateSource` / `templateFrontmatter`).
 */
import { describe, expect, it } from "vitest";
import { generator } from "../src/blocks/generator";
import { definePromptFile, parsePromptFile } from "../src/prompt/prompt-file";
import type { BlockTraceItem } from "../src/items/types";
import { createMockContext, runForTest } from "./helpers";

interface CapturedCall {
  messages: unknown[];
}

function makeCapturingModel(captured: CapturedCall[]) {
  return {
    modelId: "mock-model",
    async generate(options: { messages: unknown[] }) {
      captured.push({ messages: options.messages });
      return { text: "ok" };
    },
  };
}

function messagesByRole(call: CapturedCall, role: string): Array<{ role: string; content: unknown }> {
  return call.messages.filter(
    (m): m is { role: string; content: unknown } =>
      m !== null && typeof m === "object" && "role" in m && (m as { role: unknown }).role === role
  );
}

function withTraceCapture(captured: CapturedCall[], traces: BlockTraceItem[]) {
  return createMockContext({
    resolveModel: () => makeCapturingModel(captured) as never,
    _runtimeHooks: {
      onBlockTraceCapture: (payload: { data: Partial<BlockTraceItem> }) => {
        traces.push(payload.data as BlockTraceItem);
      },
    },
  } as never);
}

describe("PromptFile generator — default mode", () => {
  it("renders <system> and appends the framework's XML context", async () => {
    const pf = parsePromptFile(`<system>You investigate {{ input.ticker | upcase }}.</system>`);
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-default",
      model: "mock-model",
      ...definePromptFile(pf),
      context: { documents: "doc body" },
    });
    await runForTest(block, { ticker: "tsla" }, withTraceCapture(captured, []));

    const sys = messagesByRole(captured[0]!, "system");
    expect(sys).toHaveLength(1);
    expect(sys[0]!.content).toBe(
      "You investigate TSLA.\n\n<documents>\n  doc body\n</documents>"
    );
  });
});

describe("PromptFile generator — context override mode", () => {
  it("suppresses the default XML append and lets the template own context", async () => {
    const pf = parsePromptFile(
      `<system>S</system>
<context>{% if config.context.memory %}<mem>{{ config.context.memory }}</mem>{% endif %}{% if config.context.documents %}<docs>{{ config.context.documents }}</docs>{% endif %}</context>`
    );
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-override",
      model: "mock-model",
      ...definePromptFile(pf),
      // Author orders <mem> before <docs> even though docs is declared first.
      context: { documents: "D", memory: "M" },
    });
    await runForTest(block, {}, withTraceCapture(captured, []));

    const sys = messagesByRole(captured[0]!, "system");
    expect(sys).toHaveLength(1);
    expect(sys[0]!.content).toBe(
      "S\n\n<context>\n<mem>M</mem><docs>D</docs>\n</context>"
    );
  });

  it("drops capability-contributed keys the template does not render", async () => {
    const pf = parsePromptFile(
      `<system>S</system>
<context>{% if config.context.kept %}<kept>{{ config.context.kept }}</kept>{% endif %}</context>`
    );
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-drop",
      model: "mock-model",
      ...definePromptFile(pf),
      context: { kept: "yes", dropped: "no" },
    });
    await runForTest(block, {}, withTraceCapture(captured, []));

    const content = String(messagesByRole(captured[0]!, "system")[0]!.content);
    expect(content).toContain("<kept>yes</kept>");
    expect(content).not.toContain("dropped");
    expect(content).not.toContain("no");
  });
});

describe("PromptFile generator — user block", () => {
  it("fills the user slot from the <user> template", async () => {
    const pf = parsePromptFile(
      `<system>S</system>\n<user>Assess {{ input.ticker | upcase }}.</user>`
    );
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-user",
      model: "mock-model",
      ...definePromptFile(pf),
    });
    await runForTest(block, { ticker: "aapl" }, withTraceCapture(captured, []));

    const user = messagesByRole(captured[0]!, "user");
    expect(user).toHaveLength(1);
    expect(user[0]!.content).toBe("Assess AAPL.");
  });

  it("lets a user: override after the spread win over the <user> block", async () => {
    const pf = parsePromptFile(`<system>S</system>\n<user>FROM FILE</user>`);
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-user-override",
      model: "mock-model",
      ...definePromptFile(pf),
      user: "OVERRIDE",
    });
    await runForTest(block, {}, withTraceCapture(captured, []));

    const user = messagesByRole(captured[0]!, "user");
    expect(user).toHaveLength(1);
    expect(user[0]!.content).toBe("OVERRIDE");
  });
});

describe("PromptFile generator — prompt: PromptFile direct form", () => {
  it("renders <system> when the PromptFile is passed directly (no definePromptFile spread)", async () => {
    const pf = parsePromptFile(`<system>You investigate {{ input.ticker | upcase }}.</system>`);
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-direct",
      model: "mock-model",
      prompt: pf,
      context: { documents: "doc body" },
    });
    await runForTest(block, { ticker: "tsla" }, withTraceCapture(captured, []));

    const sys = messagesByRole(captured[0]!, "system");
    expect(sys[0]!.content).toBe(
      "You investigate TSLA.\n\n<documents>\n  doc body\n</documents>"
    );
  });

  it("fills the user slot from the file's <user> block", async () => {
    const pf = parsePromptFile(`<system>S</system>\n<user>Assess {{ input.ticker | upcase }}.</user>`);
    const captured: CapturedCall[] = [];
    const block = generator({ name: "pf-direct-user", model: "mock-model", prompt: pf });
    await runForTest(block, { ticker: "aapl" }, withTraceCapture(captured, []));

    const user = messagesByRole(captured[0]!, "user");
    expect(user[0]!.content).toBe("Assess AAPL.");
  });

  it("lets a sibling user: field win over the file's <user> block", async () => {
    const pf = parsePromptFile(`<system>S</system>\n<user>FROM FILE</user>`);
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-direct-user-override",
      model: "mock-model",
      prompt: pf,
      user: "OVERRIDE",
    });
    await runForTest(block, {}, withTraceCapture(captured, []));

    const user = messagesByRole(captured[0]!, "user");
    expect(user[0]!.content).toBe("OVERRIDE");
  });

  it("pulls temperature from the file, and a sibling override still wins", async () => {
    const pf = parsePromptFile(`---
temperature: 0.2
---
<system>temp={{ config.temperature }}</system>`);
    const captured: CapturedCall[] = [];
    const fromFile = generator({ name: "pf-direct-temp", model: "mock-model", prompt: pf });
    await runForTest(fromFile, {}, withTraceCapture(captured, []));
    expect(String(messagesByRole(captured[0]!, "system")[0]!.content)).toBe("temp=0.2");

    const overridden = generator({
      name: "pf-direct-temp-override",
      model: "mock-model",
      prompt: pf,
      temperature: 0.9,
    } as Parameters<typeof generator>[0]);
    const captured2: CapturedCall[] = [];
    await runForTest(overridden, {}, withTraceCapture(captured2, []));
    expect(String(messagesByRole(captured2[0]!, "system")[0]!.content)).toBe("temp=0.9");
  });

  it("captures template trace fields just like the spread form", async () => {
    const text = `---
name: direct-traced
intent: chat
---
<system>S {{ input.x }}</system>`;
    const pf = parsePromptFile(text);
    const captured: CapturedCall[] = [];
    const traces: BlockTraceItem[] = [];
    const block = generator({ name: "pf-direct-trace", model: "mock-model", prompt: pf });
    await runForTest(block, { x: 1 }, withTraceCapture(captured, traces));

    const gen = traces.find((t) => t.generator)?.generator;
    expect(gen?.templateSource).toBe(text);
    expect(gen?.templateFrontmatter).toMatchObject({ name: "direct-traced", intent: "chat" });
  });
});

describe("PromptFile generator — config view reflects overrides", () => {
  it("exposes a temperature override (not the frontmatter value) as config.temperature", async () => {
    const pf = parsePromptFile(`---
temperature: 0.2
---
<system>temp={{ config.temperature }}</system>`);
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "pf-temp-override",
      model: "mock-model",
      ...definePromptFile(pf),
      temperature: 0.9,
    } as Parameters<typeof generator>[0]);
    await runForTest(block, {}, withTraceCapture(captured, []));

    const content = String(messagesByRole(captured[0]!, "system")[0]!.content);
    expect(content).toBe("temp=0.9");
  });
});

describe("PromptFile generator — trace capture", () => {
  it("captures templateSource and templateFrontmatter for PromptFile prompts", async () => {
    const text = `---
name: traced
intent: chat
---
<system>S {{ input.x }}</system>`;
    const pf = parsePromptFile(text);
    const captured: CapturedCall[] = [];
    const traces: BlockTraceItem[] = [];
    const block = generator({
      name: "pf-trace",
      model: "mock-model",
      ...definePromptFile(pf),
    });
    await runForTest(block, { x: 1 }, withTraceCapture(captured, traces));

    const gen = traces.find((t) => t.generator)?.generator;
    expect(gen?.templateSource).toBe(text);
    expect(gen?.templateFrontmatter).toMatchObject({ name: "traced", intent: "chat" });
  });

  it("does not capture template fields for inline-string prompts", async () => {
    const captured: CapturedCall[] = [];
    const traces: BlockTraceItem[] = [];
    const block = generator({
      name: "inline-trace",
      model: "mock-model",
      prompt: "plain inline prompt",
    });
    await runForTest(block, {}, withTraceCapture(captured, traces));

    const gen = traces.find((t) => t.generator)?.generator;
    expect(gen).toBeDefined();
    expect(gen?.templateSource).toBeUndefined();
    expect(gen?.templateFrontmatter).toBeUndefined();
  });
});
