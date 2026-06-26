/**
 * Artifact resource collection — the storage shape for session artifacts, plus
 * the content reaction that keeps each artifact's summary in sync with its body.
 *
 * Each artifact is a session-scoped resource instance keyed by its id (e.g.
 * `"artifacts/my-doc"`): metadata lives in state, the document body lives in
 * resource content. This is the base of the artifacts concern — the tools,
 * context formatter, and capability all build over it (one-way dependency).
 *
 * Summarization is declarative: the collection binds `reactTo.contentUpdated`,
 * so whenever an artifact's body is written (by any server-side path) the
 * summarizer regenerates from the fresh body. The reaction isolates the
 * summarizer with `.work()`, so a summarizer failure never fails the write.
 */
import {
  defineResourceCollection,
  handler,
  sequencer,
  utility,
  resourceContentChangeSchema,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../../lib/models";

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
 * block-level `resources` declaration — declaring it here would form a
 * definition cycle with the collection's own `reactTo` binding below.
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
 * comes from the reaction's parent input (the content-change payload), since the
 * summarizer's output carries only the summary text.
 */
const saveSummary = handler({
  name: "save-artifact-summary",
  inputSchema: utility.summarizerOutputSchema,
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
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
 * that triggered it. `patchState` fires a state update, not a content write, so
 * saving the summary does not re-trigger this reaction.
 */
const summarizeArtifactReaction = sequencer({
  name: "summarize-artifact",
  inputSchema: resourceContentChangeSchema(),
}).work(summarizeArtifactBody);

// ---------------------------------------------------------------------------
// Resource collection
// ---------------------------------------------------------------------------

// client.content declares that content is readable and updatable by clients.
// client.data exposes title, summary, and updatedAt metadata in the snapshot
// without eagerly loading document bodies. reactTo.contentUpdated regenerates
// the summary from the body after each server-side content write.
export const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  scope: "session",
  stateSchema: artifactStateSchema,
  // Expose artifact bodies to the generic content search tools
  // (grepResourceContent / searchResources), so the agent can find artifacts by
  // their content. Read/write still flow through bash (the mounted filesystem),
  // so llmWritable stays off.
  llmReadable: true,
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
