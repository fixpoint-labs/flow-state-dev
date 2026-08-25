/**
 * Helpers for reading and mutating the per-session "active skills" state.
 *
 * Active skills live in session state under the `activeSkills` key (an
 * array of `ActiveSkillEntry` records) so dynamic context formatters can
 * read them without needing access to a sequencer scope. We intentionally
 * use session state — not request — so a multi-step request shares the
 * activation set across iterations of the generator's tool loop.
 *
 * V1 deactivation policy: skills remain active for the lifetime of the
 * session unless explicitly deactivated. This is the simplest correct
 * behavior for the expected use case (one-shot or short multi-turn flows).
 */

import { z } from "zod";
import type { SkillActivationSource, SkillContextMode } from "@flow-state-dev/core";
import { skillActivationSourceSchema } from "./skill-activation-types";

/** A single active-skill record stored in session state. */
export interface ActiveSkillEntry {
  /** Skill name. Matches the parent directory in the resource collection. */
  name: string;
  /** Mode the skill activated in. Always `"inline"` after FIX-918. */
  mode: SkillContextMode;
  /** Argument string the agent passed to runSkill (substituted for $ARGUMENTS). */
  input?: string;
  /** ms-since-epoch the skill was activated. */
  activatedAt: number;
  /**
   * Which path activated this skill. Set by `skillActivator` (slash /
   * keyword / classifier / manual-override). `runSkill`-driven activations
   * leave this undefined since the model decided mid-flow rather than the
   * up-front router.
   */
  source?: SkillActivationSource;
}

/**
 * Zod schema for a single active-skill array field. Reused by the v2
 * per-generator binding (`skills.config({ activeState })` contributes this
 * as the field schema at the chosen scope, and a block-state default binds it
 * onto the generator's own `stateSchema`) and by the legacy session-state
 * fragment below.
 *
 * `mode` is `"inline"` — the only surviving value after FIX-918. A persisted
 * session from before the fork/pattern removal may carry a stale
 * `"fork"`/`"pattern"` entry; those are tolerated on read (`.catch`) and
 * normalized to `"inline"` so a resume never crashes (BP-030). The entries are
 * inert either way — nothing reads `mode` other than the inline path.
 */
export const activeSkillsArraySchema = z
  .array(
    z.object({
      name: z.string(),
      mode: z
        .enum(["inline", "fork", "pattern"])
        .catch("inline")
        .transform(() => "inline" as const),
      input: z.string().optional(),
      activatedAt: z.number(),
      source: skillActivationSourceSchema.optional(),
    }),
  )
  .optional()
  .default([]);

/** Zod schema for the session-state fragment the capability declares. */
export const activeSkillStateSchema = z.object({
  activeSkills: activeSkillsArraySchema,
});

/** Read the active-skills array from a session-state-like object. */
export function readActiveSkills(state: unknown): ActiveSkillEntry[] {
  if (state === null || typeof state !== "object") return [];
  const entries = (state as { activeSkills?: unknown }).activeSkills;
  if (!Array.isArray(entries)) return [];
  return entries as ActiveSkillEntry[];
}

/**
 * Append (or replace, if same name and mode) an active-skill record.
 * Pure — caller is responsible for persisting the returned array.
 */
export function pushActiveSkill(
  current: ActiveSkillEntry[],
  next: ActiveSkillEntry,
): ActiveSkillEntry[] {
  const filtered = current.filter(
    (e) => !(e.name === next.name && e.mode === next.mode),
  );
  return [...filtered, next];
}

/** Compute the union of `allowed-tools` across the active-skill set. */
export function unionAllowedTools(
  active: ActiveSkillEntry[],
  perSkillAllowed: Record<string, string[] | undefined>,
): string[] | undefined {
  const inline = active.filter((e) => e.mode === "inline");
  if (inline.length === 0) return undefined;
  const out = new Set<string>();
  let anyDeclared = false;
  for (const entry of inline) {
    // BP-031: a skill name is caller/authoring-supplied, so a plain `[]` lookup could
    // resolve an inherited `Object.prototype` member (e.g. "constructor",
    // whose `.length` is its arity, so it passes the guard below and then
    // fails to iterate). Require an own property first, which makes such a
    // name behave as "declares no allowed-tools" (FIX-972, same as FIX-943).
    const list = Object.hasOwn(perSkillAllowed, entry.name)
      ? perSkillAllowed[entry.name]
      : undefined;
    if (list && list.length > 0) {
      anyDeclared = true;
      for (const t of list) out.add(t);
    }
  }
  // If no active inline skill declared `allowed-tools`, treat as unrestricted.
  return anyDeclared ? Array.from(out) : undefined;
}
