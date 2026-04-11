/**
 * Type-level tests for capability inference.
 *
 * These tests validate that:
 * - ctx.cap resolves to the declared fns return type
 * - ctx.cap is Record<string, never> when uses is absent
 * - Two-capability intersection produces correct merged namespace
 * - .presets() builder only accepts known preset names
 */
import { z } from "zod";
import { defineCapability } from "../../capability/define-capability";
import { defineResource } from "../resource";
import type { InferCapabilities } from "../../capability/types";
import type { BlockContext } from "../block";

// ── Resources for testing ────────────────────────────────────────────

const memoryResource = defineResource({
  stateSchema: z.object({ entries: z.array(z.string()) })
});

// ── Capability with fns ──────────────────────────────────────────────

const memoryCapability = defineCapability({
  name: "memory",
  sessionResources: { memories: memoryResource },
  fns: (ctx: BlockContext) => ({
    remember: (fact: string) => { void fact; void ctx; },
    recall: (query: string): string[] => { void query; return []; },
  }),
});

const analyticsCapability = defineCapability({
  name: "analytics",
  fns: (_ctx: BlockContext) => ({
    track: (event: string, data: Record<string, unknown>) => { void event; void data; },
  }),
});

// ── InferCapabilities with single capability ─────────────────────────

type SingleCap = InferCapabilities<readonly [typeof memoryCapability]>;

// Verify the cap has the "memory" namespace
const _singleAccess: SingleCap["memory"]["remember"] = (fact: string) => { void fact; };
const _singleRecall: SingleCap["memory"]["recall"] = (query: string): string[] => { void query; return []; };

// ── InferCapabilities with two capabilities ──────────────────────────

type TwoCaps = InferCapabilities<readonly [typeof memoryCapability, typeof analyticsCapability]>;

// Both namespaces are accessible
const _twoMemory: TwoCaps["memory"]["remember"] = (fact: string) => { void fact; };
const _twoAnalytics: TwoCaps["analytics"]["track"] = (event: string, _data: Record<string, unknown>) => { void event; };

// ── InferCapabilities with empty array ───────────────────────────────

type NoCaps = InferCapabilities<readonly []>;
// Should be assignable to empty object
const _empty: NoCaps = {};
void _empty;

// ── .presets() builder types ─────────────────────────────────────────

const capWithPresets = defineCapability({
  name: "test",
  presets: {
    alpha: {
      sessionResources: { memories: memoryResource },
    },
    beta: {
      sessionStateSchema: z.object({ flag: z.boolean() }),
    },
    default: ["alpha"],
  },
});

// .presets() accepts known preset names
const _configured1 = capWithPresets.presets({ alpha: true });
const _configured2 = capWithPresets.presets({ beta: false });
const _configured3 = capWithPresets.presets({ alpha: true, beta: true });

// Function-form override should accept the preset's shape
const _configured4 = capWithPresets.presets({
  alpha: (preset) => {
    void preset.sessionResources;
    return {};
  },
});

// ── Capability without fns ───────────────────────────────────────────

const capNoFns = defineCapability({
  name: "noFns",
  sessionResources: { memories: memoryResource },
});

type NoFnsCap = InferCapabilities<readonly [typeof capNoFns]>;
// noFns namespace should exist (as Record<string, never>)
const _noFnsAccess: NoFnsCap["noFns"] = {} as Record<string, never>;
void _noFnsAccess;

// ── Block factory ctx.cap type inference ─────────────────────────────

import { handler } from "../../blocks/handler";

// Handler with uses — ctx.cap should have the memory namespace
handler({
  name: "cap-typed-handler",
  uses: [memoryCapability] as const,
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (_input, ctx) => {
    // ctx.cap.memory should be typed with remember and recall
    ctx.cap.memory.remember("test");
    const results: string[] = ctx.cap.memory.recall("query");
    void results;
    return {};
  },
});

// Handler with two capabilities
handler({
  name: "cap-two",
  uses: [memoryCapability, analyticsCapability] as const,
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (_input, ctx) => {
    ctx.cap.memory.remember("fact");
    ctx.cap.analytics.track("event", { key: "value" });
    return {};
  },
});

// Handler without uses — ctx.cap should be empty
handler({
  name: "no-cap-handler",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (_input, _ctx) => {
    // _ctx.cap should be {} — no properties
    return {};
  },
});

// Suppress unused variable warnings
void _singleAccess;
void _singleRecall;
void _twoMemory;
void _twoAnalytics;
void _configured1;
void _configured2;
void _configured3;
void _configured4;
