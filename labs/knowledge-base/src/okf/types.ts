// ---------------------------------------------------------------------------
// OKF interchange types (incubation, FIX-813).
//
// The on-disk OKF v0.1 shape as this adapter sees it after parsing: one
// concept per non-reserved markdown file, identified by its bundle-relative
// path (the "concept ID"), carrying YAML frontmatter, a markdown body, and the
// untyped markdown links extracted from that body. These are the wire types;
// the FSD-side representation is the concept collection's state (see
// `../concepts.ts`).
// ---------------------------------------------------------------------------

/** OKF version this adapter is pinned to. OKF is a v0.x proof-of-concept. */
export const OKF_VERSION = "0.1" as const;

/** Default edge type assigned to imported links — OKF links are untyped (SPEC §5.3). */
export const DEFAULT_EDGE_TYPE = "references" as const;

/** Default concept `type` when a frontmatter block omits the one required field. */
export const DEFAULT_CONCEPT_TYPE = "concept" as const;

/** Reserved OKF filenames that MUST NOT be treated as concepts (SPEC §3.1). */
export const RESERVED_FILENAMES = ["index.md", "log.md"] as const;

/**
 * A single parsed concept document. `id` is the bundle-relative path with the
 * `.md` suffix removed (OKF "Concept ID", SPEC §2) — it doubles as the FSD
 * collection key. `frontmatter` is the raw YAML map (unknown keys included);
 * `links` are the resolved concept IDs this concept points at (external URLs and
 * anchors already filtered out, relative paths already resolved).
 */
export interface OkfConcept {
  id: string;
  frontmatter: Record<string, unknown>;
  body: string;
  links: string[];
}

/**
 * The result of walking a bundle directory. `okfVersion` comes from the bundle
 * root `index.md` frontmatter when present (the only place OKF permits index
 * frontmatter, SPEC §11). `warnings` collects non-fatal issues (missing `type`,
 * unparseable concept) so import can proceed best-effort (SPEC §9). The reserved
 * `log.md` is excluded as a concept but not otherwise read in v0.
 */
export interface ParsedOkfBundle {
  concepts: OkfConcept[];
  okfVersion: string | null;
  warnings: string[];
}
