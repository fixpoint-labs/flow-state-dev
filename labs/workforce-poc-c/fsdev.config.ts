/**
 * Zero-model POC. Plan prose and board rows are resource writes, not generators.
 */
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import workforcePocCFlow from "./src/flow";
import path from "node:path";

function neverResolvesAModel(): never {
  throw new Error(
    "workforce-poc-c: no generator actions; this flow never resolves a model."
  );
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

export default createFlowState({
  flows: { "workforce-poc-c": workforcePocCFlow },
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
