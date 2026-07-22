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
 * Skills is scoped to `itemVisibility: primary` so worker generators inside
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
  createSkillActivator,
  createSkillsLibrary,
  readSkillsDirectory,
  type SkillsBindingConfig,
} from "@flow-state-dev/orchestration";
import { z } from "zod";
import { modeSchema, featuresSchema } from "../schemas";
import { artifactsCapability } from "../artifacts";
import { selectBashProvider } from "./bash";
import { mcpCapability } from "../../../../lib/mcp";
import { researchCompany, competitorAnalysis } from "./skill-boards";
import path from "node:path";
import { fileURLToPath } from "node:url";

const featuresSessionStateSchema = z.object({
  mode: modeSchema,
  features: featuresSchema.default({}),
});

// Web tools — instantiated once, included conditionally by the features cap.
// agentControlsTier lets the model pick search depth per query (e.g. "deep").
const searchTool = search({ agentControlsTier: true });
const fetchTool = fetch();
const crawlTool = crawl();

// Skills — bundled defaults live in apps/kitchen-sink/skills. Loaded at
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
    console.warn(`[chat-agent] failed to load initial skill "${name}":`, error.message);
  }
}

// Skills v2 library (FIX-918). The catalog carries the leaf web tools plus the
// two board-backed team tools (`researchCompany`/`competitorAnalysis`) the
// migrated Shape-2 skills list under `allowed-tools`. `tech-brief` delegates via
// a declared `workers:` map, so binding it as `active` (below) installs its
// worker tool + a private task board automatically.
const skills = createSkillsLibrary({
  catalog: {
    search: searchTool,
    fetch: fetchTool,
    crawl: crawlTool,
    researchCompany,
    competitorAnalysis,
  },
  initialSkills,
  // User scope: skills are a per-user library that persists across sessions.
  // Org scope would be nicer for team-shared skills, but the chat-agent
  // flow has no project wiring yet — "org" falls through to an ambient
  // org with no persistence identity, which is why nothing seeds.
  scope: "user",
  // Main-agent only: in plan-and-execute / supervisor / blackboard, the
  // synthesizer carries skills while step-executors and workers don't.
  itemVisibility: { client: true, history: true },
});

// `createSkillsLibrary` returns the config-erased `DefinedCapability`, so
// `.with()` can't infer the binding shape at the call site. Author the binding
// as a checked `SkillsBindingConfig`, then bridge the erased signature with a
// cast (the object is still type-checked here, and re-validated by the binding
// schema at runtime). `tech-brief` is bound `active` so its delegation surface
// installs; the keyword/LLM activator feeds the rest through `activeSkills`.
const skillsBinding = {
  active: ["tech-brief"],
  activeState: { scope: "session", field: "activeSkills" },
} satisfies SkillsBindingConfig;

/**
 * skillActivatorBlock — the up-front skill-activation router.
 *
 * Runs once per turn before the main generator. Three tiers (slash prefix,
 * keyword scan over each skill's `keywords` frontmatter, LLM classifier)
 * decide which skills (if any) apply to the user message. Matched skills
 * are written into `session.state.activeSkills`, which the skills-library
 * binding reads (via its matching `activeState`) to inject the substituted
 * body into the system prompt under the `<skills>` tag.
 *
 * The `activeState` here mirrors the binding's `activeState` (§4.1) so the
 * matcher and the reader agree on where runtime activations live.
 */
export const skillActivatorBlock = createSkillActivator({
  activeState: { scope: "session", field: "activeSkills" },
});

// Bash capability — tools, guidance, and runtime auto-discovery of mounted
// collections. No resource declarations here: bash inherits whatever
// collections are installed on the block (artifacts from artifactsCapability,
// skills from the skills library binding) and mounts each at its pattern prefix. Writes
// under a mount's directory route back to that collection; files under
// /workspace/tmp/ are scratch; anything else is dropped with a warning.
//
// Provider is environment-selected (VERCEL → vercel sandbox,
// STORE_TYPE=filesystem → local shell, else → just-bash WASM with
// python + javascript). The just-bash default keeps preview environments
// self-contained so skills that exercise bash are testable without
// touching the host filesystem.
export const bashCap = createBashCapability({
  provider: selectBashProvider(),
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
 *   - skills (bound) — skills collection + catalog/team tools + skill bodies
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
    // Static: skills library binding — installs the skills collection resource
    // at build time (dynamic uses callbacks can't contribute resources) and
    // binds this generator to the catalog. Scoped to primary agents by the
    // library's own `itemVisibility` so worker generators in
    // plan-and-execute / supervisor / blackboard skip it. `tech-brief`'s
    // delegation surface installs because it's bound `active`; the Shape-2
    // team tools are activated on demand through the skill bodies. (The cast
    // bridges the config-erased `.with()` signature — see `skillsBinding`.)
    skills.with(skillsBinding as never),

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
