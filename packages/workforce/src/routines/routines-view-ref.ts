// FIX-2624.
/**
 * The client's handle on the roster flow's `routines` view: the user's
 * routines, the app's declared ones joined in, read with no session. Holds no
 * block, so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW } from "../workers/keys";
import { ROUTINES_VIEW } from "./keys";
import type { RoutinesViewDefinition } from "./routines";

/** The user's routines, for `client.view(routinesView, {})` or `useView(routinesView)`. Its answer is `{ routines }`. */
export const routinesView = viewRef<RoutinesViewDefinition>(ROSTER_FLOW, ROUTINES_VIEW);
