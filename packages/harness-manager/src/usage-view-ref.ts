// FIX-2624.
/**
 * The client's handles on usage: the view a host serves with
 * `harnessUsageFlow`, typed through a type import, and Re-check, a send to the
 * usage collection that its writer flow runs. Holds no block, so it is safe
 * in a browser bundle.
 */
import { viewRef, type Client, type ViewRef } from "@flow-state-dev/client";
import type { HarnessUsageViewDefinition } from "./harness-usage";
import { HARNESS_USAGE_FLOW, HARNESS_USAGE_PATTERN, HARNESS_USAGE_RECHECK, HARNESS_USAGE_VIEW } from "./usage-keys";

/** The usage view, for `client.view(ref, {})` or `useView(ref)`. Its answer is `{ harnesses }`. */
export function harnessUsageViewRef(): ViewRef<HarnessUsageViewDefinition> {
  return viewRef<HarnessUsageViewDefinition>(HARNESS_USAGE_FLOW, HARNESS_USAGE_VIEW);
}

/**
 * Re-check: ask each harness for a fresh reading of the caller's usage, at
 * most once a minute per person and harness, and store it. Runs in the
 * caller's own write session on the usage flow; no session is named or made
 * here. Resolves to the harnesses that were asked this time (the others were
 * asked under a minute ago). Read the view afterwards for the rows.
 */
export async function recheckHarnessUsage(client: Pick<Client, "resource">): Promise<{ asked: string[] }> {
  return client.resource({ scope: "user", pattern: HARNESS_USAGE_PATTERN }).send<{ asked: string[] }>(HARNESS_USAGE_RECHECK, {});
}
