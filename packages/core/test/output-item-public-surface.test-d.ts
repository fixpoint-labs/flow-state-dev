/**
 * Compile-time assertion that the public `OutputItem` union excludes the
 * trace-only types (`block_output`, `router_decision`, `state_snapshot`,
 * `block_debug`) and the deleted `step_error` (FIX-506).
 *
 * If any of these reappear in the public union, the corresponding `Extract`
 * stops yielding `never` and this file fails to compile.
 */
import type { OutputItem } from "@flow-state-dev/core/items";

type AssertNever<T extends never> = T;

type _NoBlockOutput   = AssertNever<Extract<OutputItem, { type: "block_output" }>>;
type _NoRouter        = AssertNever<Extract<OutputItem, { type: "router_decision" }>>;
type _NoStateSnapshot = AssertNever<Extract<OutputItem, { type: "state_snapshot" }>>;
type _NoBlockDebug    = AssertNever<Extract<OutputItem, { type: "block_debug" }>>;
type _NoStepError     = AssertNever<Extract<OutputItem, { type: "step_error" }>>;
