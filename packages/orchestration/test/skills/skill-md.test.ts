import { describe, expect, it } from "vitest";
import {
  parseSkillMd,
  serializeSkillMd,
  substitute,
  validateSkillName,
  kebabToCamel,
  camelToKebab,
  MAX_DESCRIPTION_LENGTH,
} from "../../src/skills/skill-md";

describe("parseSkillMd", () => {
  it("parses required description", () => {
    const text = `---\ndescription: A test skill\n---\n\nHello world.`;
    const { state, body } = parseSkillMd(text);
    expect(state.description).toBe("A test skill");
    expect(body).toBe("Hello world.");
  });

  it("converts allowed-tools (kebab) to allowedTools (camel)", () => {
    const text = `---\ndescription: x\nallowed-tools: [bash, Read]\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.allowedTools).toEqual(["bash", "Read"]);
  });

  it("accepts comma-separated allowed-tools as a fallback form", () => {
    const text = `---\ndescription: x\nallowed-tools: bash, Read, Glob\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.allowedTools).toEqual(["bash", "Read", "Glob"]);
  });

  it("honors context: inline", () => {
    const text = `---\ndescription: x\ncontext: inline\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.contextMode).toBe("inline");
  });

  it("warns and defaults when context is invalid", () => {
    const text = `---\ndescription: x\ncontext: weird\n---\n\nbody`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.contextMode).toBeUndefined();
    expect(warnings.some((w) => w.includes("context"))).toBe(true);
  });

  it("honors disable-model-invocation", () => {
    const text = `---\ndescription: x\ndisable-model-invocation: true\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.disableModelInvocation).toBe(true);
  });

  it("parses keywords as a lowercased array", () => {
    const text = `---\ndescription: x\nkeywords: [Linear, Issue, BUG]\n---\n\nbody`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.keywords).toEqual(["linear", "issue", "bug"]);
    expect(warnings).toEqual([]);
  });

  it("accepts keywords in comma-separated form", () => {
    const text = `---\ndescription: x\nkeywords: Foo, Bar, Baz\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.keywords).toEqual(["foo", "bar", "baz"]);
  });

  it("warns when keywords is not an array of strings", () => {
    const text = `---\ndescription: x\nkeywords: 42\n---\n\nbody`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.keywords).toBeUndefined();
    expect(warnings.some((w) => w.includes("keywords"))).toBe(true);
  });

  it("preserves unknown frontmatter under _preservedFields (camelCase)", () => {
    const text = `---\ndescription: x\nlicense: MIT\nmy-custom-field: hello\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state._preservedFields).toBeDefined();
    expect(state._preservedFields!.license).toBe("MIT");
    expect(state._preservedFields!.myCustomField).toBe("hello");
  });

  it("captures Claude-Code allowed-tools=['Read'] as both additive and restrictive", () => {
    // 'allowed-tools' on imported Claude skills is honored — V2 behavior.
    const text = `---\ndescription: x\nallowed-tools: [Read]\n---\n\nbody`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.allowedTools).toEqual(["Read"]);
    // No warning that allowed-tools is ignored
    expect(warnings.find((w) => /allowed-tools.*ignored/i.test(w))).toBeUndefined();
  });

  it("warns about ignored Claude-Code-only fields", () => {
    const text = `---\ndescription: x\npaths: [src/**]\nshell: powershell\nhooks: [a]\n---\n\nbody`;
    const { warnings, state } = parseSkillMd(text);
    expect(warnings.some((w) => w.includes("paths"))).toBe(true);
    expect(warnings.some((w) => w.includes("shell"))).toBe(true);
    expect(warnings.some((w) => w.includes("hooks"))).toBe(true);
    // But still preserve them so authors can round-trip.
    expect(state._preservedFields?.paths).toBeDefined();
    expect(state._preservedFields?.shell).toBe("powershell");
  });

  it("rejects missing frontmatter", () => {
    expect(() => parseSkillMd("just a body")).toThrow(/YAML frontmatter/);
  });

  it("rejects missing description", () => {
    const text = `---\nfoo: bar\n---\n\nbody`;
    expect(() => parseSkillMd(text)).toThrow(/description/);
  });

  it("rejects descriptions that exceed the cap", () => {
    const long = "x".repeat(MAX_DESCRIPTION_LENGTH + 1);
    const text = `---\ndescription: ${long}\n---\n\nbody`;
    expect(() => parseSkillMd(text)).toThrow(/description/);
  });

  it("rejects descriptions containing XML tags", () => {
    const text = `---\ndescription: hello <script>alert(1)</script>\n---\n\nbody`;
    expect(() => parseSkillMd(text)).toThrow(/XML/);
  });
});

describe("serializeSkillMd", () => {
  it("round-trips the documented fields", () => {
    const text = `---\ndescription: round trip\nallowed-tools: [bash, Read]\ncontext: inline\ndisable-model-invocation: true\n---\n\nThe body lives here.\n`;
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.description).toBe(parsed.state.description);
    expect(reparsed.state.allowedTools).toEqual(parsed.state.allowedTools);
    expect(reparsed.state.contextMode).toBe("inline");
    expect(reparsed.state.disableModelInvocation).toBe(true);
    expect(reparsed.body.trim()).toBe(parsed.body.trim());
  });

  it("round-trips preserved unknown fields", () => {
    const text = `---\ndescription: x\nlicense: MIT\n---\n\nbody`;
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state._preservedFields?.license).toBe("MIT");
  });

  it("round-trips the keywords field", () => {
    const text = `---\ndescription: x\nkeywords: [tag1, tag2]\n---\n\nbody`;
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.keywords).toEqual(["tag1", "tag2"]);
  });
});

describe("substitute", () => {
  it("replaces $ARGUMENTS with the provided input", () => {
    expect(substitute("Run for $ARGUMENTS", { arguments: "foo bar" })).toBe(
      "Run for foo bar",
    );
  });

  it("replaces ${SKILL_DIR} with the mount path", () => {
    const out = substitute("cd ${SKILL_DIR}", {
      skillDir: "/workspace/.fsdev/skills/pptx",
    });
    expect(out).toBe("cd /workspace/.fsdev/skills/pptx");
  });

  it("preserves ${CLAUDE_SKILL_DIR} as an alias for compatibility with Claude Code skill bodies", () => {
    const out = substitute("cd ${CLAUDE_SKILL_DIR}", {
      skillDir: "/workspace/.fsdev/skills/pptx",
    });
    expect(out).toBe("cd /workspace/.fsdev/skills/pptx");
  });

  it("replaces $1, $2 with whitespace-split tokens", () => {
    const out = substitute("Send $1 to $2", { arguments: "alice bob" });
    expect(out).toBe("Send alice to bob");
  });

  it("resolves missing positional args to empty strings", () => {
    expect(substitute("$1 $2 $3", { arguments: "only" })).toBe("only  ");
  });

  it("treats missing $ARGUMENTS as empty (Claude Code semantics)", () => {
    expect(substitute("hi $ARGUMENTS", {})).toBe("hi ");
  });
});

describe("validateSkillName", () => {
  it("accepts lowercase kebab-case", () => {
    expect(() => validateSkillName("create-pattern")).not.toThrow();
    expect(() => validateSkillName("linear")).not.toThrow();
    expect(() => validateSkillName("a1b2c3")).not.toThrow();
  });
  it("rejects uppercase", () => {
    expect(() => validateSkillName("MyPattern")).toThrow();
  });
  it("rejects reserved names", () => {
    expect(() => validateSkillName("_meta")).toThrow();
  });
  it("rejects names exceeding 64 chars", () => {
    expect(() => validateSkillName("a".repeat(65))).toThrow();
  });
});

describe("kebabToCamel / camelToKebab", () => {
  it("kebab → camel", () => {
    expect(kebabToCamel("allowed-tools")).toBe("allowedTools");
    expect(kebabToCamel("when_to_use")).toBe("when_to_use");
  });
  it("camel → kebab", () => {
    expect(camelToKebab("allowedTools")).toBe("allowed-tools");
    expect(camelToKebab("disableModelInvocation")).toBe(
      "disable-model-invocation",
    );
  });
});


// ---------------------------------------------------------------------------
// Delegation workers parsing — FIX-918
// ---------------------------------------------------------------------------

const baseHeader = `description: company research`;

function withFrontmatter(extra: string): string {
  return `---\n${baseHeader}\n${extra}\n---\n\nbody`;
}

describe("parseSkillMd — delegation workers", () => {
  it("parses a standalone `workers:` map (no pattern) into state.workers", () => {
    const text = withFrontmatter(
      [
        `workers:`,
        `  analyst:`,
        `    prompt-ref: ./reference/analyst.md`,
        `  writer:`,
        `    prompt: Write the final report.`,
      ].join("\n"),
    );
    const { state, warnings } = parseSkillMd(text);
    expect(state.workers?.analyst?.promptRef).toBe("./reference/analyst.md");
    expect(state.workers?.writer?.prompt).toBe("Write the final report.");
    // Declaring `workers:` is sufficient — no `pattern:` required, no warning.
    expect(warnings.some((w) => w.includes("workers"))).toBe(false);
  });

  it("parses inline `prompt: |` literal block scalars and visibility", () => {
    const text = withFrontmatter(
      [
        `workers:`,
        `  synth:`,
        `    prompt: |`,
        `      You write the report.`,
        `      Use prior findings.`,
        `    visibility: primary`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.workers?.synth?.prompt).toMatch(
      /You write the report\.\nUse prior findings\./,
    );
    expect(state.workers?.synth?.itemVisibility).toEqual({
      client: true,
      history: true,
    });
  });

  it("parses agent-ref + agent-overrides without resolving them", () => {
    const text = withFrontmatter(
      [
        `workers:`,
        `  vet:`,
        `    agent-ref: research-analyst`,
        `    agent-overrides:`,
        `      tools: [search, fetch]`,
        `      model: anthropic/claude-haiku`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.workers?.vet?.agentRef).toBe("research-analyst");
    expect(state.workers?.vet?.agentOverrides).toEqual({
      tools: ["search", "fetch"],
      model: "anthropic/claude-haiku",
    });
  });

  it("rejects a worker with zero of prompt/prompt-ref/block-ref/agent-ref", () => {
    const text = withFrontmatter(
      [`workers:`, `  bare:`, `    tools: [search]`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(
      /exactly one of `prompt`, `prompt-ref`, `block-ref`, `agent-ref`/,
    );
  });

  it("rejects a worker with two resolution fields", () => {
    const text = withFrontmatter(
      [`workers:`, `  bad:`, `    prompt: hi`, `    prompt-ref: ./x.md`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/mutually exclusive/);
  });

  it("rejects agent-overrides without agent-ref", () => {
    const text = withFrontmatter(
      [
        `workers:`,
        `  w:`,
        `    prompt: hi`,
        `    agent-overrides:`,
        `      tools: [x]`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/agent-overrides[`]? requires/);
  });

  it("rejects an invalid worker key", () => {
    const text = withFrontmatter(
      [`workers:`, `  "Bad Key":`, `    prompt: hi`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/worker key/);
  });
});

describe("parseSkillMd — removed pattern/fork frontmatter (FIX-918)", () => {
  it("throws a migration error on `context: fork`", () => {
    const text = `---\n${baseHeader}\ncontext: fork\n---\n\nbody`;
    expect(() => parseSkillMd(text)).toThrow(/context: fork.*removed/);
  });

  it("throws a migration error on `pattern:`", () => {
    const text = withFrontmatter([`pattern: task-board`].join("\n"));
    expect(() => parseSkillMd(text)).toThrow(/pattern.*removed/);
  });
});

describe("serializeSkillMd — delegation workers round-trip", () => {
  it("round-trips a prompt-ref + agent-ref worker map", () => {
    const text = withFrontmatter(
      [
        `workers:`,
        `  market:`,
        `    prompt-ref: ./reference/market.md`,
        `    tools: [search]`,
        `    visibility: sub`,
        `  vet:`,
        `    agent-ref: research-analyst`,
        `    agent-overrides:`,
        `      tools: [search, fetch]`,
        `      model: anthropic/claude-haiku`,
      ].join("\n"),
    );
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.workers).toEqual(parsed.state.workers);
  });

  it("round-trips an inline `prompt: |` body", () => {
    const text = withFrontmatter(
      [
        `workers:`,
        `  synth:`,
        `    prompt: |`,
        `      First line.`,
        `      Second line.`,
        `    visibility: primary`,
      ].join("\n"),
    );
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.workers?.synth?.prompt).toBe(
      parsed.state.workers?.synth?.prompt,
    );
  });
});
