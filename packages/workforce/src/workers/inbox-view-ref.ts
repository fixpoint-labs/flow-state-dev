// FIX-2774.
/**
 * The client's handle on the inbox view: the roster flow's address and the
 * view's name, typed by the view through a type import. Holds no block, so it
 * is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { INBOX_VIEW, ROSTER_FLOW } from "./keys";
import type { InboxView } from "./inbox-view";

/** What waits on the user across their sessions, and every board row: `useView(inboxViewRef)`. */
export const inboxViewRef = viewRef<InboxView>(ROSTER_FLOW, INBOX_VIEW);
