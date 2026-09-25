// The routing-with-evaluators flow: one action per step of the guide.
//
//   classify               → one evaluator, three typed questions (Step 1)
//   route                  → the triage tree on a model that reports confidence (Step 2)
//   routeWithoutConfidence → the same tree on a model that reports none: always review (Step 2)
//   activate               → the skill activator with an evaluator for tier 3 (Step 3)
//
// The models are parameters. `fsdev.config.ts` passes the real ones; the
// tests pass mock evaluation models, so they need no API key.
import { defineFlow, handler, sequencer, type EvaluationModel } from "@flow-state-dev/core";
import { activeSkillsArraySchema, defineSkillsCollection } from "@flow-state-dev/orchestration";
import { z } from "zod";
import { skillActivator } from "./activate";
import { classifyTicket, ticketSchema } from "./classify";
import { triage } from "./route";

/** The models the flow's actions run on. */
export interface RoutingModels {
  /** A model that reports confidence: `classify`, `route` and `activate`. */
  confident: string | EvaluationModel;
  /** A model that reports none: `routeWithoutConfidence`. */
  withoutConfidence: string | EvaluationModel;
}

/** Reads back what the activator wrote, so the action's output shows it. */
const activatedSkills = handler({
  name: "activated-skills",
  inputSchema: z.any(),
  sessionStateSchema: z.object({ activeSkills: activeSkillsArraySchema }),
  execute: (_input, ctx) => ({
    activeSkills: ctx.session.state.activeSkills.map((s) => ({ name: s.name, source: s.source })),
  }),
});

/** Build the flow on the given models. */
export function createRoutingFlow(models: RoutingModels) {
  return defineFlow({
    kind: "routing-with-evaluators",
    resources: { skills: defineSkillsCollection({ scope: "session" }) },
    actions: {
      classify: { inputSchema: ticketSchema, block: classifyTicket(models.confident) },
      route: { inputSchema: ticketSchema, block: triage(models.confident) },
      routeWithoutConfidence: { inputSchema: ticketSchema, block: triage(models.withoutConfidence) },
      activate: {
        inputSchema: ticketSchema,
        block: sequencer({ name: "activate", inputSchema: ticketSchema })
          .step(skillActivator(models.confident))
          .step(activatedSkills),
      },
    },
  })();
}
