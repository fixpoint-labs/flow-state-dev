/**
 * Artifacts capability — the generator-facing adapter over the artifact tools.
 *
 * Bundles the artifact resource + inventory context + read/write tools under a
 * single `uses: [artifactsCapability]` declaration. The tools, resource
 * collection, and the `saveArtifact` action itself live in `save-artifact.ts`
 * (the action's home in the by-action tree); this capability is built over them
 * — the dependency runs one way, capability → action tools, never the reverse.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  artifactResources,
  readArtifact,
  writeArtifact,
} from "../../save-artifact";

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
