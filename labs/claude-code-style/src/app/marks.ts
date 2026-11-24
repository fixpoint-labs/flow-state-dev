/**
 * Your marks on threads: the ones you pinned and the failed attempts you
 * dismissed, each your user resource (`flows/user-marks.mts`) read by scope
 * with no session. Pin, unpin and dismiss write them (`calls.ts`).
 */
import { useResource } from "@flow-state-dev/react";
import { appDismissals, appPins } from "../../flows/user-marks.mts";
import { useAppContext } from "./provider";

/** Your pinned task ids. */
export function usePins(): string[] | undefined {
  const { client, pollIntervalMs } = useAppContext();
  return useResource(appPins, { client, pollIntervalMs }).value?.pinned;
}

/** The failed attempts you dismissed, as `dismissalKey`s. */
export function useDismissed(): string[] | undefined {
  const { client, pollIntervalMs } = useAppContext();
  return useResource(appDismissals, { client, pollIntervalMs }).value?.dismissed;
}
