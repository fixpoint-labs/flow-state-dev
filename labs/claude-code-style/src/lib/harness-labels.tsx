/**
 * Each harness's name, by id, as the harness kit's readiness view labels it
 * (`Claude Code (plan)`). The app reads the view and provides it; a card or a
 * spend line reads a harness's name from here, so the lab keeps no table of
 * harness names to drift from the host's.
 */
import { createContext } from "react";

/** Harness labels by id; empty until the readiness view is read, when a harness reads as its id. */
export const HarnessLabels = createContext<Readonly<Record<string, string>>>({});

/** The labels in readiness entries, by harness id. */
export function harnessLabels(entries: readonly { harness: string; label: string }[] | undefined): Record<string, string> {
  return Object.fromEntries((entries ?? []).map((entry) => [entry.harness, entry.label]));
}
