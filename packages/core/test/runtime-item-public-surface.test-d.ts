/**
 * Compile-time assertion that `RuntimeItem` is importable from its public
 * path, `@flow-state-dev/core/items`, since public signatures such as
 * `ResponseEmitterHandle.getItems()` return it. Callers must be able to name
 * the type without the internal path.
 *
 * If the public re-export is removed, or `getItems()` stops returning the
 * runtime union, this file fails to compile.
 */
import type { OutputItem, RuntimeItem } from "@flow-state-dev/core/items";
import type { RuntimeItem as InternalRuntimeItem } from "@flow-state-dev/core/internal";
import type { ResponseEmitterHandle } from "@flow-state-dev/core/types";

declare const handle: ResponseEmitterHandle;

const fullLog: readonly RuntimeItem[] = handle.getItems();
const viaInternal: readonly InternalRuntimeItem[] = fullLog;

// The full log carries trace rows, so it is not an `OutputItem[]`.
// @ts-expect-error trace rows are not OutputItem
const notPublic: readonly OutputItem[] = handle.getItems();

void viaInternal;
void notPublic;
