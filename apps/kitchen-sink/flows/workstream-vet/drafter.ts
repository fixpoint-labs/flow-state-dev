/**
 * workstream-vet — the drafter worker (the only model-backed member).
 *
 * Worker = generator + deterministic persist tap. The generator's structured
 * output IS the draft; the tap commits it to the shared workspace (the
 * memo-writer precedent — proof evidence never depends on the model
 * voluntarily calling a write tool). The tap also stamps `feedbackEcho`
 * from the same workspace field the capability preset renders — the vet's
 * deterministic data-path evidence.
 */
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import type { TaskWorkerInput } from "@flow-state-dev/tasks";
import { workstreamWorkspaceCap } from "./capability";
import { workspaceResource, type WorkspaceState } from "./resources";

export const draftOutputSchema = z.object({ draft: z.string() });

export const drafterGenerator = generator({
  name: "wsvet-drafter-gen",
  model: "intent/utility",
  uses: [workstreamWorkspaceCap],
  inputSchema: z.object({
    goal: z.string(),
    feedback: z.string().nullable(),
    /** Upstream human work-task output, materialized via task deps. */
    requirements: z.string().nullable(),
  }),
  outputSchema: draftOutputSchema,
  prompt:
    "You draft short written briefs for a workstream. The <workstream-workspace> " +
    "context carries the objective and, on a revision pass, the human feedback " +
    "the new draft must address. Keep drafts under 150 words.",
  user: (input) => {
    const req =
      input.requirements == null
        ? ""
        : ` Requirements provided by the human requester: ${input.requirements}`;
    return input.feedback == null
      ? `Write the draft. Goal: ${input.goal}.${req}`
      : `Revise the draft to address this reviewer feedback: ${input.feedback}.${req}`;
  },
  itemVisibility: { client: true, history: false },
});

/**
 * Commit tap: persist the draft + bump the draft counter + echo the feedback
 * field the context preset renders. Runs as `.tap()` so the worker's output
 * (the draft) flows through unchanged to `collection.complete`.
 */
export const persistDraft = handler({
  name: "wsvet-persist-draft",
  inputSchema: draftOutputSchema,
  resources: { wsvetWorkspace: workspaceResource },
  execute: async (input, ctx: any) => {
    const ws = ctx.resources.wsvetWorkspace;
    await ws.updateState((s: WorkspaceState) => ({
      ...s,
      draft: input.draft,
      draftsWritten: (s.draftsWritten ?? 0) + 1,
      feedbackEcho: s.latestFeedback ?? null,
    }));
  },
});

/**
 * The registry worker for `assignee: "drafter"`. Consumes the substrate's
 * `TaskWorkerInput`; revise tasks carry the human feedback on `input`.
 */
export const drafterWorker = sequencer({ name: "wsvet-drafter" })
  .step(
    (wi: TaskWorkerInput) => {
      // Dep outputs are substrate-materialized (packWorkerInput): a human
      // WORK task upstream lands here without any custom plumbing.
      const depValues = Object.values(wi.deps ?? {});
      const firstDep = depValues[0];
      return {
        goal: wi.goal,
        feedback:
          ((wi.input as { feedback?: string | null } | undefined)?.feedback ??
            wi.feedback ??
            null) as string | null,
        requirements:
          firstDep == null
            ? null
            : typeof firstDep === "string"
              ? firstDep
              : JSON.stringify(firstDep),
      };
    },
    drafterGenerator,
  )
  .tap(persistDraft);
