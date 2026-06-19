/**
 * chat-agent flow — definition only.
 *
 * A multi-modal AI assistant demonstrating the core building blocks of
 * @flow-state-dev: handlers, generators, routers, sequencers, typed state,
 * resources, clientData, and tool-use. This file is the flow's public surface —
 * the `defineFlow` action map plus session/user/resources/voice/request wiring.
 * The implementation lives by action: `run/` (the chat turn), `shared/`
 * (schemas, context, capabilities reused across actions), and the single-file
 * root actions (`save-artifact`, `approval-gate`, `task-queue-demo`, `settings`).
 *
 * Pipeline (see run/run.ts):
 *   applyRequestedMode → applyFeatures → skillActivator → resolveThinkingStyle
 *     → thinkingStyleRouter → biasCheck → perspective capture → memory capture
 *     → autoTitle → incrementRequestCount
 */
import { defineFlow } from "@flow-state-dev/core";

import { runSequencer } from "./run/run";
import { updateArtifact } from "./save-artifact";
import { setSelectedModelHandler, setThinkingEnabledHandler } from "./settings";
import { taskQueueDemo } from "./task-queue-demo";
import { approvalGate } from "./approval-gate";
import { mem } from "./run/cognition";
import { bashCap } from "./shared/capabilities/features";
import { modeSchema, sessionStateSchema, userStateSchema } from "./shared/schemas";

const chatAgentFlow = defineFlow({
  kind: "chat-agent",
  requireUser: true,

  voice: {
    tts: {
      voice: "alloy",
    },
  },

  actions: {
    run: {
      block: runSequencer,
      userMessage: (input) => input.message,
    },
    saveArtifact: {
      block: updateArtifact,
    },
    setSelectedModel: {
      block: setSelectedModelHandler,
    },
    setThinkingEnabled: {
      block: setThinkingEnabledHandler,
    },
    "task-queue": {
      block: taskQueueDemo,
    },
    // Durable HITL action: suspends for human approval, resolvable from the
    // DevTool Suspensions tab. `durable: true` makes ctx.suspend() available
    // and enables checkpoint-based resume (requires `durable: true` on the
    // FlowState runtime — see lib/flowstate.ts).
    requestApproval: {
      block: approvalGate,
      durable: true,
      userMessage: (input) => `Requesting approval: ${input.request}`,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    client: {
      derived: {
        modeStatus: (ctx) => {
          // `activeSkills` is contributed by the skills capability's
          // session-state schema (framework merges all schemas at flow
          // registration). Project to the surface shape the top-bar UI
          // wants — name + source tier, drop the rest.
          const activeSkills =
            (ctx.state as {
              activeSkills?: Array<{ name: string; source?: string; mode?: string }>;
            }).activeSkills ?? [];
          return {
            currentMode: modeSchema.parse(ctx.state.mode ?? "ask"),
            thinkingStyle:
              (ctx.state.thinkingStyle as string | undefined) ?? null,
            requestCount: Number(ctx.state.requestCount ?? 0),
            features: ctx.state.features ?? { biasCheck: false, search: true, fetch: true, crawl: true },
            activeSkills: activeSkills.map((s) => ({
              name: s.name,
              source: s.source ?? "tool",
              ...(s.mode !== undefined ? { mode: s.mode } : {}),
            })),
          };
        },
      },
    },
  },

  // FIX-435: resources live in a single flat flow.resources map; their
  // intrinsic scope routes them to the right storage layer.
  resources: { ...(mem.userResources ?? {}) },

  // Tear down the bash sandbox at request end. Required when the bash
  // provider is MOAT (otherwise containers accumulate across requests);
  // a no-op for `local` / `just-bash` / `vercel`. Wired unconditionally
  // so swapping the provider via env vars doesn't reintroduce a leak.
  request: { onFinished: bashCap.cleanupBlock },

  user: {
    stateSchema: userStateSchema,
    client: {
      derived: {
        preferences: (ctx) => ({
          displayName: ctx.state.displayName,
          selectedModel: ctx.state.selectedModel,
          thinkingEnabled: ctx.state.thinkingEnabled,
        }),
      },
    },
  },
});

const flow = chatAgentFlow({ id: "default" });

export default flow;
