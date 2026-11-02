/**
 * A link to one of Shift Manager's addresses. It is a real `<a href>`, so a
 * modified click (Cmd, Ctrl, Shift, Alt, the middle button) opens the address
 * in a new tab or window the browser's way, and the address can be copied. A
 * plain click goes there in this tab, through `navigate`, without a reload.
 */
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate, pathFor, type Route } from "../lib/routes";

/** Whether a click is one the page handles itself, rather than the browser: the main button, no modifier key, no other target. */
export function isPlainClick(event: MouseEvent<Element>): boolean {
  const target = event.currentTarget.getAttribute("target");
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (target === null || target === "_self");
}

/**
 * @param to Where the link goes.
 * @param onNavigate Called after a plain click has gone to `to` in this tab; never on a click the browser handles.
 */
export function RouteLink({
  to,
  onClick,
  onNavigate,
  ...rest
}: { to: Route; onNavigate?: () => void } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a
      {...rest}
      href={pathFor(to)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event)) return;
        event.preventDefault();
        navigate(to);
        onNavigate?.();
      }}
    />
  );
}
