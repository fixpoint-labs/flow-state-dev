/**
 * Deterministic desk work. No model, no API key.
 *
 * Wired as HTTP actions so `fsdev run` can fire them without GitHub.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const inboundInputSchema = z.object({
  provider: z.string(),
  kind: z.enum(["issue", "pull_request"]),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  deliveryId: z.string().optional(),
});

export const inboundOutputSchema = z.object({
  recorded: z.literal(true),
  kind: z.enum(["issue", "pull_request"]),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
});

export const recordInbound = handler({
  name: "record-inbound",
  inputSchema: inboundInputSchema,
  outputSchema: inboundOutputSchema,
  execute: (input) => ({
    recorded: true as const,
    kind: input.kind,
    repo: input.repo,
    number: input.number,
    title: input.title,
  }),
});

export const reviewInputSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
});

export const reviewOutputSchema = z.object({
  reviewing: z.literal(true),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
});

/** Style 1: opening a review is also when auto-subscribe would record the PR. */
export const startReview = handler({
  name: "start-review",
  inputSchema: reviewInputSchema,
  outputSchema: reviewOutputSchema,
  execute: (input) => ({
    reviewing: true as const,
    repo: input.repo,
    number: input.number,
    title: input.title,
  }),
});

export const triageNoteSchema = z.object({
  kind: z.string(),
  repo: z.string().optional(),
  number: z.number().optional(),
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
