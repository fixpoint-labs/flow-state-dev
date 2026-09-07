/**
 * Compile-time half of the conformance claim: the block `cursorAgent()` returns
 * is a `HarnessBlock`.
 *
 * This is the cheap half. `HarnessBlock` is typed over the input and output
 * *types* rather than their schemas, and an alias whose schema slots are `any`
 * proves less than it looks like it does. The proof that carries the weight is
 * the runtime one in `conformance.spec.ts` and `agent.spec.ts` — a handle a real
 * run returns, parsed against the NEUTRAL `harnessRunHandleSchema`.
 *
 * What this file does catch is the handle drifting off the contract: drop `cost`
 * or `outcome` from the Cursor handle and it goes red. It catches nothing on the
 * *input* side — TypeScript's parameter bivariance accepts a block whose input
 * carries extra required fields.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file here, and the
 * `typecheck` script runs it after the `src` pass.
 */
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";

const agent = cursorAgent({
  // Never called: this file is compiled, not run. The version gate is stubbed
  // out for the same reason — a compile must not depend on what is on disk.
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "absent" }),
  resolveCursorClient: () => ({
    create: () => {
      throw new Error("unused");
    },
    resume: () => {
      throw new Error("unused");
    },
  }),
} as CursorAgentOptions);

// Red if the Cursor harness drifts off the contract in either direction.
const conforms: HarnessBlock = agent;
void conforms;

// Red if a public seam for the version reader ever appears on the options. The
// gate is one of the three things this package promises; an option a host could
// answer with the tested version would make it a claim rather than a guarantee.
// The runtime half — a plausible spelling is ignored, and the private symbol is
// not exported from the root — lives in `version-gate.spec.ts`.
const noPublicReaderSeam: "readInstalledSdkVersion" extends keyof CursorAgentOptions
  ? never
  : true = true;
const noSymbolOnTheType: typeof INTERNAL_SDK_VERSION_READER extends keyof CursorAgentOptions
  ? never
  : true = true;
void noPublicReaderSeam;
void noSymbolOnTheType;
