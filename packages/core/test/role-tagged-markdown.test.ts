import { describe, it, expect } from "vitest";
import {
  parseRoleTaggedMarkdown,
  RoleTaggedMarkdownParseError,
} from "../src/markdown/role-tagged";

describe("parseRoleTaggedMarkdown", () => {
  it("parses all three role-tagged sections", () => {
    const text = `---
name: test
---
<system>
You are an analyst.
</system>
<user>
Hello {{ state.name }}
</user>
<context>
Background info
</context>`;
    const result = parseRoleTaggedMarkdown(text);
    expect(result.frontmatter).toEqual({ name: "test" });
    expect(result.sections.system).toBe("You are an analyst.");
    expect(result.sections.user).toBe("Hello {{ state.name }}");
    expect(result.sections.context).toBe("Background info");
    expect(result.raw).toBe(text);
  });

  it("captures untagged body when no role tags present", () => {
    const text = `---
description: plain
---
Just a plain body with no role tags.`;
    const result = parseRoleTaggedMarkdown(text);
    expect(result.sections.system).toBeUndefined();
    expect(result.sections.user).toBeUndefined();
    expect(result.sections.context).toBeUndefined();
    expect(result.body).toContain("Just a plain body");
  });

  it("throws on duplicate <system> tags", () => {
    const text = `<system>First</system>\n<system>Second</system>`;
    expect(() => parseRoleTaggedMarkdown(text)).toThrow(
      RoleTaggedMarkdownParseError
    );
    expect(() => parseRoleTaggedMarkdown(text)).toThrow(
      /Multiple <system> blocks/
    );
  });

  it("throws on duplicate <user> tags", () => {
    const text = `<system>Ok</system>\n<user>A</user>\n<user>B</user>`;
    expect(() => parseRoleTaggedMarkdown(text)).toThrow(
      /Multiple <user> blocks/
    );
  });

  it("throws on invalid frontmatter YAML", () => {
    const text = `---\n: bad yaml\n---\n<system>ok</system>`;
    expect(() => parseRoleTaggedMarkdown(text)).toThrow(
      RoleTaggedMarkdownParseError
    );
  });

  it("handles empty frontmatter", () => {
    const text = `---\n---\n<system>Hello</system>`;
    const result = parseRoleTaggedMarkdown(text);
    expect(result.frontmatter).toEqual({});
    expect(result.sections.system).toBe("Hello");
  });

  it("handles no frontmatter at all", () => {
    const text = `<system>Just system</system>`;
    const result = parseRoleTaggedMarkdown(text);
    expect(result.frontmatter).toEqual({});
    expect(result.sections.system).toBe("Just system");
  });

  it("carries sourcePath on errors", () => {
    const text = `<system>A</system>\n<system>B</system>`;
    try {
      parseRoleTaggedMarkdown(text, { sourcePath: "/my/file.md" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RoleTaggedMarkdownParseError);
      expect((err as RoleTaggedMarkdownParseError).sourcePath).toBe("/my/file.md");
    }
  });
});
