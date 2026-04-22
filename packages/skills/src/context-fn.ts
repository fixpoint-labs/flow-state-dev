/**
 * Dynamic context formatter that prepends active-skill bodies to the
 * system prompt on every generator step.
 *
 * The capability registers this as a preset `context` entry. Because the
 * function-form context is dynamic, the generator's `prepareStep`
 * machinery re-runs it before each tool-loop step — so the moment
 * `runSkill` mutates `session.state.__activeSkills`, the next step's
 * system prefix carries the matched skill body.
 *
 * Two parallel context entries are returned:
 *   1. The runSkill tool description — always present, lists currently
 *      enabled skill names so the agent can discover them.
 *   2. The active-skill body block — empty when no skill is active;
 *      otherwise concatenated bodies with `$ARGUMENTS` substituted.
 */

import type {
  BlockContext,
  ResourceCollectionRef,
  ScopeType,
} from "@flow-state-dev/core/types";
import type { SkillState } from "@flow-state-dev/core";
import path from "node:path";
import { readActiveSkills } from "./active-skill-state";
import { skillManifestKey } from "./collection";
import {
  buildRunSkillDescription,
  listEnabledSkills,
} from "./run-skill-tool";
import { substitute } from "./skill-md";

export interface SkillsContextOptions {
  collectionKey: string;
  scope: ScopeType;
  mountPath: string;
}

/** Resolve the skills collection ref from the appropriate scope registry. */
function getCollection(
  ctx: BlockContext,
  scope: ScopeType,
  key: string,
): ResourceCollectionRef | undefined {
  const registry =
    scope === "session"
      ? ctx.session?.resources
      : scope === "user"
        ? ctx.user?.resources
        : ctx.project?.resources;
  if (!registry) return undefined;
  const list = (registry as { list: () => unknown[] }).list();
  for (const entry of list) {
    if (
      entry &&
      typeof entry === "object" &&
      "pattern" in (entry as object) &&
      "create" in (entry as object) &&
      // Match by either pattern prefix or registry key — both are stable.
      true
    ) {
      // The registry's `get` uses the key; we resolve by name to keep this
      // robust against scope-handle types that don't expose a typed get.
      const ref = entry as ResourceCollectionRef;
      if (ref.pattern.startsWith(`${key}/`)) return ref;
    }
  }
  // Fallback: try the typed get if the registry exposes it.
  const get = (registry as { get?: (k: string) => unknown }).get;
  if (typeof get === "function") {
    const ref = get.call(registry, key);
    if (ref && typeof ref === "object" && "pattern" in ref) {
      return ref as ResourceCollectionRef;
    }
  }
  return undefined;
}

/**
 * Build the runSkill tool catalog context entry. Returns the prose block
 * the agent reads to discover available skills.
 *
 * The function uses `any` for the ctx type to satisfy the framework's
 * `PresetContextEntry` signature (which is parameterized by session-state
 * shape, not full BlockContext) — at runtime, the resolver passes the
 * concrete BlockContext through.
 */
export function buildSkillsCatalogContext(
  opts: SkillsContextOptions,
): (input: unknown, ctx: any) => Promise<string | null> {
  return async (_input: unknown, ctx: BlockContext) => {
    const collection = getCollection(ctx, opts.scope, opts.collectionKey);
    if (!collection) return null;
    const enabled = listEnabledSkills(collection);
    return buildRunSkillDescription(enabled);
  };
}

/**
 * Build the active-skills context entry. When skills are active, returns a
 * `<active_skill name="...">...body...</active_skill>` block per active
 * skill (concatenated). Returns null when no skill is active so the
 * generator's slot resolution skips the entry.
 */
export function buildActiveSkillsContext(
  opts: SkillsContextOptions,
): (input: unknown, ctx: any) => Promise<string | null> {
  return async (_input: unknown, ctx: BlockContext) => {
    const active = readActiveSkills(ctx.session.state);
    if (active.length === 0) return null;
    const collection = getCollection(ctx, opts.scope, opts.collectionKey);
    if (!collection) return null;

    const blocks: string[] = [];
    for (const entry of active) {
      if (entry.mode !== "inline") continue;
      const manifest = collection.getOptional(skillManifestKey(entry.name));
      if (!manifest) continue;
      const raw = (await manifest.readContent()) ?? "";
      const body = stripFrontmatter(raw);
      const substituted = substitute(body, {
        arguments: entry.input,
        skillDir: path.posix.join("/workspace", opts.mountPath, entry.name),
      });
      const state = manifest.state as unknown as SkillState;
      const restriction = state.allowedTools && state.allowedTools.length > 0
        ? `\n(While this skill is active, only these tools are available: ${state.allowedTools.join(", ")}.)`
        : "";
      blocks.push(
        `<active_skill name="${entry.name}">\n${substituted}${restriction}\n</active_skill>`,
      );
    }

    if (blocks.length === 0) return null;
    return [
      "The following skills are currently active. Follow their instructions for the rest of this turn.",
      "",
      ...blocks,
    ].join("\n");
  };
}

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
