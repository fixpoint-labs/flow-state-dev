/**
 * Features capability — bundles conditional tool selection for the kitchen-sink.
 *
 * Encapsulates the feature-flag logic that decides which tools and context
 * are available to generators. Consumers just declare `uses: [featuresCapability]`.
 *
 * When bash is enabled (default):
 *   - bashCapability tools + guidance are included
 *   - readArtifact/updateArtifact are excluded (bash is the single artifact path)
 *
 * When bash is disabled:
 *   - readArtifact/updateArtifact are included as fallback
 *   - no bash tools or guidance
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createBashCapability } from "@flow-state-dev/tools/bash";
import { z } from "zod";
import { artifactResources, featuresSchema } from "../schemas";
import { artifactsCapability } from "./artifact-capability";
import { readArtifact, updateArtifact } from "./artifacts";
import path from "node:path";

const featuresSessionStateSchema = z.object({
  features: featuresSchema.default({}),
});

type FeaturesCtx = BlockContext<any, z.infer<typeof featuresSessionStateSchema>, any, any>;

// Bash capability — tools, guidance, and resource declarations for the
// sandboxed bash workspace. Configured with full network access.
export const bashCap = createBashCapability({
  sessionResources: artifactResources,
  collectionKey: "artifacts",
  provider: {
    type: "just-bash",
    network: { dangerouslyAllowFullInternetAccess: true },
  },
  createState: (relativePath) => ({
    title: path.basename(relativePath),
    updatedAt: Date.now(),
  }),
});

/**
 * Features capability — the single capability that provides all
 * feature-gated tools and context to generators.
 *
 * Static dependencies:
 *   - artifactsCapability (tools disabled — we manage tool selection here)
 *
 * Dynamic dependencies:
 *   - bashCap — included only when the bash feature is enabled
 *
 * Presets:
 *   - tools: provides readArtifact/updateArtifact only when bash is disabled
 */
function isBashEnabled(ctx: FeaturesCtx): boolean {
  return ctx.session?.state?.features?.bashTool !== false;
}

export const featuresCapability = defineCapability({
  name: "features",
  sessionStateSchema: featuresSessionStateSchema,

  uses: [
    // Always install artifact resources + inventory context, but not artifact tools
    // (tool selection is handled by this capability's presets + dynamic uses)
    artifactsCapability.presets({ tools: false }) as any,

    // Conditionally include bash capability based on session feature flags
    ((ctx: FeaturesCtx) => isBashEnabled(ctx) ? [bashCap] : []) as any,
  ],

  presets: {
    tools: {
      // When bash is disabled, provide artifact read/update tools + usage guidance
      tools: ((ctx: FeaturesCtx) => {
        if (isBashEnabled(ctx)) return [];
        return [readArtifact, updateArtifact];
      }) as any,
      context: [
        (_input: unknown, ctx: FeaturesCtx) => {
          if (isBashEnabled(ctx)) return null;
          return [
            "You have access to artifacts and can read or create them:",
            "- Use read-artifact when users ask about existing artifacts or you need their content.",
            "- Use update-artifact when users explicitly ask you to create or save something.",
            "Create artifacts when asked — not speculatively.",
          ].join("\n");
        },
      ],
    },
    default: ["tools"],
  },
});
