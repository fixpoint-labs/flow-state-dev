/**
 * The client's own live read (`client.live`) over a test's fake `subscribe`,
 * for a fake client the adapter watches through: `get live() { return liveOver(this); }`.
 */
import type { Client } from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";

/** `client.live`, riding whatever `subscribe` the fake holds when it is called. */
export function liveOver(fake: { subscribe: Client["subscribe"] }): Client["live"] {
  return ((topics, options) => liveRead((wanted, subscribeOptions) => fake.subscribe(wanted, subscribeOptions), topics, options as never)) as Client["live"];
}
