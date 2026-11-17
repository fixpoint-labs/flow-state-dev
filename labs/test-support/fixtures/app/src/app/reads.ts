/** The fixture's read model: the findings its allowlist names, for the inventory's controls to plant against. */
import { topic } from "@flow-state-dev/client";

type Calls = { flow(name: string): unknown; subscribe(topics: unknown[], on: unknown): unknown };

/** A row typed by hand. */
export interface BoardTask {
  id: string;
}

/** A row typed by hand, named like the screen type in `src/lib/look.ts`. */
export interface Look {
  id: string;
}

/** Two `.flow(` calls in one function: the same key twice. */
export function load(client: Calls): unknown[] {
  return [client.flow("a"), client.flow("b")];
}

/** One `.subscribe(` call. */
export function watch(client: Calls): unknown {
  return client.subscribe([topic], {});
}
