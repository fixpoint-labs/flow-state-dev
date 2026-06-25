# @flow-state-dev/knowledge-base (incubation lab)

An incubation lab for **FIX-813**: an [Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) v0.1 interchange adapter and a thin `knowledgeBase` capability over the resource graph.

This is **not a published package** (`private: true`). OKF v0.1 is a one-day-old proof-of-concept, and the typed-edge primitive it maps onto has only one other consumer (memory relations), so the adapter and capability are validated here against a first consumer before any graduation to a public `@flow-state-dev/*` package. The agent-facing content-navigation tools the same issue depends on (`globResources` / `grepResourceContent` / `searchResources`) already shipped in `@flow-state-dev/core` — this lab consumes them, it does not redefine them.

## What's here

| Piece | Where | Status |
| -- | -- | -- |
| OKF import/export adapter (`parseOkfBundle` / `importOkf` / `exportOkf`) | `src/okf/` | Incubated |
| Concept collection (OKF frontmatter → state, links → edges) | `src/concepts.ts` | Incubated |
| `createKnowledgeBaseCapability()` | `src/capability.ts` | Incubated |
| Runnable example flow (`knowledge`) | `src/flow.ts` | Lab demo |
| Sample OKF bundle | `sample-bundle/` | Fixture |

## Run it

```bash
# Mount an OKF bundle and list what came in (model-free).
pnpm fsdev run knowledge explore -i '{}'

# Mount the sample bundle, then let a generator navigate it to answer a question
# (uses the glob/grep/search tools the capability installs; needs AI_GATEWAY_API_KEY).
pnpm fsdev run knowledge research -i '{"question":"What format does this knowledge base use?"}'

# Round-trip the sample bundle and check OKF v0.1 conformance + the link graph.
pnpm okf:smoke

# Unit tests, including the export -> import -> export idempotency gate.
pnpm test
```

## The OKF ↔ FSD mapping

| OKF (SPEC §3–§5) | FSD |
| -- | -- |
| Bundle directory | one resource collection (`conceptCollection`) |
| Concept `.md` (bundle-relative path) | collection instance, key = path |
| YAML frontmatter | instance state (Zod-validated, YAML 1.2) |
| required `type` | `state.type` |
| recommended `title` / `description` / `resource` / `tags` / `timestamp` | nullable state fields |
| unknown frontmatter keys | `state.extra` (preserved, re-emitted) |
| markdown body | content body (verbatim) |
| markdown link (untyped) | typed edge; import infers `type: "references"`, export emits a plain link |
| `index.md` | generated on export (with `okf_version`), reserved on import |
| `log.md` | reserved (excluded as a concept); not round-tripped in v0 |

Frontmatter is parsed as **YAML 1.2** (gray-matter on the eemeli `yaml` engine) so the "Norway problem" doesn't bite: `country: NO` stays the string `"NO"` and `enabled: on` stays `"on"` — values that YAML 1.1 would silently turn into booleans. Frontmatter that isn't a YAML mapping (a bare scalar or list) is treated as "no recognized fields" rather than crashing, per OKF's best-effort consumption rule.

## v0 scope and known limitations

These are deliberate for the incubation; each is a follow-up, not a bug:

- **Interchange only.** Import hydrates the split state/content model; export emits a bundle. No single-file-backed collection variant.
- **Edge metadata is lossy on export.** OKF links are untyped, so confidence / temporality / provenance on an edge are dropped. The round-trip idempotency gate asserts content + frontmatter + link structure, **not** edge metadata.
- **Links are body-resident.** Import projects body links into edges for navigation; the verbatim body still carries them, so export does not re-emit body links. A *programmatic* edge (added via `relate`, not present in the body) is materialized once into a trailing `# Related` section — which a re-import reads back, so a second export is byte-identical.
- **`log.md` is not round-tripped.** It is parsed and surfaced by `parseOkfBundle`, but not persisted on import or synthesized on export.
- **Lexical only.** Navigation is glob/grep/ranked-keyword. No embeddings — semantic recall is the memory / RAG job.

## Decision records

The two evaluation questions FIX-813 asked are answered in the [implementation spec](https://linear.app/fixpoint-labs/document/fix-813-portable-knowledge-base-format-okf-over-the-resource-graph-fd644e5eaa51) §11:

- **#4** — OKF is an external *interchange boundary*, not a new internal authoring surface. It does not merge or replace the SKILL.md / generator-prompt / resource-template `.md` surfaces.
- **#5** — Curated KB navigation reduces but does not eliminate vector RAG; they are complements routed by corpus shape. The RAG roadmap (FIX-72 / FIX-71) stays, scoped toward large/uncurated/fuzzy corpora.

## Graduation criteria

Promote the adapter + capability to a published package once there is a **second consumer** (Storyteller / FIX-759 is the intended one) **and** OKF has stabilized past v0.1.
