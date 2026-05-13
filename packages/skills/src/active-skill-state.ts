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
import type { IntentSource, SkillContextMode } from "@flow-state-dev/core";
import { intentSourceSchema } from "./intent-types";

/** A single active-skill record stored in session state. */
export interface ActiveSkillEntry {
  /** Skill name. Matches the parent directory in the resource collection. */
  name: string;
  /** Mode the skill activated in. */
  mode: SkillContextMode;
  /** Argument string the agent passed to runSkill (substituted for $ARGUMENTS). */
  input?: string;
  /** ms-since-epoch the skill was activated. */
  activatedAt: number;
  /**
   * Which path activated this skill. Set by `intentSelector` (slash /
   * keyword / classifier / manual-override). `runSkill`-driven activations
   * leave this undefined since the model decided mid-flow rather than the
   * up-front router.
   */
  source?: IntentSource;
  /**
   * Set when `mode === "pattern"`. Carries enough info for the
   * `taskTools` capability to reconstruct the live TaskCollection from
   * any block context via `getOrCreateTaskCollection`.
   */
  pattern?: ActivePatternMeta;
}

/** Metadata describing the live pattern run a `pattern`-mode entry refers to. */
export interface ActivePatternMeta {
  /** Pattern key (e.g. `"task-board"`). */
  patternKey: string;
  /** TaskCollection id used at activation time. */
  collectionId: string;
  /** Backing kind so the helper can call getOrCreateTaskCollection correctly. */
  backing: "request" | "resource";
  /**
   * Resource registry key for the backing collection when `backing === "resource"`.
   * Undefined for the request backing.
   */
  resourceCollectionKey?: string;
}

/** Zod schema for the session-state fragment the capability declares. */
export const activeSkillStateSchema = z.object({
  activeSkills: z
    .array(
      z.object({
        name: z.string(),
        mode: z.enum(["inline", "fork", "pattern"]),
        input: z.string().optional(),
        activatedAt: z.number(),
        source: intentSourceSchema.optional(),
        pattern: z
          .object({
            patternKey: z.string(),
            collectionId: z.string(),
            backing: z.enum(["request", "resource"]),
            resourceCollectionKey: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional()
    .default([]),
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
    const list = perSkillAllowed[entry.name];
    if (list && list.length > 0) {
      anyDeclared = true;
      for (const t of list) out.add(t);
    }
  }
  // If no active inline skill declared `allowed-tools`, treat as unrestricted.
  return anyDeclared ? Array.from(out) : undefined;
}
