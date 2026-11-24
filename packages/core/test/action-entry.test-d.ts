/**
 * Compile-time assertions that a bare block in `actions` keeps full input
 * typing: the published action is `ActionConfig<typeof block>`, so a client
 * typed from `typeof flow` sees the block's input schema, exactly as it does
 * for `{ block }`.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file in this package's
 * `test` directory, so a regression here fails `pnpm typecheck`.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ActionConfig, FlowActionInput } from "@flow-state-dev/core/types";

const chat = handler({ name: "chat", inputSchema: z.object({ message: z.string() }), execute: () => null });
const chatPlain = handler({ name: "chat-plain", inputSchema: z.object({ text: z.string() }), execute: () => null });

const flow = defineFlow({
  kind: "typed-bare",
  actions: {
    chat,
    chatPlain: { block: chatPlain, userMessage: (input) => input.text }
  }
});

expectTypeOf(flow.actions.chat).toEqualTypeOf<ActionConfig<typeof chat>>();
expectTypeOf<FlowActionInput<typeof flow.actions.chat>>().toEqualTypeOf<{ message: string }>();
expectTypeOf<FlowActionInput<typeof flow.actions.chatPlain>>().toEqualTypeOf<{ text: string }>();
expectTypeOf<FlowActionInput<ReturnType<typeof flow>["actions"]["chat"]>>().toEqualTypeOf<{ message: string }>();

defineFlow({
  kind: "typed-bare-bad",
  actions: {
    // @ts-expect-error — an entry is a block or `{ block }`, never another value.
    chat: "chat"
  }
});
