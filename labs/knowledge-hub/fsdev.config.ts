/**
 * fsdev config for the Knowledge Hub lab scaffold (FIX-881).
 *
 * Dev profile only — in-memory/filesystem stores, no Postgres, no MCP adapter,
 * no secrets. The follow-on issues (FIX-882–884) add the real stores, adapters,
 * and profiles as the functional surface lands.
 */
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import knowledgeHubFlow from "./src/flow";
import path from "node:path";

/**
 * The scaffold has no generator actions — `ping` is pure CRUD-free echo, no
 * model calls. Passing an explicit throwing resolver skips the ambient
 * `FSDEV_DEFAULT_MODEL` / `FSDEV_INTENT_*` env scan (mirrors the knowledge-base
 * example's config), which would otherwise throw on a model-using env here.
 */
function neverResolvesAModel(): never {
  throw new Error("knowledge-hub: no generator actions are configured yet; this flow never resolves a model.");
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

export default createFlowState({
  flows: { "knowledge-hub": knowledgeHubFlow },
  modelResolver,
  stores: {
    dev: { primary: filesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") }) },
  },
  defaultProfile: "dev",
});
