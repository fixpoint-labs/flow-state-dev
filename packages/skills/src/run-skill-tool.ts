/**
 * The `runSkill` tool — the agent's entry point into the skills system.
 *
 * Skills are NOT auto-matched. The model decides when a skill applies by
 * calling this tool with `name` (and optionally `input`). The tool resolves
 * the skill from the configured collection and dispatches to:
 *   - `inlineActivate` (handler) — patches `__activeSkills` so the next
 *     generator step renders the substituted body in its system prompt.
 *   - `skillFork` (generator, `agentType: "sub"`) — runs the skill body as
 *     a subagent with a resolved subset of catalog tools.
 *
 * The tool is a `router` rather than a handler: dispatch + per-branch
 * input/output adaptation belongs inside a router (BP-013), and routing to
 * a framework-native generator lets fork mode stream tool calls and text
 * to the client in real time for DevTool observability — a concrete win
 * over the previous hand-rolled `model.generate(...)` shortcut.
 *
 * The dynamic tool `description` is built from the active skill catalog at
 * call time so the model sees only currently-enabled skill names.
 */

import { z } from "zod";
import { router } from "@flow-state-dev/core";
import type {
  BlockContext,
  BlockDefinition,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import type {
  InitialSkill,
  SkillState,
  ToolCatalog,
} from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { ensureSeeded } from "./seeding";
import {
  createSkillForkGenerator,
  type SkillForkInput,
} from "./fork-generator";
import { inlineActivate } from "./inline-activate";
import { substitute, toSkill, validateSkillName } from "./skill-md";
import path from "node:path";

// ---------------------------------------------------------------------------
// Tool I/O — public surface unchanged from the prior handler implementation
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

type RunSkillInput = z.infer<typeof inputSchema>;
type RunSkillOutput = z.infer<typeof outputSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RunSkillToolOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Scope to look the collection up under (`session`/`user`/`org`). */
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
// Helpers — retained for re-export and test use
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
        : ctx.org?.resources;
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
    "",
    "Users may also invoke a skill directly with a slash command: when the user's message begins with `/<skill-name>` followed by an optional argument (e.g. `/check-news quantum computing`), treat it as an explicit instruction to call `runSkill` with that name and the remainder of the message as `input`. Do this on the first step of your response, before any other tool call.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the `runSkill` router tool configured against a specific collection
 * scope and tool catalog. Returns a `BlockDefinition` usable as a
 * `GeneratorTool` (router + handler + generator all satisfy the surface).
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

  const forkGen = createSkillForkGenerator({
    catalog,
    defaultModelId: forkModelId,
  });

  return router({
    name: "runSkill",
    description:
      "Invoke a named skill. The list of available skills is provided in the system context — call this tool with one of those names to activate it.",
    inputSchema,
    outputSchema,
    routes: [inlineActivate, forkGen] as unknown as Array<
      BlockDefinition<typeof inputSchema, typeof outputSchema>
    >,
    execute: async (input: RunSkillInput, ctx) => {
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
      if (mode === "inline") {
        // Inline branch: adapt input shape and pass output through as the
        // router's output (it already matches RunSkillOutput).
        return inlineActivate.connectInput(
          (raw: RunSkillInput) => ({
            skillName: raw.name,
            input: raw.input,
          }),
        ) as unknown as BlockDefinition<typeof inputSchema, typeof outputSchema>;
      }

      // Fork branch: resolve the skill body + allowed tools now (closure
      // captures these so connectInput can synthesize a full SkillForkInput
      // from the router's raw input at subagent invocation time).
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
          (_raw: RunSkillInput): SkillForkInput => ({
            skillName,
            body: substitutedBody,
            allowedToolNames,
            modelId: forkModelId,
          }),
        )
        .connectOutput(
          (result: unknown): RunSkillOutput => ({
            skill: skillName,
            mode: "fork" as const,
            result: result ?? null,
          }),
        ) as unknown as BlockDefinition<typeof inputSchema, typeof outputSchema>;
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
