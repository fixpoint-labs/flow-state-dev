/**
 * Test fixture: a config that is present but skipped. The tests run this
 * directory with `--no-config`, so this file is never loaded, and the CLI must
 * not claim that no fsdev.config.* exists.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import intentChat from "./src/flows/intent-chat/flow";

export default createFlowState({
  flows: { "intent-chat": intentChat },
  stores: { default: { primary: inMemoryStores() } },
});
