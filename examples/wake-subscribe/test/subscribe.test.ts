/**
 * Pins host registration + the two subscribe styles — and the hire gap.
 *
 * What would make this fail: style 1 growing a `webhooks.on`, style 2
 * losing `sessionId`, a hop that invents NotificationFlow, hire silently
 * accepting `subscribe:` / `route:`, or a WORKER.md that smuggles `wakes:`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defineFlow, DEFAULT_ORG_ID, validateWebhookConfig } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { hireWorkforce, workerConfigSchema } from "@flow-state-dev/workforce";
import type { WorkerManifest } from "@flow-state-dev/workforce";
import prReviewerKind, {
  prReviewerKind as prReviewerDef,
} from "../src/1-per-session/workers/reviewer/kind";
import {
  autoSubscribeFromReview,
  compileWorkerSubscribe,
  matchSubscriptions,
} from "../src/1-per-session/workers/reviewer/subscribe";
import prTriageKind from "../src/1-per-session/workers/triage/kind";
import githubDeskKind, {
  compiledDeskRoutes,
  githubDeskKind as githubDeskDef,
} from "../src/2-fan-in-route/workers/desk/kind";
import { compileRouteRules, readDeskWorkerMarkdown } from "../src/2-fan-in-route/workers/desk/route-rules";
import githubIntakeKind from "../src/2-fan-in-route/workers/intake/kind";
import githubReviewerKind from "../src/2-fan-in-route/workers/reviewer/kind";
import githubTriageKind from "../src/2-fan-in-route/workers/triage/kind";
import { inspectLayout } from "../src/shared/inspect";
import { githubProviderDefinition, registerGitHubTransport } from "../src/shared/github-provider";
import {
  FANIN_DESK_KIND,
  FANIN_INTAKE_KIND,
  FANIN_REVIEWER_KIND,
  FANIN_TRIAGE_KIND,
  GITHUB_ISSUES_EVENT,
  GITHUB_PROVIDER,
  GITHUB_PULL_REQUEST_EVENT,
  SESSION_REVIEWER_KIND,
  SESSION_TRIAGE_KIND,
} from "../src/shared/scenario";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function webhookKeys(flow: { webhooks?: Record<string, { on?: Record<string, unknown> }> }) {
  return Object.entries(flow.webhooks ?? {}).flatMap(([provider, sub]) =>
    Object.keys(sub.on ?? {}).map((event) => ({ provider, event })),
  );
}

function readRel(rel: string): string {
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

describe("host registers GitHub once", () => {
  it("registerGitHubTransport is the webhook adapter with a github provider", () => {
    const adapter = registerGitHubTransport();
    expect(adapter.source).toBe("webhook");
    const provider = githubProviderDefinition();
    expect(provider.eventType({}, new Headers({ "x-github-event": "issues" }))).toBe("issues");
    expect(
      provider.deliveryId({}, new Headers({ "x-github-delivery": "abc-1" })),
    ).toBe("abc-1");
  });
});

describe("1 — per-session subscribe does not become webhooks.on", () => {
  it("reviewer and triage kinds have no webhook bindings", () => {
    expect(prReviewerKind.kind).toBe(SESSION_REVIEWER_KIND);
    expect(prReviewerDef.kind).toBe(SESSION_REVIEWER_KIND);
    expect(webhookKeys(prReviewerKind)).toEqual([]);
    expect(webhookKeys(prTriageKind)).toEqual([]);
  });

  it("WORKER.md compile yields subscribe rows, not a webhook map", () => {
    const compiled = compileWorkerSubscribe(
      readRel("src/1-per-session/workers/reviewer/WORKER.md"),
    );
    expect(compiled.provider).toBe(GITHUB_PROVIDER);
    expect(compiled.events).toEqual(["pull_request", "issue_comment"]);
    expect(compiled.resource).toBe("session");
    expect(compiled.autoSubscribe).toBe("on-review-started");
    expect(compiled.declaredWithoutSubscribe.subscribe).toBeUndefined();
    expect(compiled.declaredWithoutSubscribe.flow).toBe(SESSION_REVIEWER_KIND);
  });

  it("a delivery matches only a session that already subscribed", () => {
    const subscribed = autoSubscribeFromReview({
      sessionKey: "review-88",
      repo: "acme/app",
      number: 88,
      events: ["pull_request", "issue_comment"],
    });
    const other = autoSubscribeFromReview({
      sessionKey: "review-89",
      repo: "acme/app",
      number: 89,
      events: ["pull_request"],
    });
    const table = [subscribed, other];

    const hits = matchSubscriptions(
      {
        provider: GITHUB_PROVIDER,
        eventType: GITHUB_PULL_REQUEST_EVENT,
        payload: {
          action: "synchronize",
          pull_request: { number: 88 },
          repository: { full_name: "acme/app" },
        },
      },
      table,
    );
    expect(hits.map((row) => row.sessionKey)).toEqual(["review-88"]);

    const nobody = matchSubscriptions(
      {
        provider: GITHUB_PROVIDER,
        eventType: GITHUB_PULL_REQUEST_EVENT,
        payload: {
          action: "synchronize",
          pull_request: { number: 90 },
          repository: { full_name: "acme/app" },
        },
      },
      table,
    );
    expect(nobody).toEqual([]);
  });
});

describe("2 — fan-in route rules compile to today's webhooks.on", () => {
  it("desk registers github issues and pull_request", () => {
    expect(githubDeskKind.kind).toBe(FANIN_DESK_KIND);
    expect(githubDeskDef.kind).toBe(FANIN_DESK_KIND);
    expect(webhookKeys(githubDeskKind)).toEqual([
      { provider: GITHUB_PROVIDER, event: GITHUB_ISSUES_EVENT },
      { provider: GITHUB_PROVIDER, event: GITHUB_PULL_REQUEST_EVENT },
    ]);
    validateWebhookConfig(githubDeskKind.kind, githubDeskKind.webhooks);
    expect(
      githubDeskKind.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.sessionId,
    ).toEqual(expect.any(Function));
    expect(
      githubDeskKind.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_PULL_REQUEST_EVENT]?.sessionId,
    ).toEqual(expect.any(Function));
  });

  it("seat kinds have no webhooks", () => {
    for (const flow of [githubIntakeKind, githubReviewerKind, githubTriageKind]) {
      expect(webhookKeys(flow)).toEqual([]);
    }
  });

  it("compiled bindings are dispatcher hops to those seats", () => {
    const intake = githubDeskKind.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.block;
    const reviewer =
      githubDeskKind.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_PULL_REQUEST_EVENT]?.block;
    expect(intake?.dispatch).toEqual({
      type: "internal",
      action: "record",
      flowKind: FANIN_INTAKE_KIND,
    });
    expect(reviewer?.dispatch).toEqual({
      type: "internal",
      action: "record",
      flowKind: FANIN_REVIEWER_KIND,
    });
  });

  it("channel route is leftover, not a binding", () => {
    expect(compiledDeskRoutes.leftovers).toEqual([
      {
        id: "desk-poke",
        event: "channel",
        reason: expect.stringContaining("Layer 2"),
      },
    ]);
    const again = compileRouteRules(readDeskWorkerMarkdown(), {
      [FANIN_INTAKE_KIND]: githubDeskKind.webhooks![GITHUB_PROVIDER]!.on[GITHUB_ISSUES_EVENT]!.block,
      [FANIN_REVIEWER_KIND]:
        githubDeskKind.webhooks![GITHUB_PROVIDER]!.on[GITHUB_PULL_REQUEST_EVENT]!.block,
    });
    expect(webhookKeys({ webhooks: again.webhooks })).toEqual(webhookKeys(githubDeskKind));
    expect(again.leftovers).toEqual(compiledDeskRoutes.leftovers);
  });

  it("github when-predicates ignore the wrong sub-action", () => {
    const issueWhen = githubDeskKind.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_ISSUES_EVENT]?.when;
    const prWhen =
      githubDeskKind.webhooks?.[GITHUB_PROVIDER]?.on?.[GITHUB_PULL_REQUEST_EVENT]?.when;
    expect(issueWhen).toBeTypeOf("function");
    expect(prWhen).toBeTypeOf("function");
    const base = {
      provider: GITHUB_PROVIDER,
      headers: new Headers(),
      rawBody: new Uint8Array(),
    };
    expect(
      issueWhen?.({
        ...base,
        eventType: GITHUB_ISSUES_EVENT,
        payload: {
          action: "closed",
          issue: { number: 1, title: "x" },
          repository: { full_name: "a/b" },
        },
      }),
    ).toBe(false);
    expect(
      issueWhen?.({
        ...base,
        eventType: GITHUB_ISSUES_EVENT,
        payload: {
          action: "opened",
          issue: { number: 1, title: "x" },
          repository: { full_name: "a/b" },
        },
      }),
    ).toBe(true);
    expect(
      prWhen?.({
        ...base,
        eventType: GITHUB_PULL_REQUEST_EVENT,
        payload: {
          action: "closed",
          pull_request: { number: 2, title: "y" },
          repository: { full_name: "a/b" },
        },
      }),
    ).toBe(false);
    expect(
      prWhen?.({
        ...base,
        eventType: GITHUB_PULL_REQUEST_EVENT,
        payload: {
          action: "review_requested",
          pull_request: { number: 2, title: "y" },
          repository: { full_name: "a/b" },
        },
      }),
    ).toBe(true);
  });
});

describe("WORKER.md on disk is a seat note, not a wakes: compile", () => {
  const files = [
    "src/1-per-session/workers/reviewer/WORKER.md",
    "src/1-per-session/workers/triage/WORKER.md",
    "src/2-fan-in-route/workers/desk/WORKER.md",
    "src/2-fan-in-route/workers/intake/WORKER.md",
    "src/2-fan-in-route/workers/reviewer/WORKER.md",
    "src/2-fan-in-route/workers/triage/WORKER.md",
  ];

  it.each(files)("%s has flow: and no wakes:", (rel) => {
    const text = readRel(rel);
    expect(text).toMatch(/^---\n[\s\S]*^flow: /m);
    expect(text).not.toMatch(/^wakes:/m);
    expect(text).not.toMatch(/\nwakes:/);
  });

  it("channel leftover is on disk and not an L1 binding", () => {
    const a = readRel("src/1-per-session/leftover/CHANNEL.md");
    const b = readRel("src/2-fan-in-route/leftover/CHANNEL.md");
    expect(a).toMatch(/Layer 2 leftover/);
    expect(b).toMatch(/Layer 2 leftover/);
    for (const flow of [prReviewerKind, githubDeskKind, githubIntakeKind]) {
      expect(JSON.stringify(flow.schedules ?? {})).not.toMatch(/channel/i);
      expect(JSON.stringify(flow.webhooks ?? {})).not.toMatch(/channel/i);
    }
  });
});

describe("what runs", () => {
  it("style 1 inspect lists the per-session tree", async () => {
    const result = await testFlow({
      flow: prReviewerKind,
      action: "inspect",
      userId: "system",
      input: {},
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ layout: "per-session" });
    expect((result.output as { files: unknown[] }).files.length).toBeGreaterThan(2);
  });

  it("style 2 inspect lists the fan-in tree", async () => {
    const result = await testFlow({
      flow: githubDeskKind,
      action: "inspect",
      userId: "system",
      input: {},
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ layout: "fan-in-route" });
  });

  it("style 2 reviewer records a pull request without owning a webhook", async () => {
    const result = await testFlow({
      flow: githubReviewerKind,
      action: "record",
      userId: "system",
      input: {
        provider: GITHUB_PROVIDER,
        kind: "pull_request",
        repo: "acme/app",
        number: 88,
        title: "Login loop",
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({
      recorded: true,
      kind: "pull_request",
      repo: "acme/app",
      number: 88,
      title: "Login loop",
    });
  });
});

describe("dispatcher({ flowKind, action, session }) hops across flows", () => {
  it("1: pr-reviewer review lands on pr-triage", async () => {
    const { runtime, state } = await boot([prReviewerKind, prTriageKind]);
    try {
      const sent = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: prReviewerKind,
        actionName: "review",
        input: { repo: "acme/app", number: 88, title: "Login loop" },
        userId: "system",
        sessionId: "s_review",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(sent.error).toBeUndefined();
      const handle = sent.output as { sessionId: string };
      expect(handle.sessionId).toBeTruthy();

      const triage = await runtime.stores.session.get(handle.sessionId);
      expect(triage?.flowKind).toBe(SESSION_TRIAGE_KIND);
    } finally {
      await state.dispose();
    }
  });

  it("2: github-desk recordIssue lands on github-intake, then github-triage", async () => {
    const { runtime, state } = await boot([
      githubDeskKind,
      githubIntakeKind,
      githubReviewerKind,
      githubTriageKind,
    ]);
    try {
      const sent = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: githubDeskKind,
        actionName: "recordIssue",
        input: {
          provider: GITHUB_PROVIDER,
          kind: "issue",
          repo: "acme/app",
          number: 12,
          title: "Login loop",
        },
        userId: "system",
        sessionId: "s_desk",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      expect(sent.error).toBeUndefined();
      const handle = sent.output as { sessionId: string; requestId: string };
      expect(handle.sessionId).toBeTruthy();

      const intake = await runtime.stores.session.get(handle.sessionId);
      expect(intake?.flowKind).toBe(FANIN_INTAKE_KIND);

      await until(async () => {
        const rec = await runtime.stores.request.get(handle.requestId);
        return rec?.status === "completed";
      }, "intake request to finish");

      await until(async () => {
        const sessions = await runtime.stores.session.list({
          flowKind: FANIN_TRIAGE_KIND,
          parentage: "all",
        });
        return sessions.length > 0;
      }, "triage hop to mint a session");

      const triage = await runtime.stores.session.list({
        flowKind: FANIN_TRIAGE_KIND,
        parentage: "all",
      });
      expect(triage[0]?.flowKind).toBe(FANIN_TRIAGE_KIND);
    } finally {
      await state.dispose();
    }
  });
});

describe("hireWorkforce does not apply subscribe or route as config", () => {
  it("refuses subscribe on a closed workerConfigSchema", () => {
    const kind = defineFlow({
      kind: SESSION_REVIEWER_KIND,
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { inspect: { block: inspectLayout("per-session", []) } },
    });

    const manifest: WorkerManifest = {
      id: "desk.review",
      declared: {
        flow: SESSION_REVIEWER_KIND,
        description: "Review one PR",
        subscribe: { provider: GITHUB_PROVIDER, resource: "session" },
      },
      body: "Watch this pull request.",
    };

    expect(() => hireWorkforce([manifest], { kinds: { [SESSION_REVIEWER_KIND]: kind } })).toThrow(
      /"subscribe" is not a declared setting/,
    );
  });

  it("refuses route on a closed workerConfigSchema", () => {
    const kind = defineFlow({
      kind: FANIN_DESK_KIND,
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { inspect: { block: inspectLayout("fan-in-route", []) } },
    });

    const manifest: WorkerManifest = {
      id: "desk.watch",
      declared: {
        flow: FANIN_DESK_KIND,
        description: "Fan-in desk",
        route: [{ id: "issue-opened", event: "issues" }],
      },
      body: "Route GitHub events.",
    };

    expect(() => hireWorkforce([manifest], { kinds: { [FANIN_DESK_KIND]: kind } })).toThrow(
      /"route" is not a declared setting/,
    );
  });

  it("hires after those keys are stripped — and the seat still has no webhooks", () => {
    const kind = defineFlow({
      kind: FANIN_DESK_KIND,
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      actions: { inspect: { block: inspectLayout("fan-in-route", []) } },
    });

    const seats = hireWorkforce(
      [
        {
          id: "desk.watch",
          declared: {
            flow: FANIN_DESK_KIND,
            description: "Fan-in desk",
          },
          body: "Route GitHub events.",
        },
      ],
      { kinds: { [FANIN_DESK_KIND]: kind } },
    );

    expect(seats).toHaveLength(1);
    expect(seats[0]?.webhooks).toBeUndefined();
    expect(seats[0]?.schedules).toBeUndefined();
  });
});
