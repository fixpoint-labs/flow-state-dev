/**
 * Demo: evaluator as skill-activator tier 3.
 *
 * `systemOne: true` injects `createSystemOneSkillClassifier` into
 * `createSkillActivator({ classifier })`. Tiers 1–2 and apply stay
 * orchestration's. `systemOne: false` is the no-classifier case —
 * deterministic slash / keyword only (`enableLlmClassifier: false`).
 * Optional = model capability, not package mount.
 */

import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import { createSkillActivator } from "@flow-state-dev/orchestration";
import { z } from "zod";
import type { EvaluateClient } from "./client";
import {
  SKILLS_COLLECTION_KEY,
  SYSTEM_ONE_SKILL_CONFIDENCE,
  createSystemOneSkillClassifier,
  demoSkillsCollection,
  skillsCatalogAnchor,
} from "./skill-classifier";

export const SKILL_ACTIVATOR_FLOW_KIND = "system-one-skills";

export const DEMO_SKILLS: InitialSkill[] = [
  {
    name: "billing",
    skillMd: [
      "---",
      "description: Handle payment, refund, and invoice problems",
      "when_to_use: The user is asking about a charge, refund, invoice, or billing dispute",
      "---",
      "",
      "Help the user with billing.",
    ].join("\n"),
  },
  {
    name: "launch",
    skillMd: [
      "---",
      "description: Plan a product launch",
      "when_to_use: The user wants to plan a launch, ship a release, or sequence go-to-market work",
      "---",
      "",
      "Plan the launch.",
    ].join("\n"),
  },
];

export interface SystemOneSkillActivatorOptions {
  systemOne?: boolean;
  client?: EvaluateClient;
  apiKey?: string;
  name?: string;
  collectionKey?: string;
  confidenceThreshold?: number;
  enableKeywordMatch?: boolean;
  allowed?: readonly string[];
  initialSkills?: InitialSkill[];
}

const activateInputSchema = z.object({ message: z.string() }).passthrough();

/**
 * Host-facing factory: today's activator with an optional Jev tier 3.
 */
export function createSystemOneSkillActivator(
  options: SystemOneSkillActivatorOptions = {},
) {
  const enabled = options.systemOne !== false;
  const collectionKey = options.collectionKey ?? SKILLS_COLLECTION_KEY;
  const initialSkills = options.initialSkills ?? DEMO_SKILLS;
  const allowed = options.allowed;

  const classifier = enabled
    ? createSystemOneSkillClassifier({
        client: options.client,
        apiKey: options.apiKey,
        collectionKey,
        collection: demoSkillsCollection,
        confidenceThreshold:
          options.confidenceThreshold ?? SYSTEM_ONE_SKILL_CONFIDENCE,
        ...(allowed ? { allowed } : {}),
      })
    : undefined;

  const activator = createSkillActivator({
    name: options.name ?? "skill-activator",
    collectionKey,
    initialSkills,
    enableLlmClassifier: enabled,
    enableKeywordMatch: options.enableKeywordMatch ?? true,
    ...(classifier ? { classifier } : {}),
    ...(allowed ? { allowed } : {}),
    ...(options.confidenceThreshold !== undefined
      ? { confidenceThreshold: options.confidenceThreshold }
      : {}),
  });

  return sequencer({
    name: options.name ?? "system-one-skill-activator",
    inputSchema: activateInputSchema,
  })
    .tap(skillsCatalogAnchor({ collectionKey, collection: demoSkillsCollection }))
    .tap(activator);
}

export interface SkillActivatorFlowOptions extends SystemOneSkillActivatorOptions {}

const statusOutputSchema = z.object({
  systemOne: z.boolean(),
  classifier: z.enum(["jev", "off"]),
});

const activeSkillsOutputSchema = z.object({
  activeSkills: z.array(
    z.object({
      name: z.string(),
      source: z.string().optional(),
    }),
  ),
});

/**
 * Demo flow. On: activate uses Jev when slash+keyword miss.
 * Off: activate still runs; tier 3 is gone.
 */
export function createSkillActivatorDemoFlow(
  options: SkillActivatorFlowOptions = {},
) {
  const enabled = options.systemOne !== false;
  const activator = createSystemOneSkillActivator(options);

  const status = handler({
    name: "skill-activator-status",
    inputSchema: z.object({}),
    outputSchema: statusOutputSchema,
    execute: () => ({
      systemOne: enabled,
      classifier: enabled ? ("jev" as const) : ("off" as const),
    }),
  });

  const read = handler({
    name: "read-active-skills",
    inputSchema: z.object({}),
    outputSchema: activeSkillsOutputSchema,
    sessionStateSchema: z.object({
      activeSkills: z
        .array(
          z.object({
            name: z.string(),
            source: z.string().optional(),
          }),
        )
        .default([]),
    }),
    execute: (_input, ctx) => ({
      activeSkills: ((ctx.session.state.activeSkills ?? []) as Array<{
        name: string;
        source?: string;
      }>).map((entry) => ({
        name: entry.name,
        source: entry.source,
      })),
    }),
  });

  return defineFlow({
    kind: SKILL_ACTIVATOR_FLOW_KIND,
    requireUser: true,
    actions: {
      status: { block: status },
      activate: { block: activator },
      activeSkills: { block: read },
    },
  })();
}
