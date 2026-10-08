/**
 * SKILL.md parser/serializer and runtime substitution helpers.
 *
 * The SKILL.md format is the Agent Skills format (https://agentskills.io):
 * YAML frontmatter (kebab-case) followed by a Markdown body. The spec's
 * fields — `name`, `description`, `license`, `compatibility`, `metadata`,
 * `allowed-tools` — are parsed and validated to its rules; the framework's own
 * fields (`keywords`, `context`, …) are additive. Frontmatter is
 * converted to camelCase for TypeScript ergonomics; the inverse mapping is
 * preserved so we can round-trip back to disk without losing fields. Unknown
 * frontmatter keys are preserved on `state._preservedFields` so user data
 * survives a parse/serialize cycle.
 *
 * Substitution is intentionally separated from parsing — the body is stored
 * verbatim, and `$ARGUMENTS` / `${SKILL_DIR}` are resolved per-invocation
 * inside `substitute()`.
 *
 * The frontmatter dialect itself — splitting the fences, parsing the YAML
 * subset — lives in `../shared/frontmatter`, shared with the other convention
 * file an author writes by hand so the two never drift apart.
 */

import type { Skill, SkillState } from "@flow-state-dev/core";
import { isWindowsReservedName } from "@flow-state-dev/core/helpers";
import {
  parseFrontmatterYaml,
  parseInlineMapping,
  parseScalar,
  splitFrontmatter,
} from "../shared/frontmatter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed `description` length (Agent Skills spec). */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Maximum allowed skill name length (Agent Skills spec). */
export const MAX_NAME_LENGTH = 64;

/** Maximum allowed `compatibility` length (Agent Skills spec). */
export const MAX_COMPATIBILITY_LENGTH = 500;

/** Names disallowed as skill names (reserved by the framework). */
const RESERVED_NAMES = new Set(["_meta", ""]);

/**
 * Pattern a valid skill name must match: lowercase `a-z`/`0-9` runs joined by
 * single hyphens — so no leading, trailing, or consecutive hyphens, per the
 * Agent Skills spec. The spec admits any Unicode lowercase letter; this
 * implementation keeps to ASCII because the name doubles as a resource key,
 * a `/slash` command, and a workspace mount path.
 */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  // Claude-Code-only fields we explicitly capture/warn about
  "user-invocable",
  "paths",
  "hooks",
  "shell",
  "model",
  "effort",
  // Agent Skills spec fields (typed on SkillState)
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

/** Options for `parseSkillMd`. */
export interface ParseSkillMdOptions {
  /**
   * The folder the manifest lives in. When set and the frontmatter declares
   * `name`, the two must match (Agent Skills spec) — a mismatch throws.
   */
  expectedName?: string;
}

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
      `Skill name "${name}" must be lowercase letters, digits, and single hyphens ` +
        `(not at the start or end)`,
    );
  }
  // A skill folder named after a Windows device loads on macOS and Linux, and
  // then the repository cannot be checked out on Windows. The list is the
  // shared one, which folds case; it runs after the pattern so `CON` keeps
  // the lowercase message and only a lowercase device name reaches this one.
  if (isWindowsReservedName(name)) {
    throw new Error(`Skill name "${name}" is a reserved device name on Windows`);
  }
}

// ---------------------------------------------------------------------------
// Removed fields
// ---------------------------------------------------------------------------

/**
 * Thrown for a `SKILL.md` that declares `agents:` — skill sub-agents, removed
 * in FIX-1814.
 *
 * Its own class so a caller that otherwise skips a malformed skill can tell
 * this one apart and refuse it instead: `createSkillsLibrary` rethrows it at
 * construction rather than skipping a bundled skill that declares `agents:`.
 * It is the one removed shape refused by name; every other malformed skill
 * keeps its old path.
 */
export class SkillAgentsRemovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillAgentsRemovedError";
  }
}

/**
 * Why a skill may not declare a team (`agents:`, or its older name `workers:`),
 * so the two refusals cannot drift apart.
 */
function teamFieldRemoved(key: "agents" | "workers"): string {
  return (
    `SKILL.md \`${key}:\` was removed from skills. A skill no longer runs a team of its own: ` +
    `delegate to workers through the task board instead, and delete the \`${key}:\` block.`
  );
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
 * Required field: `description`. Throws if missing or invalid. The spec's
 * `name` is optional here (the folder is the identity) but validated when
 * present, and checked against `options.expectedName` when one is given.
 * Unknown frontmatter keys are preserved (camelCased) under `_preservedFields`.
 * Claude-Code-only keys we don't honor at runtime produce warnings.
 */
export function parseSkillMd(
  text: string,
  options: ParseSkillMdOptions = {},
): ParsedSkillMd {
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

  // Agent Skills spec fields. `name` is the folder's identity in this
  // framework, so it is optional in the manifest — but when declared it must
  // be a valid name and match the folder (`expectedName`) it lives in.
  if ("name" in raw && raw["name"] !== null && raw["name"] !== undefined) {
    const v = raw["name"];
    if (typeof v !== "string") {
      throw new Error("SKILL.md `name` must be a string");
    }
    validateSkillName(v);
    if (options.expectedName !== undefined && v !== options.expectedName) {
      throw new Error(
        `SKILL.md \`name: ${v}\` must match its folder "${options.expectedName}"`,
      );
    }
    state.name = v;
  }

  if ("license" in raw && raw["license"] !== null && raw["license"] !== undefined) {
    const v = raw["license"];
    if (typeof v === "string") {
      state.license = v;
    } else {
      warnings.push("`license` must be a string — ignored");
    }
  }

  if (
    "compatibility" in raw &&
    raw["compatibility"] !== null &&
    raw["compatibility"] !== undefined
  ) {
    const v = raw["compatibility"];
    if (typeof v !== "string") {
      warnings.push("`compatibility` must be a string — ignored");
    } else if (v.length > MAX_COMPATIBILITY_LENGTH) {
      throw new Error(
        `SKILL.md compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} chars`,
      );
    } else {
      state.compatibility = v;
    }
  }

  if ("metadata" in raw && raw["metadata"] !== null && raw["metadata"] !== undefined) {
    // The spec's example is a block mapping; the flow style
    // (`metadata: { author: x, version: "1.0" }`) is equally valid YAML, and
    // the scalar parser hands it over as a string — parse it here.
    const v =
      typeof raw["metadata"] === "string" && raw["metadata"].trim().startsWith("{")
        ? parseInlineMapping(raw["metadata"])
        : raw["metadata"];
    if (typeof v === "object" && !Array.isArray(v)) {
      // A string → string map. Scalar values are stringified (`version: 1.0`
      // is a common unquoted form); nested values don't fit the spec's shape.
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          out[k] = String(val);
        } else {
          warnings.push(`\`metadata.${k}\` must be a string — ignored`);
        }
      }
      // An all-invalid map leaves nothing to keep; `undefined` matches the
      // mistyped-field case rather than persisting an empty object.
      if (Object.keys(out).length > 0) state.metadata = out;
    } else {
      warnings.push("`metadata` must be a mapping of string keys to string values — ignored");
    }
  }

  if ("allowed-tools" in raw) {
    const v = raw["allowed-tools"];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      state.allowedTools = v as string[];
    } else if (typeof v === "string") {
      // The spec form is a space-separated string (`Bash(git:*) Read`). The
      // comma-separated form is a legacy leniency for hand-written frontmatter
      // from before the spec settled — kept deliberately, not spec drift.
      state.allowedTools = v
        .split(/[\s,]+/)
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
      // downgrade to inline (which would run work meant for its own context in
      // the parent's — the opposite of what the author asked for).
      throw new Error(
        v === "fork"
          ? `SKILL.md \`context: fork\` was removed. To run work in a context of its own, hand it to a worker through the task board.`
          : `SKILL.md \`context: pattern\` was removed. Expose a task-board/goalSeekLoop block as an allowed tool instead.`,
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
      `SKILL.md \`pattern:\` was removed. Expose a task-board/goalSeekLoop block as an allowed tool for deterministic multi-step recipes.`,
    );
  }

  // Legacy `workers:` frontmatter — renamed to `agents:` in FIX-918, which
  // FIX-1814 then removed. Fail loud rather than silently preserving the key.
  // A plain Error on purpose: `createSkillsLibrary` skips a bundled skill that
  // fails this way, like any parse failure; only `agents:` fails construction.
  if ("workers" in raw && raw["workers"] !== null && raw["workers"] !== undefined) {
    throw new Error(teamFieldRemoved("workers"));
  }

  // `agents:` (skill sub-agents) — removed in FIX-1814. Refused on any
  // presence, an empty value included: preserving it would round-trip a team
  // nothing runs, and dropping it would let the body ask for one silently.
  if ("agents" in raw) {
    throw new SkillAgentsRemovedError(teamFieldRemoved("agents"));
  }

  // Warn about ignored Claude-Code fields.
  for (const key of WARN_IGNORED_KEYS) {
    if (key in raw) {
      warnings.push(`SKILL.md field \`${key}\` is preserved but not honored at runtime`);
    }
  }

  // Preserve unknown fields (and the ignored ones we still want round-tripped)
  // under camelCase keys. Required/known fields above are NOT preserved.
  const preservedKnownButNotMapped = new Set(["user-invocable", ...WARN_IGNORED_KEYS]);
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
  const lines: string[] = ["---"];
  if (state.name !== undefined) {
    lines.push(`name: ${yamlScalar(state.name)}`);
  }
  lines.push(`description: ${yamlScalar(state.description)}`);
  if (state.license !== undefined) {
    lines.push(`license: ${yamlScalar(state.license)}`);
  }
  if (state.compatibility !== undefined) {
    lines.push(`compatibility: ${yamlScalar(state.compatibility)}`);
  }
  if (state.metadata && Object.keys(state.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(state.metadata)) {
      lines.push(`  ${k}: ${yamlStringScalar(v)}`);
    }
  }

  if (state.allowedTools && state.allowedTools.length > 0) {
    // The spec's form is one space-separated string. An entry that itself
    // contains a delimiter (whitespace or a comma) would be split on re-parse,
    // so those fall back to the list form, which keeps entry boundaries.
    const tools = state.allowedTools;
    lines.push(
      tools.some((t) => /[\s,]/.test(t))
        ? `allowed-tools: [${tools.map((t) => yamlScalar(t)).join(", ")}]`
        : `allowed-tools: ${yamlScalar(tools.join(" "))}`,
    );
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
  // A plain (unquoted) scalar is safe only when nothing in it reads as YAML
  // structure to a strict parser: no leading indicator, no `: ` (a nested
  // mapping), no ` #` (a comment), and no trailing `:`.
  if (
    /^[a-zA-Z0-9 _.,/?!@#$%^&*()=+:;-]+$/.test(value) &&
    !/^[\-?:]/.test(value) &&
    !/:(\s|$)/.test(value) &&
    !/\s#/.test(value)
  ) {
    return value;
  }
  // Quote strings containing special chars; escape embedded quotes.
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Serialize a value that must round-trip as a *string*. `metadata` values are
 * strings by spec, but a bare `version: 1.0` or `beta: true` would re-parse as
 * a number/boolean — so those are quoted. Decided with `parseScalar` itself so
 * the quoting rule can never drift from the parsing rule.
 */
function yamlStringScalar(value: string): string {
  if (typeof parseScalar(value) === "string") return yamlScalar(value);
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
    license: state.license,
    compatibility: state.compatibility,
    metadata: state.metadata,
    allowedTools: state.allowedTools,
    contextMode: state.contextMode,
    disableModelInvocation: state.disableModelInvocation,
    whenToUse: state.whenToUse,
    argumentHint: state.argumentHint,
    keywords: state.keywords,
  };
}
