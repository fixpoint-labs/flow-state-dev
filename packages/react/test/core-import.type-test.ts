/**
 * React reads core's types through core's public subpaths, not a copy: a block
 * kind and an item type resolve from `@flow-state-dev/core/types` and
 * `@flow-state-dev/core/items`. Checked by `tsc` (the package's typecheck),
 * never run.
 */
import type { BlockKind } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";

const kind: BlockKind = "handler";
const itemType: OutputItem["type"] = "message";

// @ts-expect-error a block kind core does not declare is refused
const notAKind: BlockKind = "middleware";

void [kind, itemType, notAKind];
