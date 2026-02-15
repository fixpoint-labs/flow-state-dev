import type { BlockKind } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";

export type WaveACoreTypeImportProof = BlockKind;
export type WaveACoreItemImportProof = OutputItem["type"];

export const waveACoreItemImportProof: WaveACoreItemImportProof = "message";
