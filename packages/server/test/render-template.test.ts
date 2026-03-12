import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src";

describe("renderTemplate", () => {
  it("renders scalar and each placeholders", () => {
    const output = renderTemplate(
      "## Values\n{{#each values}}- {{this}}\n{{/each}}Tone: {{tone}}",
      { values: ["Honesty", "Clarity"], tone: "Direct" }
    );

    expect(output).toBe("## Values\n- Honesty\n- Clarity\nTone: Direct");
  });

  it("renders object fields from each entries", () => {
    const output = renderTemplate(
      "{{#each items}}{{@index}}: {{name}} ({{this.kind}})\n{{/each}}",
      { items: [{ name: "A", kind: "x" }, { name: "B", kind: "y" }] }
    );

    expect(output).toBe("0: A (x)\n1: B (y)\n");
  });

  describe("security and edge cases", () => {
    it("throws for templates exceeding max length", () => {
      const hugeTemplate = "{{field}}" + "x".repeat(512_001);
      expect(() => renderTemplate(hugeTemplate, { field: "ok" })).toThrow(
        "exceeds maximum length"
      );
    });

    it("accepts templates at exactly max length", () => {
      const template = "x".repeat(512_000);
      expect(() => renderTemplate(template, {})).not.toThrow();
    });

    it("handles unmatched {{#each}} as literal text", () => {
      const output = renderTemplate(
        "before {{#each items}}inner text",
        { items: ["a", "b"] }
      );
      expect(output).toBe("before {{#each items}}inner text");
    });

    it("handles multiple {{/each}} candidates without backtracking", () => {
      const output = renderTemplate(
        "{{#each items}}{{this}}{{/each}} extra {{/each}}",
        { items: ["a", "b"] }
      );
      // First {{/each}} closes the block; second is literal text
      expect(output).toBe("ab extra {{/each}}");
    });
  });
});
