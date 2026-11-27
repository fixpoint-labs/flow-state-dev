// FIX-2725.
/**
 * Recorded work as a session view on the coding worker flow: the plan a run's
 * harness recorded and the pull requests it opened, read in the run's own
 * session, where they live. A task's detail watches it with `useView`; the
 * coding board shows only each task's pull request numbers, so no card
 * watches a run session of its own.
 *
 * The same mapping `readRecordedWork` uses (`planStepsOf`,
 * `openedPullRequestsOf`); the view reads the recorded collections through
 * its block's resources, so a write to either is heard.
 */
import { defineView, handler } from "@flow-state-dev/core";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  OBSERVED_PULL_REQUESTS,
  observedPlanCollection,
  observedPlanListCollection,
  observedPullRequestsCollection,
  planKeySegment,
  readPlanTarget,
} from "@flow-state-dev/core/harness";
import { z } from "zod";
import { openedPullRequestsOf, planStepsOf } from "./recorded-work";

/** The most rows of each kind the view answers, as the browser reader reads a page. */
const RECORDED_MAX = 200;

const recordedWorkSchema = z.object({
  /** The run's plan steps, at most 200, `truncated` when more were recorded; `null` while it records none. */
  plan: z.object({ rows: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().nullable() })), truncated: z.boolean() }).nullable(),
  /** The pull requests the run opened, oldest first, at most 200, `truncated` when it opened more. */
  pullRequests: z.object({ rows: z.array(z.object({ number: z.number().nullable(), url: z.string(), title: z.string().nullable() })), truncated: z.boolean() }),
});

/** A collection row keyed as the browser reads it, preserving its declared state type. */
const entriesOf = <TState>(collection: string, stored: readonly { path: string; state: TState }[]) =>
  stored.map((ref) => ({ topic: ref.path.startsWith(`${collection}/`) ? ref.path.slice(collection.length + 1) : ref.path, data: ref.state }));

/**
 * The recorded work view: input `{ requestId }`, a run of this session; answers
 * its plan and the pull requests it opened. Install it in the coding worker
 * flow's `views` as `recordedWork`.
 */
export function recordedWorkView() {
  return defineView({
    scope: "session",
    block: handler({
      name: "harness-manager-recorded-work",
      inputSchema: z.object({ requestId: z.string().min(1) }),
      outputSchema: recordedWorkSchema,
      resources: {
        [OBSERVED_PLAN]: observedPlanCollection,
        [OBSERVED_PLAN_LIST]: observedPlanListCollection,
        [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection,
      },
      execute: async (input, ctx) => {
        const markers = entriesOf(OBSERVED_PLAN_LIST, await ctx.resources[OBSERVED_PLAN_LIST].list(`${planKeySegment(input.requestId)}/`));
        const target = readPlanTarget(
          input.requestId,
          markers.map(({ topic, data }) => ({ topic, conversation: data?.conversation })),
        );
        const planPrefix = target.resourcesPrefix.slice(OBSERVED_PLAN.length + 1);
        // A plan is per run by its key's prefix; pull requests key by pull request, so this run's are found by its index.
        const [plan, opened] = await Promise.all([
          ctx.resources[OBSERVED_PLAN].list(planPrefix),
          ctx.resources[OBSERVED_PULL_REQUESTS].findBy("requestId", input.requestId),
        ]);
        // Only this run's rows are read, so earlier runs never use up its allowance.
        const runs = openedPullRequestsOf(entriesOf(OBSERVED_PULL_REQUESTS, opened), input.requestId);
        return {
          plan: plan.length === 0 ? null : { rows: planStepsOf(entriesOf(OBSERVED_PLAN, plan).slice(0, RECORDED_MAX)), truncated: plan.length > RECORDED_MAX },
          pullRequests: { rows: runs.slice(0, RECORDED_MAX).map(({ number, url, title }) => ({ number, url, title })), truncated: runs.length > RECORDED_MAX },
        };
      },
    }),
  });
}

/** The recorded work view, as {@link recordedWorkView} builds it. Import as a type in client code. */
export type RecordedWorkView = ReturnType<typeof recordedWorkView>;
