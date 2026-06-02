import { describe, expect, it } from "vitest";
import {
  parseSkillMd,
  serializeSkillMd,
  substitute,
  validateSkillName,
  kebabToCamel,
  camelToKebab,
  MAX_DESCRIPTION_LENGTH,
} from "../src/skill-md";

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

  it("honors context: fork", () => {
    const text = `---\ndescription: x\ncontext: fork\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.contextMode).toBe("fork");
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
    const text = `---\ndescription: round trip\nallowed-tools: [bash, Read]\ncontext: fork\ndisable-model-invocation: true\n---\n\nThe body lives here.\n`;
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.description).toBe(parsed.state.description);
    expect(reparsed.state.allowedTools).toEqual(parsed.state.allowedTools);
    expect(reparsed.state.contextMode).toBe("fork");
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
// Pattern binding parsing — FIX-450
// ---------------------------------------------------------------------------

const baseHeader = `description: company research`;

function withPattern(extra: string): string {
  return `---\n${baseHeader}\n${extra}\n---\n\nbody`;
}

describe("parseSkillMd — pattern binding", () => {
  it("parses a minimal pattern skill with a prompt-ref worker", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  analyst:`,
        `    prompt-ref: ./reference/analyst.md`,
        `initial-tasks:`,
        `  - id: a`,
        `    goal: investigate $ARGUMENTS`,
        `    assignee: analyst`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.contextMode).toBe("pattern");
    expect(state.patternBinding?.pattern).toBe("task-board");
    expect(state.patternBinding?.workers.analyst?.promptRef).toBe(
      "./reference/analyst.md",
    );
    expect(state.patternBinding?.initialTasks).toEqual([
      { id: "a", goal: "investigate $ARGUMENTS", assignee: "analyst" },
    ]);
  });

  it("parses inline `prompt: |` literal block scalars", () => {
    const text = withPattern(
      [
        `pattern: supervisor`,
        `workers:`,
        `  synth:`,
        `    prompt: |`,
        `      You write the report.`,
        `      Use prior findings.`,
        `    visibility: primary`,
        `initial-tasks:`,
        `  - id: s`,
        `    goal: finalize`,
        `    assignee: synth`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.patternBinding?.workers.synth?.prompt).toMatch(
      /You write the report\.\nUse prior findings\./,
    );
    expect(state.patternBinding?.workers.synth?.itemVisibility).toEqual({ client: true, history: true });
  });

  it("parses pattern-config and collection scope", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `collection:`,
        `  scope: session`,
        `workers:`,
        `  w:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: w`,
        `pattern-config:`,
        `  concurrency: 2`,
        `  on-idle: complete`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.patternBinding?.collection?.scope).toBe("session");
    expect(state.patternBinding?.patternConfig).toEqual({
      concurrency: 2,
      "on-idle": "complete",
    });
  });

  it("parses agent-ref + agent-overrides without resolving them", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  vet:`,
        `    agent-ref: research-analyst`,
        `    agent-overrides:`,
        `      tools: [search, fetch]`,
        `      model: anthropic/claude-haiku`,
        `initial-tasks:`,
        `  - id: r`,
        `    goal: research`,
        `    assignee: vet`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.patternBinding?.workers.vet?.agentRef).toBe(
      "research-analyst",
    );
    expect(state.patternBinding?.workers.vet?.agentOverrides).toEqual({
      tools: ["search", "fetch"],
      model: "anthropic/claude-haiku",
    });
  });

  it("rejects a worker with zero of prompt/prompt-ref/block-ref/agent-ref", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  bare:`,
        `    tools: [search]`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: bare`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(
      /exactly one of `prompt`, `prompt-ref`, `block-ref`, `agent-ref`/,
    );
  });

  it("rejects a worker with two of the four resolution fields", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  bad:`,
        `    prompt: hi`,
        `    prompt-ref: ./x.md`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: bad`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/mutually exclusive/);
  });

  it("rejects a worker with three of the four resolution fields", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  bad:`,
        `    prompt: hi`,
        `    prompt-ref: ./x.md`,
        `    block-ref: someBlock`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: bad`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/mutually exclusive/);
  });

  it("rejects agent-overrides without agent-ref", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  w:`,
        `    prompt: hi`,
        `    agent-overrides:`,
        `      tools: [x]`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: w`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/agent-overrides[`]? requires/);
  });

  it("rejects initial-task assignee referencing an unknown worker", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  a:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: ghost`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/unknown worker "ghost"/);
  });

  it("rejects a deps reference to an unknown task id", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  a:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: a`,
        `    deps: [nope]`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/unknown task id "nope"/);
  });

  it("rejects a cyclic dependency graph", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  a:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: x`,
        `    goal: x`,
        `    assignee: a`,
        `    deps: [y]`,
        `  - id: y`,
        `    goal: y`,
        `    assignee: a`,
        `    deps: [x]`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/cycle/);
  });

  it("rejects combining context: fork with pattern:", () => {
    const text = withPattern(
      [
        `context: fork`,
        `pattern: task-board`,
        `workers:`,
        `  a:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: a`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/mutually exclusive/);
  });

  it("rejects context: pattern without a pattern: field", () => {
    const text = `---\n${baseHeader}\ncontext: pattern\n---\n\nbody`;
    expect(() => parseSkillMd(text)).toThrow(/no `pattern:` field/);
  });

  it("rejects an invalid worker key", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  "Bad Key":`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: t`,
        `    goal: do`,
        `    assignee: "Bad Key"`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/worker key/);
  });

  it("auto-assigns ids when initial-tasks omit them", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  a:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - goal: first`,
        `    assignee: a`,
        `  - goal: second`,
        `    assignee: a`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    const ids = state.patternBinding?.initialTasks.map((t) => t.id);
    expect(ids).toEqual(["task-1", "task-2"]);
  });

  it("rejects duplicate initial-task ids", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `workers:`,
        `  a:`,
        `    prompt: hi`,
        `initial-tasks:`,
        `  - id: same`,
        `    goal: a`,
        `    assignee: a`,
        `  - id: same`,
        `    goal: b`,
        `    assignee: a`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/duplicate id "same"/);
  });

  it("warns when pattern-only keys appear without pattern:", () => {
    const text = `---\n${baseHeader}\nworkers:\n  a:\n    prompt: hi\n---\n\nbody`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.patternBinding).toBeUndefined();
    expect(warnings.some((w) => w.includes("workers"))).toBe(true);
  });
});

describe("serializeSkillMd — pattern binding round-trip", () => {
  it("round-trips prompt-ref, agent-ref, and pattern-config", () => {
    const text = withPattern(
      [
        `pattern: task-board`,
        `collection:`,
        `  scope: session`,
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
        `initial-tasks:`,
        `  - id: m`,
        `    goal: study market`,
        `    assignee: market`,
        `  - id: v`,
        `    goal: deep dive`,
        `    assignee: vet`,
        `    deps: [m]`,
        `pattern-config:`,
        `  concurrency: 2`,
        `  on-idle: complete`,
      ].join("\n"),
    );
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.patternBinding).toEqual(parsed.state.patternBinding);
    expect(reparsed.state.contextMode).toBe("pattern");
  });

  it("round-trips an inline `prompt: |` body", () => {
    const text = withPattern(
      [
        `pattern: supervisor`,
        `workers:`,
        `  synth:`,
        `    prompt: |`,
        `      First line.`,
        `      Second line.`,
        `    visibility: primary`,
        `initial-tasks:`,
        `  - id: s`,
        `    goal: synthesize`,
        `    assignee: synth`,
      ].join("\n"),
    );
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.patternBinding?.workers.synth?.prompt).toBe(
      parsed.state.patternBinding?.workers.synth?.prompt,
    );
  });
});
