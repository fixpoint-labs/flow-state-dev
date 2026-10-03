/**
 * A Node module hook that swaps one source module of the served Lab for a
 * control's, the server-side twin of the Vite swap the page controls use.
 *
 * Registered by `swap-hook.mjs`, which the goal puts on the Lab process's
 * `NODE_OPTIONS`. Every import that resolves to `target` resolves to `with`
 * instead (except the control's own), and each one is appended to `fired`, so
 * the goal can fail a run whose swap never happened.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

let swap;

/** `{ target, with, fired }`: absolute paths. */
export async function initialize(data) {
  swap = { target: pathToFileURL(data.target).href, with: pathToFileURL(data.with).href, fired: data.fired };
}

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (swap === undefined || resolved.url !== swap.target || context.parentURL === swap.with) return resolved;
  appendFileSync(swap.fired, `${context.parentURL ?? "(entry)"}\n`);
  return { ...resolved, url: swap.with, shortCircuit: true };
}
