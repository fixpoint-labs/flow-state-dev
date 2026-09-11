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
    expect(state._preservedFields!.myCustomField).toBe("hello");
    // Spec fields are typed, not preserved-as-unknown.
    expect(state._preservedFields!.license).toBeUndefined();
    expect(state.license).toBe("MIT");
  });

  it("accepts the spec's space-separated allowed-tools form", () => {
    const text = `---\ndescription: x\nallowed-tools: Bash(git:*) Bash(jq:*) Read\n---\n\nbody`;
    const { state } = parseSkillMd(text);
    expect(state.allowedTools).toEqual(["Bash(git:*)", "Bash(jq:*)", "Read"]);
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

// ---------------------------------------------------------------------------
// Agent Skills spec fields — https://agentskills.io/specification
// ---------------------------------------------------------------------------

describe("parseSkillMd — Agent Skills spec fields", () => {
  it("parses the spec's minimal example (name + description)", () => {
    const text = `---\nname: skill-name\ndescription: A description of what this skill does and when to use it.\n---\n`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.name).toBe("skill-name");
    expect(warnings).toEqual([]);
  });

  it("parses the spec's optional fields as typed state", () => {
    const text = [
      "---",
      "name: pdf-processing",
      "description: Extract PDF text, fill forms, merge files. Use when handling PDFs.",
      "license: Apache-2.0",
      "compatibility: Requires Python 3.14+ and uv",
      "metadata:",
      "  author: example-org",
      '  version: "1.0"',
      "---",
      "",
      "body",
    ].join("\n");
    const { state, warnings } = parseSkillMd(text);
    expect(state.license).toBe("Apache-2.0");
    expect(state.compatibility).toBe("Requires Python 3.14+ and uv");
    expect(state.metadata).toEqual({ author: "example-org", version: "1.0" });
    expect(state._preservedFields).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("validates a declared name against the folder it lives in", () => {
    const text = `---\nname: pdf-processing\ndescription: x\n---\n\nbody`;
    expect(() => parseSkillMd(text, { expectedName: "pdf-processing" })).not.toThrow();
    expect(() => parseSkillMd(text, { expectedName: "other-folder" })).toThrow(
      /must match its folder "other-folder"/,
    );
    // Without a folder to compare against, the name only has to be valid.
    expect(() => parseSkillMd(text)).not.toThrow();
  });

  it("rejects a declared name that breaks the naming rules", () => {
    expect(() => parseSkillMd(`---\nname: PDF-Processing\ndescription: x\n---\n`)).toThrow(/lowercase/);
    expect(() => parseSkillMd(`---\nname: pdf--processing\ndescription: x\n---\n`)).toThrow(/hyphen/);
    expect(() => parseSkillMd(`---\nname: 42\ndescription: x\n---\n`)).toThrow(/must be a string/);
  });

  it("rejects compatibility over 500 chars", () => {
    const text = `---\ndescription: x\ncompatibility: ${"c".repeat(501)}\n---\n`;
    expect(() => parseSkillMd(text)).toThrow(/compatibility exceeds 500/);
    const ok = `---\ndescription: x\ncompatibility: ${"c".repeat(500)}\n---\n`;
    expect(parseSkillMd(ok).state.compatibility).toHaveLength(500);
  });

  it("stringifies scalar metadata values and drops nested ones with a warning", () => {
    const text = [
      "---",
      "description: x",
      "metadata:",
      "  version: 2",
      "  beta: true",
      "  nested:",
      "    deep: value",
      "---",
      "",
    ].join("\n");
    const { state, warnings } = parseSkillMd(text);
    expect(state.metadata).toEqual({ version: "2", beta: "true" });
    expect(warnings.some((w) => w.includes("metadata.nested"))).toBe(true);
  });

  it("accepts the flow-style inline metadata mapping", () => {
    const text = `---\ndescription: x\nmetadata: { author: example-org, version: "1.0", beta: true }\n---\n`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.metadata).toEqual({ author: "example-org", version: "1.0", beta: "true" });
    expect(warnings).toEqual([]);
  });

  it("leaves metadata undefined when every value is invalid", () => {
    const text = `---\ndescription: x\nmetadata:\n  nested:\n    deep: value\n---\n`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.metadata).toBeUndefined();
    expect(warnings.some((w) => w.includes("metadata.nested"))).toBe(true);
  });

  it("warns and ignores mistyped license / compatibility / metadata", () => {
    const text = `---\ndescription: x\nlicense: [MIT]\ncompatibility: 3\nmetadata: just-a-string\n---\n`;
    const { state, warnings } = parseSkillMd(text);
    expect(state.license).toBeUndefined();
    expect(state.compatibility).toBeUndefined();
    expect(state.metadata).toBeUndefined();
    expect(warnings.filter((w) => /license|compatibility|metadata/.test(w))).toHaveLength(3);
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
    const text = `---\ndescription: x\nmy-custom-field: hello\n---\n\nbody`;
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state._preservedFields?.myCustomField).toBe("hello");
  });

  it("round-trips the Agent Skills spec fields, writing allowed-tools in the spec form", () => {
    const text = [
      "---",
      "name: pdf-processing",
      "description: x",
      "license: Apache-2.0",
      "compatibility: Requires git and jq",
      "metadata:",
      "  author: example-org",
      '  version: "1.0"',
      "allowed-tools: [search, fetch]",
      "---",
      "",
      "body",
    ].join("\n");
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    expect(out.startsWith("---\nname: pdf-processing\ndescription: x\n")).toBe(true);
    expect(out).toContain("allowed-tools: search fetch");
    const reparsed = parseSkillMd(out, { expectedName: "pdf-processing" });
    expect(reparsed.state.name).toBe("pdf-processing");
    expect(reparsed.state.license).toBe("Apache-2.0");
    expect(reparsed.state.compatibility).toBe("Requires git and jq");
    expect(reparsed.state.metadata).toEqual({ author: "example-org", version: "1.0" });
    expect(reparsed.state.allowedTools).toEqual(["search", "fetch"]);
  });

  it("round-trips the keywords field", () => {
    const text = `---\ndescription: x\nkeywords: [tag1, tag2]\n---\n\nbody`;
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.keywords).toEqual(["tag1", "tag2"]);
  });
});

describe("serializeSkillMd — YAML safety", () => {
  it("keeps the list form for an allowed-tools entry that contains a delimiter", () => {
    const out = serializeSkillMd({ description: "x", allowedTools: ["my tool", "Read"] }, "body");
    expect(out).toContain("allowed-tools: [my tool, Read]");
    expect(parseSkillMd(out).state.allowedTools).toEqual(["my tool", "Read"]);
  });

  it("quotes scalars a strict YAML parser would read as structure", () => {
    const out = serializeSkillMd(
      { description: "Use when: the user asks", compatibility: "Requires: git # and jq" },
      "body",
    );
    expect(out).toContain('description: "Use when: the user asks"');
    expect(out).toContain('compatibility: "Requires: git # and jq"');
    const { state } = parseSkillMd(out);
    expect(state.description).toBe("Use when: the user asks");
    expect(state.compatibility).toBe("Requires: git # and jq");
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
  it("rejects leading, trailing, and consecutive hyphens (Agent Skills rule)", () => {
    expect(() => validateSkillName("-pdf")).toThrow();
    expect(() => validateSkillName("pdf-")).toThrow();
    expect(() => validateSkillName("pdf--processing")).toThrow();
    expect(() => validateSkillName("pdf-processing")).not.toThrow();
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
// Delegation agents parsing — FIX-918
// ---------------------------------------------------------------------------

const baseHeader = `description: company research`;

function withFrontmatter(extra: string): string {
  return `---\n${baseHeader}\n${extra}\n---\n\nbody`;
}

describe("parseSkillMd — delegation agents", () => {
  it("parses a standalone `agents:` map into state.agents", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  analyst:`,
        `    prompt-ref: ./reference/analyst.md`,
        `  writer:`,
        `    prompt: Write the final report.`,
      ].join("\n"),
    );
    const { state, warnings } = parseSkillMd(text);
    expect(state.agents?.analyst?.promptRef).toBe("./reference/analyst.md");
    expect(state.agents?.writer?.prompt).toBe("Write the final report.");
    // Declaring `agents:` is sufficient — no `pattern:` required, no warning.
    expect(warnings.some((w) => w.includes("agents"))).toBe(false);
  });

  it("parses inline `prompt: |` literal block scalars and visibility", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  synth:`,
        `    prompt: |`,
        `      You write the report.`,
        `      Use prior findings.`,
        `    visibility: primary`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.agents?.synth?.prompt).toMatch(
      /You write the report\.\nUse prior findings\./,
    );
    expect(state.agents?.synth?.itemVisibility).toEqual({
      client: true,
      history: true,
    });
  });

  it("parses agent-ref + agent-overrides without resolving them", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  vet:`,
        `    agent-ref: research-analyst`,
        `    agent-overrides:`,
        `      tools: [search, fetch]`,
        `      model: anthropic/claude-haiku`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.agents?.vet?.agentRef).toBe("research-analyst");
    expect(state.agents?.vet?.agentOverrides).toEqual({
      tools: ["search", "fetch"],
      model: "anthropic/claude-haiku",
    });
  });

  it("rejects an agent with zero of prompt/prompt-ref/agent-ref", () => {
    const text = withFrontmatter(
      [`agents:`, `  bare:`, `    tools: [search]`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(
      /exactly one of `prompt`, `prompt-ref`, `agent-ref`/,
    );
  });

  it("rejects an agent with two resolution fields", () => {
    const text = withFrontmatter(
      [`agents:`, `  bad:`, `    prompt: hi`, `    prompt-ref: ./x.md`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/mutually exclusive/);
  });

  it("rejects a non-string resolution field (present but not a usable string)", () => {
    // `prompt: 123` satisfies the exactly-one check but leaves no usable string,
    // so it must fail at parse time, not confusingly at materialization.
    const numeric = withFrontmatter([`agents:`, `  bad:`, `    prompt: 123`].join("\n"));
    expect(() => parseSkillMd(numeric)).toThrow(/`prompt` must be a non-empty string/);

    const boolRef = withFrontmatter(
      [`agents:`, `  bad:`, `    agent-ref: false`].join("\n"),
    );
    expect(() => parseSkillMd(boolRef)).toThrow(/`agent-ref` must be a non-empty string/);
  });

  it("rejects inline tuning fields (tools/model/visibility) on an agent-ref spec", () => {
    // These apply only to inline agents; on agent-ref the materializer uses
    // agent-overrides and would silently ignore them. Fail loud instead.
    const text = withFrontmatter(
      [`agents:`, `  a:`, `    agent-ref: shared`, `    tools: [search]`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/can't be set alongside `agent-ref`/);
  });

  it("rejects tools/model/visibility/context-supply beside prompt-ref (file is source of truth)", () => {
    // Dual-write: the prompt file owns generator config. A leftover skill-entry
    // field would either silently lose or silently win — reject and point at
    // the file's frontmatter, same spirit as agent-ref + inline tuning.
    const tools = withFrontmatter(
      [`agents:`, `  analyzer:`, `    prompt-ref: ./reference/analyze.md`, `    tools: [search]`].join("\n"),
    );
    expect(() => parseSkillMd(tools)).toThrow(
      /can't be set alongside `prompt-ref`[\s\S]*frontmatter of `\.\.\/reference\/analyze\.md`|prompt file[\s\S]*frontmatter/,
    );
    expect(() => parseSkillMd(tools)).toThrow(/`tools`/);

    const model = withFrontmatter(
      [`agents:`, `  a:`, `    prompt-ref: ./x.md`, `    model: openai/gpt-5.4-mini`].join("\n"),
    );
    expect(() => parseSkillMd(model)).toThrow(/`model`/);

    const visibility = withFrontmatter(
      [`agents:`, `  a:`, `    prompt-ref: ./x.md`, `    visibility: sub`].join("\n"),
    );
    expect(() => parseSkillMd(visibility)).toThrow(/`visibility`/);

    const supply = withFrontmatter(
      [`agents:`, `  a:`, `    prompt-ref: ./x.md`, `    context-supply: conversation`].join("\n"),
    );
    expect(() => parseSkillMd(supply)).toThrow(/`context-supply`/);
  });

  it("still accepts tools/model/visibility on an inline prompt entry", () => {
    // The tiny case: a one-line persona that never earned its own file may
    // keep generator config on the skill entry. prompt-ref is what forbids it.
    const text = withFrontmatter(
      [
        `agents:`,
        `  writer:`,
        `    prompt: You write the report.`,
        `    tools: [search]`,
        `    model: openai/gpt-5.4-mini`,
        `    visibility: sub`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.agents?.writer).toEqual({
      prompt: "You write the report.",
      tools: ["search"],
      model: "openai/gpt-5.4-mini",
      itemVisibility: { client: true, history: false },
    });
  });

  it("rejects agent-overrides without agent-ref", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  w:`,
        `    prompt: hi`,
        `    agent-overrides:`,
        `      tools: [x]`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/agent-overrides[`]? requires/);
  });

  it("rejects an invalid agent key", () => {
    const text = withFrontmatter(
      [`agents:`, `  "Bad Key":`, `    prompt: hi`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/agent key/);
  });

  // FIX-925: assignee keys and catalog keys are one namespace, and a tool
  // catalog is app code whose keys are camelCase by convention (`httpGet`).
  // A lowercase-only pattern would filter exactly those out of the board's
  // worker registry, so uppercase is legal here too.
  it("accepts a camelCase agent key", () => {
    const text = withFrontmatter([`agents:`, `  httpGet:`, `    prompt: hi`].join("\n"));
    expect(parseSkillMd(text).state.agents?.httpGet?.prompt).toBe("hi");
  });

  // The leading-alphanumeric anchor is what widening must not cost: it is the
  // only thing keeping the board's reserved routes unclaimable.
  it.each(["__proto__", "__floor__", "__no_assignee__", "-lead", "_lead"])(
    "still rejects the reserved-shape agent key %j",
    (key) => {
      const text = withFrontmatter([`agents:`, `  "${key}":`, `    prompt: hi`].join("\n"));
      expect(() => parseSkillMd(text)).toThrow(/agent key/);
    },
  );

  // FIX-920 — context-supply sub-key
  it("parses `context-supply: conversation` into contextSupply", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  summarizer:`,
        `    prompt: Summarize the discussion.`,
        `    context-supply: conversation`,
      ].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.agents?.summarizer?.contextSupply).toBe("conversation");
  });

  it("leaves contextSupply undefined when context-supply is absent", () => {
    const text = withFrontmatter(
      [`agents:`, `  a:`, `    prompt: hi`].join("\n"),
    );
    const { state } = parseSkillMd(text);
    expect(state.agents?.a?.contextSupply).toBeUndefined();
  });

  it("rejects an unknown context-supply value fail-loud", () => {
    const text = withFrontmatter(
      [`agents:`, `  a:`, `    prompt: hi`, `    context-supply: everything`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/context-supply/);
  });

  it("rejects context-supply on an agent-ref agent", () => {
    // agent-ref agents own their own context (workforce materializer); the
    // orchestration history slot can't reach them, so fail loud not no-op.
    const text = withFrontmatter(
      [
        `agents:`,
        `  vet:`,
        `    agent-ref: shared`,
        `    context-supply: conversation`,
      ].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(/context-supply/);
  });
});

describe("parseSkillMd — removed pattern/fork/workers/block-ref frontmatter (FIX-918)", () => {
  it("throws a migration error on `context: fork`", () => {
    const text = `---\n${baseHeader}\ncontext: fork\n---\n\nbody`;
    expect(() => parseSkillMd(text)).toThrow(/context: fork.*removed/);
  });

  it("throws a migration error on `pattern:`", () => {
    const text = withFrontmatter([`pattern: task-board`].join("\n"));
    expect(() => parseSkillMd(text)).toThrow(/pattern.*removed/);
  });

  it("throws a migration error pointing at `agents:` on legacy `workers:`", () => {
    const text = withFrontmatter(
      [`workers:`, `  analyst:`, `    prompt: hi`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(
      /`workers:` was renamed to `agents:`/,
    );
  });

  it("throws a migration error pointing at `agent-ref` on a `block-ref:` agent field", () => {
    const text = withFrontmatter(
      [`agents:`, `  analyst:`, `    block-ref: analyst`].join("\n"),
    );
    expect(() => parseSkillMd(text)).toThrow(
      /`block-ref` was removed.*agent-ref/s,
    );
  });
});

describe("serializeSkillMd — delegation agents round-trip", () => {
  it("round-trips a prompt-ref + agent-ref agent map", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  market:`,
        `    prompt-ref: ./reference/market.md`,
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
    expect(reparsed.state.agents).toEqual(parsed.state.agents);
  });

  it("round-trips an inline `prompt: |` body", () => {
    const text = withFrontmatter(
      [
        `agents:`,
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
    expect(reparsed.state.agents?.synth?.prompt).toBe(
      parsed.state.agents?.synth?.prompt,
    );
  });

  // FIX-920 — context-supply must survive a serialize → parse round-trip.
  // Stays on the inline `prompt:` entry (the tiny case). Beside `prompt-ref`
  // the field is rejected — the prompt file owns it.
  it("round-trips `context-supply: conversation` on an inline prompt", () => {
    const text = withFrontmatter(
      [
        `agents:`,
        `  summarizer:`,
        `    prompt: Summarize the discussion.`,
        `    context-supply: conversation`,
      ].join("\n"),
    );
    const parsed = parseSkillMd(text);
    const out = serializeSkillMd(parsed.state, parsed.body);
    const reparsed = parseSkillMd(out);
    expect(reparsed.state.agents?.summarizer?.contextSupply).toBe("conversation");
    expect(reparsed.state.agents?.summarizer?.contextSupply).toEqual(
      parsed.state.agents?.summarizer?.contextSupply,
    );
  });
});
