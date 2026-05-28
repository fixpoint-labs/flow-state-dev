/**
 * Tap factory that appends a debater's turn to the transcript resource
 * and adds-then-completes a Task in the audit collection. One tap is
 * built per debater seat so the agent's name and stance are bound at
 * build time and render clearly in DevTool.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, DefinedResource } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection } from "@flow-state-dev/tasks";
import { z } from "zod";
import { coerceText } from "../../shared/coerce";
import {
  debateStateSchema,
  type DebateTranscriptState,
} from "../schemas";

export function createRecordArgument(opts: {
  name: string;
  agentName: string;
  stance: string;
  transcript: DefinedResource;
  collectionId: string;
  warnedAgents: Set<string>;
}) {
  return handler({
    name: `${opts.name}-record-${opts.agentName}`,
    inputSchema: z.any(),
    resources: { transcript: opts.transcript },
    sequencerStateSchema: debateStateSchema,
    execute: async (input, ctx) => {
      const text = coerceText(input, opts.agentName, opts.warnedAgents, {
        tag: "debate",
        noun: "debater",
      });
      const state = ctx.sequencer!.state;
      const round = state.round;

      const current = (await ctx.resources.transcript.state()) as DebateTranscriptState;
      await ctx.resources.transcript.setState({
        entries: [
          ...(current.entries ?? []),
          { round, agentName: opts.agentName, stance: opts.stance, text },
        ],
      } as Parameters<typeof ctx.resources.transcript.setState>[0]);

      const collection = getOrCreateTaskCollection({
        ctx: ctx as unknown as BlockContext,
        backing: "sequencer",
        collectionId: opts.collectionId,
        sequencer: ctx.sequencer!,
      });
      const task = await collection.addTask({
        goal: `${opts.agentName} (round ${round})`,
        assignee: opts.agentName,
        metadata: { round, stance: opts.stance },
      });
      await collection.claim(`debate:${opts.name}`, {
        eligibility: (t) => t.id === task.id,
      });
      await collection.complete(task.id, { text });

      // Surface the turn as a renderable component item. The renderer
      // groups these by round to draw the transcript timeline.
      ctx.emit.component(
        "debate-turn",
        { round, agentName: opts.agentName, stance: opts.stance, text },
        { key: `turn-${round}-${opts.agentName}-${(current.entries?.length ?? 0)}` },
      );
    },
  });
}
