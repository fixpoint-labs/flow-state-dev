/**
 * A door for test worker flows.
 *
 * Every worker flow has exactly one door: a public action that declares
 * `userMessage` and takes `{ message }`, so an app can talk to any worker
 * without knowing its flow. A fixture whose point is something else spreads
 * this into its `actions` to meet that requirement:
 *
 * ```ts
 * actions: { run: { inputSchema, block: work }, ...workerDoor }
 * ```
 */
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

const messageInput = z.object({ message: z.string() });

const talk = handler({
  name: "test-worker-door",
  inputSchema: messageInput,
  outputSchema: messageInput,
  execute: (input) => input
});

/** One door, under the action name `talk`. */
export const workerDoor = {
  talk: { inputSchema: messageInput, block: talk, userMessage: (input: { message: string }) => input.message }
};
