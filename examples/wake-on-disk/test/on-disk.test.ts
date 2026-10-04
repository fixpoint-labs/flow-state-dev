/**
 * Pins the two on-disk layouts — and one real dispatcher hop.
 *
 * What would make this fail: a worker in A that grew its own cron, a
 * B intake that lost sessionId, a hop that invents NotificationFlow,
 * or a WORKER.md that smuggles a `wakes:` list (that's #2369).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, validateSchedulesConfig, validateWebhookConfig } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import nightWatchIngress, {
  nightWatchIngress as nightWatchDef,
} from "../src/a-central/ingress/night-watch";
import nightIntakeKind from "../src/a-central/workers/intake/kind";
import nightSweepKind from "../src/a-central/workers/sweep/kind";
import nightTriageKind from "../src/a-central/workers/triage/kind";
import inboxIntakeFlow from "../src/b-per-flow/flows/intake/flow";
import inboxSweepFlow from "../src/b-per-flow/flows/sweep/flow";
import inboxTriageFlow from "../src/b-per-flow/flows/triage/flow";
import {
  CENTRAL_INGRESS_KIND,
  CENTRAL_INTAKE_KIND,
  CENTRAL_SWEEP_KIND,
  CENTRAL_TRIAGE_KIND,
  DESK_INTAKE_KIND,
  DESK_SWEEP_KIND,
  DESK_TRIAGE_KIND,
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
  SWEEP_CRON,
  SWEEP_SCHEDULE_ID,
} from "../src/shared/scenario";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function scheduleIds(flow: { schedules?: { static?: Record<string, { cron: string }> } }) {
  return Object.entries(flow.schedules?.static ?? {}).map(([id, binding]) => ({
    id,
    cron: binding.cron,
  }));
}

function webhookKeys(flow: { webhooks?: Record<string, { on?: Record<string, unknown> }> }) {
  return Object.entries(flow.webhooks ?? {}).flatMap(([provider, sub]) =>
    Object.keys(sub.on ?? {}).map((event) => ({ provider, event })),
  );
}

function readWorker(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

async function boot(flows: FlowInstance[]) {
  const state = createFlowState({
    flows: Object.fromEntries(flows.map((flow) => [flow.kind, flow])),
    stores: { default: { primary: inMemoryStores() } },
  });
  const runtime = await state.getRuntime();
  return { runtime, state };
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("A — central ingress owns wakes; seats do not", () => {
  it("night-watch registers sweep-open and github issues", () => {
    expect(nightWatchIngress.kind).toBe(CENTRAL_INGRESS_KIND);
    expect(nightWatchDef.kind).toBe(CENTRAL_INGRESS_KIND);
    expect(scheduleIds(nightWatchIngress)).toEqual([{ id: SWEEP_SCHEDULE_ID, cron: SWEEP_CRON }]);
    expect(webhookKeys(nightWatchIngress)).toEqual([
      { provider: GITHUB_PROVIDER, event: GITHUB_ISSUES_EVENT },
    ]);
    validateSchedulesConfig(nightWatchIngress.kind, nightWatchIngress.schedules);
    validateWebhookConfig(nightWatchIngress.kind, nightWatchIngress.webhooks);
  });

  it("seat kinds have no schedules and no webhooks", () => {
    for (const flow of [nightSweepKind, nightIntakeKind, nightTriageKind]) {
      expect(scheduleIds(flow)).toEqual([]);
      expect(webhookKeys(flow)).toEqual([]);
    }
  });

  it("ingress bindings are dispatcher hops to those seats", () => {
    const sweep = nightWatchIngress.schedules?.static?.[SWEEP_SCHEDULE_ID]?.block;
    const intake = nightWatchIngress.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.block;
    expect(sweep?.dispatch).toEqual({
      type: "internal",
      action: "sweep",
      flowKind: CENTRAL_SWEEP_KIND,
    });
    expect(intake?.dispatch).toEqual({
      type: "internal",
      action: "record",
      flowKind: CENTRAL_INTAKE_KIND,
    });
  });
});

describe("B — each flow owns its own wakes", () => {
  it("sweep owns the cron; intake owns the webhook; triage owns neither", () => {
    expect(inboxSweepFlow.kind).toBe(DESK_SWEEP_KIND);
    expect(scheduleIds(inboxSweepFlow)).toEqual([{ id: SWEEP_SCHEDULE_ID, cron: SWEEP_CRON }]);
    expect(webhookKeys(inboxSweepFlow)).toEqual([]);
    validateSchedulesConfig(inboxSweepFlow.kind, inboxSweepFlow.schedules);

    expect(inboxIntakeFlow.kind).toBe(DESK_INTAKE_KIND);
    expect(scheduleIds(inboxIntakeFlow)).toEqual([]);
    expect(webhookKeys(inboxIntakeFlow)).toEqual([
      { provider: GITHUB_PROVIDER, event: GITHUB_ISSUES_EVENT },
    ]);
    validateWebhookConfig(inboxIntakeFlow.kind, inboxIntakeFlow.webhooks);
    expect(inboxIntakeFlow.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.sessionId).toEqual(
      expect.any(Function),
    );

    expect(inboxTriageFlow.kind).toBe(DESK_TRIAGE_KIND);
    expect(scheduleIds(inboxTriageFlow)).toEqual([]);
    expect(webhookKeys(inboxTriageFlow)).toEqual([]);
  });
});

describe("WORKER.md on disk is a seat note, not a wakes: compile", () => {
  const files = [
    "src/a-central/workers/sweep/WORKER.md",
    "src/a-central/workers/intake/WORKER.md",
    "src/a-central/workers/triage/WORKER.md",
    "src/b-per-flow/flows/sweep/WORKER.md",
    "src/b-per-flow/flows/intake/WORKER.md",
    "src/b-per-flow/flows/triage/WORKER.md",
  ];

  it.each(files)("%s has flow: and no wakes:", (rel) => {
    const text = readWorker(rel);
    expect(text).toMatch(/^---\n[\s\S]*^flow: /m);
    expect(text).not.toMatch(/^wakes:/m);
    expect(text).not.toMatch(/\nwakes:/);
  });

  it("channel leftover is on disk and not an L1 binding", () => {
    const a = readWorker("src/a-central/leftover/CHANNEL.md");
    const b = readWorker("src/b-per-flow/leftover/CHANNEL.md");
    expect(a).toMatch(/Layer 2 leftover/);
    expect(b).toMatch(/Layer 2 leftover/);
    for (const flow of [
      nightWatchIngress,
      nightSweepKind,
      inboxSweepFlow,
      inboxIntakeFlow,
    ]) {
      expect(JSON.stringify(flow.schedules ?? {})).not.toMatch(/channel/i);
      expect(JSON.stringify(flow.webhooks ?? {})).not.toMatch(/channel/i);
    }
  });
});

describe("what runs", () => {
  it("a sweep seat records an interval tick", async () => {
    const result = await testFlow({
      flow: nightSweepKind,
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

  it("B sweep records the same tick on its own clock", async () => {
    const result = await testFlow({
      flow: inboxSweepFlow,
      action: "sweep",
      userId: "system",
      input: { reason: "interval", nominalFireTime: "2026-09-29T12:00:00.000Z" },
    });
    expect(result.output).toEqual({
      swept: true,
      reason: "interval",
      at: "2026-09-29T12:00:00.000Z",
    });
  });

  it("inspect lists the central tree", async () => {
    const result = await testFlow({
      flow: nightWatchIngress,
      action: "inspect",
      userId: "system",
      input: {},
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ layout: "central" });
    expect((result.output as { files: unknown[] }).files.length).toBeGreaterThan(2);
  });

  it("github when-predicate ignores non-opened issues", () => {
    const when = nightWatchIngress.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.when;
    expect(when).toBeTypeOf("function");
    const base = {
      provider: "github",
      eventType: "issues",
      headers: new Headers(),
      rawBody: new Uint8Array(),
    };
    expect(
      when?.({
        ...base,
        payload: {
          action: "closed",
          issue: { number: 1, title: "x" },
          repository: { full_name: "a/b" },
        },
      }),
    ).toBe(false);
    expect(
      when?.({
        ...base,
        payload: {
          action: "opened",
          issue: { number: 1, title: "x" },
          repository: { full_name: "a/b" },
        },
      }),
    ).toBe(true);
  });
});

describe("dispatcher({ flowKind, action, session }) hops across flows", () => {
  const issue = {
    provider: "github",
    repo: "acme/app",
    issueNumber: 12,
    title: "Login loop",
  };

  it("A: night-watch record lands on night-intake, then night-triage", async () => {
    const { runtime, state } = await boot([
      nightWatchIngress,
      nightSweepKind,
      nightIntakeKind,
      nightTriageKind,
    ]);
    try {
      const sent = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: nightWatchIngress,
        actionName: "record",
        input: issue,
        userId: "system",
        sessionId: "s_ingress",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(sent.error).toBeUndefined();
      const handle = sent.output as { sessionId: string; requestId: string };
      expect(handle.sessionId).toBeTruthy();

      const intake = await runtime.stores.session.get(handle.sessionId);
      expect(intake?.flowKind).toBe(CENTRAL_INTAKE_KIND);

      await until(async () => {
        const rec = await runtime.stores.request.get(handle.requestId);
        return rec?.status === "completed";
      }, "intake request to finish");

      await until(async () => {
        const sessions = await runtime.stores.session.list({
          flowKind: CENTRAL_TRIAGE_KIND,
          parentage: "all",
        });
        return sessions.length > 0;
      }, "triage hop to mint a session");

      const triage = await runtime.stores.session.list({
        flowKind: CENTRAL_TRIAGE_KIND,
        parentage: "all",
      });
      expect(triage[0]?.flowKind).toBe(CENTRAL_TRIAGE_KIND);
    } finally {
      await state.dispose();
    }
  });

  it("B: inbox-intake record hops to inbox-triage", async () => {
    const { runtime, state } = await boot([inboxIntakeFlow, inboxTriageFlow]);
    try {
      const sent = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: inboxIntakeFlow,
        actionName: "record",
        input: issue,
        userId: "system",
        sessionId: "s_intake",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(sent.error).toBeUndefined();
      const handle = sent.output as { sessionId: string };
      expect(handle.sessionId).toBeTruthy();

      const triage = await runtime.stores.session.get(handle.sessionId);
      expect(triage?.flowKind).toBe(DESK_TRIAGE_KIND);
    } finally {
      await state.dispose();
    }
  });
});
