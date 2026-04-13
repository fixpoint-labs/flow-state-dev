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
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { crawl } from "@flow-state-dev/tools/crawl";
import { z } from "zod";
import { featuresSchema } from "../schemas";
import { artifactResources, artifactsCapability } from "./artifacts";
import path from "node:path";

const featuresSessionStateSchema = z.object({
  features: featuresSchema.default({}),
});

// Web tools — instantiated once, included conditionally by the features cap.
const searchTool = search();
const fetchTool = fetch();
const crawlTool = crawl();

// Bash capability — tools, guidance, and resource declarations for the
// sandboxed bash workspace. Configured with full network access.
export const bashCap = createBashCapability({
  sessionResources: artifactResources,
  collectionKey: "artifacts",
  provider: {
    type: "local"
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
 *   - tools: artifact tools (when bash disabled) + web tools (search/fetch/crawl)
 */
export const featuresCapability = defineCapability({
  name: "features",
  sessionStateSchema: featuresSessionStateSchema,

  uses: [
    // Conditionally include bash or artifact tools based on session feature flags
    (ctx) =>
      ctx.session.state.features.bashTool
        ? [bashCap, artifactsCapability.presets({ inventory: true, tools: false })]
        : [artifactsCapability],
  ],

  presets: {
    tools: {
      tools: (ctx) => {
        const { features } = ctx.session.state;
        const tools: any[] = [];

        // Web tools — each gated by its feature flag
        if (features.search) tools.push(searchTool);
        if (features.fetch) tools.push(fetchTool);
        if (features.crawl) tools.push(crawlTool);

        return tools;
      },
      context: [
        (_input, ctx) => {
          if (ctx.session.state.features.bashTool) return null;
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
