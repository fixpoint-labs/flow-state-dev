/**
 * Features capability — bundles the tool + context surface for the chat-agent flow.
 *
 * Consumers just declare `uses: [featuresCapability]`. The capability
 * pulls in everything a primary agent needs: bash + skills + artifacts
 * (inventory context, no direct tools — bash is the single write path) +
 * optionally MCP. Web tools are toggleable per-request via feature flags.
 *
 * Bash is always available so skills and patterns can rely on shell/Python
 * without having to branch on mode. Artifacts is attached with tools
 * disabled because the bash tool creates artifacts by writing to files
 * under the artifacts mount.
 *
 * Skills is scoped to `agentType: "primary"` so worker generators inside
 * plan-and-execute / supervisor / blackboard patterns don't replicate
 * skill bodies into their context. It's attached as a static `uses` entry
 * so the framework installs the skills collection resource at build time —
 * dynamic `uses` callbacks only contribute tools and context, not resources.
 */
import { defineCapability } from "@flow-state-dev/core";
import { createBashCapability } from "@flow-state-dev/tools/bash";
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";
import { crawl } from "@flow-state-dev/tools/crawl";
import {
  createIntentSelector,
  createSkillsCapability,
  readSkillsDirectory,
} from "@flow-state-dev/skills";
import { z } from "zod";
import { modeSchema, featuresSchema } from "../schemas";
import { artifactsCapability } from "./artifacts";
import { mcpCapability } from "../../../lib/mcp";
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

// Skills — bundled defaults live in apps/kitchen-sink/skills. Loaded at
// module init so ensureSeeded() can hydrate the collection on first runSkill
// invocation. Top-level await is supported here (Next.js, ESM).
const skillsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../skills",
);
const { skills: initialSkills, errors: skillsLoadErrors } =
  await readSkillsDirectory(skillsDir);
if (skillsLoadErrors.length > 0) {
  for (const { name, error } of skillsLoadErrors) {
    console.warn(`[chat-agent] failed to load initial skill "${name}":`, error.message);
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
  // Project scope would be nicer for team-shared skills, but the chat-agent
  // flow has no project wiring yet — "project" falls through to an ambient
  // project with no persistence identity, which is why nothing seeds.
  scope: "user",
  // Main-agent only: in plan-and-execute / supervisor / blackboard, the
  // synthesizer carries skills while step-executors and workers don't.
  agentType: "primary",
  // FIX-421: skill activation is decided up-front by `intentSelectorBlock`
  // below. Drop the runSkill tool + the catalog-listing context formatter
  // from the default presets — the active-skill body formatter stays so
  // activated skills still get their body injected. Saves the per-step
  // catalog prompt cost and avoids the redundant tool-call round trip.
  bindRunSkillTool: false,
});

/**
 * intentSelectorBlock — the up-front skill-activation router (FIX-421).
 *
 * Runs once per turn before the main generator. Three tiers (slash prefix,
 * keyword scan over each skill's `keywords` frontmatter, LLM classifier)
 * decide which skills (if any) apply to the user message. Matched skills
 * are written into `session.state.__activeSkills`, which the active-skill
 * body formatter on the skills capability reads to inject the substituted
 * body into the system prompt under the `<skills>` tag.
 *
 * Scope must match the skills capability above (`"user"`) so the tiers
 * read from the same collection that gets seeded.
 */
export const intentSelectorBlock = createIntentSelector({
  scope: "user",
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
 * Features capability — the single capability that provides all tools and
 * context to generators.
 *
 * Static dependencies:
 *   - skillsCap — skills collection + runSkill tool + catalog context
 *   - bashCap — shell/python execution, always available
 *   - artifactsCapability (inventory preset, tools disabled — bash writes
 *     artifacts via the mounted filesystem)
 *
 * Dynamic dependencies:
 *   - mcpCapability — attached only when servers are configured (null otherwise)
 *
 * Presets:
 *   - tools: web tools (search/fetch/crawl), each per-request feature-gated
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

    // Static: artifacts — inventory context only. Bash is the write path,
    // so readArtifact/updateArtifact tools are disabled here.
    artifactsCapability.presets({ inventory: true, tools: false }),

    // Static: bash — always available. Skills, Artifacts and patterns can rely on
    // shell/python without having to branch on mode.
    bashCap,

    // Dynamic: MCP attached only when servers are configured.
    () => (mcpCapability ? [mcpCapability] : []),
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
    },
    default: ["tools"],
  },
});
