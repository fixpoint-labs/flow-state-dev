import { describe, expect, it } from "vitest";
import type { BlockContext } from "../src/types/block";
import {
  definePromptFile,
  getPromptFileBrand,
  isPromptFile,
  parsePromptFile,
  PromptFileParseError,
  PROMPT_FILE_BRAND,
  type PromptFileConfigView,
} from "../src/prompt/prompt-file";

/** Minimal ctx stand-in — templates only touch the fields they reference. */
function mockCtx(overrides?: Partial<BlockContext>): BlockContext {
  return {
    session: { state: {} },
    resources: {},
    ...overrides,
  } as unknown as BlockContext;
}

const emptyConfig: PromptFileConfigView = { context: {} };

describe("isPromptFile", () => {
  it("returns true for a parsed PromptFile", () => {
    expect(isPromptFile(parsePromptFile(`<system>hi</system>`))).toBe(true);
  });

  it("returns false for a bare branded slot, string, function, and array", () => {
    const pf = parsePromptFile(`<system>hi</system>`);
    expect(isPromptFile(pf.prompt)).toBe(false);
    expect(isPromptFile("inline prompt")).toBe(false);
    expect(isPromptFile(() => "x")).toBe(false);
    expect(isPromptFile([pf.prompt])).toBe(false);
    expect(isPromptFile(null)).toBe(false);
    expect(isPromptFile({ prompt: "not branded" })).toBe(false);
  });
});

describe("parsePromptFile — frontmatter", () => {
  it("parses all known frontmatter fields", () => {
    const pf = parsePromptFile(
      `---
name: analyst
description: an analyst
intent: chat
model: openai/gpt-5.4-mini
caching: true
maxTokens: 1000
temperature: 0.5
---
<system>hi</system>`
    );
    expect(pf.name).toBe("analyst");
    expect(pf.description).toBe("an analyst");
    expect(pf._meta.frontmatter.intent).toBe("chat");
    expect(pf._meta.frontmatter.model).toBe("openai/gpt-5.4-mini");
    expect(pf.caching).toBe(true);
    expect(pf.maxTokens).toBe(1000);
    expect(pf.temperature).toBe(0.5);
  });

  it("rejects unknown frontmatter keys", () => {
    expect(() =>
      parsePromptFile(`---
bogus: 1
---
<system>hi</system>`)
    ).toThrow(PromptFileParseError);
  });

  it("accepts the verbose caching object form", () => {
    const pf = parsePromptFile(`---
caching:
  enabled: true
  ttl: 1h
---
<system>hi</system>`);
    expect(pf.caching).toEqual({ enabled: true, ttl: "1h" });
  });

  it("rejects a bare-string caching value", () => {
    expect(() =>
      parsePromptFile(`---
caching: 5m
---
<system>hi</system>`)
    ).toThrow(PromptFileParseError);
  });
});

describe("parsePromptFile — body grammar", () => {
  it("parses a system-only file", () => {
    const pf = parsePromptFile(`<system>hello</system>`);
    expect(pf._meta.hasUserBlock).toBe(false);
    expect(pf._meta.hasContextBlock).toBe(false);
  });

  it("parses system + user + context", () => {
    const pf = parsePromptFile(
      `<system>s</system>\n<user>u</user>\n<context>c</context>`
    );
    expect(pf._meta.hasUserBlock).toBe(true);
    expect(pf._meta.hasContextBlock).toBe(true);
    expect(pf.user).toBeDefined();
  });

  it("rejects a file with no <system> block", () => {
    expect(() => parsePromptFile(`<user>u</user>`)).toThrow(/system.*required/i);
  });

  it("rejects a whitespace-only <system> block", () => {
    expect(() => parsePromptFile(`<system>\n   \n</system>`)).toThrow(/empty/i);
  });

  it("rejects duplicate <system> blocks", () => {
    expect(() =>
      parsePromptFile(`<system>a</system>\n<system>b</system>`)
    ).toThrow(/multiple <system>/i);
  });

  it("ignores text outside recognized tags", async () => {
    const pf = parsePromptFile(`ignored preamble\n<system>kept</system>\ntrailing`);
    const out = await pf.prompt({}, mockCtx());
    expect(out).toBe("kept");
  });
});

describe("parsePromptFile — LiquidJS render", () => {
  it("interpolates input fields", async () => {
    const pf = parsePromptFile(`<system>Look at {{ input.ticker }}.</system>`);
    const out = await pf.prompt({ ticker: "TSLA" }, mockCtx());
    expect(out).toBe("Look at TSLA.");
  });

  it("applies built-in filters", async () => {
    const pf = parsePromptFile(`<system>{{ input.ticker | upcase }}</system>`);
    expect(await pf.prompt({ ticker: "tsla" }, mockCtx())).toBe("TSLA");
  });

  it("throws on an unknown variable under strictVariables", async () => {
    const pf = parsePromptFile(`<system>{{ input.missing }}</system>`);
    await expect(pf.prompt({}, mockCtx())).rejects.toThrow(/undefined variable/i);
  });

  it("supports the default filter for optional fields", async () => {
    const pf = parsePromptFile(`<system>{{ input.notes | default: "none" }}</system>`);
    expect(await pf.prompt({ notes: null }, mockCtx())).toBe("none");
  });

  it("supports {% if %} conditionals over ctx state", async () => {
    const pf = parsePromptFile(
      `<system>{% if ctx.session.state.flag %}ON{% else %}OFF{% endif %}</system>`
    );
    const ctx = mockCtx({ session: { state: { flag: true } } } as Partial<BlockContext>);
    expect(await pf.prompt({}, ctx)).toBe("ON");
  });

  it("rejects an unknown filter at parse time", () => {
    expect(() => parsePromptFile(`<system>{{ x | nope }}</system>`)).toThrow(
      PromptFileParseError
    );
  });
});

describe("parsePromptFile — config access", () => {
  it("exposes config.context, config.model, config.tools", async () => {
    const pf = parsePromptFile(
      `<system>{{ config.model }} / {{ config.context.memory }} / {{ config.tools | join: "," }}</system>`
    );
    const out = await pf.prompt({}, mockCtx(), {
      context: { memory: "remembered" },
      model: "openai/gpt-5.4-mini",
      tools: ["search", "calc"],
    });
    expect(out).toBe("openai/gpt-5.4-mini / remembered / search,calc");
  });
});

describe("parsePromptFile — custom filters", () => {
  it("registers per-file custom filters", async () => {
    const pf = parsePromptFile(`<system>{{ input.n | format_usd }}</system>`, {
      filters: { format_usd: (n) => `$${(n as number).toFixed(2)}` },
    });
    expect(await pf.prompt({ n: 12.5 }, mockCtx())).toBe("$12.50");
  });

  it("lets a custom filter shadow a built-in", async () => {
    const pf = parsePromptFile(`<system>{{ input.x | upcase }}</system>`, {
      filters: { upcase: () => "SHADOWED" },
    });
    expect(await pf.prompt({ x: "a" }, mockCtx())).toBe("SHADOWED");
  });

  it("awaits async custom filters", async () => {
    const pf = parsePromptFile(`<system>{{ input.id | lookup }}</system>`, {
      filters: { lookup: async (id) => `name-${id as string}` },
    });
    expect(await pf.prompt({ id: "42" }, mockCtx())).toBe("name-42");
  });
});

describe("parsePromptFile — built-in fsd_ filters", () => {
  it("fsd_keyValues renders a typed object as key: value lines", async () => {
    const pf = parsePromptFile(`<system>{{ input.meta | fsd_keyValues }}</system>`);
    const out = await pf.prompt({ meta: { name: "Alice", role: "admin" } }, mockCtx());
    expect(out).toBe("name: Alice\nrole: admin");
  });

  it("fsd_list renders an array as a bullet list, ordered on request", async () => {
    const bullets = parsePromptFile(`<system>{{ input.xs | fsd_list }}</system>`);
    expect(await bullets.prompt({ xs: ["a", "b"] }, mockCtx())).toBe("- a\n- b");

    const numbered = parsePromptFile(
      `<system>{{ input.xs | fsd_list: "ordered" }}</system>`
    );
    expect(await numbered.prompt({ xs: ["a", "b"] }, mockCtx())).toBe("1. a\n2. b");
  });

  it("fsd_table renders an array of records as a Markdown table", async () => {
    const pf = parsePromptFile(`<system>{{ input.rows | fsd_table }}</system>`);
    const out = await pf.prompt(
      { rows: [{ t: "AAPL", q: 10 }, { t: "JPM", q: 5 }] },
      mockCtx()
    );
    expect(out).toBe("| t | q |\n| --- | --- |\n| AAPL | 10 |\n| JPM | 5 |");
  });

  it("fsd_json renders a fenced, pretty-printed json block", async () => {
    const pf = parsePromptFile(`<system>{{ input.obj | fsd_json }}</system>`);
    const out = await pf.prompt({ obj: { a: 1 } }, mockCtx());
    expect(out).toBe('```json\n{\n  "a": 1\n}\n```');
  });

  it("fsd_json renders undefined as null so the block stays valid json", async () => {
    // The lenient <context> engine can pass an absent key through as undefined.
    const pf = parsePromptFile(
      `<system>s</system>\n<context>{{ config.context.missing | fsd_json }}</context>`
    );
    const out = await getPromptFileBrand(pf.prompt)!.renderContext!({
      input: {},
      ctx: mockCtx(),
      config: { context: {} },
    });
    expect(out).toBe("```json\nnull\n```");
  });

  it("lets a caller filter override a built-in fsd_ filter", async () => {
    const pf = parsePromptFile(`<system>{{ input.x | fsd_json }}</system>`, {
      filters: { fsd_json: () => "OVERRIDDEN" },
    });
    expect(await pf.prompt({ x: { a: 1 } }, mockCtx())).toBe("OVERRIDDEN");
  });

  it("makes fsd_ filters available inside the lenient <context> section", async () => {
    const pf = parsePromptFile(
      `<system>s</system>\n<context>{{ config.context.rows | fsd_keyValues }}</context>`
    );
    const rendered = pf._meta.hasContextBlock
      ? await getPromptFileBrand(pf.prompt)!.renderContext!({
          input: {},
          ctx: mockCtx(),
          config: { context: { rows: { k: "v" } as unknown as string } },
        })
      : "";
    expect(rendered).toBe("k: v");
  });
});

describe("parsePromptFile — partials", () => {
  it("renders a pre-registered partial via {% render %}", async () => {
    const pf = parsePromptFile(`<system>{% render 'preamble' %}\nbody</system>`, {
      partials: { preamble: "PREAMBLE" },
    });
    expect(await pf.prompt({}, mockCtx())).toBe("PREAMBLE\nbody");
  });

  it("throws at parse time for an unregistered partial", () => {
    expect(() =>
      parsePromptFile(`<system>{% render 'missing' %}</system>`)
    ).toThrow(/partial "missing" is not registered/i);
  });

  it("isolates partial scope under {% render %}", async () => {
    // `render` does not pass the caller scope, so `input` is undefined inside
    // the partial; referencing it must throw under strictVariables.
    const pf = parsePromptFile(`<system>{% render 'p' %}</system>`, {
      partials: { p: "{{ input.x }}" },
    });
    await expect(pf.prompt({ x: 1 }, mockCtx())).rejects.toThrow(/undefined variable/i);
  });
});

describe("definePromptFile + brand", () => {
  it("produces a spreadable config carrying the brand", () => {
    const pf = parsePromptFile(`---
name: x
---
<system>s</system>
<user>u</user>`);
    const config = definePromptFile(pf);
    expect(config.name).toBe("x");
    expect(config.user).toBeDefined();
    const brand = getPromptFileBrand(config.prompt);
    expect(brand).toBeDefined();
    expect(brand?.hasUserBlock).toBe(true);
    expect(brand?.hasContextBlock).toBe(false);
  });

  it("finds the brand inside an array slot", () => {
    const pf = parsePromptFile(`<system>s</system>`);
    const brand = getPromptFileBrand(["inline", pf.prompt]);
    expect(brand).toBeDefined();
  });

  it("returns undefined for inline prompts", () => {
    expect(getPromptFileBrand("plain string")).toBeUndefined();
    expect(getPromptFileBrand(() => "x")).toBeUndefined();
  });

  it("does not enumerate the brand symbol", () => {
    const pf = parsePromptFile(`<system>s</system>`);
    expect(Object.getOwnPropertySymbols(pf.prompt)).toContain(PROMPT_FILE_BRAND);
    expect(Object.keys(pf.prompt)).toHaveLength(0);
  });
});

describe("brand renderers", () => {
  it("renders context block in author order", async () => {
    const pf = parsePromptFile(
      `<system>s</system>
<context>{% if config.context.a %}<a>{{ config.context.a }}</a>{% endif %}{% if config.context.b %}<b>{{ config.context.b }}</b>{% endif %}</context>`
    );
    const brand = getPromptFileBrand(pf.prompt)!;
    const out = await brand.renderContext({
      input: {},
      ctx: mockCtx(),
      config: { context: { b: "B", a: "A" } },
    });
    expect(out).toBe("<a>A</a><b>B</b>");
  });

  it("does not throw when a <context> block probes an absent config.context key", async () => {
    // The context block renders under a lenient engine: probing a key that no
    // capability contributed must skip cleanly, not throw under strictVariables.
    const pf = parsePromptFile(
      `<system>s</system>
<context>{% if config.context.present %}<p>{{ config.context.present }}</p>{% endif %}{% if config.context.absent %}<a>{{ config.context.absent }}</a>{% endif %}</context>`
    );
    const brand = getPromptFileBrand(pf.prompt)!;
    const out = await brand.renderContext({
      input: {},
      ctx: mockCtx(),
      config: { context: { present: "X" } },
    });
    expect(out).toBe("<p>X</p>");
  });

  it("keeps <system> strict — an absent ctx path still throws", async () => {
    const pf = parsePromptFile(`<system>{{ ctx.session.state.missing }}</system>`);
    await expect(pf.prompt({}, mockCtx())).rejects.toThrow(/undefined variable/i);
  });

  it("renderContext/renderUser return undefined when absent", () => {
    const pf = parsePromptFile(`<system>s</system>`);
    const brand = getPromptFileBrand(pf.prompt)!;
    const scope = { input: {}, ctx: mockCtx(), config: emptyConfig };
    expect(brand.renderContext(scope)).toBeUndefined();
    expect(brand.renderUser(scope)).toBeUndefined();
  });
});
