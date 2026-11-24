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
import { skillActivationSourceSchema } from "./skill-activation-types";

// FIX-918; BP-030.
/**
 * Zod schema for a single active-skill array field. Reused by the v2
 * per-generator binding (`skills.config({ activeState })` contributes this
 * as the field schema at the chosen scope, and a block-state default binds it
 * onto the generator's own `stateSchema`) and by the legacy session-state
 * fragment below.
 *
 * `mode` is `"inline"` — the only surviving value. A persisted
 * session from before the fork/pattern removal may carry a stale
 * `"fork"`/`"pattern"` entry; those are tolerated on read (`.catch`) and
 * normalized to `"inline"` so a resume never crashes. The entries are
 * inert either way — nothing reads `mode` other than the inline path.
 */
export const activeSkillsArraySchema = z
  .array(
    z.object({
      /** Name of the skill directory in the collection. */
      name: z.string(),
      mode: z
        .enum(["inline", "fork", "pattern"])
        .catch("inline")
        .transform(() => "inline" as const),
      /** Substituted for $ARGUMENTS in the skill body. */
      input: z.string().optional(),
      /** Milliseconds since epoch. */
      activatedAt: z.number(),
      /** Set by the up-front matcher; model-initiated activations leave this absent. */
      source: skillActivationSourceSchema.optional(),
    }),
  )
  .optional()
  .default([]);

/** A single active-skill record stored in state. */
export type ActiveSkillEntry = z.infer<typeof activeSkillsArraySchema>[number];

/** Zod schema for the session-state fragment the capability declares. */
export const activeSkillStateSchema = z.object({
  activeSkills: activeSkillsArraySchema,
});

/** Read the active-skills array from a session-state-like object. */
export function readActiveSkills(state: unknown, field = "activeSkills"): ActiveSkillEntry[] {
  if (state === null || typeof state !== "object") return [];
  const entries = (state as Record<string, unknown>)[field];
  if (!Array.isArray(entries)) return [];
  return entries;
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
