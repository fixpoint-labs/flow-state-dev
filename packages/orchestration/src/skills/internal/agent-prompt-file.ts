/**
 * Shared parse for generator-level agent config.
 *
 * Skills (`SKILL.md` `agents:` entries) and agent prompt files
 * (`prompt-ref` Markdown) are the same YAML-frontmatter dialect —
 * `splitFrontmatter` + `parseFrontmatterYaml` from `shared/frontmatter`.
 * This module owns the *agent-tuning* fields on top of that dialect
 * (`tools` / `model` / `visibility` / `context-supply`, plus optional
 * `description` on the prompt file) so the two call sites cannot drift.
 *
 * For `prompt-ref`, the prompt file is the source of truth. The skill
 * entry is the seat name. Dual-write is rejected, not merged.
 */

import type { AgentSpec, ItemVisibility } from "@flow-state-dev/core";
import { parseFrontmatterYaml, splitFrontmatter } from "../../shared/frontmatter";

/** Generator-config keys. On a `prompt-ref` skill entry these are dual-write. */
export const AGENT_TUNING_KEYS = [
  "tools",
  "model",
  "visibility",
  "context-supply",
] as const;

/** Keys a prompt-file frontmatter may carry. Unknown keys fail loud. */
const AGENT_PROMPT_FILE_KEYS = new Set<string>([
  "description",
  ...AGENT_TUNING_KEYS,
]);

/** Parsed generator config from a skill entry or a prompt-file frontmatter. */
export interface AgentPromptTuning {
  description?: string;
  tools?: string[];
  itemVisibility?: ItemVisibility;
  model?: string;
  contextSupply?: "conversation";
}

/** A prompt Markdown file split into body + optional frontmatter tuning. */
export interface ParsedAgentPromptFile {
  /** Markdown body (frontmatter stripped). */
  body: string;
  /** Fields read from the file's YAML frontmatter. Empty when there is none. */
  tuning: AgentPromptTuning;
}

/** Tuning keys present on a raw YAML mapping (kebab-case, as authored). */
export function presentTuningKeys(obj: Record<string, unknown>): string[] {
  return AGENT_TUNING_KEYS.filter((k) => k in obj);
}

/** Tuning fields present on a typed spec (camelCase). */
export function presentTuningOnSpec(spec: AgentSpec): string[] {
  const keys: string[] = [];
  if (spec.tools !== undefined) keys.push("tools");
  if (spec.model !== undefined) keys.push("model");
  if (spec.itemVisibility !== undefined) keys.push("visibility");
  if (spec.contextSupply !== undefined) keys.push("context-supply");
  return keys;
}

/**
 * Parse a `visibility` YAML value into an `ItemVisibility` object.
 *
 * Accepts either:
 *   - A mapping with `client` and `history` boolean fields.
 *   - A legacy string shorthand: `"primary"` | `"sub"` | `"trace"`.
 *
 * `location` is the full error prefix (e.g. `SKILL.md agent \`foo\``).
 */
export function parseVisibilityField(location: string, v: unknown): ItemVisibility {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if (typeof obj["client"] !== "boolean" || typeof obj["history"] !== "boolean") {
      throw new Error(
        `${location}: \`visibility\` mapping requires boolean \`client\` and \`history\` fields`,
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
          `${location}: \`visibility\` string must be "primary" | "sub" | "trace" — got ${JSON.stringify(v)}`,
        );
    }
  }
  throw new Error(
    `${location}: \`visibility\` must be a mapping ({ client, history }) or a shorthand string`,
  );
}

/**
 * Read generator-config fields off a YAML mapping. Shared by the skill-entry
 * parser (inline `prompt:`) and prompt-file frontmatter.
 */
export function parseAgentTuning(
  obj: Record<string, unknown>,
  location: string,
  options: { allowDescription?: boolean } = {},
): AgentPromptTuning {
  const out: AgentPromptTuning = {};

  if (options.allowDescription && "description" in obj) {
    const d = obj["description"];
    if (typeof d !== "string" || d.trim() === "") {
      throw new Error(`${location}: \`description\` must be a non-empty string`);
    }
    out.description = d;
  }

  if ("tools" in obj) {
    const t = obj["tools"];
    if (!Array.isArray(t) || !t.every((x) => typeof x === "string")) {
      throw new Error(`${location}: \`tools\` must be a string list`);
    }
    out.tools = t as string[];
  }

  if ("visibility" in obj) {
    out.itemVisibility = parseVisibilityField(location, obj["visibility"]);
  }

  if ("model" in obj) {
    const m = obj["model"];
    if (typeof m !== "string") {
      throw new Error(`${location}: \`model\` must be a string`);
    }
    out.model = m;
  }

  if ("context-supply" in obj) {
    const cs = obj["context-supply"];
    if (cs !== "conversation") {
      throw new Error(
        `${location}: \`context-supply\`'s only value is "conversation" ` +
          `— omit the field for the default (isolated) (got ${JSON.stringify(cs)})`,
      );
    }
    out.contextSupply = cs;
  }

  return out;
}

/** Dual-write rejection pointing at the prompt file's frontmatter. */
export function promptRefDualWriteError(
  agentKey: string,
  keys: string[],
  promptRef: string,
): string {
  return (
    `SKILL.md agent \`${agentKey}\`: ${keys.map((k) => `\`${k}\``).join(", ")} ` +
    `can't be set alongside \`prompt-ref\` — the prompt file is the source of truth. ` +
    `Move them into the YAML frontmatter of \`${promptRef}\`.`
  );
}

/**
 * Split a prompt Markdown file into body + optional YAML frontmatter.
 * A file with no `---` fences is all body.
 */
export function parseAgentPromptFile(
  text: string,
  agentKey: string,
): ParsedAgentPromptFile {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    return { body, tuning: {} };
  }
  const raw = parseFrontmatterYaml(yaml);
  const location = `agent prompt file for \`${agentKey}\``;
  for (const k of Object.keys(raw)) {
    if (!AGENT_PROMPT_FILE_KEYS.has(k)) {
      throw new Error(
        `${location}: unknown field \`${k}\` (allowed: ${[...AGENT_PROMPT_FILE_KEYS].join(", ")})`,
      );
    }
  }
  return {
    body,
    tuning: parseAgentTuning(raw, location, { allowDescription: true }),
  };
}

/**
 * Hydrate a `prompt-ref` spec from the file's body + frontmatter.
 * Clears `promptRef` and sets `prompt` so the materializer's inline path runs.
 * Rejects leftover skill-entry tuning — the file is the source of truth.
 */
export function applyAgentPromptFile(
  spec: AgentSpec,
  content: string,
  agentKey: string,
): AgentSpec {
  const leftover = presentTuningOnSpec(spec);
  if (leftover.length > 0) {
    throw new Error(
      promptRefDualWriteError(agentKey, leftover, spec.promptRef ?? "(missing prompt-ref)"),
    );
  }
  const parsed = parseAgentPromptFile(content, agentKey);
  const next: AgentSpec = { prompt: parsed.body };
  if (parsed.tuning.description !== undefined) next.description = parsed.tuning.description;
  if (parsed.tuning.tools !== undefined) next.tools = parsed.tuning.tools;
  if (parsed.tuning.model !== undefined) next.model = parsed.tuning.model;
  if (parsed.tuning.itemVisibility !== undefined) next.itemVisibility = parsed.tuning.itemVisibility;
  if (parsed.tuning.contextSupply !== undefined) next.contextSupply = parsed.tuning.contextSupply;
  return next;
}

/** One-line roster blurb: first non-blank line, capped at 80 chars. */
export function clipRosterLine(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) return "a delegation agent";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}
