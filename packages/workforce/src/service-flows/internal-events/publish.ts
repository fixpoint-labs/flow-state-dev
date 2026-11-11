// FIX-2630 D1, D2; epic FIX-2471 ER-2, ER-6.
/**
 * `publishEvent`: announce once, on a declared topic. One verb, as a
 * function a block in any flow calls and as a worker's tool; both run
 * {@link publish}.
 *
 * Its input is strict, `{ topic, kind, title, text, data? }`: it names no
 * sender, no recipient and no hop. In order, before anything is sent:
 *
 * - the topic and kind are declared, else refused, naming the declared topics;
 * - `data` passes the topic's schema, and is rendered into the text (an event
 *   carries no `data` field), which holds at most 4,000 characters;
 * - the publish pays one place in its turn's message chain (`payPlace`), however
 *   many will hear it, so past the budget it is refused with the budget's reason.
 *
 * Then the event goes through the dispatch seam to the internal service
 * flow's routing entry: the host routes it as `service:internal`, with this
 * session as its sender, to this user's routines on the topic. The event is
 * one object at version 0, its id kept in request state, so a repeat after a
 * crash is one event. It carries the chain it paid into and the hop one
 * before its place, so each delivery lands where a message sent in its place
 * would. It files no task and asks no reply, and the answer is
 * `{ published }` or `{ refused }`, never who heard.
 */
import { defineCapability, handler, markDispatcher } from "@flow-state-dev/core";
import { dispatchThroughSeam } from "@flow-state-dev/core/internal";
import { MAX_SUBSCRIPTION_EVENT_TEXT, type BlockContext, type SubscriptionEvent } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { z } from "zod";
import type { WorkerInstallation } from "../../workers/installation";
import { messageTurnStateSchema } from "../../messages/hop";
import { workerMessagesResources } from "../../messages/message-log";
import { payPlace } from "../../messages/send-message";
import { SUBSCRIPTION_ROUTE_ENTRY } from "../../subscriptions/keys";
import { INTERNAL_PROVIDER, internalThreadKey, undeclared, type InternalTopics } from "./topics";

/** The verb's name, as a tool and as the dispatch's sending block. */
const PUBLISH_EVENT_TOOL = "publishEvent";

/** The request-state field the ids of this request's publishes are kept in, by what was published: a repeat publishes nothing new. */
const TURN_PUBLISHED_STATE = "workforcePublished";

/** What a publish takes. Strict: no sender, no recipient, no hop. */
export const publishEventInputSchema = z
  .object({
    topic: z.string().min(1).describe("One of the declared topics, as the list below names it."),
    kind: z.string().min(1).describe("One of the topic's kinds."),
    title: z.string().min(1).max(200).describe("One line saying what happened."),
    text: z.string().min(1).describe("What a follower should know, in a few sentences."),
    data: z.unknown().optional().describe("The topic's data, as the list below shapes it. Leave it out for a topic that takes none.")
  })
  .strict();

export type PublishEventInput = z.infer<typeof publishEventInputSchema>;

/** What a publish came to: the event's id, or why nothing was published. Never who heard. */
export type PublishOutcome = { readonly published: string } | { readonly refused: string };

const publishOutcomeSchema = z.union([z.object({ published: z.string() }), z.object({ refused: z.string() })]);

/** The request state a publish keeps beside the message counts. */
const publishTurnStateSchema = messageTurnStateSchema.extend({ [TURN_PUBLISHED_STATE]: z.record(z.string(), z.string()).optional() });

/** A new event id. */
const newEventId = () => `evt_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

/** What one publish says, as one key: the same publish in one request is one event. */
async function publishKey(input: PublishEventInput, data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([input.topic, input.kind, input.title, input.text, data ?? null]));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The event's id for this publish in this request: the one kept for it, or a new one, kept. */
async function eventIdFor(ctx: BlockContext, key: string): Promise<string> {
  const fresh = newEventId();
  const kept = await withOutcome(
    (mutator: (s: Readonly<Record<string, unknown>>) => Record<string, unknown>) => ctx.request.atomicState(mutator as never),
    (current: Readonly<Record<string, unknown>>) => {
      const published = (current[TURN_PUBLISHED_STATE] ?? {}) as Record<string, string>;
      const id = published[key];
      return id !== undefined ? { state: {}, result: id } : { state: { [TURN_PUBLISHED_STATE]: { ...published, [key]: fresh } }, result: fresh };
    }
  );
  return typeof kept === "string" ? kept : fresh;
}

/** The topic's data as text, appended to what the publisher wrote. */
const withData = (text: string, data: unknown) => (data === undefined ? text : `${text}\n${JSON.stringify(data)}`);

/** How the publish tool lists a topic: its name, kinds, description, and its data's fields. */
function topicLine(name: string, topics: InternalTopics): string {
  const topic = topics[name]!;
  const shape = (topic.data as { shape?: Record<string, unknown> } | undefined)?.shape;
  const data = topic.data === undefined ? "no data" : shape === undefined ? "data as the topic declares" : `data { ${Object.keys(shape).join(", ")} }`;
  return `- ${name} (kinds: ${topic.kinds.join(", ")}; ${data})${topic.description === undefined ? "" : `: ${topic.description}`}`;
}

/** What publishing is built with. */
export interface PublishingOptions {
  readonly installation: WorkerInstallation;
  readonly topics: InternalTopics;
  /** The internal service flow's kind: where a publish is routed. */
  readonly kind: string;
}

/**
 * Publish `input` from the running session. See the file header for what is
 * checked, and in what order.
 */
async function publish(ctx: BlockContext, options: PublishingOptions, input: unknown): Promise<PublishOutcome> {
  const parsed = publishEventInputSchema.safeParse(input);
  if (!parsed.success) {
    return { refused: `invalid_input: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}. Nothing was published.` };
  }
  const given = parsed.data;
  const undeclaredTopic = undeclared(options.topics, given.topic, [given.kind], "publish");
  if (undeclaredTopic !== undefined) return { refused: `${undeclaredTopic} Nothing was published.` };
  const topic = options.topics[given.topic]!;
  let data: unknown;
  if (topic.data === undefined) {
    if (given.data !== undefined) return { refused: `invalid_data: "${given.topic}" takes no data. Nothing was published.` };
  } else {
    const checked = topic.data.safeParse(given.data);
    if (!checked.success) {
      return { refused: `invalid_data: ${checked.error.issues.map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`).join("; ")}. Nothing was published.` };
    }
    data = checked.data;
  }
  const text = withData(given.text, data);
  if (text.length > MAX_SUBSCRIPTION_EVENT_TEXT) {
    return { refused: `too_long: an event holds at most ${MAX_SUBSCRIPTION_EVENT_TEXT} characters with its data; this one has ${text.length}. Nothing was published.` };
  }

  // One place in the turn's chain, however many hear it: the budget is the loop guard (D2).
  const id = await eventIdFor(ctx, await publishKey(given, data));
  const place = await payPlace(ctx, options.installation, id);
  if (!place.ok) return { refused: place.error.replace("Nothing was sent.", "Nothing was published.") };

  const thread = internalThreadKey(given.topic);
  const now = Date.now();
  const event: SubscriptionEvent = {
    provider: INTERNAL_PROVIDER,
    threads: [thread],
    kind: given.kind,
    object: { id, version: 0 },
    // The seam replaces it: this session, as a member, named by its worker (else its flow's kind), and the owner beside it.
    sender: { id: ctx.session.identity.id, name: "", role: "member" },
    audience: "private",
    title: given.title,
    text,
    labels: [],
    url: thread,
    received: now,
    at: now,
    hop: place.hop - 1,
    chain: place.chain
  };
  const outcome = await dispatchThroughSeam(ctx, {
    type: "internal",
    action: SUBSCRIPTION_ROUTE_ENTRY,
    flowKind: options.kind,
    // Not read: a service route runs in the service's routing session.
    session: { key: id },
    payload: event,
    from: PUBLISH_EVENT_TOOL
  });
  if (!outcome.ok) return { refused: `not_published: ${outcome.refused}: ${outcome.detail}` };
  return { published: id };
}

/** The verb, as a function, a worker's tool, and the resources a block that calls it declares. */
export function definePublishing(options: PublishingOptions) {
  const description =
    "Announce something that happened, once, on a declared topic: whoever follows the topic hears it as information. " +
    "You don't name who hears it and you don't learn who did; it files no task and asks no reply. " +
    "To ask a worker something, send it a message; for work someone owes you, file a task. " +
    `Topics:\n${Object.keys(options.topics)
      .map((name) => topicLine(name, options.topics))
      .join("\n")}`;
  const tool = handler({
    name: PUBLISH_EVENT_TOOL,
    description,
    inputSchema: publishEventInputSchema,
    outputSchema: publishOutcomeSchema,
    requestStateSchema: publishTurnStateSchema,
    resources: { ...workerMessagesResources },
    execute: (input, ctx) => publish(ctx, options, input)
  });
  markDispatcher(tool, { type: "internal", action: SUBSCRIPTION_ROUTE_ENTRY, flowKind: options.kind });
  const capability = defineCapability({
    name: "internalEvents",
    resources: { ...workerMessagesResources },
    presets: { tools: { tools: [tool] }, default: ["tools"] }
  });
  return {
    publishEvent: (ctx: BlockContext, input: unknown) => publish(ctx, options, input),
    capability,
    resources: { ...workerMessagesResources }
  };
}
