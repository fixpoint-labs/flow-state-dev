/**
 * The per-generator binding **reader** — the dynamic context entry that
 * injects a generator's active skill bodies into its system prompt.
 *
 * It renders two sources, both scoped to the one generator this binding is
 * attached to:
 *
 *   1. **Static `active`** skills — preloaded by config, rendered on every
 *      step. These are fixed at build time.
 *   2. **Dynamic `activeState`** entries — skills activated at runtime (by the
 *      load tool, an upstream matcher, or code), read from the binding's
 *      {@link ActivationLocation}. Only `inline`-mode entries render;
 *      `fork` / `pattern` entries are dispatch concerns and are skipped.
 *
 * The reader is a function-form context entry, so the generator's `prepareStep`
 * re-runs it before every tool-loop step. That is deliberate: a skill the load
 * tool writes mid-loop injects on the *next* step of the same execution. The
 * combined `active + activeState` result is therefore never memoized — doing so
 * would stale out dynamic activation.
 */

import type { BlockContext } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { readActivations, type ActivationLocation } from "./activation-store";
import { getCollection } from "./internal/get-collection";
import { renderActiveSkillBody } from "./render-skill-body";
import { ensureSeeded } from "./seeding";

export interface SkillBindingReaderOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Workspace mount prefix for `${SKILL_DIR}` substitution. */
  mountPath: string;
  /** Statically-preloaded skill names (config `active`). Rendered every step. */
  active?: readonly string[];
  /** Where dynamic activations live for this binding. */
  location: ActivationLocation;
  /**
   * Bundled defaults so the reader can seed the collection on its first render
   * — otherwise a static-only binding (or one with the load-tool preset off)
   * scans an empty catalog on turn 1 and renders nothing.
   */
  initialSkills?: InitialSkill[];
}

/**
 * Build the reader context entry for a per-generator skill binding.
 * Returns `null` when the binding contributes no active skills (so the
 * generator's slot resolution skips the entry).
 */
export function buildSkillBindingReader(
  opts: SkillBindingReaderOptions,
): (input: unknown, ctx: BlockContext) => Promise<string | null> {
  const staticActive = opts.active ?? [];
  return async (_input: unknown, ctx: BlockContext) => {
    const collection = getCollection(ctx, opts.collectionKey);
    if (!collection) return null;
    // Seed on first render so static bodies resolve on turn 1. Idempotent and
    // memoized per collection ref; failures fall through with an empty catalog.
    try {
      await ensureSeeded(collection, opts.initialSkills);
    } catch {
      // Seeding failure already logged inside ensureSeeded.
    }

    const rendered = new Set<string>();
    const blocks: string[] = [];

    // Dynamic (inline) activations carry an `input` for `$ARGUMENTS`; a static
    // `active` copy of the same skill does not. When a name appears in both, the
    // dynamic entry wins so the argument-bearing body is what renders — a static
    // copy rendered first would otherwise dedupe out the loaded arguments.
    const dynamicEntries = readActivations(ctx, opts.location).filter(
      (e) => e.mode === "inline",
    );
    const dynamicNames = new Set(dynamicEntries.map((e) => e.name));

    // 1. Static preloaded skills (no runtime input) — unless superseded by a
    //    dynamic activation of the same name (rendered below with its input).
    for (const name of staticActive) {
      if (rendered.has(name) || dynamicNames.has(name)) continue;
      const block = await renderActiveSkillBody(collection, name, opts.mountPath, undefined);
      if (block) {
        rendered.add(name);
        blocks.push(block);
      }
    }

    // 2. Dynamic activations — inline mode only. Preserve each entry's input
    //    (substituted into `$ARGUMENTS`); fork/pattern entries are dispatch
    //    concerns and never render as context.
    for (const entry of dynamicEntries) {
      if (rendered.has(entry.name)) continue;
      const block = await renderActiveSkillBody(
        collection,
        entry.name,
        opts.mountPath,
        entry.input,
      );
      if (block) {
        rendered.add(entry.name);
        blocks.push(block);
      }
    }

    if (blocks.length === 0) return null;
    return [
      "The following skills are active. Follow their instructions for the rest of this turn.",
      "",
      ...blocks,
    ].join("\n");
  };
}
