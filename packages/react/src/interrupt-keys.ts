/**
 * The one stop gesture every app with a running job shares. Esc means
 * "dismiss" everywhere, so a single Esc never stops anything: Esc arms, and a
 * second Esc inside the window stops. Cmd+. on a Mac, Ctrl+. elsewhere, stops
 * at once, since nobody types it by accident. An Esc in a text field belongs
 * to the field, and an Esc something already handled (a sheet or dialog that
 * closed on it, which prevents its default) is spent: neither counts, and
 * either clears an armed first press. A held key's auto-repeats are not
 * presses.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** How long after the first Esc a second one still stops, in ms. */
export const INTERRUPT_WINDOW_MS = 1_500;

/** The parts of a keystroke the gesture reads: a React or a DOM `KeyboardEvent` both fit. */
export type InterruptKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented?: boolean;
  /** An auto-repeat from a held key. */
  repeat?: boolean;
  target?: EventTarget | null;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; defaultPrevented?: boolean };
  preventDefault?: () => void;
};

/** What one keystroke came to: stop now, show the "press Esc again" hint, or nothing. */
export type InterruptKeyResult = "interrupt" | "armed" | null;

export type InterruptKeysOptions = {
  /** How long a first Esc stays armed. Defaults to {@link INTERRUPT_WINDOW_MS}. */
  windowMs?: number;
};

/** Whether the keystroke's target is somewhere a person types. */
function inTextField(target: EventTarget | null | undefined): boolean {
  if (target === null || target === undefined || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
}

/**
 * The stop chord as this platform writes it, for a hint or a button title:
 * `⌘.` on Apple platforms, `Ctrl+.` elsewhere and when there is no browser.
 */
export function interruptChordLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+.";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ios/i.test(nav.userAgentData?.platform ?? nav.userAgent ?? "") ? "⌘." : "Ctrl+.";
}

function isStopChord(event: InterruptKeyEvent): boolean {
  return event.key === "." && (event.metaKey || event.ctrlKey);
}

/**
 * The gesture as a small state machine. Feed it every keydown in the scope
 * that can stop; it answers `"interrupt"` when the press completes a stop,
 * `"armed"` on a first Esc, and `null` for a key that is not its own.
 */
export function createInterruptKeys(options: InterruptKeysOptions = {}): {
  press(event: InterruptKeyEvent, now?: number): InterruptKeyResult;
  reset(): void;
} {
  const windowMs = options.windowMs ?? INTERRUPT_WINDOW_MS;
  let armedAt: number | null = null;
  return {
    press(event, now = Date.now()) {
      // A held key repeats: holding Esc to dismiss is one press, never two.
      if (event.repeat === true) return null;
      if (isStopChord(event)) {
        armedAt = null;
        return "interrupt";
      }
      if (event.key !== "Escape") return null;
      const composing = event.isComposing === true || event.nativeEvent?.isComposing === true || event.keyCode === 229;
      const spent = event.defaultPrevented === true || event.nativeEvent?.defaultPrevented === true;
      if (composing || spent || inTextField(event.target)) {
        armedAt = null;
        return null;
      }
      if (armedAt !== null && now - armedAt <= windowMs) {
        armedAt = null;
        return "interrupt";
      }
      armedAt = now;
      return "armed";
    },
    reset() {
      armedAt = null;
    },
  };
}

export type UseInterruptKeysOptions = InterruptKeysOptions & {
  /** Whether there is anything to stop. Off, every key is left alone and the gesture disarms. */
  enabled: boolean;
  /** Called once per completed gesture. */
  onInterrupt: () => void;
  /**
   * `"document"`: the hook listens on the document itself, so the keys work
   * wherever focus is. It listens in the bubble phase, after any
   * capture-phase dismisser has had the chance to spend an Esc. Leave it out
   * to attach the returned `onKeyDown` to a scope of your own.
   */
  target?: "document";
};

/**
 * {@link createInterruptKeys} as a hook. Attach `onKeyDown` to the scope that
 * can stop (a frame's `onKeyDown`, or a document listener); `armed` is true
 * while a first Esc waits for its second, for the "press Esc again" hint, and
 * clears itself when the window runs out.
 */
export function useInterruptKeys(options: UseInterruptKeysOptions): {
  armed: boolean;
  onKeyDown: (event: InterruptKeyEvent) => void;
} {
  const { enabled, onInterrupt, windowMs, target } = options;
  const gesture = useRef(createInterruptKeys({ windowMs }));
  const latest = useRef(onInterrupt);
  latest.current = onInterrupt;
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    gesture.current.reset();
    setArmed(false);
  }, []);

  useEffect(() => {
    gesture.current = createInterruptKeys({ windowMs });
    setArmed(false);
  }, [windowMs]);
  useEffect(() => {
    if (!enabled) disarm();
  }, [enabled, disarm]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const onKeyDown = useCallback(
    (event: InterruptKeyEvent) => {
      if (!enabled) return;
      const result = gesture.current.press(event);
      if (result === "interrupt") {
        event.preventDefault?.();
        disarm();
        latest.current();
      } else if (result === "armed") {
        if (timer.current !== null) clearTimeout(timer.current);
        setArmed(true);
        timer.current = setTimeout(disarm, windowMs ?? INTERRUPT_WINDOW_MS);
      } else if (event.key === "Escape") {
        disarm();
      }
    },
    [enabled, disarm, windowMs],
  );

  useEffect(() => {
    if (target !== "document" || typeof document === "undefined") return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [target, onKeyDown]);

  return { armed, onKeyDown };
}
