/**
 * The page's address: what is open, so a reload, a link or Back reopens it.
 * `?worker=<id>` for the teammate whose conversation is open, and, while a
 * task's popup is open, `&session=<id>&task=<id>`: the conversation the task
 * was filed in (devtool's `SESSION_ADDRESS_PARAM`, so links agree across
 * apps) and the task. A message's popup is not in the address.
 */
import { SESSION_ADDRESS_PARAM } from "@flow-state-dev/devtool/react";

/** What the address names. */
export interface Address {
  worker?: string;
  session?: string;
  task?: string;
}

/** How a write lands in history: a user's pick adds a Back step; a default or a fallback does not. */
export type AddressWrite = "push" | "replace";

const WORKER = "worker";
const TASK = "task";

const param = (search: URLSearchParams, name: string) => search.get(name)?.trim() || undefined;

/** The address the page is on now. A task without its session names nothing. */
export function readAddress(): Address {
  const search = new URLSearchParams(window.location.search);
  const session = param(search, SESSION_ADDRESS_PARAM);
  const task = param(search, TASK);
  return session === undefined || task === undefined ? { worker: param(search, WORKER) } : { worker: param(search, WORKER), session, task };
}

/** Put `address` in the page's address, leaving any other parameter alone. Writes nothing when it is already there. */
export function writeAddress(address: Address, how: AddressWrite): void {
  const url = new URL(window.location.href);
  const set = (name: string, value: string | undefined) => (value === undefined ? url.searchParams.delete(name) : url.searchParams.set(name, value));
  set(WORKER, address.worker);
  set(SESSION_ADDRESS_PARAM, address.session);
  set(TASK, address.task);
  if (url.href === window.location.href) return;
  if (how === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(window.history.state, "", url);
}
