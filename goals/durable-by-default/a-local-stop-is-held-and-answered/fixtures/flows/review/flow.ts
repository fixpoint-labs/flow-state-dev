/**
 * The goal's one flow: a step that counts its runs, a stop for a person, then
 * a step. Each step appends one line to the file `GOAL_COUNT_FILE` names, a real
 * side effect a resume can't fake, so "the step before the stop ran once in all"
 * is counted across every process the check starts.
 *
 * - `submit`: an approval stop, with an optional deadline (`deadlineMs`).
 * - `ask`: an input stop, answered with a line of text.
 */
import { appendFileSync } from "node:fs";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const input = z.object({ title: z.string(), deadlineMs: z.number().optional() });
type Input = z.infer<typeof input>;

function note(line: string): void {
  const file = process.env.GOAL_COUNT_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${line}\n`);
}

const draft = handler({
  name: "durable-goal-draft",
  inputSchema: input,
  outputSchema: input,
  execute: async (value: Input) => {
    note(`before:${value.title}`);
    return value;
  },
});

const approve = handler({
  name: "durable-goal-approve",
  inputSchema: input,
  outputSchema: input,
  execute: async (value: Input, ctx) => {
    await ctx.suspend!({
      reason: "user_approval",
      message: `Publish "${value.title}"?`,
      ...(value.deadlineMs === undefined ? {} : { timeoutMs: value.deadlineMs }),
    });
    return value;
  },
});

const question = handler({
  name: "durable-goal-question",
  inputSchema: input,
  outputSchema: z.object({ title: z.string(), answer: z.string() }),
  execute: async (value: Input, ctx) => {
    const answer = (await ctx.suspend!({
      reason: "user_input",
      message: `What should "${value.title}" say?`,
      resumeSchema: z.string().min(1),
    })) as string;
    return { title: value.title, answer };
  },
});

const publish = handler({
  name: "durable-goal-publish",
  inputSchema: z.object({ title: z.string(), answer: z.string().optional() }),
  outputSchema: z.object({ published: z.string() }),
  execute: async (value) => {
    note(`after:${value.title}${value.answer === undefined ? "" : `:${value.answer}`}`);
    return { published: value.title };
  },
});

export default defineFlow({
  kind: "durable-goal",
  actions: {
    submit: { inputSchema: input, block: sequencer({ name: "durable-goal-submit" }).step(draft).step(approve).step(publish) },
    ask: { inputSchema: input, block: sequencer({ name: "durable-goal-ask" }).step(draft).step(question).step(publish) },
  },
})();
