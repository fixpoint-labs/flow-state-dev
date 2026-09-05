/**
 * Compile-time half of the conformance claim: the block `codexAgent()` returns
 * is a `HarnessBlock`.
 *
 * This is the half that answers epic theme 7's question — whether the contract
 * LAB-152 wrote down is a real seam or a Claude-shaped one. It is also the
 * cheap half: `HarnessBlock` is typed over the input and output *types* rather
 * than their schemas, and an alias whose schema slots are `any` proves less
 * than it looks like it does. The proof that carries the weight is the runtime
 * one in `test/conformance.spec.ts` and `test/agent.spec.ts` — a handle a real
 * run returns, parsed against the NEUTRAL `harnessRunHandleSchema`.
 *
 * What this file does catch is the handle drifting off the contract: drop
 * `cost` or `outcome` from the Codex handle and it goes red. It catches nothing
 * on the *input* side — TypeScript's parameter bivariance accepts a block whose
 * input carries extra required fields.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file here, and the
 * `typecheck` script runs it after the `src` pass.
 */
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { codexAgent } from "../src/agent";

const agent = codexAgent({
  // Never called: this file is compiled, not run. The version gate is stubbed
  // out for the same reason — a compile must not depend on what is on disk.
  readInstalledSdkVersion: () => null,
  resolveCodexClient: () => ({
    startThread: () => {
      throw new Error("unused");
    },
    resumeThread: () => {
      throw new Error("unused");
    },
  }),
});

// Red if the Codex harness drifts off the contract in either direction.
const conforms: HarnessBlock = agent;
void conforms;
