"use client";

import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Hourglass,
  ChevronDownIcon,
} from "lucide-react";
import type { ThinkingStyleInput } from "@/flows/chat-agent/shared/schemas";

// Action-input shape is the source of truth: the selector lets users
// pick any value the chat-agent flow accepts on input.
// `import type` keeps the runtime schema out of the client bundle.
export type ThinkingStyle = ThinkingStyleInput;

interface StyleOption {
  value: ThinkingStyle;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

/**
 * The styles a person can pick, in menu order.
 *
 * `default` is first, which is also what {@link getStyleOption} falls back to
 * for a value this app no longer has — a session that last ran one of the
 * removed coordination styles opens on the direct answer rather than blank.
 */
export const STYLE_OPTIONS: StyleOption[] = [
  {
    value: "default",
    label: "Default",
    shortLabel: "Default",
    description: "Direct generation with the selected model",
    icon: MessageSquare,
    color: "text-zinc-500 dark:text-zinc-400",
  },
  {
    value: "background-work",
    label: "Background Work",
    shortLabel: "Background",
    description:
      "Hands the message to a child session and replies without waiting; results arrive on a later turn",
    icon: Hourglass,
    color: "text-indigo-500 dark:text-indigo-400",
  },
];

/**
 * The menu entry for `value`, falling back to the first — `Default` — for a
 * style this app no longer offers.
 *
 * The parameter is a bare `string` on purpose: the values that can be stale
 * are the ones that arrive from outside the type system, such as a style
 * stored on a session written before FIX-1478 removed it. The server folds
 * those to `default` in its `modeStatus` projection before they reach the
 * browser; this fallback is what keeps the first one that ever slips past
 * harmless instead of rendering nothing.
 */
export function getStyleOption(value: string): StyleOption {
  return STYLE_OPTIONS.find((o) => o.value === value) ?? STYLE_OPTIONS[0];
}

interface ThinkingStyleSelectorProps {
  value: ThinkingStyle;
  onValueChange: (value: ThinkingStyle) => void;
  disabled?: boolean;
}

export function ThinkingStyleSelector({
  value,
  onValueChange,
  disabled,
}: ThinkingStyleSelectorProps) {
  const active = getStyleOption(value);
  const ActiveIcon = active.icon;

  const handleValueChange = useCallback(
    (v: string) => onValueChange(v as ThinkingStyle),
    [onValueChange],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "gap-1.5 text-xs font-medium transition-colors",
            "hover:border-foreground/20",
          )}
        >
          <ActiveIcon className={cn("size-3.5", active.color)} />
          <span className="hidden sm:inline">{active.shortLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Thinking Style
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          {STYLE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = value === option.value;

            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5",
                  isActive && "bg-accent",
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isActive ? option.color : "text-muted-foreground",
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  <span className={cn("text-sm font-medium leading-none", isActive && "text-foreground")}>
                    {option.label}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
