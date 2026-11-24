// FIX-2624.
/**
 * The client's handle on the readiness view: the host's flow and the view's
 * name, typed by the view through a type import. Holds no block, so it is
 * safe in a browser bundle.
 */
import { viewRef, type ViewRef } from "@flow-state-dev/client";
import type { HarnessReadinessViewDefinition } from "./readiness";

/**
 * The readiness view a host installed on `flow` as `views: { [view]: harnessReadinessView(readiness) }`,
 * for `client.view(ref, { refresh })` or `useView(ref)`.
 *
 * @param flow The flow the host installed the view on.
 * @param view The view's name in that flow's `views`. Default `"readiness"`.
 */
export function harnessReadinessViewRef(flow: string, view = "readiness"): ViewRef<HarnessReadinessViewDefinition> {
  return viewRef<HarnessReadinessViewDefinition>(flow, view);
}
