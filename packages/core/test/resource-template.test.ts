import { describe, it, expect, vi } from "vitest";
import {
  parseResourceTemplate,
  renderResourceTemplate,
  ResourceTemplateParseError,
  ResourceTemplateRenderError,
} from "../src/resource-template/resource-template";

describe("parseResourceTemplate", () => {
  it("parses a template with <system> section and frontmatter", () => {
    const text = `---
name: analyst
description: A research analyst
---
<system>
You are {{ state.role }}, specializing in {{ state.domain }}.
</system>`;
    const tpl = parseResourceTemplate(text);
    expect(tpl.name).toBe("analyst");
    expect(tpl.description).toBe("A research analyst");
    expect(tpl.sections.system).toContain("{{ state.role }}");
    expect(tpl.source).toBe(text);
    expect(tpl.inertKeys).toEqual([]);
  });

  it("uses untagged body when no <system> section", () => {
    const text = `---
name: simple
---
You are {{ state.name }}.`;
    const tpl = parseResourceTemplate(text);
    expect(tpl.sections.system).toContain("{{ state.name }}");
  });

  it("collects generator-only keys in inertKeys", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = `---
name: test
model: openai/gpt-5.4-mini
temperature: 0.7
---
<system>Hello {{ state.name }}</system>`;
    const tpl = parseResourceTemplate(text);
    expect(tpl.inertKeys).toContain("model");
    expect(tpl.inertKeys).toContain("temperature");
    expect(tpl.inertKeys).not.toContain("name");
    warnSpy.mockRestore();
  });

  it("ignores unknown frontmatter keys (extensibility)", () => {
    const text = `---
name: test
customField: whatever
---
<system>Hello</system>`;
    const tpl = parseResourceTemplate(text);
    expect(tpl.name).toBe("test");
    expect(tpl.inertKeys).toEqual([]);
  });

  it("warns about <user> and <context> sections", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = `<system>System body</system>
<user>User body</user>
<context>Context body</context>`;
    const tpl = parseResourceTemplate(text);
    expect(tpl.sections.system).toBe("System body");
    expect(tpl.sections.user).toBe("User body");
    expect(tpl.sections.context).toBe("Context body");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("<user> section is generator-only"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("<context> section is generator-only"));
    warnSpy.mockRestore();
  });

  it("throws on duplicate <system> tags", () => {
    const text = `<system>First</system>\n<system>Second</system>`;
    expect(() => parseResourceTemplate(text)).toThrow(ResourceTemplateParseError);
  });

  it("throws on oversized templates", () => {
    const text = "x".repeat(512 * 1024 + 1);
    expect(() => parseResourceTemplate(text)).toThrow(ResourceTemplateParseError);
    expect(() => parseResourceTemplate(text)).toThrow(/maximum length/);
  });

  it("throws on bad Liquid syntax", () => {
    const text = `<system>{{ state.x | nonexistentFilter }}</system>`;
    expect(() => parseResourceTemplate(text)).toThrow(ResourceTemplateParseError);
    expect(() => parseResourceTemplate(text)).toThrow(/compile failed/);
  });
});

describe("renderResourceTemplate", () => {
  it("interpolates state variables", () => {
    const tpl = parseResourceTemplate(`<system>Hello {{ state.name }}, you are a {{ state.role }}.</system>`);
    const result = renderResourceTemplate(tpl, { name: "Alice", role: "analyst" });
    expect(result).toBe("Hello Alice, you are a analyst.");
  });

  it("supports Liquid loops over state arrays", () => {
    const tpl = parseResourceTemplate(
      `<system>{% for item in state.items %}{{ item }}{% unless forloop.last %}, {% endunless %}{% endfor %}</system>`
    );
    const result = renderResourceTemplate(tpl, { items: ["a", "b", "c"] });
    expect(result).toBe("a, b, c");
  });

  it("supports | default filter for missing optional fields", () => {
    const tpl = parseResourceTemplate(
      `<system>Role: {{ state.role | default: "assistant" }}</system>`
    );
    const result = renderResourceTemplate(tpl, {});
    expect(result).toBe('Role: assistant');
  });

  it("throws on strict-variable miss (typo)", () => {
    const tpl = parseResourceTemplate(`<system>Hello {{ state.titel }}</system>`);
    expect(() => renderResourceTemplate(tpl, { title: "test" })).toThrow(
      ResourceTemplateRenderError
    );
  });

  it("blocks prototype access via ownPropertyOnly", () => {
    const tpl = parseResourceTemplate(`<system>{{ state.constructor }}</system>`);
    expect(() => renderResourceTemplate(tpl, {})).toThrow(ResourceTemplateRenderError);
  });

  it("renders empty string for empty template", () => {
    const tpl = parseResourceTemplate(`---
name: empty
---
`);
    const result = renderResourceTemplate(tpl, {});
    expect(result).toBe("");
  });

  it("handles nested state objects", () => {
    const tpl = parseResourceTemplate(`<system>{{ state.user.name }} works at {{ state.user.company }}</system>`);
    const result = renderResourceTemplate(tpl, { user: { name: "Bob", company: "Acme" } });
    expect(result).toBe("Bob works at Acme");
  });
});
