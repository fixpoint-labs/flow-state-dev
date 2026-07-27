/**
 * Type-level tests for the task creation caps (FIX-931).
 *
 * These live under `src/` on purpose — this package's `typecheck` runs `tsc -p
 * tsconfig.json`, whose `include` is `src/**` only, and vitest transpiles test
 * files without checking types. A `@ts-expect-error` in `test/` would therefore
 * be inert. Same convention as `packages/core/src/types/tests/*.type-test.ts`.
 *
 * What they pin down: the caps are accepted exactly where they are ENFORCED.
 * `createSequencerBackedTaskCollection` is the enforcement point, and the
 * sequencer and request backings both route through it. The resource backing
 * builds a different constructor and enforces nothing (deferred to
 * FIX-939/FIX-917), so a cap passed there must be a COMPILE error rather than a
 * silently ignored ceiling — a safety option that is accepted and then dropped
 * is worse than one that does not exist.
 *
 * When resource-backed enforcement lands, adding the caps to
 * `ResourceBackingSpec` makes the `@ts-expect-error` below report "unused", and
 * this file is what forces that decision to be made deliberately.
 */
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core";
import type { GetOrCreateTaskCollectionOptions } from "../get-or-create";
import type { SequencerBackedOptions } from "../sequencer-backed";

declare const ctx: BlockContext;
declare const resourceCollection: ResourceCollectionRef<JsonObject>;
declare const sequencerRef: SequencerBackedOptions["sequencer"];

// ── Accepted where enforced ───────────────────────────────────────────────

const sequencerCapped: GetOrCreateTaskCollectionOptions = {
  ctx,
  backing: "sequencer",
  collectionId: "board",
  sequencer: sequencerRef,
  maxTotalTasks: 500,
  maxEnqueuedTasks: 100,
};

const requestCapped: GetOrCreateTaskCollectionOptions = {
  ctx,
  backing: "request",
  collectionId: "board",
  // `null` is the explicit unbounded opt-out, and must type-check alongside a
  // number — it is the documented migration for a board that needs no ceiling.
  maxTotalTasks: null,
  maxEnqueuedTasks: 100,
};

// ── Rejected where nothing enforces them ──────────────────────────────────

const resourceCapped: GetOrCreateTaskCollectionOptions = {
  ctx,
  backing: "resource",
  collectionId: "durable",
  collection: resourceCollection,
  // @ts-expect-error — the caps are not accepted on `backing: "resource"`, which
  // enforces nothing. Never accepted-then-ignored.
  maxTotalTasks: 5,
};

// Reference the bindings so they are not reported as unused; the assertions
// above are the type errors themselves.
export type _CapTypeTests = [
  typeof sequencerCapped,
  typeof requestCapped,
  typeof resourceCapped,
];
