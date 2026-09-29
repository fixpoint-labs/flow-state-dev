/**
 * Pins the three authoring shapes against today's bindings — and the hire gap.
 *
 * What would make this fail: a variant that invents a second dispatch bus,
 * a compile that fakes a channel binding, or hire silently accepting `wakes:`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defineFlow, validateSchedulesConfig, validateWebhookConfig } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { hireWorkforce, workerConfigSchema } from "@flow-state-dev/workforce";
import type { WorkerManifest } from "@flow-state-dev/workforce";
import { expandWakes } from "../src/expand-wakes";
import inboxWatchFlowConfig, { inboxWatchFlowConfig as flowConfigDef } from "../src/flow-config";
import inboxWatchWakesAlias, { inboxWatchWakesAlias as aliasDef } from "../src/wakes-alias-flow";
import { inspectWakes, WORKER_WAKE_BLOCKS } from "../src/handlers";
import {
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
  SWEEP_CRON,
  SWEEP_SCHEDULE_ID,
} from "../src/scenario";
import { compileWorkerWakes } from "../src/worker-md/compile";
import inboxWatchWorkerMd, {
  compiledWorkerWakes,
  inboxWatchWorkerMd as workerMdDef,
} from "../src/worker-md/flow";

const workerMdPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/worker-md/WORKER.md",
);

function scheduleIds(flow: { schedules?: { static?: Record<string, { cron: string }> } }) {
  return Object.entries(flow.schedules?.static ?? {}).map(([id, binding]) => ({
    id,
    cron: binding.cron,
  }));
}

function webhookKeys(flow: {
  webhooks?: Record<string, { on?: Record<string, unknown> }>;
}) {
  return Object.entries(flow.webhooks ?? {}).flatMap(([provider, sub]) =>
    Object.keys(sub.on ?? {}).map((event) => ({ provider, event })),
  );
}

describe("three authoring shapes compile to the same L1 bindings", () => {
  const variants = [
    { name: "flow-config", flow: inboxWatchFlowConfig, def: flowConfigDef },
    { name: "worker-md", flow: inboxWatchWorkerMd, def: workerMdDef },
    { name: "wakes-alias", flow: inboxWatchWakesAlias, def: aliasDef },
  ];

  it.each(variants)("$name registers sweep-open and github issues", ({ flow, def }) => {
    expect(scheduleIds(flow)).toEqual([{ id: SWEEP_SCHEDULE_ID, cron: SWEEP_CRON }]);
    expect(webhookKeys(flow)).toEqual([
      { provider: GITHUB_PROVIDER, event: GITHUB_ISSUES_EVENT },
    ]);
    expect(flow.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.when).toEqual(
      expect.any(Function),
    );
    validateSchedulesConfig(flow.kind, flow.schedules);
    validateWebhookConfig(flow.kind, flow.webhooks);
    expect(def.kind).toBe(flow.kind);
  });

  it("worker-md leaves the channel poke uncompiled", () => {
    expect(compiledWorkerWakes.leftovers).toEqual([
      {
        id: "desk-poke",
        when: "channel",
        reason: expect.stringContaining("Layer 2"),
      },
    ]);
    expect(compiledWorkerWakes.declaredWithoutWakes.wakes).toBeUndefined();
    expect(compiledWorkerWakes.declaredWithoutWakes.description).toBe(
      "Night-watch the support inbox.",
    );
  });

  it("recompiling WORKER.md matches the minted worker-md flow", () => {
    const again = compileWorkerWakes(readFileSync(workerMdPath, "utf8"), WORKER_WAKE_BLOCKS);
    expect(Object.keys(again.schedules.static ?? {})).toEqual(
      Object.keys(inboxWatchWorkerMd.schedules?.static ?? {}),
    );
    expect(webhookKeys({ webhooks: again.webhooks })).toEqual(webhookKeys(inboxWatchWorkerMd));
  });
});

describe("what runs when a wake fires", () => {
  it("sweep records an interval tick", async () => {
    const result = await testFlow({
      flow: inboxWatchFlowConfig,
      action: "sweep",
      userId: "system",
      input: { reason: "interval", nominalFireTime: "2026-09-29T12:00:00.000Z" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({
      swept: true,
      reason: "interval",
      at: "2026-09-29T12:00:00.000Z",
    });
  });

  it("record stores the opened issue", async () => {
    const result = await testFlow({
      flow: inboxWatchWorkerMd,
      action: "record",
      userId: "system",
      input: {
        provider: "github",
        repo: "fixpoint-labs/flow-state-dev",
        issueNumber: 2361,
        title: "Keeping flows alive",
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({
      recorded: true,
      repo: "fixpoint-labs/flow-state-dev",
      issueNumber: 2361,
      title: "Keeping flows alive",
    });
  });

  it("inspect lists the shared wake table", async () => {
    const result = await testFlow({
      flow: inboxWatchWakesAlias,
      action: "inspect",
      userId: "system",
      input: {},
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({
      variant: "wakes-alias",
      schedules: [{ id: SWEEP_SCHEDULE_ID, cron: SWEEP_CRON }],
    });
  });

  it("github when-predicate ignores non-opened issues", () => {
    const when = inboxWatchFlowConfig.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]
      ?.when;
    expect(when).toBeTypeOf("function");
    expect(
      when?.({
        provider: "github",
        eventType: "issues",
        payload: {
          action: "closed",
          issue: { number: 1, title: "x" },
          repository: { full_name: "a/b" },
        },
        headers: new Headers(),
        rawBody: new Uint8Array(),
      }),
    ).toBe(false);
    expect(
      when?.({
        provider: "github",
        eventType: "issues",
        payload: {
          action: "opened",
          issue: { number: 1, title: "x" },
          repository: { full_name: "a/b" },
        },
        headers: new Headers(),
        rawBody: new Uint8Array(),
      }),
    ).toBe(true);
  });
});

describe("compile and alias refuse what they cannot map", () => {
  it("expandWakes rejects a channel type instead of inventing a bus", () => {
    expect(() =>
      expandWakes([
        { type: "channel", id: "desk-poke" } as unknown as Parameters<
          typeof expandWakes
        >[0][number],
      ]),
    ).toThrow(/Layer 2/);
  });

  it("compile reports an unknown webhook event as a leftover, not a fake binding", () => {
    const compiled = compileWorkerWakes(
      `---
description: gap
wakes:
  - id: slack-msg
    when: webhook
    provider: slack
    event: message
    runs: record-inbound-issue
---
`,
      WORKER_WAKE_BLOCKS,
    );
    expect(compiled.webhooks).toEqual({});
    expect(compiled.leftovers[0]).toMatchObject({
      id: "slack-msg",
      when: "webhook",
    });
  });
});

describe("hireWorkforce does not apply wakes as config", () => {
  it("refuses wakes on a closed workerConfigSchema", () => {
    const kind = defineFlow({
      kind: "inbox-watch",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { inspect: { block: inspectWakes("hire-gap") } },
    });

    const manifest: WorkerManifest = {
      id: "desk.watch",
      declared: {
        flow: "inbox-watch",
        description: "Night watch",
        wakes: [{ when: "cron", id: "sweep-open", cron: SWEEP_CRON }],
      },
      body: "Sweep the inbox.",
    };

    expect(() => hireWorkforce([manifest], { kinds: { "inbox-watch": kind } })).toThrow(
      /"wakes" is not a declared setting/,
    );
  });

  it("hires after wakes are stripped — and the seat still has no schedules", () => {
    const kind = defineFlow({
      kind: "inbox-watch",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { inspect: { block: inspectWakes("hire-stripped") } },
    });

    const seats = hireWorkforce(
      [
        {
          id: "desk.watch",
          declared: {
            flow: "inbox-watch",
            description: "Night watch",
          },
          body: "Sweep the inbox.",
        },
      ],
      { kinds: { "inbox-watch": kind } },
    );

    expect(seats).toHaveLength(1);
    expect(seats[0]?.schedules).toBeUndefined();
    expect(seats[0]?.webhooks).toBeUndefined();
  });
});
