/**
 * Workforce POC lab C — write spec content, attach tasks, read both back.
 *
 * Three zero-model actions on one session. The session *is* the plan.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { board, spec, tasks } from "./plan";

const nonBlank = (s: string) => s.trim().length > 0;

const taskSummarySchema = z.object({
  id: z.string(),
  goal: z.string(),
  title: z.string().optional(),
  context: z.string().optional(),
  status: z.string(),
});

const writePlan = handler({
  name: "writePlan",
  inputSchema: z.object({
    body: z.string().refine(nonBlank, "plan body must be non-blank"),
  }),
  outputSchema: z.object({ written: z.literal(true) }),
  resources: { spec },
  execute: async (input, ctx) => {
    await ctx.resources.spec.writeContent(input.body);
    return { written: true as const };
  },
});

const addTask = handler({
  name: "addTask",
  inputSchema: z.object({
    id: z.string().min(1).optional(),
    goal: z.string().refine(nonBlank, "goal must be non-blank"),
    title: z.string().optional(),
    context: z.string().optional(),
  }),
  outputSchema: taskSummarySchema,
  uses: [board.capability],
  execute: async (input, ctx) => {
    const task = await ctx.cap.plan.addTask({
      ...(input.id !== undefined ? { id: input.id } : {}),
      goal: input.goal,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
    });
    return {
      id: task.id,
      goal: task.goal,
      ...(task.title !== undefined ? { title: task.title } : {}),
      ...(task.context !== undefined ? { context: task.context } : {}),
      status: task.status,
    };
  },
});

const readPlan = handler({
  name: "readPlan",
  inputSchema: z.object({}),
  outputSchema: z.object({
    body: z.string().nullable(),
    tasks: z.array(taskSummarySchema),
  }),
  resources: { spec },
  uses: [board.capability],
  execute: async (_input, ctx) => {
    const body = await ctx.resources.spec.readContent();
    const rows = await ctx.cap.plan.listTasks();
    return {
      body,
      tasks: rows.map((task) => ({
        id: task.id,
        goal: task.goal,
        ...(task.title !== undefined ? { title: task.title } : {}),
        ...(task.context !== undefined ? { context: task.context } : {}),
        status: task.status,
      })),
    };
  },
});

const workforcePocCFlow = defineFlow({
  kind: "workforce-poc-c",
  authentication: { requireUser: true },
  resources: { spec, tasks },
  actions: {
    writePlan: {
      block: writePlan,
      description: "Write the plan's prose half as resource content.",
    },
    addTask: {
      block: addTask,
      description: "Attach a structured task on the same plan's board.",
    },
    readPlan: {
      block: readPlan,
      description: "Read the spec content and list tasks on this plan.",
    },
  },
});

export default workforcePocCFlow({ id: "default" });
