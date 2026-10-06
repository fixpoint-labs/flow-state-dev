/**
 * Shift Manager's mark: three overlapping petals, one per shift (Day,
 * Evening, Night, left to right), and the control that changes the theme. A
 * click moves to the next shift (Day, Evening, Night, back to Day).
 *
 * The petals are outlined, and one filled outline sits over the shift that's
 * showing, in that shift's colour. A sundial dot rides the dashed arc above
 * them to show the time of day: the left end is midnight, the top noon, the
 * right end midnight again.
 *
 * The petals' colours are the design system's `--shift-*` tokens. The ink is
 * the theme's own, so the mark follows the page through each shift.
 */
import { useSyncExternalStore } from "react";
import { nextShift, SHIFTS, type Shift, type ShiftLook } from "../lib/shift";

/** The three petals, left to right: each one the width of two steps along the page's horizontal midline. */
const PETALS = ["M31 45 Q53 7 75 45 Q53 83 31 45 Z", "M53 45 Q75 7 97 45 Q75 83 53 45 Z", "M75 45 Q97 7 119 45 Q97 83 75 45 Z"] as const;

/** How far the filled petal slides from one shift's petal to the next. */
const PETAL_STEP = 22;

/** The arc the sundial rides, as a quadratic curve from `(31, 24)` through the control `(75, -4)` to `(119, 24)`. */
const ARC = { x0: 31, x1: 75, x2: 119, y0: 24, y1: -4, y2: 24 } as const;

/** Where the sundial dot sits at `minute` since midnight: that fraction of the way along the arc. */
export function sundial(minute: number): { x: number; y: number } {
  const t = minute / 1440;
  const u = 1 - t;
  return {
    x: u * u * ARC.x0 + 2 * u * t * ARC.x1 + t * t * ARC.x2,
    y: u * u * ARC.y0 + 2 * u * t * ARC.y1 + t * t * ARC.y2,
  };
}

const NAMES: Record<Shift, string> = { day: "Day", evening: "Evening", night: "Night" };

/** The shift's name, as the header and the roster show it. */
export const shiftName = (shift: Shift): string => NAMES[shift];

/** What the control is called, and what a click does: "Theme: Evening. Click for Night." */
export function describeMark(shift: Shift): string {
  return `Theme: ${NAMES[shift]}. Click for ${NAMES[nextShift(shift)]}.`;
}

export function ShiftManagerMark({ look }: { look: ShiftLook }) {
  const shift = useSyncExternalStore(look.subscribe, look.current);
  const minute = useSyncExternalStore(look.subscribe, look.minute);
  const dot = sundial(minute);
  const label = describeMark(shift);

  return (
    <button
      type="button"
      onClick={look.cycle}
      title={label}
      aria-label={label}
      data-testid="shift-mark"
      data-shift={shift}
      className="flex shrink-0 cursor-pointer py-0.5"
    >
      <svg viewBox="28 -2 94 88" className="block h-auto w-[42px] overflow-visible" aria-hidden>
        <path d="M31 24 Q75 -4 119 24" fill="none" strokeWidth={2} strokeDasharray="3 4" className="stroke-muted-foreground" />
        <g fill="none" strokeWidth={2.4} strokeDasharray="14 4 3 4 3 4" className="stroke-muted-foreground">
          {PETALS.map((d, i) => (
            <path key={SHIFTS[i]} d={d} />
          ))}
        </g>
        <g style={{ transform: `translateX(${SHIFTS.indexOf(shift) * PETAL_STEP}px)`, transition: "transform .32s cubic-bezier(.6,0,.2,1)" }}>
          <path d={PETALS[0]} strokeWidth={4.4} className="stroke-foreground" style={{ fill: `var(--shift-${shift})`, transition: "fill .32s linear" }} />
        </g>
        <circle cx={dot.x} cy={dot.y} r={6} className="fill-foreground" />
      </svg>
    </button>
  );
}
