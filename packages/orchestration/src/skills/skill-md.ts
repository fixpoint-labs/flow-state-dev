/**
 * SKILL.md parser/serializer and runtime substitution helpers.
 *
 * The SKILL.md format is YAML frontmatter (kebab-case) followed by Markdown
 * body. Frontmatter is converted to camelCase for TypeScript ergonomics; the
 * inverse mapping is preserved so we can round-trip back to disk without
 * losing fields. Unknown frontmatter keys are preserved on
 * `state._preservedFields` so user data survives a parse/serialize cycle.
 *
 * Substitution is intentionally separated from parsing — the body is stored
 * verbatim, and `$ARGUMENTS` / `${SKILL_DIR}` are resolved per-invocation
 * inside `substitute()`.
 */

import type {
  AgentOverrides,
  AgentSpec,
  ItemVisibility,
  Skill,
  SkillState,
} from "@flow-state-dev/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed `description` length, mirroring Claude's contract. */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Maximum allowed skill name length. */
export const MAX_NAME_LENGTH = 64;

/** Names disallowed as skill names (reserved by the framework). */
const RESERVED_NAMES = new Set(["_meta", ""]);

/** Pattern a valid skill name must match. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Frontmatter keys the framework knows about. All other keys are preserved
 * on `_preservedFields`. Keys are kebab-case as they appear on disk.
 */
const KNOWN_KEYS = new Set([
  "description",
  "allowed-tools",
  "context",
  "disable-model-invocation",
  "when_to_use",
  "argument-hint",
  "keywords",
  // Delegation agents (FIX-918)
  "agents",
  // Claude-Code-only fields we explicitly capture/warn about
  "user-invocable",
  "paths",
  "hooks",
  "shell",
  "model",
  "effort",
  // Open-standard fields preserved as metadata
  "name",
  "license",
  "compatibility",
  "metadata",
]);

/** Agent-spec sub-keys recognized at parse time. */
const AGENT_KNOWN_KEYS = new Set([
  "prompt",
  "prompt-ref",
  "agent-ref",
  "tool",
  "agent-overrides",
  "tools",
  "visibility",
  "model",
  "context-supply",
]);

/** Sub-keys of `agent-overrides`. */
const AGENT_OVERRIDES_KEYS = new Set(["tools", "model", "visibility"]);

/**
 * Mutually-exclusive participant resolution fields. Exactly one must be set.
 * `tool` (FIX-925) joins the three agent kinds as a fourth resolution kind on
 * the same map — one assignee namespace, not a second registry.
 */
const AGENT_RESOLUTION_FIELDS = ["prompt", "prompt-ref", "agent-ref", "tool"] as const;

/**
 * Fields that only mean something for a prompt-driven agent — every one of them
 * tunes a model turn a `tool:` participant does not take. Rejected on a tool
 * spec rather than ignored, mirroring the `agent-ref`-tuning rejection below.
 */
const AGENT_ONLY_TUNING_KEYS = [
  "agent-overrides",
  "tools",
  "visibility",
  "model",
  "context-supply",
] as const;

/**
 * Claude-Code fields we silently ignore at runtime but warn about so users
 * understand what carried over from an imported skill.
 */
const WARN_IGNORED_KEYS = new Set([
  "paths",
  "hooks",
  "shell",
  "model",
  "effort",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of parsing a SKILL.md text. */
export interface ParsedSkillMd {
  /** Parsed state — the camelCase frontmatter representation. */
  state: SkillState;
  /** Raw Markdown body (no frontmatter). */
  body: string;
  /** Warnings the parser surfaced (ignored fields, soft validations). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a skill name. Throws on invalid input. */
export function validateSkillName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Skill name must be a non-empty string");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Skill name "${name}" exceeds ${MAX_NAME_LENGTH} chars`);
  }
  if (RESERVED_NAMES.has(name)) {
    throw new Error(`Skill name "${name}" is reserved`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Skill name "${name}" must match /^[a-z0-9][a-z0-9-]*$/`,
    );
  }
}

// ---------------------------------------------------------------------------
// Delegation agents parser (FIX-918)
// ---------------------------------------------------------------------------

/** Pattern an agent key must match. Kebab/snake-case, ASCII alphanumeric. */
const AGENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * True when `key` is a legal agent key. The leading-`[a-z0-9]` requirement is
 * load-bearing beyond tidiness: the delegation board reserves underscore-led
 * names for routes an author must never be able to claim — the floor's worker
 * key (`__floor__`) and the absent-assignee sentinel (`__no_assignee__`,
 * `task-board/blocks/worker-step.ts`). It also keeps prototype-poisoning names
 * (`__proto__`, `toString`, `valueOf`) out of the plain-object worker registry.
 *
 * Exported because this parser is NOT the only way an agent map reaches the
 * board: `delegation-surface.ts` also reads `agents` off a live skill manifest,
 * whose state schema is `.passthrough()` and does not describe `agents` at all,
 * so a manifest written out-of-band (an app block holding the collection ref, a
 * store-level write, a migration) never passes through here. That reader
 * re-checks with this predicate in `validateAgentKeys`, which filters the roster
 * once so the board's worker registry and the coordinator's guidance are built
 * from the same list. Relax the pattern and both call sites — and the two
 * reserved names above — must be revisited together.
 */
export function isValidAgentKey(key: string): boolean {
  return AGENT_KEY_PATTERN.test(key);
}

/**
 * Parse the `agents:` frontmatter field into a typed participant map. Declaring
 * `agents:` is what turns on the delegation surface in `createSkillsLibrary`:
 * the skill assigns work as tasks and drains its board; the board runs the
 * participants. Each entry is one of three shapes — an inline agent
 * (`prompt`/`prompt-ref`), a registry agent (`agent-ref`), or a deterministic
 * tool (`tool`, FIX-925). The keys form ONE assignee namespace.
 */
function parseAgentsField(v: unknown): Record<string, AgentSpec> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error("SKILL.md `agents:` must be a mapping of agent key → spec");
  }
  const out: Record<string, AgentSpec> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!isValidAgentKey(key)) {
      throw new Error(
        `SKILL.md agent key "${key}" must match /^[a-z0-9][a-z0-9_-]*$/`,
      );
    }
    out[key] = parseAgentSpec(key, value);
  }
  if (Object.keys(out).length === 0) {
    throw new Error("SKILL.md `agents:` must contain at least one entry");
  }
  return out;
}

function parseAgentSpec(key: string, v: unknown): AgentSpec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`SKILL.md agent \`${key}\` must be a mapping`);
  }
  const obj = v as Record<string, unknown>;

  // `block-ref` was removed in FIX-918 (mirrors the pattern/fork migration
  // throw). An arbitrary app block is a *tool*, not an agent — fail loud rather
  // than silently dropping the field, so an author migrating a PR #854 skill
  // is pointed at the replacement. FIX-918 deferred the direct replacement to
  // FIX-925; now that `tool:` exists, it is the migration target for a
  // deterministic block, so name it first.
  if ("block-ref" in obj) {
    throw new Error(
      `SKILL.md agent \`${key}\`: \`block-ref\` was removed (FIX-918). An arbitrary app ` +
        `block is a tool, not an agent — put it on the board with \`tool\` (a catalog ` +
        `key, run deterministically with no model turn), or, for a prompt-driven ` +
        `participant, use \`agent-ref\` (registry) or \`prompt\`/\`prompt-ref\` (inline).`,
    );
  }

  for (const k of Object.keys(obj)) {
    if (!AGENT_KNOWN_KEYS.has(k)) {
      throw new Error(
        `SKILL.md agent \`${key}\`: unknown field \`${k}\` (allowed: ${[...AGENT_KNOWN_KEYS].join(", ")})`,
      );
    }
  }

  const setResolution = AGENT_RESOLUTION_FIELDS.filter((f) => f in obj && obj[f] !== null && obj[f] !== undefined);
  if (setResolution.length === 0) {
    throw new Error(
      `SKILL.md agent \`${key}\`: exactly one of ` +
        `${AGENT_RESOLUTION_FIELDS.map((f) => `\`${f}\``).join(", ")} required`,
    );
  }
  if (setResolution.length > 1) {
    throw new Error(
      `SKILL.md agent \`${key}\`: fields ${setResolution.map((f) => `\`${f}\``).join(", ")} are mutually exclusive — set exactly one`,
    );
  }
  // The exactly-one check above only proves the field is *present* and non-null.
  // A non-string value (e.g. `prompt: 123`, `agent-ref: false`) would pass it but
  // leave the AgentSpec with no usable resolution below, failing confusingly at
  // materialization instead of here. Reject it at parse time with a clear error.
  const resolutionField = setResolution[0]!;
  const resolutionValue = obj[resolutionField];
  if (typeof resolutionValue !== "string" || resolutionValue.trim() === "") {
    throw new Error(
      `SKILL.md agent \`${key}\`: \`${resolutionField}\` must be a non-empty string`,
    );
  }

  // FIX-925: a `tool:` participant is deterministic — it is invoked directly
  // with the task's input and takes no model turn, so every agent tuning field
  // is inapplicable rather than merely unused. Reject them here, BEFORE the
  // `agent-overrides`/`agent-ref` checks below, so a tool spec gets the pointed
  // "tools don't take a model turn" error instead of a generic one.
  if ("tool" in obj) {
    const inapplicable = AGENT_ONLY_TUNING_KEYS.filter((k) => k in obj);
    if (inapplicable.length > 0) {
      throw new Error(
        `SKILL.md agent \`${key}\`: ${inapplicable.map((k) => `\`${k}\``).join(", ")} ` +
          `can't be set alongside \`tool\` — a tool participant is invoked directly with ` +
          `the task's input and takes no model turn, so there is nothing to tune. Use a ` +
          `\`prompt\`/\`prompt-ref\`/\`agent-ref\` agent if the node needs one.`,
      );
    }
  }

  if ("agent-overrides" in obj && !("agent-ref" in obj)) {
    throw new Error(
      `SKILL.md agent \`${key}\`: \`agent-overrides\` requires \`agent-ref\``,
    );
  }

  // Inline tuning fields (`tools`/`model`/`visibility`) apply only to inline
  // agents. On an `agent-ref` spec the materializer resolves the registered
  // agent and applies `agent-overrides` — these top-level fields are silently
  // ignored, so the agent would run with its default surface instead of the
  // skill-authored one. Reject them and point at `agent-overrides`.
  if ("agent-ref" in obj) {
    const inlineTuning = ["tools", "model", "visibility"].filter((k) => k in obj);
    if (inlineTuning.length > 0) {
      throw new Error(
        `SKILL.md agent \`${key}\`: ${inlineTuning.map((k) => `\`${k}\``).join(", ")} ` +
          `can't be set alongside \`agent-ref\` — put them under \`agent-overrides\` instead.`,
      );
    }
  }

  const spec: AgentSpec = {};
  if (typeof obj["prompt"] === "string") spec.prompt = obj["prompt"];
  if (typeof obj["prompt-ref"] === "string") spec.promptRef = obj["prompt-ref"];
  if (typeof obj["agent-ref"] === "string") spec.agentRef = obj["agent-ref"];
  if (typeof obj["tool"] === "string") spec.tool = obj["tool"];

  if ("agent-overrides" in obj) {
    spec.agentOverrides = parseAgentOverrides(key, obj["agent-overrides"]);
  }

  if ("tools" in obj) {
    const t = obj["tools"];
    if (!Array.isArray(t) || !t.every((x) => typeof x === "string")) {
      throw new Error(`SKILL.md agent \`${key}\`: \`tools\` must be a string list`);
    }
    spec.tools = t as string[];
  }

  if ("visibility" in obj) {
    spec.itemVisibility = parseVisibilityField(`agent \`${key}\``, obj["visibility"]);
  }

  if ("model" in obj) {
    const m = obj["model"];
    if (typeof m !== "string") {
      throw new Error(`SKILL.md agent \`${key}\`: \`model\` must be a string`);
    }
    spec.model = m;
  }

  // FIX-920: `context-supply` controls how much prior conversation an inline
  // agent inherits. It applies only to prompt/prompt-ref agents — an agent-ref
  // agent owns its own context, so setting it there is a fail-loud error rather
  // than a silent no-op (mirrors the inline-tuning-on-agent-ref rejection).
  if ("context-supply" in obj) {
    if ("agent-ref" in obj) {
      throw new Error(
        `SKILL.md agent \`${key}\`: \`context-supply\` applies to prompt/prompt-ref agents; ` +
          `agent-ref agents own their own context.`,
      );
    }
    const cs = obj["context-supply"];
    if (cs !== "conversation") {
      throw new Error(
        `SKILL.md agent \`${key}\`: \`context-supply\`'s only value is "conversation" ` +
          `— omit the field for the default (isolated) (got ${JSON.stringify(cs)})`,
      );
    }
    spec.contextSupply = cs;
  }

  return spec;
}

function parseAgentOverrides(agentKey: string, v: unknown): AgentOverrides {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`SKILL.md agent \`${agentKey}\`: \`agent-overrides\` must be a mapping`);
  }
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!AGENT_OVERRIDES_KEYS.has(k)) {
      throw new Error(
        `SKILL.md agent \`${agentKey}\`: unknown agent-overrides field \`${k}\` (allowed: ${[...AGENT_OVERRIDES_KEYS].join(", ")})`,
      );
    }
  }
  const out: AgentOverrides = {};
  if ("tools" in obj) {
    const t = obj["tools"];
    if (!Array.isArray(t) || !t.every((x) => typeof x === "string")) {
      throw new Error(`SKILL.md agent \`${agentKey}\`: \`agent-overrides.tools\` must be a string list`);
    }
    out.tools = t as string[];
  }
  if ("model" in obj) {
    const m = obj["model"];
    if (typeof m !== "string") {
      throw new Error(`SKILL.md agent \`${agentKey}\`: \`agent-overrides.model\` must be a string`);
    }
    out.model = m;
  }
  if ("visibility" in obj) {
    out.itemVisibility = parseVisibilityField(`agent \`${agentKey}\` agent-overrides`, obj["visibility"]);
  }
  return out;
}

/**
 * Parse a `visibility` YAML value into an `ItemVisibility` object.
 *
 * Accepts either:
 *   - A mapping with `client` and `history` boolean fields.
 *   - A legacy string shorthand: `"primary"` | `"sub"` | `"trace"`.
 */
function parseVisibilityField(location: string, v: unknown): ItemVisibility {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if (typeof obj["client"] !== "boolean" || typeof obj["history"] !== "boolean") {
      throw new Error(
        `SKILL.md ${location}: \`visibility\` mapping requires boolean \`client\` and \`history\` fields`,
      );
    }
    return { client: obj["client"] as boolean, history: obj["history"] as boolean };
  }
  if (typeof v === "string") {
    switch (v) {
      case "primary": return { client: true, history: true };
      case "sub": return { client: true, history: false };
      case "trace": return { client: false, history: false };
      default:
        throw new Error(
          `SKILL.md ${location}: \`visibility\` string must be "primary" | "sub" | "trace" — got ${JSON.stringify(v)}`,
        );
    }
  }
  throw new Error(
    `SKILL.md ${location}: \`visibility\` must be a mapping ({ client, history }) or a shorthand string`,
  );
}

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Tiny YAML-subset parser sufficient for SKILL.md frontmatter.
 *
 * Supports:
 *   - Scalar `key: value` pairs.
 *   - Inline arrays `[a, b, c]` and inline objects (preserved as strings).
 *   - Block arrays of scalars (`- a` per line).
 *   - Block arrays of mappings (`- key: value` followed by indented fields).
 *   - Block-scalar literals (`|` / `|-`) for multi-line strings.
 *   - Nested mappings to arbitrary depth via indentation.
 *
 * NOT a general-purpose YAML implementation — intentionally narrow to keep
 * this package dependency-free.
 */
function parseFrontmatterYaml(text: string): Record<string, unknown> {
  const rawLines = text.split(/\r?\n/);
  // Strip comments (full-line and trailing `#` outside strings) but preserve
  // intra-string content. Block scalars (`|`) are handled later and must
  // ignore comment stripping inside their bodies.
  const result = parseBlock(rawLines, 0, rawLines.length, 0) as Record<string, unknown>;
  return result;
}

/** Number of leading space characters on a line. Tabs count as one space. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === " " || line[n] === "\t")) n++;
  return n;
}

/**
 * Parse a contiguous YAML block delimited by `[start, end)` whose entries
 * all sit at indentation `>= baseIndent`. Returns a mapping (object) when
 * the block's first non-blank line is a `key:` pair, or an array when it's
 * a `- item` sequence.
 */
function parseBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  let i = start;
  while (i < end && (lines[i]!.trim() === "" || lines[i]!.trim().startsWith("#"))) i++;
  if (i >= end) return {};
  const first = lines[i]!;
  const trimmed = first.trim();
  if (trimmed.startsWith("- ") || trimmed === "-") {
    return parseSequenceBlock(lines, start, end, baseIndent);
  }
  return parseMappingBlock(lines, start, end, baseIndent);
}

function parseMappingBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Lines at deeper indent without a preceding key are skipped to stay
      // resilient against partial inputs.
      i++;
      continue;
    }

    const colonIdx = findKeyColon(trimmed);
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const [value, next] = readBlockScalar(lines, i + 1, end, baseIndent, rest);
      result[key] = value;
      i = next;
      continue;
    }

    if (rest === "" || rest === "~" || rest.toLowerCase() === "null") {
      // Either a null scalar or a nested block.
      const childStart = i + 1;
      const childIndent = nextNonBlankIndent(lines, childStart, end);
      if (childIndent !== -1 && childIndent > baseIndent) {
        const nested = parseBlock(lines, childStart, end, childIndent);
        result[key] = nested;
        i = consumeBlock(lines, childStart, end, childIndent);
        continue;
      }
      result[key] = rest === "" ? null : null;
      i++;
      continue;
    }

    result[key] = parseScalar(rest);
    i++;
  }
  return result;
}

function parseSequenceBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): unknown[] {
  const out: unknown[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    }
    if (!(trimmed.startsWith("- ") || trimmed === "-")) break;

    // Item body — what follows the `- ` marker.
    const after = trimmed === "-" ? "" : trimmed.slice(2);
    // A sequence-of-mappings item looks like `- key: value` and may carry
    // further fields on subsequent lines indented deeper than this dash.
    const dashColumn = indent;
    const itemIndent = dashColumn + 2;

    if (after === "") {
      // Either empty item or a nested mapping/sequence on the next lines.
      const childStart = i + 1;
      const childIndent = nextNonBlankIndent(lines, childStart, end);
      if (childIndent !== -1 && childIndent > dashColumn) {
        out.push(parseBlock(lines, childStart, end, childIndent));
        i = consumeBlock(lines, childStart, end, childIndent);
        continue;
      }
      out.push(null);
      i++;
      continue;
    }

    const afterColon = findKeyColon(after);
    if (afterColon === -1) {
      // Plain scalar item.
      out.push(parseScalar(after));
      i++;
      continue;
    }

    // Mapping item: rebuild a virtual block whose first line is the `- ` part
    // re-indented to `itemIndent`, plus subsequent lines that are indented
    // deeper than the dash column.
    const firstLineRebuilt = " ".repeat(itemIndent) + after;
    const virtual: string[] = [firstLineRebuilt];
    let j = i + 1;
    while (j < end) {
      const nl = lines[j]!;
      const nt = nl.trim();
      if (nt === "" || nt.startsWith("#")) {
        virtual.push(nl);
        j++;
        continue;
      }
      const ni = indentOf(nl);
      if (ni <= dashColumn) break;
      virtual.push(nl);
      j++;
    }
    const itemMap = parseMappingBlock(virtual, 0, virtual.length, itemIndent);
    out.push(itemMap);
    i = j;
  }
  return out;
}

/** Locate the indent of the next non-blank line, or -1 if none. */
function nextNonBlankIndent(lines: string[], start: number, end: number): number {
  for (let k = start; k < end; k++) {
    const t = lines[k]!.trim();
    if (t === "" || t.startsWith("#")) continue;
    return indentOf(lines[k]!);
  }
  return -1;
}

/** Advance past every line at `>= blockIndent`. */
function consumeBlock(
  lines: string[],
  start: number,
  end: number,
  blockIndent: number,
): number {
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (indentOf(line) < blockIndent) break;
    i++;
  }
  return i;
}

/**
 * Read a `|` / `|-` / `>` / `>-` block scalar. Returns `[bodyText, nextIndex]`.
 * Folded (`>`) scalars collapse interior newlines to spaces; literal (`|`)
 * scalars preserve them. The trailing-newline indicator (`-`) strips the
 * final newline.
 */
function readBlockScalar(
  lines: string[],
  start: number,
  end: number,
  parentIndent: number,
  marker: string,
): [string, number] {
  const literal = marker.startsWith("|");
  const strip = marker.endsWith("-");
  const collected: string[] = [];
  let bodyIndent = -1;
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.trim() === "") {
      collected.push("");
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (bodyIndent === -1) bodyIndent = ind;
    collected.push(line.slice(Math.min(ind, bodyIndent)));
    i++;
  }
  // Trim trailing blank lines.
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }
  let body = literal
    ? collected.join("\n")
    : collected.reduce((acc, l, idx) => {
        if (idx === 0) return l;
        if (l === "") return acc + "\n";
        return acc.endsWith("\n") ? acc + l : acc + " " + l;
      }, "");
  if (!strip) body += "\n";
  return [body, i];
}

/**
 * Find the index of the `:` that ends a YAML mapping key. Skips colons
 * inside `[...]` / `{...}` / quotes so inline structures don't false-match.
 */
function findKeyColon(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) {
      // Must be followed by whitespace or end-of-line to count as the
      // mapping colon (avoids matching `http://...` etc).
      if (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\t") {
        return i;
      }
    }
  }
  return -1;
}

/** Parse a single scalar, inline array, or quoted string. */
function parseScalar(raw: string): unknown {
  const text = raw.trim();
  if (text.length === 0) return "";

  // Inline array: [a, b, c]
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitTopLevelCommas(inner).map((item) => parseScalar(item));
  }

  // Inline object: { a: 1, b: 2 } — coerce to a string for forward-compat
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  // Quoted string
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  // Booleans
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;

  // Numbers
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);

  // Bare string
  return text;
}

/** Split a string on commas not inside brackets/braces/quotes. */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";

  for (let k = 0; k < input.length; k++) {
    const c = input[k]!;
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      buf += c;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter extraction
// ---------------------------------------------------------------------------

/**
 * Split a SKILL.md text into a YAML frontmatter block and the remaining body.
 * Frontmatter is delimited by `---` lines at the start of the file.
 */
function splitFrontmatter(text: string): { yaml: string; body: string } {
  // Normalize leading whitespace but preserve trailing for body fidelity.
  if (!text.startsWith("---")) {
    return { yaml: "", body: text };
  }

  // Find the closing `---` on its own line.
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { yaml: "", body: text };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { yaml: "", body: text };
  }

  const yaml = lines.slice(1, endIdx).join("\n");
  // Drop the leading newline after the closing `---`.
  const body = lines.slice(endIdx + 1).join("\n").replace(/^\r?\n/, "");
  return { yaml, body };
}

// ---------------------------------------------------------------------------
// kebab-case ↔ camelCase
// ---------------------------------------------------------------------------

/** Convert a kebab-case key to camelCase. Underscores are preserved as-is. */
export function kebabToCamel(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Convert a camelCase key to kebab-case. */
export function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Public: parse
// ---------------------------------------------------------------------------

/**
 * Parse a SKILL.md text into structured state + raw body.
 *
 * Required field: `description`. Throws if missing or invalid.
 * Unknown frontmatter keys are preserved (camelCased) under `_preservedFields`.
 * Claude-Code-only keys we don't honor at runtime produce warnings.
 */
export function parseSkillMd(text: string): ParsedSkillMd {
  const { yaml, body } = splitFrontmatter(text);
  const warnings: string[] = [];

  if (yaml.trim().length === 0) {
    throw new Error(
      "SKILL.md must begin with YAML frontmatter (--- delimited) including a `description`",
    );
  }

  const raw = parseFrontmatterYaml(yaml);

  const description = raw["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error("SKILL.md frontmatter requires a non-empty `description`");
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `SKILL.md description exceeds ${MAX_DESCRIPTION_LENGTH} chars`,
    );
  }
  if (/<[a-zA-Z][^>]*>/.test(description)) {
    throw new Error("SKILL.md description must not contain XML tags");
  }

  const state: SkillState = { description };

  if ("allowed-tools" in raw) {
    const v = raw["allowed-tools"];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      state.allowedTools = v as string[];
    } else if (typeof v === "string") {
      // Accept comma-separated form for forward-compat with Claude variants
      state.allowedTools = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (v !== undefined && v !== null) {
      warnings.push("`allowed-tools` must be a list of strings — ignored");
    }
  }

  if ("context" in raw) {
    const v = raw["context"];
    if (v === "fork" || v === "pattern") {
      // FIX-918 removed both non-inline modes. Fail loud rather than silently
      // downgrade to inline (which would run a would-be sub-agent's work in the
      // parent's context — the opposite of what the author asked for).
      throw new Error(
        v === "fork"
          ? `SKILL.md \`context: fork\` was removed. For sub-agent isolation, declare \`agents:\` and let the skill delegate; history-inheriting sub-agents are planned separately.`
          : `SKILL.md \`context: pattern\` was removed. Declare \`agents:\` for delegation, or expose a task-board/goalSeekLoop block as an allowed tool.`,
      );
    }
    if (v === "inline") {
      state.contextMode = "inline";
    } else if (v !== undefined && v !== null) {
      warnings.push(
        `\`context\` must be "inline" — got ${JSON.stringify(v)}; defaulting to inline`,
      );
    }
  }

  if ("disable-model-invocation" in raw) {
    const v = raw["disable-model-invocation"];
    if (typeof v === "boolean") {
      state.disableModelInvocation = v;
    }
  }

  if ("when_to_use" in raw && typeof raw["when_to_use"] === "string") {
    state.whenToUse = raw["when_to_use"] as string;
  }

  if ("argument-hint" in raw && typeof raw["argument-hint"] === "string") {
    state.argumentHint = raw["argument-hint"] as string;
  }

  if ("keywords" in raw) {
    const v = raw["keywords"];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      // Normalize to lowercase here so the tier-2 scan can do plain
      // case-sensitive substring matches without per-call lowercasing.
      state.keywords = (v as string[]).map((s) => s.toLowerCase());
    } else if (typeof v === "string") {
      // Comma-separated form for forward-compat with hand-written frontmatter
      state.keywords = v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (v !== undefined && v !== null) {
      warnings.push("`keywords` must be a list of strings — ignored");
    }
  }

  // Legacy `pattern:` frontmatter — removed in FIX-918. Fail loud with a
  // migration pointer rather than silently reinterpreting the file as inline.
  if ("pattern" in raw && raw["pattern"] !== null && raw["pattern"] !== undefined) {
    throw new Error(
      `SKILL.md \`pattern:\` was removed (FIX-918). Declare delegation \`agents:\` (a skill with agents gets a task board; assign work as tasks and drain the board), or expose a task-board/goalSeekLoop block as an allowed tool for deterministic multi-step recipes.`,
    );
  }

  // Legacy `workers:` frontmatter — renamed to `agents:` in FIX-918. Fail loud
  // with a migration pointer rather than silently preserving the key (which
  // would leave the skill with no declared agents and no delegation surface).
  if ("workers" in raw && raw["workers"] !== null && raw["workers"] !== undefined) {
    throw new Error(
      `SKILL.md \`workers:\` was renamed to \`agents:\` (FIX-918). Rename the frontmatter key; each entry is an agent defined inline (\`prompt\`/\`prompt-ref\`) or referenced from the registry (\`agent-ref\`).`,
    );
  }

  // Delegation agents (FIX-918). Declaring `agents:` is what turns on the
  // delegation surface in createSkillsLibrary — a private task board the skill
  // assigns work to and drains.
  if ("agents" in raw && raw["agents"] !== null && raw["agents"] !== undefined) {
    state.agents = parseAgentsField(raw["agents"]);
  }

  // Warn about ignored Claude-Code fields.
  for (const key of WARN_IGNORED_KEYS) {
    if (key in raw) {
      warnings.push(`SKILL.md field \`${key}\` is preserved but not honored at runtime`);
    }
  }

  // Preserve unknown fields (and the ignored ones we still want round-tripped)
  // under camelCase keys. Required/known fields above are NOT preserved.
  const preservedKnownButNotMapped = new Set(["user-invocable", "name", "license", "compatibility", "metadata", ...WARN_IGNORED_KEYS]);
  const preserved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k) || preservedKnownButNotMapped.has(k)) {
      preserved[kebabToCamel(k)] = v;
    }
  }
  if (Object.keys(preserved).length > 0) {
    state._preservedFields = preserved;
  }

  return { state, body, warnings };
}

// ---------------------------------------------------------------------------
// Public: serialize
// ---------------------------------------------------------------------------

/**
 * Serialize a parsed state + body back to SKILL.md text. Inverse of
 * `parseSkillMd` for the fields we model; preserved fields round-trip via
 * `_preservedFields` (camelCase → kebab-case).
 */
export function serializeSkillMd(state: SkillState, body: string): string {
  const lines: string[] = ["---", `description: ${yamlScalar(state.description)}`];

  if (state.allowedTools && state.allowedTools.length > 0) {
    lines.push(`allowed-tools: [${state.allowedTools.map((t: string) => yamlScalar(t)).join(", ")}]`);
  }
  if (state.contextMode) {
    lines.push(`context: ${state.contextMode}`);
  }
  if (state.disableModelInvocation !== undefined) {
    lines.push(`disable-model-invocation: ${state.disableModelInvocation}`);
  }
  if (state.whenToUse !== undefined) {
    lines.push(`when_to_use: ${yamlScalar(state.whenToUse)}`);
  }
  if (state.argumentHint !== undefined) {
    lines.push(`argument-hint: ${yamlScalar(state.argumentHint)}`);
  }
  if (state.keywords && state.keywords.length > 0) {
    lines.push(`keywords: [${state.keywords.map((k: string) => yamlScalar(k)).join(", ")}]`);
  }

  if (state.agents) {
    serializeAgents(lines, state.agents);
  }

  if (state._preservedFields) {
    for (const [k, v] of Object.entries(state._preservedFields)) {
      lines.push(`${camelToKebab(k)}: ${yamlValue(v)}`);
    }
  }

  lines.push("---", "", body);
  // Avoid trailing newlines beyond a single one for stable round-trip.
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** Serialize a skill's `agents:` map (delegation, FIX-918). */
function serializeAgents(
  lines: string[],
  agents: Record<string, AgentSpec>,
): void {
  lines.push("agents:");
  for (const [key, spec] of Object.entries(agents)) {
    lines.push(`  ${key}:`);
    if (spec.promptRef !== undefined) lines.push(`    prompt-ref: ${yamlScalar(spec.promptRef)}`);
    if (spec.prompt !== undefined) {
      // Use literal block scalar for prompts so multi-line values survive
      // a round-trip exactly.
      lines.push("    prompt: |");
      for (const ln of spec.prompt.split("\n")) lines.push(`      ${ln}`);
    }
    if (spec.agentRef !== undefined) lines.push(`    agent-ref: ${yamlScalar(spec.agentRef)}`);
    // FIX-925: a tool participant's only field. Without this branch it parses
    // but does not survive a serialize → re-parse cycle (persisted state).
    if (spec.tool !== undefined) lines.push(`    tool: ${yamlScalar(spec.tool)}`);
    if (spec.agentOverrides) {
      lines.push("    agent-overrides:");
      if (spec.agentOverrides.tools)
        lines.push(`      tools: [${spec.agentOverrides.tools.map((t) => yamlScalar(t)).join(", ")}]`);
      if (spec.agentOverrides.model !== undefined)
        lines.push(`      model: ${yamlScalar(spec.agentOverrides.model)}`);
      if (spec.agentOverrides.itemVisibility !== undefined) {
        lines.push("      visibility:");
        lines.push(`        client: ${spec.agentOverrides.itemVisibility.client}`);
        lines.push(`        history: ${spec.agentOverrides.itemVisibility.history}`);
      }
    }
    if (spec.tools)
      lines.push(`    tools: [${spec.tools.map((t) => yamlScalar(t)).join(", ")}]`);
    if (spec.itemVisibility !== undefined) {
      lines.push("    visibility:");
      lines.push(`      client: ${spec.itemVisibility.client}`);
      lines.push(`      history: ${spec.itemVisibility.history}`);
    }
    if (spec.model !== undefined) lines.push(`    model: ${yamlScalar(spec.model)}`);
    if (spec.contextSupply !== undefined)
      lines.push(`    context-supply: ${spec.contextSupply}`);
  }
}

function yamlScalar(value: string): string {
  if (/^[a-zA-Z0-9 _.,/?!@#$%^&*()=+:;]+$/.test(value) && !/^[\-?:]/.test(value)) {
    return value;
  }
  // Quote strings containing special chars; escape embedded quotes.
  return `"${value.replace(/"/g, '\\"')}"`;
}

function yamlValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return yamlScalar(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => yamlValue(v)).join(", ")}]`;
  }
  // For nested objects (rare in frontmatter), JSON-encode for round-trip.
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Public: substitution
// ---------------------------------------------------------------------------

export interface SubstitutionContext {
  /** The full argument string passed via `runSkill({ input })`. */
  arguments?: string;
  /** Absolute path the skill folder is mounted at, e.g. `/workspace/.fsdev/skills/pptx`. */
  skillDir?: string;
}

/**
 * Apply skill body substitutions: `$ARGUMENTS`, `$1..$9`, and `${SKILL_DIR}`.
 * Unset substitutions resolve to empty strings.
 *
 * `${CLAUDE_SKILL_DIR}` is preserved as a working alias for `${SKILL_DIR}`
 * so skill folders authored against Claude Code's skills format drop in
 * unchanged. New skills should use `${SKILL_DIR}`.
 */
export function substitute(body: string, ctx: SubstitutionContext): string {
  const args = ctx.arguments ?? "";
  const skillDir = ctx.skillDir ?? "";

  let out = body;
  out = out.replace(/\$\{SKILL_DIR\}/g, skillDir);
  out = out.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);
  out = out.replace(/\$ARGUMENTS\b/g, args);

  if (/\$[1-9]\b/.test(out)) {
    const tokens = args.length > 0 ? args.split(/\s+/) : [];
    out = out.replace(/\$([1-9])\b/g, (_, n) => tokens[Number(n) - 1] ?? "");
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public: assemble Skill descriptor
// ---------------------------------------------------------------------------

/** Compose a Skill record from its name, parsed state, and body. */
export function toSkill(name: string, state: SkillState, body: string): Skill {
  validateSkillName(name);
  return {
    name,
    body,
    description: state.description,
    allowedTools: state.allowedTools,
    contextMode: state.contextMode,
    disableModelInvocation: state.disableModelInvocation,
    whenToUse: state.whenToUse,
    argumentHint: state.argumentHint,
    keywords: state.keywords,
  };
}
