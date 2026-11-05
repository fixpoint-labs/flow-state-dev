/**
 * The config screens (FIX-2534 D1): five fixed kinds, code only, no model.
 *
 * `sender` and `own` run on every subscription; `labels`, `words` and `allow`
 * run when a subscription lists them, and every one it lists must pass, two
 * of one kind included.
 *
 * - `sender` fails closed (epic Q1): members and collaborators pass, a bot
 *   passes when the service lists it, and an outsider (or a sender of unknown
 *   role) passes only a subscription that opted in.
 * - `own` drops the subscriber's own actions.
 * - `labels`: the event carries one of the listed labels.
 * - `words`: the title or text holds one of the listed words, ignoring case.
 * - `allow`: the sender is one of the listed ids.
 *
 * The chain is a sequencer (epic D7): one `.stepIf` step per kind, each taken
 * while a subscription is still undecided, so the first refusal stops that
 * subscription. Its output is one verdict per subscription,
 * `{ subscription, pass, reason }`: the shape a custom screen and Jev answer
 * in too (FIX-2537). A subscription with no verdict is refused.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { subscriptionEventSchema, type SubscriptionEvent } from "@flow-state-dev/core/types";
import { z } from "zod";
import { indexEntrySchema, type IndexEntry, type ScreenKind } from "./rows";

/** One verdict: a subscription, whether it passed, and the screen that decided it and why. **Pinned** (D1). */
export const screenVerdictSchema = z.object({ subscription: z.string().min(1), pass: z.boolean(), reason: z.string() });

export type ScreenVerdict = z.infer<typeof screenVerdictSchema>;

/** A screen's whole answer: one verdict per subscription it was handed. **Pinned** (D1). */
export const screenVerdictsSchema = z.object({ verdicts: z.array(screenVerdictSchema) });

/** A subscription the index nominated: its id, and what the screens read of it. */
const candidateSchema = z.object({ subscription: z.string().min(1), entry: indexEntrySchema });

type Candidate = z.infer<typeof candidateSchema>;

/** What the chain carries from step to step: the event, who is still undecided, and the verdicts so far. */
export const screeningSchema = z.object({
  event: subscriptionEventSchema,
  /** Every subscription the selection nominated: each gets a verdict, or is refused for having none. */
  nominated: z.array(candidateSchema),
  pending: z.array(candidateSchema),
  verdicts: z.array(screenVerdictSchema),
  /**
   * The subscriptions to the thread this event closes, whatever kinds they
   * hear and whatever the screens make of it: each ends (ER-7 as amended).
   */
  closing: z.array(candidateSchema).default([])
});

export type Screening = z.infer<typeof screeningSchema>;

/** What the screens are built with: the bots the service lets through. */
export interface ScreenOptions {
  readonly trustedBots: readonly string[];
}

/** One screen's answer for one subscription: `undefined` to pass, or why it refused. */
export function screenRefusal(kind: ScreenKind, event: SubscriptionEvent, entry: IndexEntry, options: ScreenOptions): string | undefined {
  switch (kind) {
    case "sender": {
      const role = event.sender.role;
      if (role === "member" || role === "collaborator") return undefined;
      if (role === "bot") return options.trustedBots.includes(event.sender.id) ? undefined : `bot "${event.sender.id}" isn't one the service lets through`;
      const outsidersPass = entry.outsiders === true;
      return outsidersPass ? undefined : `"${event.sender.id}" is outside the project (${role}), and this subscription takes no outsiders`;
    }
    case "own":
      return entry.self !== undefined && event.sender.id === entry.self ? "the subscriber's own action" : undefined;
    case "labels":
      for (const listed of entry.screens) {
        if (listed.screen === "labels" && !listed.any.some((label) => event.labels.includes(label))) return `none of the labels ${listed.any.join(", ")}`;
      }
      return undefined;
    case "words": {
      const body = `${event.title}\n${event.text}`.toLowerCase();
      for (const listed of entry.screens) {
        if (listed.screen === "words" && !listed.any.some((word) => body.includes(word.toLowerCase()))) return `none of the words ${listed.any.join(", ")}`;
      }
      return undefined;
    }
    case "allow":
      for (const listed of entry.screens) {
        if (listed.screen === "allow" && !listed.ids.includes(event.sender.id)) return `"${event.sender.id}" isn't an allowed sender`;
      }
      return undefined;
  }
}

/** Run one screen over the undecided: a refusal becomes a verdict, a pass stays undecided for the next. */
function screenStep(kind: ScreenKind, options: ScreenOptions) {
  return handler({
    name: `subscription-screen-${kind}`,
    inputSchema: screeningSchema,
    outputSchema: screeningSchema,
    execute: async (screening: Screening): Promise<Screening> => {
      const pending: Candidate[] = [];
      const verdicts = [...screening.verdicts];
      for (const candidate of screening.pending) {
        const refused = screenRefusal(kind, screening.event, candidate.entry, options);
        if (refused === undefined) pending.push(candidate);
        else verdicts.push({ subscription: candidate.subscription, pass: false, reason: `${kind}: ${refused}` });
      }
      return { ...screening, pending, verdicts };
    }
  });
}

/** Every subscription still undecided after the config screens passed them all. */
const passRest = handler({
  name: "subscription-screens-passed",
  inputSchema: screeningSchema,
  outputSchema: screeningSchema,
  execute: async (screening: Screening): Promise<Screening> => ({
    ...screening,
    pending: [],
    verdicts: [
      ...screening.verdicts,
      ...screening.pending.map((c) => ({ subscription: c.subscription, pass: true, reason: "passed the config screens" }))
    ]
  })
});

const undecided = (screening: Screening) => screening.pending.length > 0;

/** The config screen chain: `sender`, `own`, `labels`, `words`, `allow`, each while a subscription is undecided. */
export function configScreenChain(options: ScreenOptions) {
  return sequencer({ name: "subscription-config-screens", inputSchema: screeningSchema })
    .stepIf(undecided, screenStep("sender", options))
    .stepIf(undecided, screenStep("own", options))
    .stepIf(undecided, screenStep("labels", options))
    .stepIf(undecided, screenStep("words", options))
    .stepIf(undecided, screenStep("allow", options))
    .stepIf(undecided, passRest);
}
