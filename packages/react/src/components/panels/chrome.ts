/**
 * The bits of presentation both panels share (FIX-1477 S5, S6).
 *
 * Nothing here publishes a class name, and the package brings no CSS framework
 * and no icon set — a host themes by setting the `--fsd-panel-*` custom
 * properties on any ancestor, and fills the parts that are its own through
 * slots. Same contract the navigator ships under, so a host that themed one
 * has already themed the other.
 */
import { createElement, type ReactNode } from "react";

export const bareList = { listStyle: "none", margin: 0, padding: 0 } as const;

export const panelStyle = {
  color: "var(--fsd-panel-fg, inherit)",
  fontSize: "var(--fsd-panel-font-size, 13px)"
} as const;

export const noteStyle = {
  margin: 0,
  padding: "4px 8px",
  fontSize: "var(--fsd-panel-note-font-size, 11px)",
  color: "var(--fsd-panel-muted-fg, inherit)"
} as const;

export const headingStyle = {
  margin: 0,
  padding: "4px 8px",
  fontSize: "var(--fsd-panel-heading-font-size, 11px)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--fsd-panel-muted-fg, inherit)"
} as const;

export const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  boxSizing: "border-box",
  minWidth: 0
} as const;

export const labelStyle = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
} as const;

/**
 * A failure, with the retry beside it.
 *
 * Every failed region says what failed and offers the retry; nothing re-reads
 * on a timer, because a region that quietly retries hides a broken deployment
 * behind a spinner.
 */
export function retryLine(message: string, onRetry: () => void): ReactNode {
  return createElement(
    "p",
    { style: noteStyle, role: "alert" },
    message,
    " ",
    createElement(
      "button",
      { type: "button", onClick: onRetry, style: { font: "inherit", cursor: "pointer" } },
      "Retry"
    )
  );
}

/** A plain note. `data-state` is what a test asserts on, since the text is a host's to restyle. */
export function note(state: string, text: string): ReactNode {
  return createElement("p", { style: noteStyle, "data-state": state }, text);
}
