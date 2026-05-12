/**
 * Canned conversations used by stories that demo a multi-item session.
 */
import type { OutputItem } from "@flow-state-dev/core/items";

import { messageItem, reasoningItem, toolItem } from "./items";

/**
 * A short user/assistant exchange with no tools or reasoning.
 */
export function plainConversation(): OutputItem[] {
  return [
    messageItem({ role: "user", text: "What's the capital of France?", requestId: "req-1" }),
    messageItem({ role: "assistant", text: "Paris.", requestId: "req-1" }),
  ];
}

/**
 * An assistant turn that reasons, runs a tool, and replies — exercising the
 * full chat-assistant renderer registry.
 */
export function toolUseConversation(): OutputItem[] {
  return [
    messageItem({ role: "user", text: "What's the weather in Tokyo?", requestId: "req-2" }),
    reasoningItem({ text: "I should call the weather tool for Tokyo.", requestId: "req-2" }),
    toolItem({
      name: "get_weather",
      args: { city: "Tokyo" },
      output: { tempC: 22, condition: "cloudy" },
      requestId: "req-2",
    }),
    messageItem({
      role: "assistant",
      text: "It's 22°C and cloudy in Tokyo.",
      requestId: "req-2",
    }),
  ];
}
