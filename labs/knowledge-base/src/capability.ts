// ---------------------------------------------------------------------------
// createKnowledgeBaseCapability — the thin KB composition layer (incubation).
//
// Wraps the OKF concept collection and exposes it as a knowledge base. It is a
// composition over landed primitives, modeled on `createMemoryCapability`:
//   - `resources`: the concept collection (its single resource entry).
//   - `index` preset: an `index.md`-style progressive-disclosure listing injected
//     into the prompt under a <knowledge> tag (OKF SPEC §6, in spirit).
//   - `search` preset: the core glob/grep/search nav tools (FIX-813 PR 1),
//     installed as-is. They are NOT re-aliased under KB-specific names: the KB
//     vocabulary lives in `fns` helpers and the context formatter, so we avoid a
//     second, divergent tool surface (decision #4) and shallow wrapper blocks.
//   - `fns`: `listConcepts` / `readConcept` / `relate` (over `.edges`) /
//     `createConcept` / `updateConcept` / `deleteConcept` (single-concept
//     CRUD) plus `importBundle` / `exportBundle` (the OKF interchange
//     boundary).
//
// Incubated, not graduated: no public package export, no separate session/user
// resource tiers — v0 is one collection in one scope.
// ---------------------------------------------------------------------------

import { defineCapability } from "@flow-state-dev/core";
import { resourceSearchTools, readResourceContentTool } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  conceptCollection,
  conceptIdFromPath,
  conceptStateSchema,
  type ConceptState,
} from "./concepts";
import { importOkf, exportOkf } from "./okf/index";
import { DEFAULT_EDGE_TYPE, RESERVED_FILENAMES } from "./okf/types";

/** Concept ids reserved for OKF's own files (SPEC §3.1) — `index.md` / `log.md`. */
const RESERVED_CONCEPT_IDS = new Set(RESERVED_FILENAMES.map((f) => f.replace(/\.md$/, "")));

/**
 * Reject a concept id that collides with an OKF-reserved filename: creating
 * one would clobber the bundle's own root listing or log file on the next
 * `exportOkf`. Path traversal, absolute paths, and empty ids are already
 * rejected by the collection's own key resolution (every `collection.create`
 * / `getOptional` call normalizes the key and throws on `..`/empty/control
 * characters before this fn is reached), so this only needs to guard names
 * OKF reserves that the collection layer has no reason to know about.
 */
function assertSafeConceptId(id: string): void {
  if (RESERVED_CONCEPT_IDS.has(id)) {
    throw new Error(`knowledgeBase: concept id "${id}" is reserved (OKF ${id}.md)`);
  }
}

/** Render the progressive-disclosure concept listing for prompt context. */
async function formatKnowledgeIndex(
  collection: ResourceCollectionRef<ConceptState>,
): Promise<{ knowledge: string } | null> {
  const instances = await collection.list();
  if (instances.length === 0) return null;

  const prefix = getPatternPrefix(collection.pattern);
  const lines = instances
    .map((ref) => {
      const id = conceptIdFromPath(ref.path, prefix);
      const title = ref.state.title ?? id;
      const desc = ref.state.description ? ` — ${ref.state.description}` : "";
      return `- ${title} (${id})${desc}`;
    })
    .sort();

  return { knowledge: `Concepts in the knowledge base:\n${lines.join("\n")}` };
}

/**
 * Build the `knowledgeBase` capability over the OKF concept collection. Install
 * on a generator with `uses: [kb]` and register the collection on the flow via
 * `kb.collection`. v0 wraps the single `conceptCollection` — there is no
 * collection-injection option until a second consumer needs one (graduation).
 */
export function createKnowledgeBaseCapability() {
  const collection = conceptCollection;
  const nav = resourceSearchTools();
  const readContent = readResourceContentTool();

  const capability = defineCapability({
    name: "knowledgeBase" as const,
    resources: { concepts: collection },
    fns: (ctx: any) => {
      const ref = () => ctx.resources.concepts as ResourceCollectionRef<ConceptState>;
      return {
        /** All concept IDs (bundle paths), sorted. */
        listConcepts: async (): Promise<string[]> => {
          const c = ref();
          const prefix = getPatternPrefix(c.pattern);
          return (await c.list()).map((r) => conceptIdFromPath(r.path, prefix)).sort();
        },
        /** One concept's frontmatter state and body, or `null` if absent. */
        readConcept: async (id: string): Promise<{ state: ConceptState; body: string } | null> => {
          const r = await ref().getOptional(id);
          if (!r) return null;
          return { state: r.state, body: (await r.readContent()) ?? "" };
        },
        /** Add a typed link edge between two concepts (default `references`). Both endpoints must exist. */
        relate: async (from: string, to: string, type: string = DEFAULT_EDGE_TYPE): Promise<void> => {
          const r = await ref().get(from);
          if (r.edges === undefined) {
            throw new Error("knowledgeBase: concept collection has no edge slot");
          }
          await ref().get(to); // throws if the target doesn't exist — no dangling edges
          await r.edges.add({ from, to, type });
        },
        /** Create a NEW concept (frontmatter state + body). Rejects if the id already exists. */
        createConcept: async (id: string, state: ConceptState, body: string): Promise<void> => {
          assertSafeConceptId(id);
          const c = ref();
          if (await c.getOptional(id)) {
            throw new Error(`knowledgeBase: concept "${id}" already exists; use updateConcept`);
          }
          const r = await c.create(id, state);
          try {
            await r.writeContent(body);
          } catch (err) {
            await c.delete(id); // roll back so a retry isn't blocked by "already exists"
            throw err;
          }
        },
        /** Update an existing concept's state and/or body (partial; last-write-wins). */
        updateConcept: async (
          id: string,
          patch: { state?: Partial<ConceptState>; body?: string },
        ): Promise<void> => {
          const r = await ref().getOptional(id);
          if (!r) throw new Error(`knowledgeBase: concept "${id}" not found`);
          if (patch.state !== undefined) {
            // Validate the MERGED state before persisting — patchState/setState would otherwise
            // let a malformed patch erase required frontmatter; merge + parse first.
            await r.setState(conceptStateSchema.parse({ ...r.state, ...patch.state }));
          }
          if (patch.body !== undefined) await r.writeContent(patch.body);
        },
        /** Delete one concept. No-op if missing. Dangling inbound edges from other concepts are tolerated. */
        deleteConcept: async (id: string): Promise<void> => {
          await ref().delete(id);
        },
        /** Mount an external OKF bundle into the collection. */
        importBundle: (dir: string) => importOkf(dir, ref()),
        /** Hand the collection off as a portable OKF bundle. */
        exportBundle: (dir: string) => exportOkf(ref(), dir),
      };
    },
    presets: {
      /** Inject the concept listing under <knowledge>. Default-on. */
      index: {
        context: (_input: any, ctx: any) =>
          formatKnowledgeIndex(ctx.resources.concepts as ResourceCollectionRef<ConceptState>),
      },
      /**
       * Install the glob/grep/search nav tools plus the content-read tool.
       * The nav tools return uris + snippets; `readResourceContent` lets the
       * model fetch a full concept body by uri when the snippet isn't enough.
       * Default-on.
       */
      search: {
        tools: () => [nav.globResources, nav.grepResourceContent, nav.searchResources, readContent],
      },
      default: ["index", "search"],
    },
  });

  // `nav` is exposed so a consumer (e.g. the MCP flow's search/grep actions)
  // can reuse the identical glob/grep/search block instances the generator's
  // `search` preset installs, rather than a second `resourceSearchTools()`
  // instantiation — one tool surface (decision #4), not a divergent second.
  return Object.assign(capability, { collection, nav });
}
