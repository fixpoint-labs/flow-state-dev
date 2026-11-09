// FIX-2536 D3; epic FIX-2471 ER-5, D10.
/**
 * Subscriptions an app's config declares: each entry
 * names its owner, the worker that hears, and the thread, and is written by
 * `subscribe`'s own write (ER-5) under a stable id, `cfg_<hash of flow kind
 * and entry id>`, so a restart writes nothing new.
 *
 * - **When it writes.** Only when the row is missing, or the entry's
 *   config-owned fields changed. A row its thread, task or user ended stays
 *   ended while its entry is unchanged; a changed entry merges only the fields
 *   config owns and keeps whether the row is on, so the seed never turns back
 *   on what someone turned off.
 * - **As whom.** The entry's owner, as server config, never a request's input: the seed runs in
 *   the owner's own request, so the row lands in their shared cell, `canRead`
 *   checks the thread on their credentials, and it polls as them (D1).
 * - **Where it is heard.** The entry's explicit target, or the owner's own
 *   conversation with the worker (the session `deriveWorkerSessionId` gives).
 * - **When it ends.** A `cfg_` row whose entry left config ends at its poll
 *   row's next fire (`config_removed`); `sub_` rows are untouched.
 *
 * The list itself is the declared routines': `hireWorkforce(installation, { routines: {
 * declared } })`, whose event-triggered entries are {@link DeclaredSubscription}s.
 * Until that lands, a host runs the seed at startup by dispatching the service
 * flow's {@link SUBSCRIPTION_SEED_ENTRY} as each owner.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { deriveWorkerSessionId } from "../workers/derive-session-id";
import type { WorkerInstallation } from "../workers/installation";
import { listedScreenSchema, subscriptionsOf, type SubscriptionResourceState } from "./rows";
import { POLL_CADENCES } from "./poll";
import type { SubscriptionPolling } from "./poll";
import { writeSubscription, type SubscriptionProvider } from "./subscribe";

/** The service flow's seed entry: the running owner's declared subscriptions in, each written once. **Pinned**: not on the root. */
export const SUBSCRIPTION_SEED_ENTRY = "seedDeclaredSubscriptions";

// The shape of an event-triggered declared routine (FIX-2614).
/** One subscription a config declares. */
export const declaredSubscriptionSchema = z
  .object({
    /** The entry's id in config: with the flow kind, the row's id. */
    id: z.string().min(1),
    /** Who it runs as, by server config, never by a request. */
    owner: z.object({ userId: z.string().min(1), orgId: z.string().min(1) }).strict(),
    /** The worker that hears. */
    worker: z.string().min(1),
    /** Where it is heard, when not the owner's own conversation with the worker. */
    target: z.object({ sessionId: z.string().min(1), taskId: z.string().min(1).optional() }).strict().optional(),
    trigger: z
      .object({
        event: z
          .object({
            provider: z.string().min(1),
            thread: z.string().min(1),
            interest: z.string().min(1).max(500),
            kinds: z.array(z.string().min(1)).optional(),
            screens: z.array(listedScreenSchema).optional(),
            outsiders: z.literal(true).optional(),
            everyMinutes: z.number().int().optional()
          })
          .strict()
      })
      .strict()
  })
  .strict()
  .superRefine((entry, issue) => {
    const minutes = entry.trigger.event.everyMinutes;
    if (minutes !== undefined && !(POLL_CADENCES as readonly number[]).includes(minutes)) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path: ["trigger", "event", "everyMinutes"], message: `everyMinutes must be one of ${POLL_CADENCES.join(", ")}.` });
    }
  });

export type DeclaredSubscription = z.infer<typeof declaredSubscriptionSchema>;

/** What a seed came to, per entry. */
export type SeedOutcome = { readonly id: string; readonly act: "written" | "unchanged" } | { readonly id: string; readonly refused: string };

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha(text: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** A declared subscription's row id: `cfg_` and a hash of the flow kind and the entry's id. Stable across restarts. */
export async function configSubscriptionId(flowKind: string, entryId: string): Promise<string> {
  return `cfg_${hex((await sha(`${flowKind}\n${entryId}`)).slice(0, 12))}`;
}

/** Whether a row id is one a config seed wrote. */
export const isConfigSubscriptionId = (id: string) => id.startsWith("cfg_");

/** The fields config owns, as one comparable value. */
function configFields(entry: DeclaredSubscription, flow: string, sessionId: string) {
  const event = entry.trigger.event;
  return {
    provider: event.provider,
    thread: event.thread.trim(),
    kinds: event.kinds ?? null,
    screens: event.screens ?? [],
    outsiders: event.outsiders ?? null,
    interest: event.interest,
    everyMinutes: event.everyMinutes ?? null,
    worker: entry.worker,
    flow,
    sessionId,
    taskId: entry.target?.taskId ?? null
  };
}

/** A hash of the fields config owns: a changed entry changes it. */
async function configHashOf(fields: ReturnType<typeof configFields>): Promise<string> {
  return hex((await sha(JSON.stringify(fields))).slice(0, 12));
}

/**
 * Write one declared subscription for the running owner, through
 * `subscribe`'s write, when it is missing or its entry changed.
 */
export async function seedSubscription(
  ctx: BlockContext,
  options: {
    readonly flowKind: string;
    readonly providers: readonly SubscriptionProvider[];
    readonly installation: WorkerInstallation;
    readonly polling?: SubscriptionPolling;
  },
  entry: DeclaredSubscription
): Promise<SeedOutcome> {
  const id = await configSubscriptionId(options.flowKind, entry.id);
  const identity = ctx.session.identity as { userId?: string; orgId?: string };
  if (identity.userId !== entry.owner.userId || identity.orgId !== entry.owner.orgId) {
    return { id, refused: "not_the_owner: a declared subscription is written only in its owner's own request." };
  }
  const event = entry.trigger.event;
  const thread = event.thread.trim();
  const provider = options.providers.find((p) => p.provider === event.provider);
  if (provider === undefined) return { id, refused: `no_provider: "${event.provider}" isn't a provider this app subscribes on.` };
  if (!thread.startsWith(`${provider.provider}:`)) return { id, refused: `wrong_provider: a ${provider.provider} thread key starts with "${provider.provider}:".` };
  const worker = await options.installation.rosterWorker(ctx, entry.worker);
  if (worker === undefined) return { id, refused: `no_worker: "${entry.worker}" isn't on the owner's roster.` };
  const sessionId =
    entry.target?.sessionId ??
    (await deriveWorkerSessionId({ userId: entry.owner.userId, orgId: entry.owner.orgId, flow: worker.flow, criteria: { worker: entry.worker } }));
  const fields = configFields(entry, worker.flow, sessionId);
  const configHash = await configHashOf(fields);

  const existing = (await subscriptionsOf(ctx).getOptional(id))?.state as (SubscriptionResourceState & { configHash?: string }) | undefined;
  if (existing !== undefined && existing.configHash === configHash) return { id, act: "unchanged" };
  if (!(await provider.canRead(thread, ctx))) return { id, refused: `not_readable: the owner can't read "${thread}".` };
  const self = await provider.self?.(ctx);
  const row: SubscriptionResourceState = {
    id,
    provider: provider.provider,
    thread,
    ...(event.kinds === undefined ? {} : { kinds: event.kinds }),
    screens: event.screens ?? [],
    ...(event.outsiders === true ? { outsiders: true as const } : {}),
    ...(self === undefined ? {} : { self }),
    interest: event.interest,
    sessionId,
    flow: worker.flow,
    worker: entry.worker,
    ...(entry.target?.taskId === undefined ? {} : { taskId: entry.target.taskId }),
    ...(event.everyMinutes === undefined ? {} : { everyMinutes: event.everyMinutes }),
    userId: entry.owner.userId,
    orgId: entry.owner.orgId,
    configHash,
    // A changed entry keeps whether the row is on: the seed never turns back on what someone turned off.
    enabled: existing === undefined ? true : existing.enabled,
    ...(existing?.endedReason === undefined ? {} : { endedReason: existing.endedReason }),
    ...(existing?.endedAt === undefined ? {} : { endedAt: existing.endedAt }),
    at: existing?.at ?? Date.now()
  };
  await writeSubscription(ctx, row, options.polling);
  return { id, act: "written" };
}
