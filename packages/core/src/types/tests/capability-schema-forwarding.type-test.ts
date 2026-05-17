/**
 * Type-level tests for capability schema forwarding (FIX-616, Steps 1-2).
 *
 * These tests validate that schemas declared on a capability
 * (`sessionStateSchema`, `resources`, `targetStateSchemas`,
 * `sequencerStateSchema`) are forwarded into consumer blocks' ctx via the
 * `InferCapability*` utilities — without requiring the consumer to
 * re-declare the schemas.
 *
 * Coverage:
 *   - Empty `uses` arrays → each utility resolves to `{}`
 *   - Single-cap forwarding for each axis (session/resources/targets/sequencer)
 *   - Multi-capability intersection merges non-overlapping keys
 *   - Wrong-slot regression: a capability declaring only resources must
 *     not leak into the session-state inference (slot-position check)
 *   - `.presets()` forwarding preserves inferred shapes
 *   - `sessionStateType` escape hatch overrides the inferred shape
 *   - Setting an escape hatch field without its schema is a compile error
 */
import { z } from "zod";
import { defineCapability } from "../../capability/define-capability";
import { defineResource } from "../resource";
import type {
  InferCapabilityResources,
  InferCapabilitySequencerState,
  InferCapabilitySessionState,
  InferCapabilityTargets,
} from "../../capability/types";
import type { StateRef } from "../block";
import type { ResourceRef } from "../resource";

// ── Capabilities for testing ─────────────────────────────────────────

const sessionCap = defineCapability({
  name: "session",
  sessionStateSchema: z.object({ ticker: z.string() }),
});

const otherSessionCap = defineCapability({
  name: "otherSession",
  sessionStateSchema: z.object({ count: z.number() }),
});

const memoryResource = defineResource({
  ref: "memory",
  scope: "session",
  stateSchema: z.object({ entries: z.array(z.string()) }),
});

const resourcesCap = defineCapability({
  name: "withResources",
  resources: { memories: memoryResource },
});

const targetsCap = defineCapability({
  name: "withTargets",
  targetStateSchemas: { draft: z.object({ body: z.string() }) },
});

const sequencerCap = defineCapability({
  name: "withSequencer",
  sequencerStateSchema: z.object({ step: z.number() }),
});

// ── Empty uses → each utility is `{}` ────────────────────────────────

type EmptySession = InferCapabilitySessionState<readonly []>;
type EmptyResources = InferCapabilityResources<readonly []>;
type EmptyTargets = InferCapabilityTargets<readonly []>;
type EmptySequencer = InferCapabilitySequencerState<readonly []>;

const _emptySession: EmptySession = {};
const _emptyResources: EmptyResources = {};
const _emptyTargets: EmptyTargets = {};
const _emptySequencer: EmptySequencer = {};

// ── Single capability — session state forwarding ─────────────────────

type SingleSession = InferCapabilitySessionState<readonly [typeof sessionCap]>;
const _ticker: SingleSession["ticker"] = "AAPL";

// ── Multi-capability — non-overlapping session-state keys merge ──────

type TwoSession = InferCapabilitySessionState<
  readonly [typeof sessionCap, typeof otherSessionCap]
>;
const _twoTicker: TwoSession["ticker"] = "AAPL";
const _twoCount: TwoSession["count"] = 1;

// ── Wrong-slot regression: resources-only cap must not leak ──────────
// Slot positions: 5=sessionState, 6=resources, 7=targets, 8=sequencer.
// If slots were swapped, declaring only `resources` would surface in
// session-state inference — assert it doesn't.

type ResourcesOnlySession = InferCapabilitySessionState<
  readonly [typeof resourcesCap]
>;
const _resourcesOnlySession: ResourcesOnlySession = {};
void _resourcesOnlySession;

// ── .presets() forwarding preserves session-state shape ──────────────

const presetCap = defineCapability({
  name: "preset",
  sessionStateSchema: z.object({ ticker: z.string() }),
  presets: {
    tools: { sessionStateSchema: z.object({ ticker: z.string() }) },
  },
});

type RawCap = InferCapabilitySessionState<readonly [typeof presetCap]>;
type ConfiguredCapShape = InferCapabilitySessionState<
  readonly [ReturnType<typeof presetCap.presets>]
>;

// Both must accept the same value — i.e. the inferred shape survives .presets().
const _raw: RawCap["ticker"] = "AAPL";
const _configured: ConfiguredCapShape["ticker"] = "AAPL";

// ── Escape hatch — `sessionStateType` overrides inferred shape ───────

const escapeCap = defineCapability({
  name: "escape",
  sessionStateSchema: z.record(z.any()),
  // Carries no runtime value; only the type position matters.
  sessionStateType: undefined as unknown as { exact: number },
});

type EscapeSession = InferCapabilitySessionState<readonly [typeof escapeCap]>;
const _exact: EscapeSession["exact"] = 42;

// ── Escape hatch enforcement (negative) ──────────────────────────────
// Setting `sessionStateType` without `sessionStateSchema` must not compile.

defineCapability({
  name: "badEscape",
  // @ts-expect-error sessionStateType without sessionStateSchema is forbidden
  sessionStateType: undefined as unknown as { exact: number },
});

// ── Resources forwarding ─────────────────────────────────────────────

type ResourcesShape = InferCapabilityResources<readonly [typeof resourcesCap]>;
const _memoriesRef: ResourcesShape["memories"] =
  {} as ResourceRef<{ entries: string[] }>;
void _memoriesRef;

// ── Targets forwarding ───────────────────────────────────────────────

type TargetsShape = InferCapabilityTargets<readonly [typeof targetsCap]>;
const _draftRef: TargetsShape["draft"] =
  {} as StateRef<{ body: string }> | undefined;
void _draftRef;

// ── Sequencer state forwarding ───────────────────────────────────────

type SequencerShape = InferCapabilitySequencerState<
  readonly [typeof sequencerCap]
>;
const _step: SequencerShape["step"] = 0;

// ── Suppress unused-variable warnings ────────────────────────────────

void _emptySession;
void _emptyResources;
void _emptyTargets;
void _emptySequencer;
void _ticker;
void _twoTicker;
void _twoCount;
void _raw;
void _configured;
void _exact;
void _step;
