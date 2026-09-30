/**
 * Variant 3 — thin `wakes:` alias.
 *
 * Naming sugar only. `expandWakes` returns `{ schedules, webhooks }` that
 * `defineFlow` already accepts. No new runtime bus, no host route, no
 * Heartbeats product. A misspelled `type` throws here — the same moment
 * `validateSchedulesConfig` / `validateWebhookConfig` would catch a bad
 * binding on the flow.
 */
import {
  defineScheduleBinding,
  defineWebhookBinding,
  type ScheduleConfig,
  type SchedulesConfig,
  type WebhookConfig,
  type WebhookEventBinding,
  type WebhookInboundEvent,
} from "@flow-state-dev/core";
import type { ActionCore } from "@flow-state-dev/core/types";

export type CronWake = ActionCore & {
  type: "cron";
  id: string;
  cron: string;
  timezone?: string;
  onOverlap?: "skip" | "allow";
  description?: string;
  input?: ScheduleConfig["input"];
  principal?: ScheduleConfig["principal"];
};

export type WebhookWake<TPayload = unknown> = ActionCore & {
  type: "webhook";
  provider: string;
  event: string;
  input: (event: WebhookInboundEvent<TPayload>) => unknown | Promise<unknown>;
  sessionId?: (
    event: WebhookInboundEvent<TPayload>,
  ) => string | Promise<string> | undefined;
  when?: (event: WebhookInboundEvent<TPayload>) => boolean;
};

/** Payload is `any` so typed GitHub/Stripe mappers assign without a cast. */
export type WakeDecl = CronWake | WebhookWake<any>;

export function expandWakes(wakes: WakeDecl[]): {
  schedules: SchedulesConfig;
  webhooks: WebhookConfig;
} {
  const staticSchedules: Record<string, ScheduleConfig> = {};
  const webhooks: WebhookConfig = {};

  for (const wake of wakes) {
    if (wake.type === "cron") {
      const { type: _type, id, ...binding } = wake;
      staticSchedules[id] = defineScheduleBinding(binding);
      continue;
    }

    if (wake.type === "webhook") {
      const { type: _type, provider, event, ...binding } = wake;
      const on = (webhooks[provider] ??= { on: {} }).on;
      on[event] = defineWebhookBinding(binding) as WebhookEventBinding;
      continue;
    }

    const unknown = wake as { type?: string };
    throw new Error(
      `expandWakes does not compile type ${JSON.stringify(unknown.type)}. ` +
        `Use "cron" or "webhook". A channel poke is Layer 2 Workforce notify, ` +
        `not an L1 binding.`,
    );
  }

  return { schedules: { static: staticSchedules }, webhooks };
}
