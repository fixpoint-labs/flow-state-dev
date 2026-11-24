/**
 * A teammate's bot: one ink-drawn face per teammate on a 64×64 grid, the
 * same wherever the teammate shows. Two ways to draw it:
 *
 * - {@link Avatar}: a solid tile in the teammate's color with the bot in
 *   dark ink, in every theme. Its state wins over its color: running turns
 *   the eyes blue, needs-you puts it on the highlighter, queued draws it as a
 *   dashed outline, idle dims its eyes, done keeps them ink.
 * - {@link BotFigure}: the header's bot, full size with no frame, its head
 *   filled with the teammate's dark tint and animated by its state (the
 *   `hb-*` keyframes in `styles.css`, which stop under reduced motion).
 *
 * The eleven faces (Pip, Tally, Bolt, Dot, Hex, Sprocket, Visor, Dome, Pod,
 * Telly, Chip) share one layout: an antenna at the top, the head, then the
 * shoulders, so the animations move the same parts on every face.
 */
import type { CSSProperties, ReactNode } from "react";
import type { BotFace, BotStatus, Look } from "../lib/looks";
import { cn } from "../lib/utils";

/** A face's head and its eyes, open; drawn with the bot's stroke. */
interface FaceParts {
  head: ReactNode;
  /** The open eyes, each a filled shape. */
  eyes: ReactNode;
  /** The antenna, from the head's top: it sways while the bot runs. */
  antenna: ReactNode;
  /** Where the eyes sit, for the shut eyes of a queued bot. */
  eyeY: number;
  eyeX: readonly number[];
}

const ROUND_EYES = (y: number, xs: readonly number[], r = 3.5) => xs.map((x) => <circle key={x} cx={x} cy={y} r={r} />);
const BALL_ANTENNA = (
  <>
    <path d="M32 15V7" />
    <circle cx="32" cy="5.5" r="2.5" data-tip />
  </>
);

const FACES: Record<BotFace, FaceParts> = {
  pip: {
    head: <rect x="14" y="15" width="36" height="28" rx="10" />,
    eyes: ROUND_EYES(28, [25, 39]),
    antenna: BALL_ANTENNA,
    eyeY: 28,
    eyeX: [25, 39],
  },
  tally: {
    head: (
      <>
        <rect x="11" y="16" width="42" height="26" rx="4" />
        <path d="M11 25H7v8h4M53 25h4v8h-4" />
      </>
    ),
    eyes: [<rect key="l" x="20" y="26.5" width="9" height="4" rx="1" />, <rect key="r" x="35" y="26.5" width="9" height="4" rx="1" />],
    antenna: (
      <>
        <path d="M32 16V8" />
        <rect x="28.5" y="3.5" width="7" height="4.5" rx="1" data-tip />
      </>
    ),
    eyeY: 28.5,
    eyeX: [24.5, 39.5],
  },
  bolt: {
    head: <rect x="15" y="15" width="34" height="28" rx="6" />,
    eyes: [<rect key="l" x="21.5" y="24.5" width="6" height="6" rx="1" />, <rect key="r" x="36.5" y="24.5" width="6" height="6" rx="1" />],
    antenna: (
      <>
        <path d="M32 15l-3-4 5-2-3-5" />
        <circle cx="31" cy="4" r="1.5" data-tip />
      </>
    ),
    eyeY: 27.5,
    eyeX: [24.5, 39.5],
  },
  dot: {
    head: <circle cx="32" cy="29" r="15" />,
    eyes: <circle cx="32" cy="27.5" r="5" />,
    antenna: (
      <>
        <path d="M32 14V8" />
        <circle cx="32" cy="6" r="2.5" data-tip />
      </>
    ),
    eyeY: 27.5,
    eyeX: [32],
  },
  hex: {
    head: <path d="M32 14l16 7.5v15L32 44l-16-7.5v-15z" />,
    eyes: ROUND_EYES(28.5, [25.5, 38.5], 3.2),
    antenna: (
      <>
        <path d="M32 14V7" />
        <path d="M29 7h6" data-tip />
      </>
    ),
    eyeY: 28.5,
    eyeX: [25.5, 38.5],
  },
  sprocket: {
    head: (
      <>
        <circle cx="32" cy="29" r="13" />
        <path d="M32 13v3M32 42v3M16 29h3M45 29h3M20.7 17.7l2.1 2.1M41.2 38.2l2.1 2.1M20.7 40.3l2.1-2.1M41.2 19.8l2.1-2.1" />
      </>
    ),
    eyes: ROUND_EYES(28, [27, 37], 3),
    antenna: (
      <>
        <path d="M32 13V8" />
        <circle cx="32" cy="6" r="2" data-tip />
      </>
    ),
    eyeY: 28,
    eyeX: [27, 37],
  },
  visor: {
    head: <rect x="14" y="15" width="36" height="28" rx="8" />,
    eyes: <rect x="19" y="24.5" width="26" height="7" rx="3.5" />,
    antenna: (
      <>
        <path d="M32 15V8" />
        <path d="M29.5 5.5l2.5-2.5 2.5 2.5-2.5 2.5z" data-tip />
      </>
    ),
    eyeY: 28,
    eyeX: [25, 39],
  },
  dome: {
    head: <path d="M14 43V31a18 18 0 0 1 36 0v12z" />,
    eyes: ROUND_EYES(30, [25, 39]),
    antenna: (
      <>
        <path d="M32 13V7" />
        <circle cx="32" cy="5" r="2" data-tip />
      </>
    ),
    eyeY: 30,
    eyeX: [25, 39],
  },
  pod: {
    head: (
      <>
        <rect x="13" y="17" width="38" height="24" rx="12" />
        <circle cx="10" cy="29" r="2.5" />
        <circle cx="54" cy="29" r="2.5" />
      </>
    ),
    eyes: [<ellipse key="l" cx="25" cy="28" rx="2.5" ry="4" />, <ellipse key="r" cx="39" cy="28" rx="2.5" ry="4" />],
    antenna: (
      <>
        <path d="M32 17c-3-1.5 3-3 0-4.5s3-3 0-4.5" />
        <circle cx="32" cy="5.5" r="2" data-tip />
      </>
    ),
    eyeY: 28,
    eyeX: [25, 39],
  },
  telly: {
    head: (
      <>
        <rect x="12" y="15" width="40" height="29" rx="5" />
        <rect x="17" y="20" width="30" height="20" rx="3" />
      </>
    ),
    eyes: ROUND_EYES(28.5, [26, 38], 3),
    antenna: (
      <>
        <path d="M30 15l-6-9M34 15l6-9" />
        <circle cx="24" cy="6" r="1.8" data-tip />
        <circle cx="40" cy="6" r="1.8" data-tip />
      </>
    ),
    eyeY: 28.5,
    eyeX: [26, 38],
  },
  chip: {
    head: (
      <>
        <rect x="17" y="15" width="30" height="28" rx="3" />
        <path d="M17 21h-4M17 29h-4M17 37h-4M47 21h4M47 29h4M47 37h4" />
      </>
    ),
    eyes: [<path key="l" d="M25 24.5l3.5 3.5-3.5 3.5-3.5-3.5z" />, <path key="r" d="M39 24.5l3.5 3.5-3.5 3.5-3.5-3.5z" />],
    antenna: (
      <>
        <path d="M32 15V9" />
        <path d="M28.5 9h7L32 4z" data-tip />
      </>
    ),
    eyeY: 28,
    eyeX: [25, 39],
  },
};

/** The bot itself, on the 64×64 grid: antenna, head, eyes, mouth, shoulders; `figure` adds the header's extras. */
function BotSvg({ face, state, figure = false, size }: { face: BotFace; state: BotStatus; figure?: boolean; size: number }) {
  const parts = FACES[face];
  const queued = state === "queued";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--b-ink)"
      strokeWidth={figure ? 2.5 : 3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={queued ? "3 3.5" : undefined}
      data-bot-svg
    >
      <g className="hb-body">
        <g className="hb-antenna">{parts.antenna}</g>
        <g fill="var(--b-head)">{parts.head}</g>
        {queued ? (
          <g className="hb-eyes" strokeDasharray="none">
            {parts.eyeX.map((x) => (
              <path key={x} d={`M${x - 3.5} ${parts.eyeY}h7`} />
            ))}
          </g>
        ) : (
          <g className="hb-eyes" fill="var(--b-eye)" stroke="none" opacity={state === "idle" ? 0.45 : 1}>
            <g className="hb-blink">{parts.eyes}</g>
          </g>
        )}
        {/* A smile once it is done; a flat mouth otherwise. */}
        <path className="hb-mouth" d={state === "done" ? "M27 36.5q5 3.5 10 0" : "M28 37h8"} />
        <path d="M20 62v-9a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6v9" fill="var(--b-head)" />
        {figure ? <FigureExtras state={state} /> : null}
      </g>
    </svg>
  );
}

/** What only the header's bot draws: its arms, and its state's mark (typing dots, a tick, z's, an alert). */
function FigureExtras({ state }: { state: BotStatus }) {
  return (
    <>
      {state === "needs" ? <path d="M20 52l-7-9M44 52l7-9" className="hb-arms" /> : <path d="M20 54l-5 7M44 54l5 7" />}
      {state === "running" ? (
        <g className="hb-type" fill="var(--b-eye)" stroke="none">
          <circle cx="27" cy="55" r="1.6" />
          <circle cx="32" cy="55" r="1.6" />
          <circle cx="37" cy="55" r="1.6" />
        </g>
      ) : null}
      {state === "done" ? <path d="M51 12l3 3 6-7" stroke="var(--done)" strokeDasharray="none" /> : null}
      {state === "queued" ? (
        <g className="hb-zz" stroke="none" fill="var(--b-ink)" fontFamily="var(--font-mono)" fontSize="8" fontWeight="600">
          <text x="50" y="14">z</text>
          <text x="55" y="8" fontSize="6">z</text>
        </g>
      ) : null}
      {state === "needs" ? (
        <g className="hb-flash">
          <circle cx="54" cy="10" r="6" fill="var(--hl)" stroke="var(--bot-ink)" strokeWidth="1.5" />
          <path d="M54 7v3.5M54 13v.2" stroke="var(--bot-ink)" strokeWidth="1.8" />
        </g>
      ) : null}
    </>
  );
}

const SIZES = {
  sm: { box: "size-5 rounded-[5px]", bot: 18 },
  md: { box: "size-[34px] rounded-[6px]", bot: 30 },
  lg: { box: "size-[38px] rounded-[6px]", bot: 34 },
} as const;

/** The tile's colours by state: the stroke, the eyes and the tile itself. Needs-you wins over the team color. */
function tileStyle(look: Look, state: BotStatus): CSSProperties {
  const tile = `var(--team-${look.color}-tile)`;
  if (state === "queued") return { "--b-ink": "var(--ink3)", "--b-eye": "var(--ink3)", "--b-head": "transparent", background: "transparent", outline: `1.5px dashed ${tile}`, outlineOffset: "-1.5px" } as CSSProperties;
  return {
    "--b-ink": "var(--bot-ink)",
    "--b-eye": state === "running" ? "var(--bot-live)" : "var(--bot-ink)",
    "--b-head": "transparent",
    background: state === "needs" ? "var(--hl)" : tile,
  } as CSSProperties;
}

/**
 * A teammate's bot on its tile. `state` says what it is doing (see the
 * module's note); without one it is drawn as done, eyes in ink.
 */
export function Avatar({ look, size = "md", state = "done" }: { look: Look; size?: keyof typeof SIZES; state?: BotStatus }) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      data-avatar={look.color}
      data-face={look.face}
      data-state={state}
      style={tileStyle(look, state)}
      className={cn("inline-flex shrink-0 items-end justify-center overflow-hidden", s.box)}
    >
      <BotSvg face={look.face} state={state} size={s.bot} />
    </span>
  );
}

/**
 * The header's bot: 64px with no frame, its head filled with the
 * teammate's dark tint, animated by its state. Running sways and pulses the
 * antenna, scans the eyes and types on the chest; done bobs and blinks with a
 * smile and a tick; queued breathes with its eyes shut under drifting z's;
 * needs-you hops with its arms up beside a flashing alert.
 */
export function BotFigure({ look, state }: { look: Look; state: BotStatus }) {
  return (
    <span
      aria-hidden
      data-avatar={look.color}
      data-face={look.face}
      data-state={state}
      data-bot-figure
      style={
        {
          "--b-ink": "var(--ink)",
          "--b-eye": state === "running" ? "var(--blue)" : "var(--ink)",
          "--b-head": `var(--team-${look.color}-surface)`,
        } as CSSProperties
      }
      className="inline-flex size-16 shrink-0"
    >
      <BotSvg face={look.face} state={state} size={64} figure />
    </span>
  );
}
