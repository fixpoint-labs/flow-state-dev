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
import {
  debateStateSchema,
  type DebateState,
  type DebateTranscriptState,
} from "../schemas";

function coerceText(out: unknown, agentName: string, warned: Set<string>): string {
  if (typeof out === "string") return out;
  if (out !== null && typeof out === "object") {
    const obj = out as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  if (!warned.has(agentName)) {
    warned.add(agentName);
    // eslint-disable-next-line no-console
    console.warn(
      `[debate] debater "${agentName}" returned a non-string/non-{text} value; coerced via String().`,
    );
  }
  return String(out);
}

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
    outputSchema: z.any(),
    resources: { transcript: opts.transcript },
    sequencerStateSchema: debateStateSchema,
    execute: async (input, ctx) => {
      const text = coerceText(input, opts.agentName, opts.warnedAgents);
      const state = ctx.sequencer!.state as DebateState;
      const round = state.round;

      const current = ctx.resources.transcript.state as DebateTranscriptState;
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

      return input;
    },
  });
}
