/**
 * A message box's unsent text, kept in `localStorage` so a reload or a remount
 * does not lose what was typed.
 *
 * Text is stored under `<namespace>:<id>`: the namespace is the app's (and the
 * box's, when an app has several kinds), the id is what the box writes to, such
 * as a session. The stored text is read when the box opens, and when `id`
 * changes on a box that stays mounted. Text typed before the id is known
 * (`undefined`) is kept in memory and stored once the id arrives.
 *
 * Storage that throws (quota, private mode) leaves the draft in memory only.
 */
import { useCallback, useEffect, useRef, useState } from "react";

function storageKey(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}

/** The stored draft for `id`, or `""`: for code that runs after its box closed. */
export function readDraft(namespace: string, id: string | undefined): string {
  if (id === undefined || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey(namespace, id)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Store `text` as the draft for `id` (`""` drops it), whether or not a box for it is open: for a
 * send that settles after its box closed. A box already open for `id` keeps what it shows.
 */
export function saveDraft(namespace: string, id: string | undefined, text: string): void {
  if (id === undefined || typeof window === "undefined") return;
  try {
    if (text === "") window.localStorage.removeItem(storageKey(namespace, id));
    else window.localStorage.setItem(storageKey(namespace, id), text);
  } catch {
    // Keep the in-memory draft only.
  }
}

/**
 * Drop the stored draft for `id`, leaving any box's in-memory text alone: for a
 * send the server took while the box may already hold newer text. With `sent`,
 * the stored draft is dropped only if it is still that text (surrounding
 * whitespace aside), so a send that
 * settles after the box was closed and reopened keeps what was typed since.
 */
export function clearDraft(namespace: string, id: string | undefined, sent?: string): void {
  if (sent !== undefined && readDraft(namespace, id).trim() !== sent.trim()) return;
  saveDraft(namespace, id, "");
}

/**
 * The unsent text for one box, restored from storage when it opens. The setter
 * stores as it sets; setting `""` drops the stored draft. A setter kept from an
 * earlier `id` (a slow send that settles after the box moved on) stores under
 * that id and leaves the shown draft alone. A setter called after the box
 * unmounted does nothing: the box opened next owns the stored draft, so clear
 * a send that settles late with {@link clearDraft} and its `sent` text.
 */
export function useDraft(namespace: string, id: string | undefined): [string, (text: string) => void] {
  const [state, setState] = useState(() => ({ id, draft: readDraft(namespace, id) }));

  if (state.id !== id) {
    let draft = readDraft(namespace, id);
    // Typed before the id was known: it belongs to the id that just arrived.
    if (id !== undefined && state.id === undefined && state.draft !== "") {
      saveDraft(namespace, id, state.draft);
      draft = state.draft;
    }
    setState({ id, draft });
  }

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);

  const setDraft = useCallback(
    (text: string) => {
      if (!mounted.current) return;
      saveDraft(namespace, id, text);
      setState((prev) => (prev.id === id ? { id, draft: text } : prev));
    },
    [namespace, id],
  );

  return [state.draft, setDraft];
}
