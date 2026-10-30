import { useFollowLatest } from "@flow-state-dev/react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SessionStep } from "../adapter";
import { AgentMarkdown } from "./flow-state/message-response";
import { composeToolGroupLabel } from "./flow-state/tool-grouping";

// Framed after the Claude Code-style lab's `Sheet`; one overlay both labs share is FIX-2340.
/**
 * A read-only popup over the main thread: another worker's session, live.
 * It closes with its close button, Esc, or a click outside it, and the
 * thread under it keeps its place. What it shows is the opener's to keep
 * live; the popup only frames it.
 */
export function SessionPopup({ label, title, status, onClose, children }: {
  /** The popup's accessible name. */
  label: string;
  title: ReactNode;
  /** How the work stands: working, replied, done, failed. */
  status?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  // Opens on the session's latest turn, and follows it while the reader stays there.
  const feed = useFollowLatest();
  useEffect(() => {
    // Focus moves in, stays in while it is open, and goes back to whatever opened it on close.
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "Tab") keepFocusIn(dialog.current, event);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div data-popup-backdrop className="fixed inset-0 z-20 flex justify-center bg-background/70 p-6 backdrop-blur-[1px]" onClick={onClose}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex h-full w-full max-w-(--thread-width) min-h-0 flex-col rounded-lg border border-border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1 text-sm font-semibold">{title}</div>
          {status ? (
            <span className="shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground uppercase" data-popup-status>
              {status}
            </span>
          ) : null}
          <button ref={close} type="button" aria-label="Close" onClick={onClose} className="px-1 text-lg leading-none text-muted-foreground hover:text-foreground">
            ×
          </button>
        </header>
        <div ref={feed.ref} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Tab and Shift+Tab wrap around the popup's own controls, so the thread under it can't take focus. */
function keepFocusIn(container: HTMLElement | null, event: KeyboardEvent) {
  if (container === null) return;
  const focusable = [...container.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.hasAttribute("disabled"),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const inside = container.contains(document.activeElement);
  if (event.shiftKey && (!inside || document.activeElement === first)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
    event.preventDefault();
    first?.focus();
  }
}

/**
 * A session's steps, drawn like a conversation: what the worker was given on
 * the right, what it wrote as Markdown, a message it sent as a line, and each
 * run of tool steps folded into one line ("Ran 3 commands and edited a file")
 * that opens to what each one did.
 */
export function Steps({ steps, nameOf, empty }: { steps: readonly SessionStep[]; nameOf: (id: string) => string; empty: string }) {
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const groups: (SessionStep | SessionStep[])[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (step.kind === "tool" && Array.isArray(last)) last.push(step);
    else groups.push(step.kind === "tool" ? [step] : step);
  }
  return groups.map((group) => {
    if (Array.isArray(group) && group.length === 1) {
      return (
        <div key={group[0].id} data-step="tool" className="text-xs text-muted-foreground">
          <ToolText step={group[0]} />
        </div>
      );
    }
    if (Array.isArray(group)) {
      return (
        <details key={group[0].id} data-step="tools" className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{composeToolGroupLabel(group.map((t) => t.tool ?? t.text))}</summary>
          <ol className="mt-1 pl-4">
            {group.map((t) => (
              <li key={t.id}>
                · <ToolText step={t} />
              </li>
            ))}
          </ol>
        </details>
      );
    }
    switch (group.kind) {
      case "given":
        return (
          <div key={group.id} className="flex justify-end">
            <div data-step="given" className="max-w-[80%] rounded-lg bg-accent px-4 py-2.5 text-sm whitespace-pre-wrap">
              {group.text}
            </div>
          </div>
        );
      case "said":
        return (
          <div key={group.id} data-step="said" className="text-sm leading-relaxed">
            <AgentMarkdown text={group.text} />
          </div>
        );
      case "sent":
        return (
          <div key={group.id} data-step="sent" className="font-mono text-xs text-success">
            → to {nameOf(group.to ?? "")} · <span className="whitespace-pre-wrap text-foreground">{group.text}</span>
          </div>
        );
      case "harness":
        return (
          <div key={group.id} data-step="harness" className="font-mono text-xs text-muted-foreground">
            {group.text}
          </div>
        );
      default:
        return null;
    }
  });
}

/** What one tool step did; a shell command is shown as the code it ran. */
function ToolText({ step }: { step: SessionStep }) {
  return step.code ? <code className="font-mono">{step.text}</code> : <>{step.text}</>;
}
