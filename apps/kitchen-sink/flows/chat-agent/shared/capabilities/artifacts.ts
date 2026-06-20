/**
 * Artifacts — the capability IS the home for the whole artifact concern.
 *
 * Everything artifact-related lives here: the resource collection, the
 * read/write tools, the background summarizer, the `saveArtifact` action
 * sequencer, the inventory context formatter, and the `artifactsCapability`
 * that bundles them for generators via `uses: [artifactsCapability]`.
 *
 * Artifacts are session-scoped resources with metadata in state and the
 * document body stored as resource content. `flow.ts` wires the exported
 * `updateArtifact` sequencer as the `saveArtifact` action; generators install
 * the surface through the capability rather than reaching for the blocks
 * directly.
 */
import {
  defineCapability,
  defineResourceCollection,
  handler,
  sequencer,
  utility,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../../lib/models";

// ---------------------------------------------------------------------------
// Resource definition
// ---------------------------------------------------------------------------

// Per-instance state for an artifact resource. State tracks metadata only —
// the document body is stored as resource content via writeContent/readContent.
// The summary field is populated by a background .work() block after each update.
export const artifactStateSchema = z.object({
  title: z.string(),
  summary: z.string().default(""),
  extension: z.string().optional(),
  updatedAt: z.number()
});

// Resource collection for artifacts. Each artifact is a separate resource
// instance keyed by its ID (e.g., "artifacts/my-doc"). Metadata lives in
// state, the document body lives in resource content.
//
// client.content declares that content is readable and updatable by clients.
// client.data exposes title, summary, and updatedAt metadata in the snapshot
// without eagerly loading document bodies.
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
});

export const artifactResources = {
  artifacts: artifactsCollection,
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
// Write artifact (sequencer — the LLM-callable tool + the saveArtifact action)
// ---------------------------------------------------------------------------

export const updateArtifactInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

export const updateArtifactOutputSchema = z.object({
  success: z.boolean(),
  id: z.string()
});

const artifactSummarizer = utility.summarizer({
  name: "artifact-summarizer",
  model: DEFAULT_KITCHEN_SINK_MODEL,
  granularity: "brief",
});

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

const saveSummary = handler({
  name: "save-artifact-summary",
  inputSchema: utility.summarizerOutputSchema,
  outputSchema: updateArtifactOutputSchema,
  // TODO: we will refactor the need for this out of the framework. Ideally blocks should mainly rely on their input and use connectors to send necessary data into them
  parentInputSchema: updateArtifactInputSchema,
  resources: artifactResources,
  execute: async (input, ctx) => {
    const { id } = ctx.parent!.input;
    const ref = await ctx.resources.artifacts.getOptional(id);
    if (ref) await ref.patchState({ summary: input.summary });
    return { success: true, id };
  }
});

const summarizeArtifact = sequencer({
  name: "summarize-artifact",
  inputSchema: updateArtifactInputSchema,
})
  .step((input) => input.content, artifactSummarizer)
  .step(saveSummary);

export const writeArtifact = sequencer({
  name: "write-artifact",
  description: "Create or update an artifact in the session artifacts collection.",
  inputSchema: updateArtifactInputSchema,
})
  .tap(upsertArtifact)
  .work(summarizeArtifact);

// Keep updateArtifact as an alias so flow.ts and the saveArtifact action don't break.
export const updateArtifact = writeArtifact;

// ---------------------------------------------------------------------------
// Inventory context
// ---------------------------------------------------------------------------

/**
 * Context formatter that shows the artifact inventory (title + summary)
 * so the LLM knows what artifacts exist without reading full content.
 *
 * Installed only through this capability's `inventory` preset, so generators
 * pick it up via `uses` rather than threading it into a `context` slot by
 * hand. `ctx: any` because the preset context slot is the sole call site —
 * there is no second, differently-typed consumer to satisfy.
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
// Capability
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
