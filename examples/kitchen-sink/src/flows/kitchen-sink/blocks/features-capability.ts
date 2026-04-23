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
 *
 * Skills are always available on main agents. The capability is scoped to
 * `agentType: "primary"` so worker generators inside plan-and-execute /
 * supervisor / blackboard patterns don't replicate skill bodies into their
 * context. It's attached as a static `uses` entry so the framework installs
 * the skills collection resource at build time — dynamic `uses` callbacks
 * only contribute tools and context, not resources.
 */
import { defineCapability, type CapabilityRef } from "@flow-state-dev/core";
import { createBashCapability } from "@flow-state-dev/tools/bash";
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { crawl } from "@flow-state-dev/tools/crawl";
import { createSkillsCapability, readSkillsDirectory } from "@flow-state-dev/skills";
import { z } from "zod";
import { modeSchema, featuresSchema } from "../schemas";
import { artifactsCapability } from "./artifacts";
import { mcpCapability } from "../../../../lib/mcp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const featuresSessionStateSchema = z.object({
  mode: modeSchema,
  features: featuresSchema.default({}),
});

// Web tools — instantiated once, included conditionally by the features cap.
const searchTool = search();
const fetchTool = fetch();
const crawlTool = crawl();

// Skills — bundled defaults live in examples/kitchen-sink/skills. Loaded at
// module init so ensureSeeded() can hydrate the collection on first runSkill
// invocation. Top-level await is supported here (Next.js, ESM).
const skillsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../skills",
);
const { skills: initialSkills, errors: skillsLoadErrors } =
  await readSkillsDirectory(skillsDir);
if (skillsLoadErrors.length > 0) {
  for (const { name, error } of skillsLoadErrors) {
    console.warn(`[kitchen-sink] failed to load initial skill "${name}":`, error.message);
  }
}

const skillsCap = createSkillsCapability({
  catalog: {
    search: searchTool,
    fetch: fetchTool,
    crawl: crawlTool,
  },
  initialSkills,
  // User scope: skills are a per-user library that persists across sessions.
  // Project scope would be nicer for team-shared skills, but the kitchen-sink
  // flow has no project wiring yet — "project" falls through to an ambient
  // project with no persistence identity, which is why nothing seeds.
  scope: "user",
  // Main-agent only: in plan-and-execute / supervisor / blackboard, the
  // synthesizer carries skills while step-executors and workers don't.
  agentType: "primary",
});

// Bash capability — tools, guidance, and runtime auto-discovery of mounted
// collections. No resource declarations here: bash inherits whatever
// collections are installed on the block (artifacts from artifactsCapability,
// skills from skillsCap) and mounts each at its pattern prefix. Writes
// under a mount's directory route back to that collection; files under
// /workspace/tmp/ are scratch; anything else is dropped with a warning.
export const bashCap = createBashCapability({
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
    // Static: skills capability — installs the skills collection resource at
    // build time (dynamic uses callbacks can't contribute resources). Scoped
    // to primary agents by the capability's own `agentType` so worker
    // generators in plan-and-execute / supervisor / blackboard skip it.
    skillsCap,

    // Dynamic: mode- and feature-gated tools/context.
    // Bash vs. artifact tools depends on mode + bashTool flag.
    // MCP capability included when servers are configured (null when absent).
    (ctx) => {
      const bashEnabled =
        ctx.session.state.mode === "build" && ctx.session.state.features.bashTool;
      const caps: CapabilityRef[] = bashEnabled
        ? [bashCap, artifactsCapability.presets({ inventory: true, tools: false })]
        : [artifactsCapability];
      if (mcpCapability) caps.push(mcpCapability);
      return caps;
    },
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
          // Bash is only active in Build mode with the feature flag enabled.
          const bashActive =
            ctx.session.state.mode === "build" && ctx.session.state.features.bashTool;
          if (bashActive) return null;
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
