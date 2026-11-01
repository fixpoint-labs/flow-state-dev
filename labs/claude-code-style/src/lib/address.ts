/**
 * The page's address: what is open, so a reload, a link or Back reopens it.
 * `?view=threads` while no session is open, `?session=<id>` for the open
 * session (devtool's `SESSION_ADDRESS_PARAM`, so links agree across apps), and
 * `&task=<id>` for the task open in that session's pane.
 */
import { SESSION_ADDRESS_PARAM } from "@flow-state-dev/devtool/react";
import type { ModeId } from "../modes";

/** What the address names. */
export interface Address {
  view?: ModeId;
  session?: string;
  task?: string;
}

/** How a write lands in history: a user's pick adds a Back step; a default or a fallback does not. */
export type AddressWrite = "push" | "replace";

const VIEW = "view";
const TASK = "task";

const param = (search: URLSearchParams, name: string) => search.get(name)?.trim() || undefined;

/** The address the page is on now. A view the app doesn't know is ignored. */
export function readAddress(): Address {
  const search = new URLSearchParams(window.location.search);
  const view = param(search, VIEW);
  return {
    view: view === "session" || view === "threads" ? view : undefined,
    session: param(search, SESSION_ADDRESS_PARAM),
    task: param(search, TASK),
  };
}

/** Put `address` in the page's address, leaving any other parameter alone. Writes nothing when it is already there. */
export function writeAddress(address: Address, how: AddressWrite): void {
  const url = new URL(window.location.href);
  const set = (name: string, value: string | undefined) => (value === undefined ? url.searchParams.delete(name) : url.searchParams.set(name, value));
  // An open session's mode decides its view, so the view is written only without one.
  set(VIEW, address.session === undefined && address.view !== "session" ? address.view : undefined);
  set(SESSION_ADDRESS_PARAM, address.session);
  set(TASK, address.session === undefined ? undefined : address.task);
  if (url.href === window.location.href) return;
  if (how === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(window.history.state, "", url);
}
