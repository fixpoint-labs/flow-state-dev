/**
 * The goal's flows: a support desk (a singleton, addressed by its kind) and a
 * notes copy (a collection instance, addressed by its id). Both run the same
 * three actions:
 *
 * - `reply`: a typed turn. It appends the text to the session's `transcript`
 *   resource, whose content a client can read.
 * - `approve`: a stop for a person, an approval or a line of input as the
 *   input says, then the answer as its output.
 * - `hold`: a step that counts its runs, then a step that waits on a latch
 *   file. The host is killed while it waits; the step before must not run
 *   again when the request carries on.
 *
 * Every count is a line appended to `GOAL_COUNTER_FILE`, a side effect a
 * replay can't fake, counted across every process the check starts.
 */
import { appendFileSync, existsSync } from "node:fs";
import { defineFlow, defineResource, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

/** The support desk's kind, which is also its address. */
export const SUPPORT_KIND = "support";
/** The notes flow's kind; a copy is addressed by its own id. */
export const NOTES_KIND = "notes";

function count(line: string): void {
  const file = process.env.GOAL_COUNTER_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${line}\n`);
}

const transcript = defineResource({
  scope: "session",
  ref: "transcript",
  writable: true,
  stateSchema: z.object({ turns: z.array(z.string()).default([]) }),
  client: { content: { read: true } },
});

const replyInput = z.object({ text: z.string().min(1) });

const reply = handler({
  name: "goal-one-client-reply",
  inputSchema: replyInput,
  outputSchema: z.object({ turns: z.number() }),
  execute: async (input, ctx) => {
    const turns = [...ctx.resources.transcript.state.turns, input.text];
    await ctx.resources.transcript.patchState({ turns });
    await ctx.resources.transcript.writeContent(turns.join("\n"));
    return { turns: turns.length };
  },
});

const approveInput = z.object({ subject: z.string(), kind: z.enum(["approval", "input"]) });

const gate = handler({
  name: "goal-one-client-gate",
  inputSchema: approveInput,
  outputSchema: z.object({ answer: z.string() }),
  execute: async (input, ctx) => {
    if (input.kind === "approval") {
      await ctx.suspend!({ reason: "human_approval", message: `Approve "${input.subject}"?` });
      return { answer: "approved" };
    }
    const answer = (await ctx.suspend!({
      reason: "human_input",
      message: `What should "${input.subject}" say?`,
      resumeSchema: z.string().min(1),
    })) as string;
    return { answer };
  },
});

const holdInput = z.object({ label: z.string() });

const before = handler({
  name: "goal-one-client-before",
  inputSchema: holdInput,
  outputSchema: holdInput,
  execute: async (input) => {
    count(`before:${input.label}`);
    return input;
  },
});

const latch = handler({
  name: "goal-one-client-latch",
  inputSchema: holdInput,
  outputSchema: z.object({ released: z.string() }),
  execute: async (input) => {
    const file = process.env.GOAL_LATCH_FILE ?? "";
    while (!existsSync(file)) await new Promise((resolve) => setTimeout(resolve, 100));
    count(`after:${input.label}`);
    return { released: input.label };
  },
});

const actions = {
  reply: { inputSchema: replyInput, block: reply },
  approve: { inputSchema: approveInput, block: sequencer({ name: "goal-one-client-approve" }).step(gate) },
  hold: { inputSchema: holdInput, block: sequencer({ name: "goal-one-client-hold" }).step(before).step(latch) },
};

/** The support desk's definition: what `fsd.flow<typeof supportDefinition>` types against. */
export const supportDefinition = defineFlow({ kind: SUPPORT_KIND, actions, resources: { transcript } });

/** The notes definition, one copy per instance id. */
export const notesDefinition = defineFlow({
  kind: NOTES_KIND,
  cardinality: "collection",
  actions,
  resources: { transcript },
});

/** Every flow the host serves, by address: the support desk and one notes copy. */
export function goalFlows(notesId: string) {
  const notes = notesDefinition({ id: notesId });
  return { [SUPPORT_KIND]: supportDefinition(), [notes.id]: notes };
}
