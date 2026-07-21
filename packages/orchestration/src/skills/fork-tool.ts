/**
 * The model-facing **fork tool** for a per-generator skill binding.
 *
 * Installed by `presets({ fork: true })` on `createSkillsLibrary`. When the
 * model calls it, the tool resolves a `context: fork` skill from the binding's
 * `allowed` set, substitutes its body, and dispatches the fork subagent
 * generator (`createSkillForkGenerator`). The subagent inherits the
 * conversation history up to the fork point, does its bounded chunk of work in
 * isolation (`itemVisibility: { client: true, history: false }`), and returns
 * only its final result — the sole thing the parent generator sees.
 *
 * It is a `router` (not a handler) because dispatch + per-branch I/O adaptation
 * belongs inside a router (BP-013), and routing to a framework-native generator
 * lets the child stream its tool calls and text to the client for live
 * observability. This mirrors the fork branch the retiring session-global
 * `runSkill` router used to own — the fork tool is where it lives now, scoped
 * to one generator instead of the whole session.
 *
 * A binding rejects inline/pattern skills from the fork `allowed` set at build
 * time; this tool rejects them again at call time as a backstop.
 */

import { z } from "zod";
import { router } from "@flow-state-dev/core";
import type {
  BlockContext,
  MessageLimit,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import type { InitialSkill, SkillState, ToolCatalog } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";
import { listEnabledSkills } from "./internal/list-enabled-skills";
import { stripFrontmatter } from "./internal/strip-frontmatter";
import { ensureSeeded } from "./seeding";
import {
  createSkillForkGenerator,
  type SkillForkInput,
} from "./fork-generator";
import { substitute, toSkill, validateSkillName } from "./skill-md";
import path from "node:path";

// ---------------------------------------------------------------------------
// Tool I/O — mirrors the public fork shape the runSkill router returned.
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "The exact fork skill name. Must be one of the fork skills listed in this tool's description / the system context.",
    ),
  input: z
    .string()
    .optional()
    .describe(
      "Optional argument string passed to the skill. Substituted for $ARGUMENTS in the skill body.",
    ),
});

const outputSchema = z.object({
  skill: z.string(),
  mode: z.literal("fork"),
  result: z.unknown().optional(),
});

type ForkSkillInput = z.infer<typeof inputSchema>;
type ForkSkillOutput = z.infer<typeof outputSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ForkSkillToolOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Tool catalog fork subagents resolve `allowed-tools` against. */
  catalog: ToolCatalog;
  /**
   * Fork skill names the tool may run. `undefined` means any fork-mode skill in
   * the catalog. Names outside this set are rejected at call time.
   */
  allowed?: readonly string[];
  /** Bundled defaults, lazily seeded on first call. */
  initialSkills?: InitialSkill[];
  /** Mount root for `${SKILL_DIR}` substitution. Default `.fsdev/skills`. */
  mountPath?: string;
  /** Model the fork child runs on. */
  forkModelId?: string;
  /** Bound on the history the fork child inherits (whole turns, never split). */
  forkHistoryLimit?: MessageLimit;
}

function getRequiredCollection(
  ctx: BlockContext,
  key: string,
): ResourceCollectionRef {
  const collection = getCollection(ctx, key);
  if (!collection) {
    throw new Error(
      `Skills collection "${key}" is not registered on ctx.resources`,
    );
  }
  return collection;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the fork tool for a binding. Dispatches a `context: fork` skill to the
 * fork subagent generator and returns only its result.
 */
export function createForkSkillTool(opts: ForkSkillToolOptions) {
  const {
    collectionKey,
    catalog,
    allowed,
    initialSkills,
    mountPath = ".fsdev/skills",
    forkModelId,
    forkHistoryLimit,
  } = opts;
  const allowedSet = allowed ? new Set(allowed) : undefined;

  const forkGen = createSkillForkGenerator({
    catalog,
    ...(forkModelId !== undefined ? { defaultModelId: forkModelId } : {}),
    ...(forkHistoryLimit !== undefined ? { historyLimit: forkHistoryLimit } : {}),
  });

  return router({
    name: "forkSkill",
    description:
      "Fork a named skill into a child agent. The child inherits the conversation " +
      "so far, does a bounded chunk of work in isolation, and returns only its final " +
      "result — keeping your own context small. The list of fork skills is provided " +
      "in the system context; call this with one of those names.",
    inputSchema,
    outputSchema,
    routes: [forkGen] as never,
    execute: async (input: ForkSkillInput, ctx) => {
      validateSkillName(input.name);

      const collection = getRequiredCollection(ctx, collectionKey);
      await ensureSeeded(collection, initialSkills);

      if (allowedSet && !allowedSet.has(input.name)) {
        throw new Error(
          `Skill "${input.name}" is not in this generator's allowed fork set. Allowed: ${
            [...allowedSet].join(", ") || "(none)"
          }`,
        );
      }

      const manifest = await collection.getOptional(skillManifestKey(input.name));
      if (!manifest) {
        const enabled = await listEnabledSkills(collection);
        const available = enabled.map((s) => s.name).join(", ") || "(none)";
        throw new Error(`Unknown skill "${input.name}". Available: ${available}`);
      }

      const state = manifest.state as unknown as SkillState;
      if (state.disableModelInvocation) {
        throw new Error(
          `Skill "${input.name}" has \`disable-model-invocation: true\` and cannot be invoked by the agent`,
        );
      }

      const mode = state.contextMode ?? "inline";
      if (mode !== "fork") {
        throw new Error(
          `Skill "${input.name}" is a ${mode}-mode skill and cannot be forked. ` +
            `The fork tool only accepts context: fork skills.`,
        );
      }

      // Resolve the skill body + allowed tools now; the closure captures them so
      // connectInput can synthesize a full SkillForkInput from the raw input.
      const skill = toSkill(input.name, state, "");
      const rawBody = (await manifest.readContent()) ?? "";
      const substitutedBody = substitute(stripFrontmatter(rawBody), {
        arguments: input.input,
        skillDir: path.posix.join("/workspace", mountPath, input.name),
      });
      const allowedToolNames = skill.allowedTools ?? Object.keys(catalog);

      const skillName = input.name;
      return forkGen
        .connectInput(
          (_raw: ForkSkillInput): SkillForkInput => ({
            skillName,
            body: substitutedBody,
            allowedToolNames,
            ...(forkModelId !== undefined ? { modelId: forkModelId } : {}),
          }),
        )
        .connectOutput(
          (result: unknown): ForkSkillOutput => ({
            skill: skillName,
            mode: "fork" as const,
            result: result ?? null,
          }),
        ) as never;
    },
  });
}

// ---------------------------------------------------------------------------
// Catalog listing — what fork skills the model may call
// ---------------------------------------------------------------------------

export interface ForkCatalogContextOptions {
  collectionKey: string;
  allowed?: readonly string[];
  initialSkills?: InitialSkill[];
}

/**
 * Build the catalog-listing context entry the model reads to discover which
 * fork skills it can call. Filtered to the binding's `allowed` set (if any) and
 * to `fork`-mode skills — the fork tool rejects anything else, so listing them
 * would only invite a call that can't succeed.
 */
export function buildForkCatalogContext(
  opts: ForkCatalogContextOptions,
): (input: unknown, ctx: BlockContext) => Promise<string | null> {
  const allowedSet = opts.allowed ? new Set(opts.allowed) : undefined;
  return async (_input: unknown, ctx: BlockContext) => {
    const collection = getCollection(ctx, opts.collectionKey);
    if (!collection) return null;
    try {
      await ensureSeeded(collection, opts.initialSkills);
    } catch {
      // Seeding failure already logged.
    }
    const enabled = await listEnabledSkills(collection);
    const forkable = enabled.filter(
      (s) => s.mode === "fork" && (!allowedSet || allowedSet.has(s.name)),
    );
    if (forkable.length === 0) return null;
    const lines = [
      "You can fork any of these skills with the `forkSkill` tool. A fork runs the skill in a child agent that inherits this conversation and returns only its result:",
      "",
    ];
    for (const skill of forkable) lines.push(`- ${skill.name}: ${skill.description}`);
    return lines.join("\n");
  };
}
