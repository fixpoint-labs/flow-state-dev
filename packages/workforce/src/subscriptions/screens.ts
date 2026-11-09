// FIX-2534 D1; FIX-2537.
/**
 * The code screens: five fixed config kinds, and the app's own custom
 * screens, with no model.
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
 * - `custom`: the app's function of that name, declared once on
 *   the provider, `(event, entry) => string | undefined`: a string refuses
 *   with it, `undefined` passes, and a throw (or any other answer, a promise
 *   included: nothing here awaits) refuses as `custom:<name>: failed`.
 *
 * Each screen is one step of the chain (`chain.ts`), taken while a
 * subscription is still undecided, so the first refusal stops that
 * subscription. Every step answers in one verdict per subscription,
 * `{ subscription, pass, reason }`. A subscription with no verdict is refused.
 *
 * **The unheard seam**: an event is unheard,
 * and may be forwarded as unmatched, only when every refusal was on its
 * content. {@link refusedOnContent} says which were: not `interest: unjudged`,
 * not a screen's `: failed`, not `no verdict`.
 */
import { handler } from "@flow-state-dev/core";
import { subscriptionEventSchema, type EvaluationModel, type SubscriptionEvent } from "@flow-state-dev/core/types";
import { z } from "zod";
import { indexEntrySchema, type IndexEntry, type ScreenKind } from "./rows";

/** One verdict: a subscription, whether it passed, and the screen that decided it and why. **Pinned** (D1). */
export const screenVerdictSchema = z.object({ subscription: z.string().min(1), pass: z.boolean(), reason: z.string() });

export type ScreenVerdict = z.infer<typeof screenVerdictSchema>;

/** A screen's whole answer: one verdict per subscription it was handed. **Pinned** (D1). */
export const screenVerdictsSchema = z.object({ verdicts: z.array(screenVerdictSchema) });

/** A subscription the index nominated: its id, and what the screens read of it. */
const candidateSchema = z.object({ subscription: z.string().min(1), entry: indexEntrySchema });

export type Candidate = z.infer<typeof candidateSchema>;

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

/**
 * An app's own screen (D2): a sync function over the event and what the
 * screens read of the subscription. `undefined` passes; a string refuses, and
 * is the reason.
 */
export interface CustomScreen {
  /** What it passes, in a few words: the subscribe tool lists it, so a model knows when to list it. */
  readonly describe: string;
  readonly screen: (event: SubscriptionEvent, entry: IndexEntry) => string | undefined;
}

/** The screens an app adds on one provider, declared once (D2). */
export interface SubscriptionScreens {
  /**
   * The one evaluation model the `interest` screen asks: a model string the
   * app's resolver turns into one, or one. Without it, `subscribe` refuses a
   * subscription that lists `interest`.
   */
  readonly interestModel?: string | EvaluationModel;
  /** The app's custom screens by name, run in this order. A subscription lists one as `{ screen: "custom", name }`. */
  readonly custom?: Readonly<Record<string, CustomScreen>>;
}

/** The reason a subscription is refused when its interest couldn't be judged: not on content. **Pinned** (D1). */
export const INTEREST_UNJUDGED = "interest: unjudged";

/** A screen's refusal for having failed, not for the event: `<screen>: failed`. **Pinned** (D1). */
const FAILED_SCREEN = /: failed$/;

/**
 * Whether a verdict refused the event on its content. `interest: unjudged`, a
 * screen that failed (`<screen>: failed`), and `no verdict` are not, so an
 * outage leaves an event unheard by nobody's choice, never forwarded (D1).
 */
export function refusedOnContent(verdict: ScreenVerdict): boolean {
  return !verdict.pass && verdict.reason !== INTEREST_UNJUDGED && verdict.reason !== "no verdict" && !FAILED_SCREEN.test(verdict.reason);
}

/** One config screen's answer for one subscription: `undefined` to pass, or why it refused. */
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

/** A step over the undecided: `refusal` answers each, a refusal becomes a verdict, a pass stays undecided for the next. */
function refusingStep(name: string, refusal: (event: SubscriptionEvent, entry: IndexEntry) => string | undefined) {
  return handler({
    name,
    inputSchema: screeningSchema,
    outputSchema: screeningSchema,
    execute: async (screening: Screening): Promise<Screening> => {
      const pending: Candidate[] = [];
      const verdicts = [...screening.verdicts];
      for (const candidate of screening.pending) {
        const refused = refusal(screening.event, candidate.entry);
        if (refused === undefined) pending.push(candidate);
        else verdicts.push({ subscription: candidate.subscription, pass: false, reason: refused });
      }
      return { ...screening, pending, verdicts };
    }
  });
}

/** Run one config screen over the undecided. */
export function screenStep(kind: ScreenKind, options: ScreenOptions) {
  return refusingStep(`subscription-screen-${kind}`, (event, entry) => {
    const refused = screenRefusal(kind, event, entry, options);
    return refused === undefined ? undefined : `${kind}: ${refused}`;
  });
}

/** Whether `entry` lists the custom screen `name`. */
const listsCustom = (entry: IndexEntry, name: string) => entry.screens.some((listed) => listed.screen === "custom" && listed.name === name);

/** One custom screen's answer for one subscription: `undefined` to pass, or why it refused. A throw, or an answer that isn't a string, is `failed`. */
export function customRefusal(screen: CustomScreen["screen"], event: SubscriptionEvent, entry: IndexEntry): string | undefined {
  let answer: unknown;
  try {
    answer = screen(event, entry);
  } catch {
    return "failed";
  }
  if (answer === undefined) return undefined;
  return typeof answer === "string" ? answer : "failed";
}

/** Run the custom screen `name` over the undecided that list it: a refusal becomes `custom:<name>: <why>`. */
export function customScreenStep(name: string, custom: CustomScreen) {
  return refusingStep(`subscription-screen-custom-${name}`, (event, entry) => {
    const refused = listsCustom(entry, name) ? customRefusal(custom.screen, event, entry) : undefined;
    return refused === undefined ? undefined : `custom:${name}: ${refused}`;
  });
}

/** The first custom screen `entry` lists that the provider doesn't declare. */
const undeclaredCustom = (entry: IndexEntry, declared: readonly string[]) =>
  entry.screens.find((listed) => listed.screen === "custom" && !declared.includes(listed.name)) as { name: string } | undefined;

/** Whether an undecided subscription lists a custom screen the provider doesn't declare. */
export const listsUndeclaredCustom = (declared: readonly string[]) => (screening: Screening) =>
  screening.pending.some((candidate) => undeclaredCustom(candidate.entry, declared) !== undefined);

/** Refuse, as `custom:<name>: failed`, the undecided that list a custom screen the provider no longer declares: it can't run. */
export function undeclaredCustomStep(declared: readonly string[]) {
  return refusingStep("subscription-screen-custom-undeclared", (_event, entry) => {
    const missing = undeclaredCustom(entry, declared);
    return missing === undefined ? undefined : `custom:${missing.name}: failed`;
  });
}

/** Every subscription still undecided after every screen it lists passed it. */
export const passRest = handler({
  name: "subscription-screens-passed",
  inputSchema: screeningSchema,
  outputSchema: screeningSchema,
  execute: async (screening: Screening): Promise<Screening> => ({
    ...screening,
    pending: [],
    verdicts: [
      ...screening.verdicts,
      ...screening.pending.map((c) => ({ subscription: c.subscription, pass: true, reason: "passed its screens" }))
    ]
  })
});

/** Whether a subscription is still undecided. */
export const undecided = (screening: Screening) => screening.pending.length > 0;
