// FIX-2630 D1, D2, Q1; epic FIX-2471 ER-2, ER-4, ER-5, ER-6.
/**
 * Internal events: a session that learns something announces it once, on a
 * declared topic, and every routine that follows the topic hears it once, as
 * information, from `service:internal`. A third way into subscriptions,
 * beside a webhook's push and a poll: the event goes through the same
 * routing, screens, cursor and cap (`defineSubscriptionServiceFlow`), with an
 * `internal` provider, on thread keys `internal:<topic>`.
 *
 * - **Topics are declared** ({@link InternalTopics}): each with its kinds,
 *   the schema its `data` is checked by, and a description. A publish and a
 *   subscription to a topic or kind that isn't declared are refused, naming
 *   the declared ones. No wildcards: a subscription's kinds only narrow.
 * - **A publish** (`./publish`) enters through the dispatch seam: the host
 *   routes it as `service:internal` in the sender's org, stamps its sender as
 *   the publishing session, and fires only the publisher's own user's runs
 *   (own-user first, Q1). A teammate and another org hear nothing.
 * - **`canRead`** is a declared topic, read as a member of the org: an owner
 *   run never leaves it. Events are private, so it is asked again per
 *   delivery. **`self`** is the subscribing session, so a session never hears
 *   its own events.
 * - **The loop guard is the message budget** (D2): a publish pays one place
 *   in its turn's message chain however many hear it, carries that chain and
 *   its hop, and each delivery lands in that chain one hop on, so everything
 *   the woken sessions send next pays into the same budget.
 *
 * Internal threads never close, and are never polled.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { WorkerInstallation } from "../../workers/installation";
import type { SubscriptionProvider } from "../../subscriptions/subscribe";
import { defineSubscriptionServiceFlow } from "../service-flow";
import { definePublishing, type PublishOutcome } from "./publish";
import { INTERNAL_PROVIDER, INTERNAL_SERVICE_FLOW, topicOf, undeclared, type InternalTopics } from "./topics";

/** What {@link internalServiceFlow} is built with. */
export interface InternalServiceFlowOptions {
  /** The app's worker installation: the sessions it delivers to run its workers, and its message budget is the loop guard. */
  readonly installation: WorkerInstallation;
  /** The topics a session may publish on and a routine may follow. */
  readonly topics: InternalTopics;
  /** The flow kind. Default {@link INTERNAL_SERVICE_FLOW}. */
  readonly kind?: string;
  /** The most messages one subscription sends in an hour. */
  readonly capPerHour?: number;
  /** The most subscriptions one event is delivered to. */
  readonly maxOwnerRuns?: number;
}

/** The internal provider: declared topics only, read as a member of the org; the subscribing session is `self`. */
function internalProvider(topics: InternalTopics): SubscriptionProvider {
  return {
    provider: INTERNAL_PROVIDER,
    canRead(thread: string, ctx: BlockContext) {
      const topic = topicOf(thread);
      const orgId = (ctx.session.identity as { orgId?: string }).orgId;
      return topic !== undefined && Object.hasOwn(topics, topic) && typeof orgId === "string" && orgId.length > 0;
    },
    self: (_ctx, hearer) => hearer.sessionId,
    refuses(thread, kinds) {
      const topic = topicOf(thread);
      return topic === undefined ? undefined : undeclared(topics, topic, kinds, "follow");
    }
  };
}

/** What {@link internalServiceFlow} builds. */
export interface InternalServiceFlow {
  /** The service flow: register it with the app's flows. */
  readonly flow: ReturnType<typeof defineSubscriptionServiceFlow>;
  /** The `internal` provider: give it to `hireWorkforce`'s `routines.providers` beside the others. */
  readonly provider: SubscriptionProvider;
  /**
   * Publish from a block in any flow: `{ topic, kind, title, text, data? }`
   * in, `{ published }` or `{ refused }` out, never who heard. The block
   * declares {@link InternalServiceFlow.resources}.
   */
  publishEvent(ctx: BlockContext, input: unknown): Promise<PublishOutcome>;
  /** `publishEvent` as a worker's tool: name it in a worker flow's `uses`. */
  readonly capability: ReturnType<typeof definePublishing>["capability"];
  /** What a block that calls `publishEvent` declares: the message chains a publish pays its place in. */
  readonly resources: ReturnType<typeof definePublishing>["resources"];
}

/**
 * Build the internal service flow: its flow, its provider, and `publishEvent`.
 *
 * ```ts
 * const internal = internalServiceFlow({ installation, topics: {
 *   "deploy.finished": { kinds: ["succeeded", "failed"], data: z.object({ service: z.string(), sha: z.string() }) },
 * } });
 * hireWorkforce(installation, { routines: { providers: [github, internal.provider] } });
 * ```
 */
export function internalServiceFlow(options: InternalServiceFlowOptions): InternalServiceFlow {
  const kind = options.kind ?? INTERNAL_SERVICE_FLOW;
  for (const [topic, declared] of Object.entries(options.topics)) {
    if (topic.length === 0 || /[\s*]/.test(topic)) throw new Error(`internalServiceFlow: "${topic}" isn't a topic name: one word with no spaces or wildcards.`);
    if (declared.kinds.length === 0) throw new Error(`internalServiceFlow: "${topic}" declares no kinds.`);
  }
  const provider = internalProvider(options.topics);
  const flow = defineSubscriptionServiceFlow({
    kind,
    provider,
    installation: options.installation,
    published: true,
    ...(options.capPerHour === undefined ? {} : { capPerHour: options.capPerHour }),
    ...(options.maxOwnerRuns === undefined ? {} : { maxOwnerRuns: options.maxOwnerRuns })
  });
  const publishing = definePublishing({ installation: options.installation, topics: options.topics, kind });
  return { flow, provider, publishEvent: publishing.publishEvent, capability: publishing.capability, resources: publishing.resources };
}
