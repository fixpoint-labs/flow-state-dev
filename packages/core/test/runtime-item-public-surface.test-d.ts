/**
 * Compile-time assertion that `RuntimeItem` is importable from the public
 * paths, since public signatures such as `ResponseEmitterHandle.getItems()`
 * return it. Callers must be able to name the type without the internal path.
 *
 * If either public re-export is removed, or `getItems()` stops returning the
 * runtime union, this file fails to compile.
 */
import type { RuntimeItem } from "@flow-state-dev/core";
import type { OutputItem, RuntimeItem as ItemsRuntimeItem } from "@flow-state-dev/core/items";
import type { RuntimeItem as InternalRuntimeItem } from "@flow-state-dev/core/items/internal";
import type { ResponseEmitterHandle } from "@flow-state-dev/core/types";

declare const handle: ResponseEmitterHandle;

const fullLog: readonly RuntimeItem[] = handle.getItems();
const viaItems: readonly ItemsRuntimeItem[] = fullLog;
const viaInternal: readonly InternalRuntimeItem[] = viaItems;

// The full log carries trace rows, so it is not an `OutputItem[]`.
// @ts-expect-error trace rows are not OutputItem
const notPublic: readonly OutputItem[] = handle.getItems();

void viaInternal;
void notPublic;
