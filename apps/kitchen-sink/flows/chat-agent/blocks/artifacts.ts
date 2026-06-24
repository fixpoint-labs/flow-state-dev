/**
 * Artifact system — resource definition, capability, and tool blocks.
 *
 * Artifacts are session-scoped resources with metadata in state and document
 * body stored as resource content. The capability bundles resources, context,
 * and tools under a single `uses: [artifactsCapability]` declaration.
 *
 * Summarization is declarative: the artifacts collection binds a block to
 * `reactTo.contentUpdated`, so whenever an artifact's body is written (by any
 * server-side path) the summarizer regenerates from the fresh body. The write
 * tool just upserts; it no longer wires summarization per call.
 */
import {
  defineCapability,
  defineResourceCollection,
  handler,
  resourceContentChangeSchema,
  sequencer,
  utility,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../lib/models";

// ---------------------------------------------------------------------------
// Resource state + I/O schemas
// ---------------------------------------------------------------------------

// Per-instance state for an artifact resource. State tracks metadata only —
// the document body is stored as resource content via writeContent/readContent.
// The summary field is populated by the reactTo.contentUpdated reaction below
// after each body write.
export const artifactStateSchema = z.object({
  title: z.string(),
  summary: z.string().default(""),
  extension: z.string().optional(),
  updatedAt: z.number()
});

type ArtifactState = z.infer<typeof artifactStateSchema>;

export const updateArtifactInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

export const updateArtifactOutputSchema = z.object({
  success: z.boolean(),
  id: z.string()
});

// ---------------------------------------------------------------------------
// Content reaction: summarize the body whenever it is written
// ---------------------------------------------------------------------------

const artifactSummarizer = utility.summarizer({
  name: "artifact-summarizer",
  model: DEFAULT_KITCHEN_SINK_MODEL,
  granularity: "brief",
});

/**
 * Reads the freshly-written body for the changed artifact. Accesses the
 * collection through `ctx.resources` (installed by the capability) rather than a
 * block-level `resources` declaration — declaring the collection here would form
 * a definition cycle with the collection's own `reactTo` binding.
 */
const loadArtifactBody = handler({
  name: "load-artifact-body",
  inputSchema: resourceContentChangeSchema(),
  outputSchema: z.object({ key: z.string(), content: z.string() }),
  execute: async (change, ctx) => {
    const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<ArtifactState>;
    const ref = await artifacts.getOptional(change.key);
    return { key: change.key, content: (ref ? await ref.readContent() : null) ?? "" };
  }
});

/**
 * Persists the generated summary onto the artifact's state. The artifact key
 * comes from the reaction's parent input (the {@link resourceContentChangeSchema}
 * payload), since the summarizer's output carries only the summary text.
 */
const saveSummary = handler({
  name: "save-artifact-summary",
  inputSchema: utility.summarizerOutputSchema,
  outputSchema: updateArtifactOutputSchema,
  parentInputSchema: resourceContentChangeSchema(),
  execute: async (input, ctx) => {
    const { key } = ctx.parent!.input;
    const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<ArtifactState>;
    const ref = await artifacts.getOptional(key);
    if (ref) await ref.patchState({ summary: input.summary });
    return { success: true, id: key };
  }
});

// Inner pipeline: load the fresh body → summarize → save the summary.
const summarizeArtifactBody = sequencer({
  name: "summarize-artifact-body",
  inputSchema: resourceContentChangeSchema(),
})
  .step(loadArtifactBody)
  .step((loaded) => loaded.content, artifactSummarizer)
  .step(saveSummary);

/**
 * The block bound to `reactTo.contentUpdated`. Isolates summarization as
 * background `.work()` so a summarizer failure does not fail the artifact write
 * that triggered it (the FIX-751 isolation idiom). The summary catches up out of
 * band; `patchState` fires a state update, not a content write, so it does not
 * re-trigger this reaction.
 */
const summarizeArtifactReaction = sequencer({
  name: "summarize-artifact",
  inputSchema: resourceContentChangeSchema(),
}).work(summarizeArtifactBody);

// ---------------------------------------------------------------------------
// Resource definition
// ---------------------------------------------------------------------------

// Resource collection for artifacts. Each artifact is a separate resource
// instance keyed by its ID (e.g., "artifacts/my-doc"). Metadata lives in
// state, the document body lives in resource content.
//
// client.content declares that content is readable and updatable by clients.
// client.data exposes title, summary, and updatedAt metadata in the snapshot
// without eagerly loading document bodies.
//
// reactTo.contentUpdated regenerates the summary from the body after each
// server-side content write.
export const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  scope: "session",
  stateSchema: artifactStateSchema,
  client: {
    content: { read: true, update: true },
    state: { read: true },
    data: (state) => ({
      title: state.title ?? "Untitled",
      summary: state.summary ?? "",
      updatedAt: state.updatedAt,
      extension: state.extension ?? null
    }),
  },
  reactTo: { contentUpdated: summarizeArtifactReaction },
});

export const artifactResources = {
  artifacts: artifactsCollection,
};

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/**
 * Context formatter that shows the artifact inventory (title + summary)
 * so the LLM knows what artifacts exist without reading full content.
 */
const artifactListContext = async (_input: unknown, ctx: any) => {
  const artifacts = ctx.resources.artifacts as ResourceCollectionRef<{
    title: string;
    summary: string;
    updatedAt: number;
  }>;
  const instances = await artifacts.list();
  if (instances.length === 0) {
    return "No artifacts exist yet in this session.";
  }
  const list = instances
    .map((ref: any) => {
      const id = ref.path.replace("artifacts/", "");
      const title = ref.state.title ?? "Untitled";
      const summary = ref.state.summary ? ` — ${ref.state.summary}` : "";
      return `- ${id}: ${title}${summary}`;
    })
    .join("\n");
  return `Current artifacts:\n${list}`;
};

// ---------------------------------------------------------------------------
// Read artifact
// ---------------------------------------------------------------------------

export const readArtifactInputSchema = z.object({
  artifactId: z.string()
});

export const readArtifactOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  extension: z.string().optional(),
  summary: z.string().optional(),
  content: z.string()
});

export const readArtifact = handler({
  name: "read-artifact",
  description: "Read an artifact by ID from the session artifacts collection.",
  inputSchema: readArtifactInputSchema,
  outputSchema: readArtifactOutputSchema,
  resources: artifactResources,
  // FIX-610: artifact content is deterministic per (artifactId,
  // updatedAt). A short TTL means repeated reads inside one plan
  // iteration are served from cache without staling fresh writes
  // across turns. The default board-run scope clears the cache when
  // the surrounding Task Board exits.
  cacheable: { ttl: 60_000 },

  execute: async (input, ctx) => {
    const ref = await ctx.resources.artifacts.getOptional(input.artifactId);
    if (ref === undefined) {
      return { id: input.artifactId, title: "Not Found", updatedAt: 0, summary: "", content: "" };
    }

    return {
      id: input.artifactId,
      title: ref.state.title,
      updatedAt: ref.state.updatedAt,
      extension: ref.state.extension,
      summary: ref.state.summary ?? "",
      content: await ref.readContent() ?? ""
    };
  }
});

// ---------------------------------------------------------------------------
// Write artifact (sequencer — the LLM-callable tool)
// ---------------------------------------------------------------------------

const upsertArtifact = utility.upsertResource({
  name: "upsert-artifact",
  inputSchema: updateArtifactInputSchema,
  resources: artifactResources,
  collectionKey: "artifacts",
  key: (input) => input.id,
  state: (input) => {
    // Derive the extension from the title rather than the storage id so
    // user renames (e.g. `.txt` → `.md`) update the metadata that drives
    // the viewer's renderer pick.
    const ext =
      path.extname(input.title).slice(1) || path.extname(input.id).slice(1);
    return {
      title: input.title,
      ...(ext ? { extension: ext } : {}),
      updatedAt: Date.now(),
    };
  },
  content: (input) => input.content,
});

// The write tool upserts metadata + body. The body write fires
// reactTo.contentUpdated, which regenerates the summary — so the tool no longer
// wires summarization itself.
export const writeArtifact = sequencer({
  name: "write-artifact",
  description: "Create or update an artifact in the session artifacts collection.",
  inputSchema: updateArtifactInputSchema,
})
  .tap(upsertArtifact);

// Keep updateArtifact as an alias so flow.ts and saveArtifact action don't break.
export const updateArtifact = writeArtifact;

// ---------------------------------------------------------------------------
// Capability definition
// ---------------------------------------------------------------------------

/**
 * Artifact capability — session resources + LLM context + tools.
 *
 * Required surface (always installed):
 *   - `artifactsCollection` resource in session scope
 *
 * Presets (opt-in/opt-out):
 *   - `inventory` (default: on) — context formatter showing artifact list
 *   - `tools` (default: on) — readArtifact + writeArtifact as generator tools
 */
export const artifactsCapability = defineCapability({
  name: "artifacts",
  resources: artifactResources,

  presets: {
    /**
     * Context formatter: artifact title + summary inventory for the LLM.
     *
     * Object-form so the inventory lands inside an `<artifacts>` tag and
     * any other capability contributing to `artifacts` aggregates with it.
     */
    inventory: {
      context: { artifacts: artifactListContext },
    },
    /** Generator tools: read and write artifacts. */
    tools: {
      tools: [readArtifact, writeArtifact],
    },
    default: ["inventory", "tools"],
  },
});
