/**
 * Action inputs for the four declared coding doors.
 *
 * The harness itself only accepts `{ prompt }`. These schemas are the
 * outer-agent payload; each door maps them onto a prompt. `cwd` and a
 * Cursor session id are not fields here (BP-031).
 */
import { z } from "zod";

/** Shared payload for implement / fix / openPr. */
export const taskInputSchema = z.object({
  task: z.string().min(1),
});

/** Self-heal payload: a repro of the FSD or harness failure, then retry the original door. */
export const fixFsdInputSchema = z.object({
  repro: z.string().min(1),
  notes: z.string().optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
export type FixFsdInput = z.infer<typeof fixFsdInputSchema>;

/** Session slice this host owns: the Cursor agent id `resume` will ask for. */
export const sessionStateSchema = z.object({
  cursorAgentId: z.string().nullable().default(null),
});

export const FLOW_KIND = "fsd-coding";

export const DOORS = ["implement", "fix", "openPr", "fixFsd"] as const;
export type CodingDoor = (typeof DOORS)[number];

/** Prompt prefixes the sequencers stamp so a door is visible on the wire. */
export const DOOR_PREFIX = {
  implement: "FSD-CODING DOOR=implement",
  fix: "FSD-CODING DOOR=fix",
  openPr: "FSD-CODING DOOR=openPr",
  fixFsd: "FSD-CODING DOOR=fixFsd",
} as const;
