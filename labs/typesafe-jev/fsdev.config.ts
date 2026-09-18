/**
 * fsdev config for the System One POC lab.
 *
 * No generators — Jev is a Decisions call, not a chat model. The host key
 * is `OPENROUTER_API_KEY` (never action input).
 *
 *   cd labs/typesafe-jev
 *   pnpm fsdev run system-one route -i '{"message":"let us plan the launch"}'
 *   pnpm fsdev run ticket-triage triage -i '{"subject":"Duplicate charge","message":"My card was charged twice. Help ASAP."}'
 */

import path from "node:path";
import type { ModelResolver } from "@flow-state-dev/core";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import { createTicketTriageFlow, FLOW_KIND } from "./src/flow";
import { createSystemOneDemoFlow, SYSTEM_ONE_FLOW_KIND } from "./src/mode-flow";

function neverResolvesAModel(): never {
  throw new Error(
    "typesafe-jev declares no generator actions; Jev is called through OpenRouter Decisions.",
  );
}

const root = path.join(process.cwd(), ".fsdev");

export default createFlowState({
  flows: {
    [SYSTEM_ONE_FLOW_KIND]: createSystemOneDemoFlow(),
    [FLOW_KIND]: createTicketTriageFlow(),
  },
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
