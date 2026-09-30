/**
 * Compile `wakes:` in a WORKER.md frontmatter into existing L1 bindings.
 *
 * This is an authoring sketch, not a loader change. `hireWorkforce` does not
 * call it. Extra frontmatter keys become flow config; schedules/webhooks live
 * on the kind. If you leave `wakes:` on `declared` and hire a closed
 * `configSchema`, the mint refuses the key by name (see the hire-gap test).
 *
 * YAML cannot hold functions. Named `action` / `session` values map to the
 * small catalog below. Unknown names are a documented gap, not a guessed
 * runtime.
 */
import {
  defineScheduleBinding,
  defineWebhookBinding,
  type ScheduleConfig,
  type SchedulesConfig,
  type ScheduleInputContext,
  type WebhookConfig,
} from "@flow-state-dev/core";
import { parseFrontmatterYaml, splitFrontmatter } from "@flow-state-dev/orchestration";
import type { BlockDefinition } from "@flow-state-dev/core";
import {
  inboundFromGitHubIssue,
  isIssueOpened,
  issueSessionId,
} from "../github-issues";

export type WakeLeftover = {
  id: string;
  when: string;
  reason: string;
};

export type CompiledWorkerWakes = {
  schedules: SchedulesConfig;
  webhooks: WebhookConfig;
  leftovers: WakeLeftover[];
  /** Frontmatter without `wakes` — what hire may still receive as config. */
  declaredWithoutWakes: Record<string, unknown>;
};

type BlockCatalog = Record<string, BlockDefinition<any, any>>;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`WORKER.md ${label} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`WORKER.md ${label} must be a non-empty string.`);
  }
  return value;
}

function resolveBlock(runs: string, blocks: BlockCatalog): BlockDefinition<any, any> {
  const block = blocks[runs];
  if (block === undefined) {
    throw new Error(
      `WORKER.md wake runs ${JSON.stringify(runs)}, which is not in the ` +
        `compile catalog (${Object.keys(blocks).join(", ") || "(empty)"}).`,
    );
  }
  return block;
}

/**
 * Parse a WORKER.md and compile cron/webhook rows to `schedules` / `webhooks`.
 * Channel rows (and any other `when`) become leftovers.
 */
export function compileWorkerWakes(
  markdown: string,
  blocks: BlockCatalog,
): CompiledWorkerWakes {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml.trim().length === 0) {
    throw new Error("WORKER.md has no frontmatter.");
  }

  const declared = parseFrontmatterYaml(yaml);
  const { wakes, ...rest } = declared;
  const declaredWithoutWakes = rest;

  if (wakes == null) {
    return {
      schedules: { static: {} },
      webhooks: {},
      leftovers: [],
      declaredWithoutWakes,
    };
  }

  if (!Array.isArray(wakes)) {
    throw new Error('WORKER.md `wakes:` must be a list of mappings.');
  }

  const staticSchedules: Record<string, ScheduleConfig> = {};
  const webhooks: WebhookConfig = {};
  const leftovers: WakeLeftover[] = [];

  for (const raw of wakes) {
    const row = asRecord(raw, "wake row");
    const id = asString(row.id, "wake id");
    const when = asString(row.when, `wake "${id}" when`);

    if (when === "cron") {
      const runs = asString(row.runs, `wake "${id}" runs`);
      const cron = asString(row.cron, `wake "${id}" cron`);
      const onOverlap = row.onOverlap;
      if (onOverlap !== undefined && onOverlap !== "skip" && onOverlap !== "allow") {
        throw new Error(
          `WORKER.md wake "${id}" onOverlap must be "skip" or "allow".`,
        );
      }
      staticSchedules[id] = defineScheduleBinding({
        cron,
        block: resolveBlock(runs, blocks),
        timezone: typeof row.timezone === "string" ? row.timezone : undefined,
        onOverlap,
        description:
          typeof row.description === "string" ? row.description : undefined,
        input: (ctx: ScheduleInputContext) => ({
          reason: "interval",
          nominalFireTime: ctx.nominalFireTime,
        }),
      });
      continue;
    }

    if (when === "webhook") {
      const runs = asString(row.runs, `wake "${id}" runs`);
      const provider = asString(row.provider, `wake "${id}" provider`);
      const event = asString(row.event, `wake "${id}" event`);
      const action = row.action;
      const session = row.session;

      if (event !== "issues") {
        leftovers.push({
          id,
          when,
          reason:
            `No compile mapper for webhook event ${JSON.stringify(event)}. ` +
            `This sketch only maps GitHub \`issues\`.`,
        });
        continue;
      }
      if (action !== undefined && action !== "opened") {
        leftovers.push({
          id,
          when,
          reason: `No compile mapper for action ${JSON.stringify(action)}.`,
        });
        continue;
      }
      if (session !== undefined && session !== "issue") {
        leftovers.push({
          id,
          when,
          reason: `No compile mapper for session ${JSON.stringify(session)}.`,
        });
        continue;
      }

      const on = (webhooks[provider] ??= { on: {} }).on;
      on[event] = defineWebhookBinding({
        block: resolveBlock(runs, blocks),
        when: action === "opened" ? isIssueOpened : undefined,
        input: inboundFromGitHubIssue,
        sessionId: session === "issue" ? issueSessionId : undefined,
      });
      continue;
    }

    if (when === "channel") {
      leftovers.push({
        id,
        when,
        reason:
          "Channel poke is Workforce Layer 2 (CHANNEL.md members + " +
          "onChannelPost / wakeMemberSeats). There is no L1 schedule or " +
          "webhook binding to compile to.",
      });
      continue;
    }

    leftovers.push({
      id,
      when,
      reason: `Unknown when ${JSON.stringify(when)}. Compile knows cron, webhook, and channel (leftover).`,
    });
  }

  return {
    schedules: { static: staticSchedules },
    webhooks,
    leftovers,
    declaredWithoutWakes,
  };
}
