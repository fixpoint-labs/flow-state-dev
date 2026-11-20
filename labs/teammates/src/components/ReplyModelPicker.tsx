/**
 * The composer's reply-model picker, beside the coding harness picker: which
 * model the teammate's own replies run on. A chat mark tells it apart from
 * "Code with", which picks where coding tasks start. The choices and where each
 * one's calls would go come from the lab's context (`TEAMMATES_MODELS`); a
 * model with no key or gateway is listed but can't be picked, with the reason.
 * A pick is saved to that teammate's settings and applies from its next reply.
 */
import { ChevronDownIcon, MessageCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppContext } from "../../flows/lab-context.mts";
import { cn } from "../lib/utils";

/** A model as `TEAMMATES_MODELS` names it, without its provider or route: `openrouter:openai/gpt-6-sol` reads `gpt-6-sol`. */
export const shortModelName = (model: string) => model.slice(Math.max(model.lastIndexOf("/"), model.lastIndexOf(":")) + 1) || model;

/**
 * The picker. `current` is the teammate's model; one the lab's list doesn't
 * name is still shown, first, with no route. Esc or a click elsewhere closes
 * the list, and Esc there never counts toward the composer's Esc Esc stop.
 */
export function ReplyModelPicker({
  choices,
  current,
  workerName,
  onPick,
}: {
  choices: NonNullable<AppContext["models"]>;
  current: string;
  workerName: string;
  /** Saves the pick to the teammate; rejects with why it wasn't saved. */
  onPick: (model: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string>();
  const [refused, setRefused] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const listed = choices.some((c) => c.id === current) ? choices : [{ id: current, available: true }, ...choices];
  const shown = listed.find((c) => c.id === (saving ?? current));
  const via = shown?.via === undefined ? "" : ` · via ${shown.via}`;
  const pick = (model: string) => {
    setOpen(false);
    button.current?.focus();
    if (model === current) return;
    setSaving(model);
    setRefused(undefined);
    onPick(model).then(
      () => setSaving(undefined),
      (error: unknown) => {
        setSaving(undefined);
        setRefused(error instanceof Error ? error.message : String(error));
      },
    );
  };
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Respond with ${shortModelName(saving ?? current)}${via}`}
        title={`${workerName}'s own replies run on this model. Coding tasks use the Code with harness.${refused === undefined ? "" : ` Not saved: ${refused}`}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-sm px-2 text-xs text-text-2 hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <MessageCircleIcon aria-hidden className="size-3.5 shrink-0 text-text-3" />
        <span className="hidden text-text-3 md:inline">Respond with</span>
        <span className="truncate font-mono text-foreground">{shortModelName(saving ?? current)}</span>
        {shown?.via === undefined ? null : <span className="hidden truncate text-text-3 lg:inline">· via {shown.via}</span>}
        {refused === undefined ? null : <span className="text-warning-text">not saved</span>}
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
      </button>
      {open ? (
        <div role="menu" aria-label="Reply with" className="absolute bottom-full left-0 z-20 mb-1 min-w-64 rounded-md border border-border-strong bg-surface p-1 shadow-lg">
          <div aria-hidden className="px-2 pt-1 pb-1.5 text-xs font-medium tracking-wide text-text-3 uppercase">
            {workerName} replies with
          </div>
          {listed.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={c.id === current}
              aria-disabled={!c.available || undefined}
              title={c.available ? c.id : `${c.id}: ${c.reason ?? "can't run here"}`}
              onClick={() => (c.available ? pick(c.id) : undefined)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring",
                c.id === current && "bg-surface-raised",
                !c.available && "cursor-not-allowed opacity-60",
              )}
            >
              <span className="font-mono text-foreground">{shortModelName(c.id)}</span>
              <span className="ml-auto text-text-3">{c.available ? (c.via === undefined ? "" : `via ${c.via}`) : (c.reason ?? "can't run here")}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
