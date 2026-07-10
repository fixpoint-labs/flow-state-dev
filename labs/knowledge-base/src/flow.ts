// ---------------------------------------------------------------------------
// The knowledge-base lab's flow: a secured personal MCP server (FIX-855).
//
// Exposes 8 MCP tools (list / read / search / grep / create / update / delete
// / relate) over the user-scoped concept collection, plus two CLI-only OKF
// import/export actions (`mcp: { enabled: false }` — they take server-side
// filesystem paths, which must never be reachable over a hosted MCP endpoint).
// Auth is a bearer secret read from `KB_MCP_SECRET`: constructed only when the
// env var is set, so importing this module in local dev / CI never throws;
// the hosted (Postgres) profile fails closed on a missing secret at config
// load instead (see `../fsdev.config.ts`).
// ---------------------------------------------------------------------------

import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { createKnowledgeBaseCapability } from "./capability";
import { conceptStateSchema, CONCEPT_PREFIX } from "./concepts";
import { DEFAULT_EDGE_TYPE } from "./okf/types";

const kb = createKnowledgeBaseCapability();

/** Every concept ref's `uri` is `${scope}/${CONCEPT_PREFIX}/<id>` — e.g. `user/concepts/topics/react`. */
const URI_LEAD = `${kb.collection.scope}/${CONCEPT_PREFIX}/`;

/**
 * Normalize a `search_concepts`/`grep_concepts` result uri back to a bare
 * concept id; a bare id passes through unchanged. Applied to every id-taking
 * action (read/update/delete/relate) so pasting a search result into any of
 * them resolves the concept instead of silently no-op'ing.
 */
function conceptIdFromUri(x: string): string {
  return x.startsWith(URI_LEAD) ? x.slice(URI_LEAD.length) : x;
}

const noGeneratorPresets = kb.presets({ index: false, search: false });

const listConceptsHandler = handler({
  name: "listConcepts",
  inputSchema: z.object({}),
  outputSchema: z.object({ ids: z.array(z.string()) }),
  uses: [noGeneratorPresets],
  execute: async (_input, ctx: any) => ({ ids: await ctx.cap.knowledgeBase.listConcepts() }),
});

const readConceptHandler = handler({
  name: "readConcept",
  inputSchema: z.object({
    id: z.string().describe("Concept id, or a uri returned by search_concepts/grep_concepts"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    state: conceptStateSchema.nullable(),
    body: z.string().nullable(),
  }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const result = await ctx.cap.knowledgeBase.readConcept(conceptIdFromUri(input.id));
    return result ? { found: true, state: result.state, body: result.body } : { found: false, state: null, body: null };
  },
});

const createConceptHandler = handler({
  name: "createConcept",
  inputSchema: z.object({
    id: z.string().describe("New concept id, e.g. 'topics/react'"),
    type: z.string().describe("Concept type — OKF's one required frontmatter field"),
    title: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
    tags: z.array(z.string()).default([]),
    body: z.string().describe("Markdown body"),
  }),
  outputSchema: z.object({ id: z.string() }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const { id, type, title, description, tags, body } = input;
    await ctx.cap.knowledgeBase.createConcept(id, { type, title, description, tags }, body);
    return { id };
  },
});

const updateConceptHandler = handler({
  name: "updateConcept",
  inputSchema: z.object({
    id: z.string(),
    state: conceptStateSchema.partial().nullable().default(null),
    body: z.string().nullable().default(null),
  }),
  outputSchema: z.object({ id: z.string() }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const id = conceptIdFromUri(input.id);
    await ctx.cap.knowledgeBase.updateConcept(id, {
      state: input.state ?? undefined,
      body: input.body ?? undefined,
    });
    return { id };
  },
});

const deleteConceptHandler = handler({
  name: "deleteConcept",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ id: z.string() }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const id = conceptIdFromUri(input.id);
    await ctx.cap.knowledgeBase.deleteConcept(id);
    return { id };
  },
});

const relateConceptsHandler = handler({
  name: "relateConcepts",
  inputSchema: z.object({
    from: z.string(),
    to: z.string(),
    type: z.string().nullable().default(null),
  }),
  outputSchema: z.object({ from: z.string(), to: z.string(), type: z.string() }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const from = conceptIdFromUri(input.from);
    const to = conceptIdFromUri(input.to);
    const type = input.type ?? DEFAULT_EDGE_TYPE;
    await ctx.cap.knowledgeBase.relate(from, to, type);
    return { from, to, type };
  },
});

/**
 * OKF bundle import/export — CLI-only (`mcp: { enabled: false }`). These take
 * server-side filesystem paths; over a hosted MCP endpoint they would let a
 * remote client read from / write to / prune arbitrary host paths.
 */
const importBundleHandler = handler({
  name: "importBundle",
  inputSchema: z.object({ dir: z.string().describe("OKF bundle directory to mount") }),
  outputSchema: z.object({ imported: z.number(), warnings: z.array(z.string()) }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const { imported, warnings } = await ctx.cap.knowledgeBase.importBundle(input.dir);
    return { imported, warnings };
  },
});

const exportBundleHandler = handler({
  name: "exportBundle",
  inputSchema: z.object({ dir: z.string().describe("Directory to write the OKF bundle to") }),
  outputSchema: z.object({ exported: z.number() }),
  uses: [noGeneratorPresets],
  execute: async (input, ctx: any) => {
    const { exported } = await ctx.cap.knowledgeBase.exportBundle(input.dir);
    return { exported };
  },
});

const knowledgeFlow = defineFlow({
  kind: "knowledge",
  authentication: {
    requireUser: true,
    // No defaultUserId: a missing/invalid key denies rather than serving an
    // anon principal. Construct the resolver only when the secret is set —
    // createBearerSecretPrincipalResolver throws on an empty secret, so
    // importing this module in local dev / CI (no KB_MCP_SECRET) must not
    // pass "". The hosted (Postgres) profile fails closed on a missing
    // secret at config load instead (see ../fsdev.config.ts).
    resolvePrincipal: process.env.KB_MCP_SECRET
      ? createBearerSecretPrincipalResolver({
          secret: process.env.KB_MCP_SECRET,
          principal: { userId: "owner" }, // the single personal user the corpus binds to
        })
      : undefined,
  },
  mcp: { enabled: true },
  actions: {
    listConcepts: { block: listConceptsHandler, description: "List all concept ids in the knowledge base." },
    readConcept: { block: readConceptHandler, description: "Read one concept's body and frontmatter by id." },
    searchConcepts: {
      block: kb.nav.searchResources,
      description: "Rank concepts by lexical relevance to a query.",
    },
    grepConcepts: {
      block: kb.nav.grepResourceContent,
      description: "Find concept lines matching a regex/substring.",
    },
    createConcept: { block: createConceptHandler, description: "Create a new concept (frontmatter + body)." },
    updateConcept: {
      block: updateConceptHandler,
      description: "Update an existing concept's frontmatter and/or body.",
    },
    deleteConcept: { block: deleteConceptHandler, description: "Delete one concept by id." },
    relateConcepts: { block: relateConceptsHandler, description: "Add a typed link edge between two concepts." },
    // OKF import/export are NOT MCP tools — see the handler comments above.
    importBundle: {
      block: importBundleHandler,
      description: "Mount an OKF bundle directory into the knowledge base (CLI-only).",
      mcp: { enabled: false },
    },
    exportBundle: {
      block: exportBundleHandler,
      description: "Export the knowledge base as a portable OKF bundle directory (CLI-only).",
      mcp: { enabled: false },
    },
  },
  resources: { concepts: kb.collection },
});

export default knowledgeFlow({ id: "default" });
