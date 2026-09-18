/**
 * fsdev config for the TypeSafe / Jev POC lab.
 *
 * No generators — Jev is a Decisions call, not a chat model. The host key
 * is `OPENROUTER_API_KEY` (never action input).
 *
 *   cd labs/typesafe-jev
 *   pnpm fsdev run ticket-triage triage -i '{"subject":"Duplicate charge","message":"My card was charged twice. Help ASAP."}'
 *   pnpm fsdev run ticket-triage evaluate -i '{"state":"…","questions":{…}}'
 */

import path from "node:path";
import type { ModelResolver } from "@flow-state-dev/core";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import { createTicketTriageFlow, FLOW_KIND } from "./src/flow";

function neverResolvesAModel(): never {
  throw new Error(
    "typesafe-jev declares no generator actions; Jev is called through OpenRouter Decisions.",
  );
}

const root = path.join(process.cwd(), ".fsdev");

export default createFlowState({
  flows: { [FLOW_KIND]: createTicketTriageFlow() },
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
