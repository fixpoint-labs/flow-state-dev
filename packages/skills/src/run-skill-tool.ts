/**
 * The `runSkill` handler — the agent's entry point into the skills system.
 *
 * Skills are NOT auto-matched. The model decides when a skill applies by
 * calling this tool with `name` (and optionally `input`). The tool resolves
 * the skill from the configured collection, dispatches to inline or fork
 * mode based on `context:` frontmatter, and returns either an
 * acknowledgment (inline) or a structured subagent result (fork).
 *
 * The dynamic tool `description` is built from the active skill catalog at
 * call time so the model sees only currently-enabled skill names. The
 * generator's `describeTools` pipeline picks this up and surfaces it in
 * the tool documentation injected into the system prompt.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import type {
  InitialSkill,
  SkillState,
  ToolCatalog,
} from "@flow-state-dev/core";
import {
  pushActiveSkill,
  readActiveSkills,
  type ActiveSkillEntry,
} from "./active-skill-state";
import { skillManifestKey } from "./collection";
import { ensureSeeded } from "./seeding";
import { runSkillFork } from "./fork-runner";
import { substitute, toSkill, validateSkillName } from "./skill-md";
import path from "node:path";

// ---------------------------------------------------------------------------
// Tool I/O
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "The exact skill name (matches the directory under skills/). Must be one of the names listed in this tool's description.",
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
  mode: z.enum(["inline", "fork"]),
  message: z.string().optional(),
  result: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RunSkillToolOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Scope to look the collection up under (`session`/`user`/`project`). */
  scope: ScopeType;
  /** Tool catalog used by fork-mode subagents to resolve `allowed-tools`. */
  catalog: ToolCatalog;
  /** Default-on initial skills, lazily seeded on first invocation. */
  initialSkills?: InitialSkill[];
  /** Mount root for `${CLAUDE_SKILL_DIR}` substitution. Default `.fsdev/skills`. */
  mountPath?: string;
  /** Optional override of the default model used by fork-mode subagents. */
  forkModelId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCollection(
  ctx: BlockContext,
  scope: ScopeType,
  key: string,
): ResourceCollectionRef {
  const registry =
    scope === "session"
      ? ctx.session?.resources
      : scope === "user"
        ? ctx.user?.resources
        : ctx.project?.resources;
  if (!registry) {
    throw new Error(
      `Skills collection requires the ${scope} scope to be configured`,
    );
  }
  const ref = (registry as { get: (k: string) => unknown }).get(key);
  if (!ref) {
    throw new Error(
      `Skills collection "${key}" is not registered in the ${scope} scope`,
    );
  }
  return ref as ResourceCollectionRef;
}

/** List enabled (non-disabled) skill names + descriptions for the tool surface. */
export function listEnabledSkills(
  collection: ResourceCollectionRef,
): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();
  for (const ref of collection.list()) {
    // The collection holds a mix of SKILL.md manifests and supporting files.
    // Manifests have keys ending in `/SKILL.md` once stripped of the prefix.
    if (!ref.name.endsWith("/SKILL.md")) continue;
    const state = ref.state as unknown as SkillState;
    if (state.disableModelInvocation) continue;
    // Extract skill name from the storage key — strip prefix and `/SKILL.md`.
    const segments = ref.name.split("/");
    if (segments.length < 2) continue;
    const name = segments[segments.length - 2]!;
    if (seen.has(name)) continue;
    seen.add(name);
    let desc = state.description ?? "";
    if (state.whenToUse) desc = `${desc}\n${state.whenToUse}`;
    out.push({ name, description: desc });
  }
  return out;
}

/**
 * Build the runSkill tool's dynamic description listing available skills.
 * Returns a stable string so the model sees the same enum on every step.
 */
export function buildRunSkillDescription(
  enabled: Array<{ name: string; description: string }>,
): string {
  if (enabled.length === 0) {
    return "No skills are currently available — this tool will reject any invocation.";
  }
  const lines = [
    "Invoke a domain-specific skill by name. Skills are pre-authored playbooks that load specialized instructions and (optionally) extra tools when activated.",
    "",
    "Available skills:",
  ];
  for (const skill of enabled) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }
  lines.push(
    "",
    "Pass the skill name in `name`. Pass any required argument string in `input` (substituted for $ARGUMENTS in the skill body).",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the `runSkill` handler block configured against a specific
 * collection scope and tool catalog. The returned block is a normal
 * `BlockDefinition` and may be used wherever `GeneratorTool` is accepted.
 */
export function createRunSkillTool(opts: RunSkillToolOptions) {
  const {
    collectionKey,
    scope,
    catalog,
    initialSkills,
    mountPath = ".fsdev/skills",
    forkModelId,
  } = opts;

  return handler({
    name: "runSkill",
    description:
      "Invoke a named skill. The list of available skills is provided in the system context — call this tool with one of those names to activate it.",
    inputSchema,
    outputSchema,
    execute: async (input: z.infer<typeof inputSchema>, ctx: BlockContext) => {
      validateSkillName(input.name);

      const collection = getCollection(ctx, scope, collectionKey);
      // Lazy seed on first invocation per process. ensureSeeded is memoized
      // via WeakMap on the collection ref, so this is a no-op after the
      // initial pass.
      await ensureSeeded(collection, initialSkills);

      const manifestKey = skillManifestKey(input.name);
      const manifest = collection.getOptional(manifestKey);
      if (!manifest) {
        const enabled = listEnabledSkills(collection);
        const available = enabled.map((s) => s.name).join(", ") || "(none)";
        throw new Error(
          `Unknown skill "${input.name}". Available: ${available}`,
        );
      }

      const state = manifest.state as unknown as SkillState;
      if (state.disableModelInvocation) {
        throw new Error(
          `Skill "${input.name}" has \`disable-model-invocation: true\` and cannot be invoked by the agent`,
        );
      }

      const mode = state.contextMode ?? "inline";
      const skill = toSkill(input.name, state, "");

      if (mode === "inline") {
        // Activation in inline mode is just a state mutation. The next
        // step's prepareStep re-resolves the dynamic context formatter,
        // which reads `__activeSkills` and prepends the substituted body.
        const current = readActiveSkills(ctx.session.state);
        const entry: ActiveSkillEntry = {
          name: input.name,
          mode: "inline",
          input: input.input,
          activatedAt: Date.now(),
        };
        const next = pushActiveSkill(current, entry);
        await ctx.session.patchState({ __activeSkills: next } as never);
        return {
          skill: input.name,
          mode: "inline" as const,
          message: `Skill "${input.name}" activated. Its instructions are now in your system context — re-read it before proceeding.`,
        };
      }

      // Fork mode: read the body, substitute, dispatch to subagent.
      const body = (await manifest.readContent()) ?? "";
      const substituted = substitute(stripFrontmatter(body), {
        arguments: input.input,
        skillDir: path.posix.join("/workspace", mountPath, input.name),
      });

      const result = await runSkillFork(ctx, {
        skill,
        body: substituted,
        catalog,
        modelId: forkModelId,
      });

      return { skill: input.name, mode: "fork" as const, result };
    },
  });
}

/** Strip a leading `---`-delimited frontmatter block from a SKILL.md body. */
function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return lines.slice(i + 1).join("\n").replace(/^\r?\n/, "");
    }
  }
  return text;
}
