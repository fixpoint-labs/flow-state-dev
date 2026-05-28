/**
 * Tap factory that appends a roster turn's output to the contributions
 * resource and adds-then-completes a Task in the audit collection. One
 * tap is built per roster slot so the agent's name is bound at build
 * time and renders clearly in DevTool.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, DefinedResource } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection } from "@flow-state-dev/tasks";
import { z } from "zod";
import { coerceText } from "../../shared/coerce";
import {
  roundRobinStateSchema,
  type RoundRobinContributionsState,
} from "../schemas";

export function createRecordContribution(opts: {
  name: string;
  agentName: string;
  contributions: DefinedResource;
  collectionId: string;
  warnedAgents: Set<string>;
  /** Accessor key used in the block's `resources:` map. Defaults to
   *  `"contributions"`. See `createInitContributions` for rationale. */
  accessorKey?: string;
}) {
  const accessor = opts.accessorKey ?? "contributions";
  return handler({
    name: `${opts.name}-record-${opts.agentName}`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    resources: { [accessor]: opts.contributions },
    sequencerStateSchema: roundRobinStateSchema,
    execute: async (input, ctx) => {
      const text = coerceText(input, opts.agentName, opts.warnedAgents, {
        tag: "round-robin",
        noun: "roster agent",
      });
      const state = ctx.sequencer!.state;
      const round = state.round;

      // TODO: computed-key resource accessor — see round-robin follow-up
      const contribRef = (ctx.resources as any)[accessor];
      const current = contribRef.state as RoundRobinContributionsState;
      await contribRef.setState({
        entries: [
          ...(current.entries ?? []),
          { round, agentName: opts.agentName, text },
        ],
      });

      const collection = getOrCreateTaskCollection({
        ctx: ctx as unknown as BlockContext,
        backing: "sequencer",
        collectionId: opts.collectionId,
        sequencer: ctx.sequencer!,
      });
      const task = await collection.addTask({
        goal: `${opts.agentName} (round ${round})`,
        assignee: opts.agentName,
        metadata: { round },
      });
      await collection.claim(`round-robin:${opts.name}`, {
        eligibility: (t) => t.id === task.id,
      });
      await collection.complete(task.id, { text });

      return input;
    },
  });
}
