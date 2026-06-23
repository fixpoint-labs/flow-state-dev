/**
 * Artifacts capability — the thin adapter that bundles the concern for
 * generators.
 *
 * Composes the resource, the read/write tools, and the inventory context
 * formatter into a single `uses: [artifactsCapability]` declaration. The
 * dependency runs one way: capability → resource/tools/context, never the
 * reverse.
 */
import { defineCapability } from "@flow-state-dev/core";
import { artifactResources } from "./resource";
import { readArtifact, writeArtifact } from "./tools";
import { artifactListContext } from "./context";

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
