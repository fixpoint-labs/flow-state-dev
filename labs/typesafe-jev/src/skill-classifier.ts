/**
 * Drop-in evaluator replacement for skill-activator tier 3.
 *
 * Compatible with `createSkillActivator({ classifier })`. Orchestration
 * does not import this module — the host passes the block when an
 * evaluate-capable (or System 2) classifier is installed. Tiers 1–2
 * (slash / keyword) and apply stay as-is.
 *
 * Choice is over catalog skill names plus `none`. Criteria are each
 * skill's description / whenToUse. Confidence maps to the existing
 * 0.65 threshold. Invented names fail the catalog `validNames` guard.
 * Optional = model capability, not package mount.
 */

import { handler, type BlockDefinition } from "@flow-state-dev/core";
import type { ResourceCollectionRef, SkillState } from "@flow-state-dev/core";
import { defineSkillsCollection } from "@flow-state-dev/orchestration";
import { z } from "zod";
import type { EvaluateClient } from "./client";
import { asTypeSafeState, runEvaluate } from "./run-evaluate";
import { choice, isChoiceAnswer } from "./schemas";

/** Matches `DEFAULT_CONFIDENCE_THRESHOLD` on the generator classifier. */
export const SYSTEM_ONE_SKILL_CONFIDENCE = 0.65;

/** Choice option when no catalog skill applies. Not a skill name. */
export const SYSTEM_ONE_SKILL_NONE = "none";

export const SYSTEM_ONE_SKILL_QUESTION = "skill";

export const SKILLS_COLLECTION_KEY = "skills";

/** Session-scoped catalog for the lab demo / tests. */
export const demoSkillsCollection = defineSkillsCollection({ scope: "session" });

export interface SkillCatalogEntry {
  name: string;
  description: string;
}

export interface SystemOneSkillClassifierOptions {
  client?: EvaluateClient;
  apiKey?: string;
  model?: unknown;
  fallbackModel?: string;
  mode?: "evaluate" | "system-2";
  collectionKey?: string;
  collection?: ReturnType<typeof defineSkillsCollection>;
  confidenceThreshold?: number;
  maxSkills?: number;
  allowed?: readonly string[];
  name?: string;
}

const inputSchema = z.object({ message: z.string() }).passthrough();

const outputSchema = z.object({
  accepted: z.boolean(),
  skill: z.string().nullable(),
});

const sequencerStateSchema = z.object({
  resolved: z.boolean().default(false),
  skills: z
    .array(
      z.object({
        name: z.string(),
        input: z.string().default(""),
        source: z.enum(["slash", "keyword", "classifier", "manual-override"]),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  classifierConfidence: z.number().min(0).max(1).nullable().default(null),
});

/**
 * List enabled catalog skills for the Choice criteria.
 */
export async function listSkillsForChoice(
  collection: ResourceCollectionRef | undefined,
  cap: number,
  allowedSet: Set<string> | undefined,
): Promise<SkillCatalogEntry[]> {
  if (!collection) return [];
  const out: SkillCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const ref of await collection.list()) {
    if (out.length >= cap) break;
    if (!ref.path.endsWith("/SKILL.md")) continue;
    const segments = ref.path.split("/");
    if (segments.length < 2) continue;
    const skillName = segments[segments.length - 2]!;
    if (seen.has(skillName)) continue;
    seen.add(skillName);
    if (allowedSet && !allowedSet.has(skillName)) continue;
    const state = ref.state as unknown as SkillState;
    if (state.disableModelInvocation) continue;
    let desc = state.description ?? "";
    if (state.whenToUse) desc = desc ? `${desc}\n${state.whenToUse}` : state.whenToUse;
    out.push({ name: skillName, description: desc });
  }
  return out;
}

/**
 * Declares the skills collection so seed / slash / keyword can see it
 * when the Jev classifier is not installed.
 */
export function skillsCatalogAnchor(
  options: Pick<SystemOneSkillClassifierOptions, "collectionKey" | "collection"> = {},
) {
  const collectionKey = options.collectionKey ?? SKILLS_COLLECTION_KEY;
  const collection = options.collection ?? demoSkillsCollection;
  return handler({
    name: "skills-catalog-anchor",
    inputSchema,
    outputSchema: z.object({ anchored: z.literal(true) }),
    resources: { [collectionKey]: collection },
    execute: () => ({ anchored: true as const }),
  });
}

/**
 * Tier-3 block for `createSkillActivator({ classifier })`.
 */
export function createSystemOneSkillClassifier(
  options: SystemOneSkillClassifierOptions = {},
): BlockDefinition<typeof inputSchema, typeof outputSchema> {
  const collectionKey = options.collectionKey ?? SKILLS_COLLECTION_KEY;
  const collection = options.collection ?? demoSkillsCollection;
  const threshold = options.confidenceThreshold ?? SYSTEM_ONE_SKILL_CONFIDENCE;
  const cap = options.maxSkills ?? 20;
  const allowedSet = options.allowed ? new Set(options.allowed) : undefined;

  return handler({
    name: options.name ?? "system-one-skill-classifier",
    inputSchema,
    outputSchema,
    sequencerStateSchema,
    resources: { [collectionKey]: collection },
    execute: async (input, ctx) => {
      const installed = ctx.resources[collectionKey] as
        | ResourceCollectionRef
        | undefined;
      const catalog = await listSkillsForChoice(installed, cap, allowedSet);
      const validNames = new Set(catalog.map((row) => row.name));

      if (catalog.length === 0) {
        await ctx.sequencer!.patchState({
          resolved: true,
          skills: [],
          classifierConfidence: 0,
        });
        return { accepted: false, skill: null };
      }

      const criteria: Record<string, string> = {
        [SYSTEM_ONE_SKILL_NONE]:
          "No catalog skill clearly applies to this message.",
      };
      for (const row of catalog) {
        criteria[row.name] =
          row.description || `Skill "${row.name}" in the catalog.`;
      }

      const result = await runEvaluate({
        state: asTypeSafeState((input as { message: string }).message),
        questions: {
          [SYSTEM_ONE_SKILL_QUESTION]: choice(
            "Which catalog skill applies to this user message? Pick none if none clearly apply.",
            criteria,
          ),
        },
        client: options.client,
        apiKey: options.apiKey,
        model: options.model,
        fallbackModel: options.fallbackModel,
        mode: options.mode,
      });

      const answer = result.answers[SYSTEM_ONE_SKILL_QUESTION];
      const confidence = isChoiceAnswer(answer) ? (answer.confidence ?? 0) : 0;
      const picked = isChoiceAnswer(answer) ? answer.choice : SYSTEM_ONE_SKILL_NONE;

      if (
        !isChoiceAnswer(answer) ||
        picked === SYSTEM_ONE_SKILL_NONE ||
        confidence < threshold ||
        !validNames.has(picked)
      ) {
        await ctx.sequencer!.patchState({
          resolved: true,
          skills: [],
          classifierConfidence: confidence,
        });
        return { accepted: false, skill: null };
      }

      await ctx.sequencer!.patchState({
        resolved: true,
        skills: [
          {
            name: picked,
            input: "",
            source: "classifier" as const,
            confidence,
          },
        ],
        classifierConfidence: confidence,
      });
      return { accepted: true, skill: picked };
    },
  });
}
