/**
 * Payload and binding types for reactive blocks (FIX-751, FIX-843).
 *
 * A reactive block is one an author binds to a resource or collection mutation
 * via `reactTo` on `defineResource` / `defineResourceCollection`. When the bound
 * mutation fires, the server dispatcher runs the block with a payload describing
 * what changed. There are two payload families, one per mutation axis:
 *
 * - {@link ResourceChange} — a structured-state mutation (`created` /
 *   `stateUpdated` / `deleted`), carrying the post/pre state.
 * - {@link ResourceContentChange} — a content-body write (`contentUpdated`),
 *   carrying only identity; the block `readContent()`s for the fresh body.
 *
 * This file owns:
 *
 * - the payload shapes and their Zod input schemas ({@link resourceChangeSchema},
 *   {@link resourceContentChangeSchema});
 * - {@link ReactiveBinding} / {@link ReactiveContentBinding} / {@link ReactiveBindings}
 *   — the author-facing `reactTo` config (bare block or `{ block, when }`, keyed
 *   by reactive kind);
 * - {@link normalizeReactiveBinding} — collapses a binding union to a single
 *   `{ block, when? }` form, shared by the definers and the server dispatcher.
 *
 * Note the vocabulary split: these *reactive* kinds (`created` / `deleted` /
 * `stateUpdated` / `contentUpdated`) are author-facing. The internal mutation
 * seam and the FIX-739 client `resource_change` wire format keep the older
 * `"created" | "updated" | "deleted"`; the server dispatcher maps one to the
 * other (a content write fires the seam as `"updated"` and routes here to
 * `contentUpdated`).
 */

import { z, type ZodType, type ZodTypeAny } from "zod";
import type { JsonObject } from "../schema/common";
import type { BlockDefinition } from "./block";
import { isBlockDefinition } from "../blocks/internal/utils";

/**
 * The kind of structured-state mutation that produced a {@link ResourceChange}.
 * `stateUpdated` (renamed from FIX-751's `updated`) names the axis that changed,
 * keeping it parallel to the content axis's `contentUpdated`.
 */
export type ResourceChangeKind = "created" | "stateUpdated" | "deleted";

/**
 * The full set of author-facing reactive kinds: the three state kinds plus the
 * content kind. Backs `reactTo`'s keys and `validateReactTo`'s `allowedKinds`.
 */
export type ReactiveBindingKind = ResourceChangeKind | "contentUpdated";

/**
 * The payload handed to a reactive block when its bound state mutation fires.
 * `state` is the post-mutation state (null on delete); `prevState` is the
 * pre-mutation state (null on create). `evicted` distinguishes a
 * capacity-driven removal from an explicit delete.
 */
export interface ResourceChange<TState extends JsonObject = JsonObject> {
  /** Collection instance key, or the single resource's ref name. */
  key: string;
  /** Full storage path, e.g. `"artifacts/memo-1"`. */
  ref: string;
  /** Which state mutation produced this change. */
  kind: ResourceChangeKind;
  /** Post-mutation state; `null` for `"deleted"`. */
  state: TState | null;
  /** Pre-mutation state; `null` for `"created"`; present for stateUpdated/deleted. */
  prevState: TState | null;
  /**
   * `true` only when `kind === "deleted"` AND it was a capacity eviction
   * (LRU/oldest); `false` otherwise.
   */
  evicted: boolean;
}

/**
 * The payload handed to a reactive block when a resource's content body is
 * written (`writeContent`). Deliberately minimal: bodies are not inlined — the
 * block `readContent()`s the fresh body, and reads state (unchanged by a content
 * write) from `ctx.resources` if it needs it.
 */
export interface ResourceContentChange {
  /** Collection instance key, or the single resource's ref name. */
  key: string;
  /** Full storage path, e.g. `"artifacts/memo-1"`. */
  ref: string;
  /** Always `"contentUpdated"` — the discriminant against {@link ResourceChange}. */
  kind: "contentUpdated";
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
    kind: z.enum(["created", "stateUpdated", "deleted"]),
    state: stateSchema.nullable(),
    prevState: stateSchema.nullable(),
    evicted: z.boolean(),
  }) as unknown as ZodType<ResourceChange>;
}

/**
 * Build a Zod schema matching {@link ResourceContentChange}, suitable as a
 * `reactTo.contentUpdated` block's `inputSchema`. Takes no state schema — a
 * content change carries only identity. An INPUT schema, so BP-016 does not apply.
 */
export function resourceContentChangeSchema(): ZodType<ResourceContentChange> {
  return z.object({
    key: z.string(),
    ref: z.string(),
    kind: z.literal("contentUpdated"),
  }) as unknown as ZodType<ResourceContentChange>;
}

/**
 * An author's binding for one state kind: either a bare block, or a block paired
 * with an optional `when` gate that skips dispatch when it returns false.
 */
export type ReactiveBinding<TState extends JsonObject = JsonObject> =
  | BlockDefinition<any, any>
  | {
      block: BlockDefinition<any, any>;
      /** Optional gate; skip dispatch when it returns false. */
      when?: (change: ResourceChange<TState>) => boolean;
    };

/**
 * An author's binding for the content kind. Same shape as {@link ReactiveBinding},
 * but its `when` gate receives a {@link ResourceContentChange} (`key`/`ref` only —
 * no state to gate on; gate on state inside the block).
 */
export type ReactiveContentBinding =
  | BlockDefinition<any, any>
  | {
      block: BlockDefinition<any, any>;
      /** Optional gate; skip dispatch when it returns false. */
      when?: (change: ResourceContentChange) => boolean;
    };

/** Per-reactive-kind bindings, as passed to `reactTo`. */
export interface ReactiveBindings<TState extends JsonObject = JsonObject> {
  /** Runs when an instance/resource is created. */
  created?: ReactiveBinding<TState>;
  /** Runs when an instance/resource's structured state is updated. */
  stateUpdated?: ReactiveBinding<TState>;
  /** Runs when an instance/resource is deleted (including eviction). */
  deleted?: ReactiveBinding<TState>;
  /** Runs after an instance/resource's content body is written. */
  contentUpdated?: ReactiveContentBinding;
  // The `updated` umbrella (react to ANY in-place change) is intentionally
  // reserved, not declared: it is expressible by binding the same block to both
  // `stateUpdated` and `contentUpdated`, and can be added non-breakingly later.
}

/**
 * Collapse a reactive binding (bare block or `{ block, when }`) to its
 * normalized `{ block, when? }` form. Generic over the change payload type so it
 * serves both {@link ReactiveBinding} (state) and {@link ReactiveContentBinding}
 * (content). Exported because the server dispatcher reuses it to resolve the
 * block and gate before running it.
 */
export function normalizeReactiveBinding<TChange = ResourceChange>(
  binding:
    | BlockDefinition<any, any>
    | { block: BlockDefinition<any, any>; when?: (change: TChange) => boolean }
): { block: BlockDefinition<any, any>; when?: (c: TChange) => boolean } {
  // Discriminate via the canonical block guard rather than `"block" in binding`,
  // which would misread a bare block that ever gained a `block` property.
  if (isBlockDefinition(binding)) {
    return { block: binding };
  }
  return binding.when === undefined
    ? { block: binding.block }
    : { block: binding.block, when: binding.when };
}

/**
 * Validate a `reactTo` config at definer time. For each present reactive kind,
 * normalizes the binding and asserts the resolved `block` is a block definition
 * and any `when` is a function, throwing a `<definer>` qualified error otherwise.
 * Shared by `defineResource` and `defineResourceCollection`.
 *
 * `allowedKinds` restricts which reactive kinds may be bound. Single resources
 * have no create/delete lifecycle (they always exist with a default and are only
 * ever updated), so `defineResource` passes `["stateUpdated", "contentUpdated"]`
 * — a `created` or `deleted` binding on a single resource is a silent no-op at
 * runtime and is rejected here instead. Collections allow all four.
 */
export function validateReactTo(
  definer: string,
  reactTo: ReactiveBindings | undefined,
  allowedKinds: readonly ReactiveBindingKind[] = [
    "created",
    "stateUpdated",
    "deleted",
    "contentUpdated",
  ]
): void {
  if (reactTo === undefined) {
    return;
  }
  for (const kind of ["created", "stateUpdated", "deleted", "contentUpdated"] as const) {
    const binding = reactTo[kind];
    if (binding === undefined) {
      continue;
    }
    if (!allowedKinds.includes(kind)) {
      throw new Error(
        `${definer} does not support reactTo.${kind} — single resources have no create/delete lifecycle and only fire "stateUpdated" / "contentUpdated". Use reactTo.stateUpdated or reactTo.contentUpdated.`
      );
    }
    const { block, when } = normalizeReactiveBinding(binding as ReactiveBinding);
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
