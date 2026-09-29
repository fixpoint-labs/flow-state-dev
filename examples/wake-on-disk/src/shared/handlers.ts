/**
 * Deterministic work the night-watch desk runs. No model, no API key.
 *
 * The same blocks are wired as schedule/webhook bindings *and* as HTTP
 * actions so `fsdev run` can fire them without a host clock or GitHub.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const sweepInputSchema = z.object({
  reason: z.string(),
  nominalFireTime: z.string().optional(),
});

export const sweepOutputSchema = z.object({
  swept: z.literal(true),
  reason: z.string(),
  at: z.string(),
});

/** What a sweep tick does once it has a session. */
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

/** What an opened-issue delivery does once it has a session. */
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

export const triageNoteSchema = z.object({
  kind: z.string(),
  repo: z.string().optional(),
  issueNumber: z.number().optional(),
  title: z.string().optional(),
});

export const triageNoteOutputSchema = z.object({
  noted: z.literal(true),
  kind: z.string(),
});

/** Receives the tiny cross-flow hop. Not a NotificationFlow. */
export const noteTriage = handler({
  name: "note-triage",
  inputSchema: triageNoteSchema,
  outputSchema: triageNoteOutputSchema,
  execute: (input) => ({ noted: true as const, kind: input.kind }),
});
