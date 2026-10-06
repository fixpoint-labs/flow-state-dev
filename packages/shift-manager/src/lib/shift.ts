/**
 * Shift Manager's theme: three shifts, Day, Evening and Night.
 *
 * The root element carries the shift as `data-shift`, and Night also takes the
 * `dark` class the design-system theme and Tailwind's `dark:` variant key on.
 * Evening is a light variant, so it never takes `dark`.
 *
 * Which shift the page opens on, in order:
 *
 * 1. The one a person picked with the mark in the sidebar header. It's kept in
 *    this browser's storage, so it holds across reloads and restarts.
 * 2. One forced at start (`--shift day|evening|night`, or
 *    `SHIFT_MANAGER_SHIFT`), which reaches the page as a meta tag.
 * 3. The one the clock calls for: Day from 06:00, Evening from 16:00, Night
 *    from 19:00 until the next morning.
 *
 * After that the clock only moves the mark's sundial; it never changes the
 * shift. A change a person picks fades in over a third of a second.
 *
 * Browser storage can be missing or throw (a private window, blocked site
 * data); then a pick still changes the look, it just isn't kept.
 */

/** A shift the page can be in. */
export type Shift = "day" | "evening" | "night";

/** Every shift, in the order a day runs through them. */
export const SHIFTS: readonly Shift[] = ["day", "evening", "night"];

/** The hour, on the clock, each shift starts at. Night runs past midnight to the next morning's Day. */
const STARTS: Record<Shift, number> = { day: 6, evening: 16, night: 19 };

/** The page meta the `shift-manager` command writes a forced shift into. */
const SHIFT_META = "shift-manager-color-scheme";

/** The browser storage key a person's pick is kept under. */
const PICK_KEY = "shift-manager:shift";

/** How long a change takes to show. */
const FADE_MS = 320;

/** How often the clock is read, so the sundial moves within a minute of the time. */
const TICK_MS = 15_000;

const isShift = (value: unknown): value is Shift => value === "day" || value === "evening" || value === "night";

/**
 * A shift named by a stored or served value. The two-look build named them
 * `light` and `dark`; a pick or a profile written then still reads. Anything
 * else, such as the `auto` an earlier build could keep, names none.
 */
function parseShift(value: unknown): Shift | undefined {
  if (isShift(value)) return value;
  return value === "light" ? "day" : value === "dark" ? "night" : undefined;
}

/** The shift the clock calls for at `hour`, 0 up to 24. */
export function shiftAt(hour: number): Shift {
  if (hour >= STARTS.night || hour < STARTS.day) return "night";
  return hour >= STARTS.evening ? "evening" : "day";
}

/** The shift a click on the mark moves to from `shift`: Day, Evening, Night, and back to Day. */
export function nextShift(shift: Shift): Shift {
  return SHIFTS[(SHIFTS.indexOf(shift) + 1) % SHIFTS.length]!;
}

/**
 * The shift the page was served with, or `undefined` when it was started on
 * none (or the meta holds anything but a shift).
 */
export function readServedShift(doc: Document = document): Shift | undefined {
  return parseShift(doc.querySelector<HTMLMetaElement>(`meta[name="${SHIFT_META}"]`)?.content.trim());
}

/** The look on the page, and the mark's handle on it. */
export interface ShiftLook {
  /** The shift the page shows now. */
  current(): Shift;
  /** Minutes since midnight, the sundial's position. It moves on a minute boundary, not within one. */
  minute(): number;
  /** A person's pick: shown at once and kept for this browser. */
  choose(shift: Shift): void;
  /** Move to the shift after this one (`nextShift`). */
  cycle(): void;
  /** Call `listener` whenever the shift or the minute changes. @returns A function that stops calling it. */
  subscribe(listener: () => void): () => void;
  /** Stop reading the clock. */
  stop(): void;
}

/**
 * Set the look at boot, by the precedence in this file's header, and return
 * the handle the mark drives it through.
 *
 * @param served The shift the page was served with (`readServedShift`).
 * @param now The clock; the tests move it.
 */
export function bootShift(
  served: Shift | undefined,
  win: Pick<Window, "localStorage"> = window,
  root: HTMLElement = document.documentElement,
  now: () => Date = () => new Date(),
): ShiftLook {
  const listeners = new Set<() => void>();
  let kept: string | null = null;
  try {
    kept = win.localStorage.getItem(PICK_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
  const minuteNow = (): number => {
    const d = now();
    return d.getHours() * 60 + d.getMinutes();
  };

  let shift: Shift = parseShift(kept) ?? served ?? shiftAt(minuteNow() / 60);
  let shownMinute = minuteNow();
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const paint = () => {
    root.dataset.shift = shift;
    root.classList.toggle("dark", shift === "night");
  };

  paint();

  const tick = setInterval(() => {
    if (minuteNow() === shownMinute) return;
    shownMinute = minuteNow();
    notify();
  }, TICK_MS);

  const choose = (next: Shift) => {
    try {
      win.localStorage.setItem(PICK_KEY, next);
    } catch {
      // Storage blocked: the pick holds for this page only.
    }
    if (next === shift) return;
    shift = next;
    // The fade class is on only while the colours move.
    root.style.setProperty("--shift-xd", `${FADE_MS}ms`);
    root.classList.add("shift-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove("shift-fade"), FADE_MS + 100);
    paint();
    notify();
  };

  return {
    current: () => shift,
    minute: minuteNow,
    choose,
    cycle: () => choose(nextShift(shift)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => clearInterval(tick),
  };
}
