/**
 * Payload and binding types for reactive blocks (FIX-751).
 *
 * A reactive block is one an author binds to a resource or collection mutation
 * via `reactTo` on `defineResource` / `defineResourceCollection`. When the bound
 * mutation fires, the server dispatcher (PR2) runs the block with a
 * {@link ResourceChange} payload describing what changed. This file owns:
 *
 * - {@link ResourceChange} — the runtime payload shape.
 * - {@link resourceChangeSchema} — a Zod input schema for a reactive block,
 *   parameterized by the resource's state schema.
 * - {@link ReactiveBinding} / {@link ReactiveBindings} — the author-facing
 *   `reactTo` config (bare block or `{ block, when }`, keyed by change kind).
 * - {@link normalizeReactiveBinding} — collapses the binding union to a single
 *   `{ block, when? }` form, shared by the definers (PR1) and the dispatcher (PR2).
 */

import { z, type ZodType, type ZodTypeAny } from "zod";
import type { JsonObject } from "../schema/common";
import type { BlockDefinition } from "./block";
import { isBlockDefinition } from "../blocks/internal/utils";

/** The kind of mutation that produced a {@link ResourceChange}. */
export type ResourceChangeKind = "created" | "updated" | "deleted";

/**
 * The payload handed to a reactive block when its bound mutation fires.
 * `state` is the post-mutation state (null on delete); `prevState` is the
 * pre-mutation state (null on create). `evicted` distinguishes a
 * capacity-driven removal from an explicit delete.
 */
export interface ResourceChange<TState extends JsonObject = JsonObject> {
  /** Collection instance key, or the single resource's ref name. */
  key: string;
  /** Full storage path, e.g. `"artifacts/memo-1"`. */
  ref: string;
  /** Which mutation produced this change. */
  kind: ResourceChangeKind;
  /** Post-mutation state; `null` for `"deleted"`. */
  state: TState | null;
  /** Pre-mutation state; `null` for `"created"`; present for updated/deleted. */
  prevState: TState | null;
  /**
   * `true` only when `kind === "deleted"` AND it was a capacity eviction
   * (LRU/oldest); `false` otherwise.
   */
  evicted: boolean;
}

/**
 * Build a Zod schema matching {@link ResourceChange}`<TState>`, suitable as a
 * reactive block's `inputSchema`. `stateSchema` is the resource's own state
 * schema; `state`/`prevState` are its nullable form.
 *
 * This is an INPUT schema — the BP-016 strict-output rules (which only apply to
 * generator OUTPUT schemas) do not apply, so the schema is returned as-is
 * without `makeSchemaStrict`.
 */
export function resourceChangeSchema(stateSchema: ZodTypeAny): ZodType<ResourceChange> {
  return z.object({
    key: z.string(),
    ref: z.string(),
    kind: z.enum(["created", "updated", "deleted"]),
    state: stateSchema.nullable(),
    prevState: stateSchema.nullable(),
    evicted: z.boolean(),
  }) as unknown as ZodType<ResourceChange>;
}

/**
 * An author's binding for one change kind: either a bare block, or a block
 * paired with an optional `when` gate that skips dispatch when it returns false.
 */
export type ReactiveBinding<TState extends JsonObject = JsonObject> =
  | BlockDefinition<any, any>
  | {
      block: BlockDefinition<any, any>;
      /** Optional gate; skip dispatch when it returns false. */
      when?: (change: ResourceChange<TState>) => boolean;
    };

/** Per-change-kind reactive bindings, as passed to `reactTo`. */
export interface ReactiveBindings<TState extends JsonObject = JsonObject> {
  /** Runs when an instance/resource is created. */
  created?: ReactiveBinding<TState>;
  /** Runs when an instance/resource's state is updated. */
  updated?: ReactiveBinding<TState>;
  /** Runs when an instance/resource is deleted (including eviction). */
  deleted?: ReactiveBinding<TState>;
}

/**
 * Collapse a {@link ReactiveBinding} (bare block or `{ block, when }`) to its
 * normalized `{ block, when? }` form. Exported because the server dispatcher
 * (PR2) reuses it to resolve the block and gate before running it.
 */
export function normalizeReactiveBinding<TState extends JsonObject = JsonObject>(
  binding: ReactiveBinding<TState>
): { block: BlockDefinition<any, any>; when?: (c: ResourceChange<TState>) => boolean } {
  if ("block" in binding) {
    return binding.when === undefined
      ? { block: binding.block }
      : { block: binding.block, when: binding.when };
  }
  return { block: binding };
}

/**
 * Validate a `reactTo` config at definer time. For each present change kind,
 * normalizes the binding and asserts the resolved `block` is a block definition
 * and any `when` is a function, throwing a `<definer>` qualified error otherwise.
 * Shared by `defineResource` and `defineResourceCollection`.
 */
export function validateReactTo(
  definer: string,
  reactTo: ReactiveBindings | undefined
): void {
  if (reactTo === undefined) {
    return;
  }
  for (const kind of ["created", "updated", "deleted"] as const) {
    const binding = reactTo[kind];
    if (binding === undefined) {
      continue;
    }
    const { block, when } = normalizeReactiveBinding(binding);
    if (!isBlockDefinition(block)) {
      throw new Error(
        `${definer} reactTo.${kind} must be a block (got ${JSON.stringify(block)})`
      );
    }
    if (when !== undefined && typeof when !== "function") {
      throw new Error(`${definer} reactTo.${kind}.when must be a function`);
    }
  }
}
