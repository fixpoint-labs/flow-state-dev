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
 * verbatim, and `$ARGUMENTS` / `${CLAUDE_SKILL_DIR}` are resolved per-invocation
 * inside `substitute()`.
 */

import type {
  Skill,
  SkillContextMode,
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
  "output-schema",
  "when_to_use",
  "argument-hint",
  "keywords",
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
// Minimal YAML frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Tiny YAML-subset parser sufficient for SKILL.md frontmatter.
 *
 * Supports: scalars, single-line arrays (`[a, b, c]`), block arrays
 * (`- a` per line), nested objects up to one level, and quoted strings.
 * NOT a general-purpose YAML implementation — intentionally narrow to keep
 * this package dependency-free.
 */
function parseFrontmatterYaml(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip blank lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Indented lines without a parent key are unsupported here — skip them.
    if (line.startsWith(" ") || line.startsWith("\t")) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    // Block array: rest is empty or null, subsequent indented `- item` lines.
    if (rest === "" || rest === "~" || rest.toLowerCase() === "null") {
      const items: unknown[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j]!;
        const trimmed = next.trim();
        if (!next.startsWith(" ") && !next.startsWith("\t")) break;
        if (trimmed.startsWith("- ")) {
          items.push(parseScalar(trimmed.slice(2).trim()));
        } else if (trimmed.startsWith("-")) {
          items.push(parseScalar(trimmed.slice(1).trim()));
        }
        j++;
      }
      if (items.length > 0) {
        result[key] = items;
      } else {
        result[key] = null;
      }
      i = j;
      continue;
    }

    result[key] = parseScalar(rest);
    i++;
  }

  return result;
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
    if (v === "fork" || v === "inline") {
      state.contextMode = v as SkillContextMode;
    } else if (v !== undefined && v !== null) {
      warnings.push(
        `\`context\` must be "inline" or "fork" — got ${JSON.stringify(v)}; defaulting to inline`,
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

  if ("output-schema" in raw) {
    state.outputSchema = raw["output-schema"];
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

  if (state._preservedFields) {
    for (const [k, v] of Object.entries(state._preservedFields)) {
      lines.push(`${camelToKebab(k)}: ${yamlValue(v)}`);
    }
  }

  lines.push("---", "", body);
  // Avoid trailing newlines beyond a single one for stable round-trip.
  return lines.join("\n").replace(/\n+$/, "\n");
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
 * Apply Claude-skill body substitutions: `$ARGUMENTS`, `$1..$9`, and
 * `${CLAUDE_SKILL_DIR}`. Unset substitutions resolve to empty strings —
 * matches Claude Code's documented behavior.
 */
export function substitute(body: string, ctx: SubstitutionContext): string {
  const args = ctx.arguments ?? "";
  const skillDir = ctx.skillDir ?? "";

  let out = body;
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
