/**
 * Artifact capability — bundles artifact resources, context formatter, and
 * tool blocks under a single `uses: [artifactsCapability]` declaration.
 *
 * Replaces the manual pattern of spreading `artifactResources` into every
 * block config, wiring `artifactListContext` into generator context arrays,
 * and listing `readArtifact`/`updateArtifact` in tools arrays.
 *
 * Usage:
 *   generator({ uses: [artifactsCapability], model: "preset/fast", prompt: "..." })
 *   // → resources auto-installed, context formatter and tools available as presets
 */
import { defineCapability } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { artifactsCollection, artifactResources } from "../schemas";
import { readArtifact, writeArtifact } from "./artifacts";

/**
 * Context formatter that shows the artifact inventory (title + summary)
 * so the LLM knows what artifacts exist without reading full content.
 */
const artifactListContext = (_input: unknown, ctx: any) => {
  const artifacts = ctx.session.resources.artifacts as ResourceCollectionRef<{
    title: string;
    summary: string;
    updatedAt: number;
  }>;
  const instances = artifacts.list();
  if (instances.length === 0) {
    return "No artifacts exist yet in this session.";
  }
  const list = instances
    .map((ref: any) => {
      const id = ref.name.replace("artifacts/", "");
      const title = ref.state.title ?? "Untitled";
      const summary = ref.state.summary ? ` — ${ref.state.summary}` : "";
      return `- ${id}: ${title}${summary}`;
    })
    .join("\n");
  return `Current artifacts:\n${list}`;
};

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
  sessionResources: artifactResources,

  presets: {
    /** Context formatter: artifact title + summary inventory for the LLM. */
    inventory: {
      context: [artifactListContext],
    },
    /** Generator tools: read and write artifacts. */
    tools: {
      tools: [readArtifact, writeArtifact],
    },
    default: ["inventory", "tools"],
  },
});
