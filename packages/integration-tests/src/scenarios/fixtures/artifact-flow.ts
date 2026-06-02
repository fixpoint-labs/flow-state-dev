/**
 * Build-mode fixture flow for the artifact-creation scenario.
 *
 * The flow declares a session-scoped artifact collection and exposes a
 * single `writeArtifact` tool that writes to it. A primary generator
 * pulls the request through the artifact write path. Mocking the
 * generator with a `writeArtifact` tool call exercises the resource
 * mutation and the resulting `resource_change` SSE event.
 *
 * Kitchen-sink's chat-agent uses bash for artifact writes — too coupled
 * to a runtime environment to reproduce in a unit test. This fixture
 * isolates the artifact resource pattern from app-specific plumbing.
 */
import {
  defineFlow,
  defineResourceCollection,
  generator,
  handler,
  sequencer,
  utility
} from "@flow-state-dev/core";
import { z } from "zod";

const buildInputSchema = z.object({
  message: z.string().min(1)
});

const artifactStateSchema = z.object({
  title: z.string(),
  updatedAt: z.number()
});

const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  scope: "session",
  stateSchema: artifactStateSchema
});

const artifactResources = { artifacts: artifactsCollection };

const writeArtifactInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

const upsertArtifact = utility.upsertResource({
  name: "upsert-artifact",
  inputSchema: writeArtifactInputSchema,
  resources: artifactResources,
  collectionKey: "artifacts",
  key: (input) => input.id,
  state: (input) => ({
    title: input.title,
    updatedAt: Date.now()
  }),
  content: (input) => input.content
});

const writeArtifactConfirm = handler({
  name: "write-artifact-confirm",
  inputSchema: writeArtifactInputSchema,
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: (input) => ({ success: true, id: input.id })
});

const writeArtifact = sequencer({
  name: "write-artifact",
  description: "Create or update a session artifact.",
  inputSchema: writeArtifactInputSchema
})
  .tap(upsertArtifact)
  .step(writeArtifactConfirm);

const builderGenerator = generator({
  name: "builder-generator",
  model: "intent/synthesize",
  prompt: "You build artifacts in response to user requests.",
  inputSchema: buildInputSchema,
  user: (input) => input.message,
  outputSchema: z.string(),
  tools: [writeArtifact],
  resources: artifactResources,
  itemVisibility: { client: true, history: true },
  maxIterations: 4
});

const buildPipeline = sequencer({ name: "build-pipeline", inputSchema: buildInputSchema })
  .step(builderGenerator);

const artifactFlow = defineFlow({
  kind: "test-artifact",
  requireUser: true,
  actions: {
    build: {
      inputSchema: buildInputSchema,
      block: buildPipeline,
      userMessage: (input) => input.message
    }
  },
  resources: artifactResources,
  session: {
    stateSchema: z.object({})
  }
});

export default artifactFlow({ id: "default" });
