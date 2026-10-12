/**
 * The door a fixture worker flow takes a user's line through.
 *
 * Every worker flow has one door: the public action that declares
 * `userMessage` and takes `{ message }`. A fixture whose point is its board or
 * its runs, not conversation, answers a line by saying it heard it, so a test
 * driving its composer sees the line read and answered.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

/** What a fixture worker says when it hears `message`. */
export const fixtureHeardLine = (message: string) => `Heard: ${message}`;

const messageInput = z.object({ message: z.string() });

const hear = handler({
  name: "fixture-hear",
  inputSchema: messageInput,
  outputSchema: z.object({ heard: z.string() }),
  execute: (input, ctx) => {
    ctx.emit.message(fixtureHeardLine(input.message));
    return { heard: input.message };
  },
});

/** One door, under the action name `message`. Spread into a fixture's `actions`. */
export const hearingDoor = {
  message: {
    block: hear,
    inputSchema: messageInput,
    userMessage: (input: { message: string }) => input.message,
    description: "A user's line into this worker's session.",
  },
};
