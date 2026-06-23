/**
 * Scope-level state-change emission wrappers.
 *
 * `wrapStateOpsWithEmit` wraps bare `StateRef` operations so each committed
 * mutation emits a `state_change` SSE item. Handles both outer scopes
 * (request/session/user/org — no transient filtering) and the block_instance
 * scope (transient-key suppression, `atomicState` diff gating).
 */

import type { FlowInstance, JsonObject, StateRef } from "@flow-state-dev/core/types";
import type { ItemProvenance, StateChangeItem, OutputItem } from "@flow-state-dev/core/items";
import { deepEqual } from "@flow-state-dev/core/helpers";
import type { createStateContainer } from "../stores/state-container";

type StateChangeScope = StateChangeItem["scope"];
type StateChangeOperation = StateChangeItem["operation"];

export function shouldPersistScopeChange(flow: FlowInstance): boolean {
  const withFlags = flow as FlowInstance & {
    persistStateChanges?: boolean;
  };

  if (withFlags.persistStateChanges === true) {
    return true;
  }

  return process.env.NODE_ENV !== "production";
}

export async function emitStateChangeItem(options: {
  response: unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  scope: StateChangeScope;
  operation: StateChangeOperation;
  version: number;
  delta?: unknown;
  path?: string;
  blockInstanceId?: string;
  transient: boolean;
}): Promise<void> {
  const typed = options.response as {
    emitItemAdded?: (item: OutputItem) => Promise<unknown>;
    emitItemDone?: (item: OutputItem) => Promise<unknown>;
  };

  if (
    typeof typed.emitItemAdded !== "function" ||
    typeof typed.emitItemDone !== "function"
  ) {
    return;
  }

  const itemIndex = options.nextItemIndex();
  const item: StateChangeItem = {
    id: `item_state_change_${itemIndex}_${Math.random().toString(16).slice(2)}`,
    type: "state_change",
    status: "completed",
    transient: options.transient,
    requestId: options.requestId,
    itemIndex,
    provenance: options.provenance(),
    ts: Date.now(),
    scope: options.scope,
    blockInstanceId: options.blockInstanceId,
    operation: options.operation,
    path: options.path,
    delta: options.delta,
    version: options.version
  };

  await typed.emitItemAdded(item);
  await typed.emitItemDone(item);
}

/**
 * Wraps a set of `StateRef` operations so each committed mutation emits a
 * `state_change` SSE item. Handles both outer scopes (request/session/user/org)
 * and the block_instance scope.
 *
 * When `transientKeys` is provided and non-empty, patches that touch only
 * transient keys are persisted to the in-memory container but suppressed from
 * SSE emits. When `transientKeys` is absent or empty, no filtering is applied.
 */
export function wrapStateOpsWithEmit<TState extends JsonObject>(options: {
  scope: StateChangeItem["scope"];
  baseOps: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">;
  container: ReturnType<typeof createStateContainer<TState>>;
  getResponse: () => unknown;
  requestId: string;
  nextItemIndex: () => number;
  provenance: () => ItemProvenance;
  transient: boolean;
  transientKeys?: Set<string>;
  blockInstanceId?: string;
}): Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> {
  const transientKeys = options.transientKeys ?? new Set<string>();
  const useTransientFiltering = transientKeys.size > 0;

  function isTransientKey(key: string): boolean {
    return transientKeys.has(key);
  }

  function filterTransientFromDelta<T extends Record<string, unknown>>(
    delta: T
  ): { filtered: Partial<T>; hasNonTransient: boolean } {
    if (!useTransientFiltering) {
      return { filtered: delta, hasNonTransient: Object.keys(delta).length > 0 };
    }
    const filtered: Record<string, unknown> = {};
    let hasNonTransient = false;
    for (const k of Object.keys(delta)) {
      if (!isTransientKey(k)) {
        filtered[k] = delta[k];
        hasNonTransient = true;
      }
    }
    return { filtered: filtered as Partial<T>, hasNonTransient };
  }

  function emit(params: {
    operation: StateChangeOperation;
    delta?: unknown;
    path?: string;
  }): Promise<void> {
    return emitStateChangeItem({
      response: options.getResponse(),
      requestId: options.requestId,
      nextItemIndex: options.nextItemIndex,
      provenance: options.provenance,
      scope: options.scope,
      operation: params.operation,
      delta: params.delta,
      path: params.path,
      version: options.container.getVersion(),
      blockInstanceId: options.blockInstanceId,
      transient: options.transient
    });
  }

  return {
    async patchState(
      updatesOrKey: Partial<TState> | keyof TState,
      updater?: (current: TState[keyof TState]) => TState[keyof TState]
    ) {
      const committed = await (options.baseOps.patchState as (
        updatesOrKey: Partial<TState> | keyof TState,
        updater?: (current: TState[keyof TState]) => TState[keyof TState]
      ) => Promise<boolean>)(updatesOrKey, updater);
      if (!committed) return false;
      const version = options.container.getVersion();
      if (typeof updatesOrKey === "string") {
        if (useTransientFiltering && isTransientKey(updatesOrKey)) return true;
        await emitStateChangeItem({
          response: options.getResponse(),
          requestId: options.requestId,
          nextItemIndex: options.nextItemIndex,
          provenance: options.provenance,
          scope: options.scope,
          operation: "patch",
          path: updatesOrKey,
          delta: { path: updatesOrKey },
          version,
          blockInstanceId: options.blockInstanceId,
          transient: options.transient
        });
        return true;
      }

      const { filtered, hasNonTransient } = filterTransientFromDelta(
        updatesOrKey as Record<string, unknown>
      );
      if (!hasNonTransient) return true;

      await emitStateChangeItem({
        response: options.getResponse(),
        requestId: options.requestId,
        nextItemIndex: options.nextItemIndex,
        provenance: options.provenance,
        scope: options.scope,
        operation: "patch",
        delta: filtered,
        version,
        blockInstanceId: options.blockInstanceId,
        transient: options.transient
      });
      return true;
    },
    async setState(nextState: TState) {
      const committed = await options.baseOps.setState(nextState);
      if (!committed) return false;
      const { filtered, hasNonTransient } = filterTransientFromDelta(
        nextState as Record<string, unknown>
      );
      if (!hasNonTransient) return true;
      await emit({ operation: "set", delta: filtered });
      return true;
    },
    async incState(increments: Record<string, number>) {
      const committed = await options.baseOps.incState(increments);
      if (!committed) return false;
      const { filtered, hasNonTransient } = filterTransientFromDelta(increments);
      if (!hasNonTransient) return true;
      await emit({ operation: "increment", delta: filtered });
      return true;
    },
    async pushState(field: string, value: unknown) {
      const committed = await options.baseOps.pushState(field, value);
      if (!committed) return false;
      if (useTransientFiltering && isTransientKey(field)) return true;
      await emit({ operation: "push", path: field, delta: value });
      return true;
    },
    async setStateRecord(field: string, key: string, value: unknown) {
      const committed = await options.baseOps.setStateRecord(field, key, value);
      if (!committed) return false;
      if (useTransientFiltering && isTransientKey(field)) return true;
      await emit({
        operation: "patch",
        path: `${field}.${key}`,
        delta: { [field]: { [key]: value } }
      });
      return true;
    },
    async deleteStateRecord(field: string, key: string) {
      const committed = await options.baseOps.deleteStateRecord(field, key);
      if (!committed) return false;
      if (useTransientFiltering && isTransientKey(field)) return true;
      await emit({
        operation: "delete_key",
        path: `${field}.${key}`,
        delta: { [field]: key }
      });
      return true;
    },
    async atomicState(mutator: (state: Readonly<TState>) => Partial<TState>) {
      const before = useTransientFiltering
        ? (options.container.read() as Record<string, unknown>)
        : undefined;
      const committed = await options.baseOps.atomicState(mutator);
      if (!committed) return false;
      if (useTransientFiltering && before !== undefined) {
        const after = options.container.read() as Record<string, unknown>;
        const allKeys = new Set<string>([
          ...Object.keys(before),
          ...Object.keys(after)
        ]);
        const changedKeys: string[] = [];
        for (const k of allKeys) {
          if (!deepEqual(before[k], after[k])) {
            changedKeys.push(k);
          }
        }
        if (changedKeys.length > 0 && changedKeys.every((k) => isTransientKey(k))) {
          return true;
        }
      }
      await emit({ operation: "atomic" });
      return true;
    }
  };
}
