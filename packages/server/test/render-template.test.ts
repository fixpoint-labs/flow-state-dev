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
});
