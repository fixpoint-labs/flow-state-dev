/**
 * fsdev config for the evaluator POC lab.
 *
 * Evaluate goes through AI SDK `experimental_evaluate` (Gateway / Jev)
 * or System 2 `generateObject`. Host keys are never action input.
 *
 *   cd labs/typesafe-jev
 *   pnpm fsdev run system-one route -i '{"message":"let us plan the launch"}'
 *   pnpm fsdev run system-one-index ingest -i '{"key":"dup-charge","title":"Duplicate charge","body":"Card charged twice"}'
 *   pnpm fsdev run system-one-skills activate -i '{"message":"the card was charged twice"}'
 *   pnpm fsdev run ticket-triage triage -i '{"subject":"Duplicate charge","message":"My card was charged twice. Help ASAP."}'
 */

import path from "node:path";
import type { ModelResolver } from "@flow-state-dev/core";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import {
  CASCADING_FLOW_KIND,
  createCascadingTriageFlow,
} from "./src/cascading-flow";
import { createTicketTriageFlow, FLOW_KIND } from "./src/flow";
import { createIndexedDocsFlow, INDEXED_DOCS_FLOW_KIND } from "./src/index-flow";
import { createSystemOneDemoFlow, SYSTEM_ONE_FLOW_KIND } from "./src/mode-flow";
import {
  createSkillActivatorDemoFlow,
  SKILL_ACTIVATOR_FLOW_KIND,
} from "./src/skill-activator-flow";

function neverResolvesAModel(): never {
  throw new Error(
    "typesafe-jev demo actions do not resolve a chat model through fsdev; evaluate uses experimental_evaluate or System 2 generateObject.",
  );
}

const root = path.join(process.cwd(), ".fsdev");

export default createFlowState({
  flows: {
    [SYSTEM_ONE_FLOW_KIND]: createSystemOneDemoFlow(),
    [INDEXED_DOCS_FLOW_KIND]: createIndexedDocsFlow({ systemOne: true }),
    [SKILL_ACTIVATOR_FLOW_KIND]: createSkillActivatorDemoFlow({ systemOne: true }),
    [FLOW_KIND]: createTicketTriageFlow(),
    [CASCADING_FLOW_KIND]: createCascadingTriageFlow(),
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
