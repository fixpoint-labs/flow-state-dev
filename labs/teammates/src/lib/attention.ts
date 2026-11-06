/**
 * How the lab calls you back from another tab: the tab's title counts the
 * teammates that have something for you, `(2) Teammates`, and, when you turn
 * *Notify me* on, a desktop notification says what is new while the tab is in
 * the background. Both read only what each teammate's row already holds:
 * whether it has unread lines, what it needs from you, and which coding
 * tasks just ended.
 *
 * Two rules, on purpose (FIX-2397 D1, D3): what *needs* you is `needsOf`'s,
 * and drives the badge, the status line and the notifications; what the
 * title counts is wider, a teammate with an unread line or a need, once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardTask } from "../adapter";
import { endedAt, type Need } from "./status";

/** The page's own name, the title with nothing waiting. */
export const TITLE = "Teammates";

/** One thing worth a notification: its key (so it fires once) and what it says. */
export interface Alert {
  key: string;
  text: string;
}

/** What one teammate's row reports up: it has something for you (an unread line or a need), and the alerts it holds now. */
export interface RowAttention {
  asks: boolean;
  alerts: readonly Alert[];
}

/** A row's attention, from its name, its unread count, what it needs from you and its coding tasks that just ended. */
export function rowAttention(name: string, unread: number, needs: readonly Need[], endings: readonly BoardTask[]): RowAttention {
  return {
    asks: unread > 0 || needs.length > 0,
    alerts: [
      ...needs.map((n) => ({ key: n.key, text: n.kind === "approval" ? `${name} needs your OK: ${n.text}` : `${name} is waiting on you: ${n.text}` })),
      ...endings.map((t) => ({ key: `ended:${t.id}:${endedAt(t)}`, text: `Coding task ${t.status === "failed" ? "failed" : "finished"}: ${t.title}` })),
    ],
  };
}

/** The tab's title: how many teammates have something for you, each counted once. */
export function titleFor(rows: Readonly<Record<string, RowAttention>>): string {
  const count = Object.values(rows).filter((r) => r.asks).length;
  return count > 0 ? `(${count}) ${TITLE}` : TITLE;
}

/**
 * Fires each alert once, the first time it is seen, and only while `enabled()`
 * and the tab is hidden. An alert first seen with the tab in front is known
 * and never fires later: you saw it there.
 */
export function createNotifier(io: { enabled: () => boolean; hidden: () => boolean; notify: (text: string) => void }) {
  const known = new Set<string>();
  return (alerts: readonly Alert[]) => {
    for (const alert of alerts) {
      if (known.has(alert.key)) continue;
      known.add(alert.key);
      if (io.enabled() && io.hidden()) io.notify(alert.text);
    }
  };
}

const KEY = "teammates.notify";

/** Whether this browser can show notifications at all. */
export const supported = () => typeof window !== "undefined" && "Notification" in window;

/**
 * *Notify me*: off until you turn it on, then remembered per viewer in
 * browser storage. Turning it on asks the browser's permission; a refusal
 * leaves it off and says why.
 */
export function useNotifyToggle(): { on: boolean; blocked: string | undefined; toggle: () => Promise<void> } {
  const [on, setOn] = useState(() => {
    try {
      return supported() && window.localStorage.getItem(KEY) === "on" && Notification.permission === "granted";
    } catch {
      return false;
    }
  });
  const [blocked, setBlocked] = useState<string | undefined>(() => (supported() ? undefined : "This browser can't show notifications."));
  const store = (value: boolean) => {
    try {
      window.localStorage.setItem(KEY, value ? "on" : "off");
    } catch {
      // Storage blocked: the toggle lasts until reload.
    }
  };
  const toggle = useCallback(async () => {
    if (!supported()) return;
    if (on) {
      setOn(false);
      store(false);
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      setBlocked("Notifications are blocked for this page in the browser's settings.");
      return;
    }
    setBlocked(undefined);
    setOn(true);
    store(true);
  }, [on]);
  return { on, blocked, toggle };
}

/** Sets the tab's title from the rows, and notifies of new alerts while `notifyOn`. Puts back the title the page had on unmount. */
export function useAttention(rows: Readonly<Record<string, RowAttention>>, notifyOn: boolean): void {
  const enabled = useRef(notifyOn);
  enabled.current = notifyOn;
  const [observe] = useState(() =>
    createNotifier({
      enabled: () => enabled.current,
      hidden: () => document.visibilityState === "hidden",
      notify: (text) => {
        try {
          new Notification(TITLE, { body: text });
        } catch {
          // A browser that refuses to construct one here shows nothing.
        }
      },
    }),
  );
  const [original] = useState(() => document.title);
  const title = titleFor(rows);
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => () => void (document.title = original), [original]);
  useEffect(() => {
    observe(Object.values(rows).flatMap((r) => r.alerts));
  }, [rows, observe]);
}
