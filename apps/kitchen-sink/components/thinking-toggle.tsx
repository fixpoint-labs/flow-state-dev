/**
 * ThinkingToggle — extended-thinking on/off control.
 *
 * Drives `thinkingEnabled` on user state. When enabled, the chat-agent flow
 * passes provider-specific reasoning options on the assistant generator (no
 * model swap). When disabled, those options are omitted.
 */
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
import { Brain, ChevronDownIcon } from "lucide-react";

interface ThinkingToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}

const OPTIONS: {
  value: "off" | "on";
  label: string;
  description: string;
}[] = [
  {
    value: "off",
    label: "Thinking off",
    description: "Standard responses",
  },
  {
    value: "on",
    label: "Thinking on",
    description: "Extended reasoning when supported",
  },
];

/** Two-option dropdown that toggles extended thinking on the active model. */
export function ThinkingToggle({
  value,
  onValueChange,
  disabled,
}: ThinkingToggleProps) {
  const activeKey: "off" | "on" = value ? "on" : "off";
  const activeLabel = OPTIONS.find((o) => o.value === activeKey)!.label;

  const handleValueChange = useCallback(
    (v: string) => onValueChange(v === "on"),
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
          <Brain
            className={cn(
              "size-3.5",
              value
                ? "text-indigo-500 dark:text-indigo-400"
                : "text-muted-foreground",
            )}
          />
          <span className="hidden sm:inline">{activeLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Extended thinking
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={activeKey}
          onValueChange={handleValueChange}
        >
          {OPTIONS.map((opt) => {
            const isActive = opt.value === activeKey;
            return (
              <DropdownMenuRadioItem
                key={opt.value}
                value={opt.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5",
                  isActive && "bg-accent",
                )}
              >
                <Brain
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isActive
                      ? "text-indigo-500 dark:text-indigo-400"
                      : "text-muted-foreground",
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-sm font-medium leading-none",
                      isActive && "text-foreground",
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {opt.description}
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
