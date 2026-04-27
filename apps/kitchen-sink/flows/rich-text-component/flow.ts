/**
 * rich-text-component flow
 *
 * A non-agentic counterpoint to chat-agent: seven discrete single-shot AI
 * text transformations exposed as flow actions. No tools, no session state,
 * no resources, no looping — input → one generator → streamed text.
 *
 * Demonstrates that the same `defineFlow` primitive that powers a multi-step
 * agent powers a "Fix grammar" button. Consumed by the artifact editor UI.
 */
import { defineFlow } from "@flow-state-dev/core";

import {
  copyeditGenerator,
  improveGenerator,
  changeToneGenerator,
  translateGenerator,
  summarizeGenerator,
  expandGenerator,
  fixCodeGenerator,
} from "./generators";
import {
  copyeditInputSchema,
  improveInputSchema,
  changeToneInputSchema,
  translateInputSchema,
  summarizeInputSchema,
  expandInputSchema,
  fixCodeInputSchema,
} from "./schemas";

const richTextComponentFlow = defineFlow({
  kind: "rich-text-component",
  requireUser: true,
  actions: {
    copyedit:   { inputSchema: copyeditInputSchema,   block: copyeditGenerator   },
    improve:    { inputSchema: improveInputSchema,    block: improveGenerator    },
    changeTone: { inputSchema: changeToneInputSchema, block: changeToneGenerator },
    translate:  { inputSchema: translateInputSchema,  block: translateGenerator  },
    summarize:  { inputSchema: summarizeInputSchema,  block: summarizeGenerator  },
    expand:     { inputSchema: expandInputSchema,     block: expandGenerator     },
    fixCode:    { inputSchema: fixCodeInputSchema,    block: fixCodeGenerator    },
  },
});

const flow = richTextComponentFlow({ id: "default" });

export default flow;
