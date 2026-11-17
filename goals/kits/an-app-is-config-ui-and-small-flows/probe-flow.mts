/**
 * What leg w writes at, served beside the lab's own flows through
 * `GOAL_FLOWS`: a flow that declares, at user and org scope, the two kinds of
 * resource a client might write without a flow.
 *
 * - `userSkills`, `orgSkills`: a skills collection, whose `client.content`
 *   grants create, update and delete. The content routes must still answer
 *   501 at user and org scope (the exemption until FIX-2633).
 * - `notes`: a user resource with no `runBy`; `noteBook`: a user collection
 *   with no `runBy` whose content grants writes. A client write to either is
 *   refused, through the action route and through a content route.
 * - three views that each call a model, at session, user and org scope:
 *   each must be refused (`view_model_call`).
 */
import { defineFlow, defineResource, defineResourceCollection, defineView, generator } from "@flow-state-dev/core";
import { defineSkillsCollection } from "@flow-state-dev/orchestration";
import { z } from "zod";

/** The flow's kind and id. */
export const PROBE_FLOW = "closure-probe";

/** The resources, by the name a content route takes. */
export const probeResources = {
  userSkills: defineSkillsCollection({ scope: "user", prefix: "closure-user-skills" }),
  orgSkills: defineSkillsCollection({ scope: "org", prefix: "closure-org-skills" }),
  notes: defineResource({ ref: "closure-notes", scope: "user", stateSchema: z.object({ text: z.string().default("") }), client: { expose: ["text"] } }),
  noteBook: defineResourceCollection({
    pattern: "closure-note-book/**",
    scope: "user",
    stateSchema: z.object({ text: z.string().default("") }),
    client: { content: { read: true, create: true, update: true, delete: true } },
  }),
};

/** A model call planted in a view, at each scope a view runs at: journey j5 reads each one refused. */
const summarize = generator({ name: "closure-summarize", model: "openai/gpt-6-luna", prompt: "Summarize.", outputSchema: z.object({ text: z.string() }) });
export const MODEL_VIEWS = { session: "summarizeSession", user: "summarizeUser", org: "summarizeOrg" } as const;

export default [
  defineFlow({
    kind: PROBE_FLOW,
    resources: probeResources,
    views: {
      [MODEL_VIEWS.session]: defineView({ scope: "session", block: summarize }),
      [MODEL_VIEWS.user]: defineView({ scope: "user", block: summarize }),
      [MODEL_VIEWS.org]: defineView({ scope: "org", block: summarize }),
    },
  } as never)({ id: PROBE_FLOW } as never) as { id: string },
];
