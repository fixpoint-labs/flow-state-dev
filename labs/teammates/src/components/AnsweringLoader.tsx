/**
 * The small animated loader in the "is answering" bubble: three dots in ink,
 * the middle one in blue (live), doing one of six moves. A reply picks one
 * move at random when it starts and keeps it until it ends, so the bubble
 * never swaps loaders mid-reply or on a redraw. The loader is decorative
 * (`aria-hidden`): the bubble's words still say who is answering. Its styles
 * (`.ld-*`, in `styles.css`) read the theme's tokens and hold still under
 * reduced motion.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/utils";

/** The six moves, in the design canvas's order. */
export const LOADERS = ["bounce", "juggle", "leapfrog", "orbit", "chase", "gather"] as const;

/** One of the six moves. */
export type LoaderVariant = (typeof LOADERS)[number];

/** One move drawn at random; `random` returns a number in [0, 1), as `Math.random` does. */
export function pickLoader(random: () => number = Math.random): LoaderVariant {
  return LOADERS[Math.min(LOADERS.length - 1, Math.floor(random() * LOADERS.length))]!;
}

/**
 * The move for the reply under way: drawn once when `replying` turns on, kept
 * while it stays on, dropped when it turns off so the next reply draws again.
 */
export function useLoaderPerReply(replying: boolean, random: () => number = Math.random): LoaderVariant | undefined {
  const [pick, setPick] = useState<LoaderVariant>();
  if (replying && pick === undefined) {
    const next = pickLoader(random);
    setPick(next);
    return next;
  }
  if (!replying && pick !== undefined) {
    setPick(undefined);
    return undefined;
  }
  return pick;
}

/** A dot or ball offset `left` px, its animation started `delay` seconds in (negative: already under way). */
const at = (left: number | undefined, delay: number): CSSProperties => ({
  ...(left === undefined ? {} : { left }),
  ...(delay === 0 ? {} : { animationDelay: `${delay}s` }),
});

/** Three dots of one class, the middle one blue, each `step` seconds behind the last. */
const dots = (kind: string, step: number) =>
  [0, 1, 2].map((i) => <div key={i} className={cn("ld-dot", kind, i === 1 && "ld-live")} style={at(undefined, -step * i)} />);

const MOVES: Record<LoaderVariant, ReactNode> = {
  bounce: (
    <>
      {[36, 51, 66].map((left, i) => <div key={`s${i}`} className="ld-shadow" style={at(left, 0.12 * i)} />)}
      {[36, 51, 66].map((left, i) => <div key={`b${i}`} className={cn("ld-ball", i === 1 && "ld-live")} style={at(left, 0.12 * i)} />)}
    </>
  ),
  juggle: (
    <>
      <div className="ld-hand" style={{ left: 24 }} />
      <div className="ld-hand" style={{ left: 64 }} />
      {dots("ld-jug", 0.6)}
    </>
  ),
  leapfrog: (
    <>
      <div className="ld-ground" style={{ left: 36, right: 30 }} />
      {dots("ld-frog", 0.5)}
    </>
  ),
  orbit: (
    <>
      <svg className="ld-guide" width="112" height="36" viewBox="0 0 112 36"><ellipse cx="56" cy="18" rx="22" ry="8" /></svg>
      {dots("ld-orb", 1.6 / 3)}
    </>
  ),
  chase: (
    <>
      <svg className="ld-guide" width="112" height="36" viewBox="0 0 112 36"><polygon points="56,8 68,28 44,28" /></svg>
      {dots("ld-tri", 0.6)}
    </>
  ),
  gather: (
    <>
      <div className="ld-dot ld-gat l" />
      <div className="ld-dot ld-gat m ld-live" />
      <div className="ld-dot ld-gat r" />
    </>
  ),
};

/** The 112×36 stage with one move on it. */
export function AnsweringLoader({ variant, className }: { variant: LoaderVariant; className?: string }) {
  return (
    <div aria-hidden="true" data-loader={variant} className={cn("ld-stage", className)}>
      {MOVES[variant]}
    </div>
  );
}
