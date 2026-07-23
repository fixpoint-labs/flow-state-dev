/**
 * Dynamic context formatter that prepends active-skill bodies to the
 * system prompt on every generator step.
 *
 * The capability registers this as a preset `context` entry. Because the
 * function-form context is dynamic, the generator's `prepareStep`
 * machinery re-runs it before each tool-loop step — so the moment
 * `runSkill` mutates `session.state.activeSkills`, the next step's
 * system prefix carries the matched skill body.
 *
 * Two parallel context entries are returned:
 *   1. The runSkill tool description — always present, lists currently
 *      enabled skill names so the agent can discover them.
 *   2. The active-skill body block — empty when no skill is active;
 *      otherwise concatenated bodies with `$ARGUMENTS` substituted.
 */

import type { BlockContext } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { readActiveSkills } from "./active-skill-state";
import { getCollection } from "./internal/get-collection";
import { renderActiveSkillBody } from "./render-skill-body";
import {
  buildRunSkillDescription,
  listEnabledSkills,
} from "./run-skill-tool";
import { ensureSeeded } from "./seeding";

export interface SkillsContextOptions {
  collectionKey: string;
  mountPath: string;
  /**
   * Bundled skill defaults, passed through from the capability factory.
   * When present, the catalog formatter seeds the collection on its first
   * render — without this, the catalog would be empty on the first turn
   * (seeding is otherwise triggered only inside `runSkill.execute`), and
   * the model would never see any skills to invoke in the first place.
   */
  initialSkills?: InitialSkill[];
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
    const collection = getCollection(ctx, opts.collectionKey);
    if (!collection) return null;
    // Seed on first render so the model sees the catalog on turn 1.
    // `ensureSeeded` is memoized per collection ref, so subsequent turns
    // are no-ops. If seeding fails, we surface an empty catalog rather
    // than blocking the turn — the warning is logged inside ensureSeeded.
    try {
      await ensureSeeded(collection, opts.initialSkills);
    } catch {
      // Seeding failure already logged; fall through with whatever the
      // collection contains (possibly empty).
    }
    const enabled = await listEnabledSkills(collection);
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
    const collection = getCollection(ctx, opts.collectionKey);
    if (!collection) return null;

    const blocks: string[] = [];
    for (const entry of active) {
      if (entry.mode !== "inline") continue;
      const block = await renderActiveSkillBody(
        collection,
        entry.name,
        opts.mountPath,
        entry.input,
      );
      if (block) blocks.push(block);
    }

    if (blocks.length === 0) return null;
    return [
      "The following skills are currently active. Follow their instructions for the rest of this turn.",
      "",
      ...blocks,
    ].join("\n");
  };
}
