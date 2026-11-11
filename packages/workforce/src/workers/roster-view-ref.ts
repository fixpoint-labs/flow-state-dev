// FIX-2623.
/**
 * The client's handle on the roster view: the roster flow's address and the
 * view's name, typed by the view through a type import. Holds no block, so it
 * is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW, ROSTER_VIEW } from "./keys";
import type { RosterView } from "./roster-view";

/** The roster view, for `useView(rosterView)` or `client.view(rosterView)`. */
export const rosterView = viewRef<RosterView>(ROSTER_FLOW, ROSTER_VIEW);
