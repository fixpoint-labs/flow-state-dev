import type { BlockKind } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";

export type CoreTypeImportProof = BlockKind;
export type CoreItemImportProof = OutputItem["type"];

export const coreItemImportProof: CoreItemImportProof = "message";
