// ---------------------------------------------------------------------------
// The OKF concept collection + the frontmatter <-> state mapping.
//
// A bundle directory maps to one resource collection; each concept `.md` file
// maps to one instance keyed by its bundle-relative concept ID. The state
// schema mirrors OKF frontmatter (SPEC §4.1): the one required `type`, the
// recommended fields as nullable, and `extra` carrying preserved unknown keys
// as a strict-compatible key/value list (not `z.record`, per BP-016 / BP-023).
// The collection declares an `edges` slot so OKF's untyped markdown links map
// onto typed graph edges, and opts into `llmReadable`/`llmWritable` so the core
// glob/grep/search tools (FIX-813 PR 1) and content tools see the concepts.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import {
  DEFAULT_CONCEPT_TYPE,
  type OkfConcept,
} from "./okf/types";
import { serializeExtraValue, parseExtraValue } from "./okf/frontmatter";

/** The KNOWN OKF frontmatter fields, in the order they are re-emitted on export. */
const KNOWN_FIELDS = ["type", "title", "description", "resource", "tags", "timestamp"] as const;

/** State shape for a concept instance — a Zod mirror of OKF frontmatter. */
export const conceptStateSchema = z.object({
  /** OKF: the one required field (SPEC §4.1). */
  type: z.string(),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  resource: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  timestamp: z.string().nullable().default(null),
  /** Preserved unknown frontmatter keys — the OKF "consumers SHOULD preserve" MUST (SPEC §4.1). */
  extra: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
});

export type ConceptState = z.infer<typeof conceptStateSchema>;

/**
 * The default OKF concept collection used by the knowledge-base example.
 *
 * `scope: "user"` binds the corpus to the authenticated principal rather
 * than the (ephemeral, per-request) session, so it survives across the
 * stateless MCP fresh-session-per-`tools/call` model and is durable when
 * backed by Postgres.
 */
export const conceptCollection = defineResourceCollection({
  pattern: "concepts/**",
  scope: "user",
  stateSchema: conceptStateSchema,
  edges: true,
  llmReadable: true,
  llmWritable: true,
});

/** The storage-key prefix injected by the collection pattern (e.g. `concepts`). */
export const CONCEPT_PREFIX = getPatternPrefix(conceptCollection.pattern);

/**
 * Concept ID (OKF bundle path) from a full storage path. The collection pattern
 * injects a `concepts/` prefix onto every key; OKF identity is the path WITHOUT
 * that FSD-internal prefix, so strip it.
 */
export function conceptIdFromPath(path: string, prefix: string = CONCEPT_PREFIX): string {
  const lead = `${prefix}/`;
  return path.startsWith(lead) ? path.slice(lead.length) : path;
}

/**
 * Map a parsed OKF concept's frontmatter onto collection state. Splits known
 * fields from unknown ones (the latter preserved in `extra`), coerces scalar
 * fields to strings, and defaults a missing `type` to `"concept"` with a
 * warning (best-effort consumption, SPEC §9) rather than failing the concept.
 */
export function frontmatterToState(
  frontmatter: Record<string, unknown>,
  conceptId: string,
  warnings: string[],
): ConceptState {
  const rawType = frontmatter.type;
  let type: string;
  if (typeof rawType === "string" && rawType.length > 0) {
    type = rawType;
  } else {
    type = DEFAULT_CONCEPT_TYPE;
    warnings.push(`${conceptId}: missing required "type"; defaulted to "${DEFAULT_CONCEPT_TYPE}"`);
  }

  const extra: ConceptState["extra"] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if ((KNOWN_FIELDS as readonly string[]).includes(key)) continue;
    extra.push({ key, value: serializeExtraValue(value) });
  }
  extra.sort((a, b) => a.key.localeCompare(b.key));

  return {
    type,
    title: stringOrNull(frontmatter.title),
    description: stringOrNull(frontmatter.description),
    resource: stringOrNull(frontmatter.resource),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    timestamp: stringOrNull(frontmatter.timestamp),
    extra,
  };
}

/**
 * Build the canonical, ordered frontmatter object for export: known fields in a
 * fixed order (omitting null/empty optionals so re-import/re-export is stable),
 * then preserved `extra` keys sorted and parsed back to their YAML value. A
 * known-field collision in `extra` is ignored (the typed field wins).
 */
export function stateToFrontmatter(state: ConceptState): Record<string, unknown> {
  const out: Record<string, unknown> = { type: state.type };
  if (state.title != null) out.title = state.title;
  if (state.description != null) out.description = state.description;
  if (state.resource != null) out.resource = state.resource;
  if (state.tags.length > 0) out.tags = state.tags;
  if (state.timestamp != null) out.timestamp = state.timestamp;

  for (const { key, value } of [...state.extra].sort((a, b) => a.key.localeCompare(b.key))) {
    if (key in out) continue;
    out[key] = parseExtraValue(value);
  }
  return out;
}

/** Coerce a frontmatter scalar to a string, or `null` when absent. */
function stringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

/** Re-export the concept wire type for adapter consumers. */
export type { OkfConcept };
