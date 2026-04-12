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
import { createBashCapability } from "@flow-state-dev/tools/bash";
import { z } from "zod";
import { artifactResources, featuresSchema } from "../schemas";
import { artifactsCapability } from "./artifact-capability";
import { readArtifact, updateArtifact } from "./artifacts";
import path from "node:path";

const featuresSessionStateSchema = z.object({
  features: featuresSchema.default({}),
});

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
export const featuresCapability = defineCapability({
  name: "features",
  sessionStateSchema: featuresSessionStateSchema,

  uses: [
    // Conditionally include bash or artifact tools based on session feature flags
    (ctx) =>
      ctx.session.state.features.bashTool
        ? [bashCap, artifactsCapability.presets({ tools: false })]
        : [artifactsCapability],
  ],

  presets: {
    tools: {
      // When bash is disabled, provide artifact read/update tools + usage guidance
      tools: (ctx) => {
        if (ctx.session?.state?.features?.bashTool !== false) return [];
        return [readArtifact, updateArtifact];
      },
      context: [
        (_input, ctx) => {
          if (ctx.session?.state?.features?.bashTool !== false) return null;
          return [
            "You have access to artifacts and can read or create them:",
            "- Use read-artifact tool when users ask about existing artifacts or you need their content.",
            "- Use update-artifact tool when users explicitly ask you to create or save something.",
            "Create artifacts when asked — not speculatively.",
          ].join("\n");
        },
      ],
    },
    default: ["tools"],
  },
});
