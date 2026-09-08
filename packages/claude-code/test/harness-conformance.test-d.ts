/**
 * Compile-time half of the conformance claim: the block `claudeCodeAgent()`
 * returns is a `HarnessBlock`.
 *
 * The cheap half, deliberately. `HarnessBlock` is typed over the input and
 * output *types* rather than their schemas — the schema-typed spelling rejects
 * every real harness, because each returns the neutral handle plus its own
 * extension — and an alias whose schema slots are `any` proves less than it
 * looks like it does. The proof that carries the weight is the runtime one in
 * `test/sdk/agent.spec.ts`: the handle a real run returns, parsed against
 * `harnessRunHandleSchema`.
 *
 * What it does catch is the handle drifting off the contract: drop `cost` or
 * `outcome` from the SDK handle and this goes red. It catches nothing on the
 * *input* side — TypeScript's parameter bivariance accepts a block whose input
 * carries extra required fields, so adding one to the agent's input schema
 * passes here. The input contract is held by review and by the core suite's
 * "prompt and nothing else" test, not by this file.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file in this package's
 * `test` directory, and the `typecheck` script runs it after the `src` pass.
 */
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "../src/sdk/agent";

const agent = claudeCodeAgent({
  resolveClaudeAgent: () => ({
    query: async function* () {
      // Never called: this file is compiled, not run.
    },
  }),
});

// Red if the SDK door drifts off the contract in either direction.
const conforms: HarnessBlock = agent;
void conforms;
