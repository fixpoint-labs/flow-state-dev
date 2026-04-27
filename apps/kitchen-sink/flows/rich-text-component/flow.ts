/**
 * rich-text-component flow
 *
 * A non-agentic counterpoint to chat-agent: eight discrete single-shot AI
 * text transformations exposed as flow actions. No tools, no looping, no
 * cross-action state — input → one generator → streamed text.
 *
 * The `personalize` action reads user-scoped episodic + semantic memories
 * captured by chat-agent. Both flows configure `memorySystem` with the same
 * user scope, and user-scoped resources are stored at bare `userId` (no
 * flow-isolation by default), so memories captured in chat-agent are
 * visible here.
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
  personalizeGenerator,
} from "./generators";
import {
  copyeditInputSchema,
  improveInputSchema,
  changeToneInputSchema,
  translateInputSchema,
  summarizeInputSchema,
  expandInputSchema,
  fixCodeInputSchema,
  personalizeInputSchema,
} from "./schemas";
import { mem } from "./memory";

const richTextComponentFlow = defineFlow({
  kind: "rich-text-component",
  requireUser: true,
  actions: {
    copyedit:    { inputSchema: copyeditInputSchema,    block: copyeditGenerator    },
    improve:     { inputSchema: improveInputSchema,     block: improveGenerator     },
    changeTone:  { inputSchema: changeToneInputSchema,  block: changeToneGenerator  },
    translate:   { inputSchema: translateInputSchema,   block: translateGenerator   },
    summarize:   { inputSchema: summarizeInputSchema,   block: summarizeGenerator   },
    expand:      { inputSchema: expandInputSchema,      block: expandGenerator      },
    fixCode:     { inputSchema: fixCodeInputSchema,     block: fixCodeGenerator     },
    personalize: { inputSchema: personalizeInputSchema, block: personalizeGenerator },
  },

  // FIX-435: resources live in a single flat resources map; their intrinsic
  // scope routes them to the right storage layer. Spreading mem.userResources
  // registers `episodicMemory` and `semanticMemory` at user scope so the
  // personalize generator's memory capability has user-store backing.
  resources: { ...(mem.userResources ?? {}) },
});

const flow = richTextComponentFlow({ id: "default" });

export default flow;
