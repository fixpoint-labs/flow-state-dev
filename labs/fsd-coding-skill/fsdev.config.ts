/**
 * fsdev config for the FSD coding skill lab (FIX-1340).
 *
 * Filesystem `dev` profile — `--session` reuses harness session ids written
 * by `onSession`. No generators; the coding run goes through the host-selected
 * Codex, Cursor, or Claude adapter, which resolves its own model.
 *
 * Host flags (per-command environment, never action input; see README.md):
 *   FSD_CODING_HARNESS          codex | cursor | claude (omit defaults Cursor)
 *   FSD_CODING_CWD              required checkout the harness works in
 *   FSD_CODING_MODEL            optional adapter model override
 *   FSD_CODING_NETWORK_ACCESS   Codex only (`1` / `true`)
 *   FSD_CODING_ADD_DIR          Codex only, PATH-style extra writable dirs
 *                               (`path.delimiter`: `:` on Unix, `;` on Windows)
 *
 * v1 runtime is a local machine or Grok box with the harness already signed
 * in. Cloud agent VMs and nested cloud harnesses are out of scope.
 */
import path from "node:path";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import { createFsdCodingFlow } from "./src/flow";
import { readHostOptionsFromEnv } from "./src/config-env";
import { FLOW_KIND } from "./src/schemas";

function neverResolvesAModel(): never {
  throw new Error(
    "fsd-coding declares no generator actions; the coding run resolves its own model.",
  );
}

const root = path.join(process.cwd(), ".fsdev");
const host = readHostOptionsFromEnv();

export default createFlowState({
  flows: { [FLOW_KIND]: createFsdCodingFlow(host) },
  modelResolver: Object.assign(neverResolvesAModel, {
    resolveId: neverResolvesAModel,
  }) as ModelResolver,
  stores: {
    dev: {
      primary: filesystemStores({
        rootDir: path.join(root, "data"),
        developmentOnly: true,
      }),
    },
  },
  defaultProfile: "dev",
});
