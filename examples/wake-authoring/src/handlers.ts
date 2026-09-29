/**
 * Deterministic handlers shared by every variant. No model, no API key.
 *
 * The same block reference is wired as a schedule/webhook binding *and* as an
 * HTTP action so `fsdev run` / `testFlow` can exercise "what runs when it
 * fires" without standing up a host scheduler or GitHub.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { INBOX_WAKE_TABLE } from "./scenario";

export const sweepInputSchema = z.object({
  reason: z.string(),
  nominalFireTime: z.string().optional(),
});

export const sweepOutputSchema = z.object({
  swept: z.literal(true),
  reason: z.string(),
  at: z.string(),
});

/** Runs when the host posts a scheduled dispatch for `sweep-open`. */
export const sweepOpenTickets = handler({
  name: "sweep-open-tickets",
  inputSchema: sweepInputSchema,
  outputSchema: sweepOutputSchema,
  execute: (input) => ({
    swept: true as const,
    reason: input.reason,
    at: input.nominalFireTime ?? "unspecified",
  }),
});

export const inboundInputSchema = z.object({
  provider: z.string(),
  repo: z.string(),
  issueNumber: z.number(),
  title: z.string(),
  deliveryId: z.string().optional(),
});

export const inboundOutputSchema = z.object({
  recorded: z.literal(true),
  repo: z.string(),
  issueNumber: z.number(),
  title: z.string(),
});

/** Runs when a verified GitHub `issues` event matches `action === "opened"`. */
export const recordInboundIssue = handler({
  name: "record-inbound-issue",
  inputSchema: inboundInputSchema,
  outputSchema: inboundOutputSchema,
  execute: (input) => ({
    recorded: true as const,
    repo: input.repo,
    issueNumber: input.issueNumber,
    title: input.title,
  }),
});

export const inspectInputSchema = z.object({}).default({});

export const inspectOutputSchema = z.object({
  variant: z.string(),
  schedules: z.array(
    z.object({
      id: z.string(),
      cron: z.string(),
      fires: z.string(),
      runs: z.string(),
    }),
  ),
  webhooks: z.array(
    z.object({
      provider: z.string(),
      event: z.string(),
      fires: z.string(),
      runs: z.string(),
    }),
  ),
  leftover: z.array(
    z.object({
      id: z.string(),
      fires: z.string(),
      runs: z.string(),
    }),
  ),
});

/** Lists the scenario's wakes. Useful for `fsdev run` without a clock. */
export function inspectWakes(variant: string) {
  return handler({
    name: `inspect-wakes-${variant}`,
    inputSchema: inspectInputSchema,
    outputSchema: inspectOutputSchema,
    execute: () => ({ variant, ...INBOX_WAKE_TABLE }),
  });
}

/** Blocks a worker-md `runs:` line may name. */
export const WORKER_WAKE_BLOCKS = {
  "sweep-open-tickets": sweepOpenTickets,
  "record-inbound-issue": recordInboundIssue,
} as const;
