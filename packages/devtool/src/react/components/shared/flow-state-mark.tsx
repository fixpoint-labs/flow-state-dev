import type { SVGAttributes } from "react";

export type FlowStateMarkProps = Omit<SVGAttributes<SVGSVGElement>, "viewBox"> & {
  /** Accessible name. Omit for a decorative mark (the default). */
  title?: string;
};

/**
 * flow-state.dev brand mark — three overlapping loops knocked out of an ink
 * tile. Paints from the panel's `--fs-ink` / `--fs-paper` tokens, so it
 * follows the active theme; outside the panel it falls back to Paper ink.
 */
export function FlowStateMark({ title, ...props }: FlowStateMarkProps) {
  return (
    <svg
      viewBox="0 0 26 26"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <rect width="26" height="26" fill="var(--fs-ink, #1b1a15)" />
      <g
        transform="translate(3.5 7.3) scale(0.1267)"
        fill="none"
        stroke="var(--fs-paper, #f0ece1)"
        strokeWidth="9"
      >
        <path d="M31 45 Q53 7 75 45 Q53 83 31 45 Z" />
        <path d="M53 45 Q75 7 97 45 Q75 83 53 45 Z" />
        <path d="M75 45 Q97 7 119 45 Q97 83 75 45 Z" />
      </g>
    </svg>
  );
}
