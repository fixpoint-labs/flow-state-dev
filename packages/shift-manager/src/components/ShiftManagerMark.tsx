/**
 * Shift Manager's mark: three overlapping petals, one per theme (Day,
 * Evening, Night, left to right), and the control that changes the theme. A
 * click moves to the next theme (Day, Evening, Night, back to Day).
 *
 * The petals are outlined, and one filled outline sits over the theme that's
 * showing, in that theme's colour. A sundial dot rides the dashed arc above
 * them to show the time of day: the left end is midnight, the top noon, the
 * right end midnight again.
 *
 * The petals' colours are the design system's `--theme-*` tokens. The ink is
 * the theme's own, so the mark follows the page through each theme.
 */
import { useSyncExternalStore } from "react";
import { FADE_MS, nextTheme, themeName, THEMES, type Theme, type ThemeLook } from "../lib/theme";

/** The three petals, left to right: each one the width of two steps along the page's horizontal midline. */
const PETALS = ["M31 45 Q53 7 75 45 Q53 83 31 45 Z", "M53 45 Q75 7 97 45 Q75 83 53 45 Z", "M75 45 Q97 7 119 45 Q97 83 75 45 Z"] as const;

/** How far the filled petal slides from one theme's petal to the next. */
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

/** What the control is called, and what a click does: "Theme: Evening. Click for Night." */
export function describeMark(theme: Theme): string {
  return `Theme: ${themeName(theme)}. Click for ${themeName(nextTheme(theme))}.`;
}

export function ShiftManagerMark({ look }: { look: ThemeLook }) {
  const theme = useSyncExternalStore(look.subscribe, look.current);
  const minute = useSyncExternalStore(look.subscribe, look.minute);
  const dot = sundial(minute);
  const label = describeMark(theme);

  return (
    <button
      type="button"
      onClick={look.cycle}
      title={label}
      aria-label={label}
      data-testid="theme-mark"
      data-theme={theme}
      className="flex shrink-0 cursor-pointer py-0.5"
    >
      <svg viewBox="28 -2 94 88" fill="none" className="block h-auto w-[42px] overflow-visible" aria-hidden>
        <path d="M31 24 Q75 -4 119 24" fill="none" strokeWidth={2} strokeDasharray="3 4" className="stroke-muted-foreground" />
        <g fill="none" strokeWidth={2.4} strokeDasharray="14 4 3 4 3 4" className="stroke-muted-foreground">
          {PETALS.map((d, i) => (
            <path key={THEMES[i]} d={d} />
          ))}
        </g>
        <g style={{ transform: `translateX(${THEMES.indexOf(theme) * PETAL_STEP}px)`, transition: `transform ${FADE_MS}ms cubic-bezier(.6,0,.2,1)` }}>
          <path d={PETALS[0]} strokeWidth={4.4} className="stroke-foreground" style={{ fill: `var(--theme-${theme})`, transition: `fill ${FADE_MS}ms linear` }} />
        </g>
        <circle cx={dot.x} cy={dot.y} r={6} className="fill-foreground" />
      </svg>
    </button>
  );
}
