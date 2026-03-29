import { z } from "zod";

export const coordinatorInputSchema = z.object({
  goal: z.string().describe("The goal to decompose and coordinate")
});

export type CoordinatorInput = z.infer<typeof coordinatorInputSchema>;

export type SubTaskErrorStrategy = "skip" | "fail" | "retry";
