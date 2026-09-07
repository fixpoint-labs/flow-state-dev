/**
 * Zero-model POC. Goals and lessons are content writes, not generators.
 */
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import workforcePocEFlow, { otherKindFlow } from "./src/flow";
import path from "node:path";

function neverResolvesAModel(): never {
  throw new Error(
    "workforce-poc-e: no generator actions; this flow never resolves a model."
  );
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

export default createFlowState({
  flows: {
    "workforce-poc-e": workforcePocEFlow,
    "workforce-poc-e-other": otherKindFlow,
  },
  modelResolver,
  stores: {
    dev: {
      primary: filesystemStores({
        rootDir: path.join(process.cwd(), ".fsdev", "data"),
      }),
    },
  },
  defaultProfile: "dev",
});
