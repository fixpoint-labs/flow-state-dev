/**
 * ModelSelector — concrete-model dropdown for the kitchen-sink chat agent.
 * Values are Vercel AI Gateway model strings from `KITCHEN_SINK_MODELS`;
 * thinking on/off is a separate axis (see `ThinkingToggle`).
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
import { Sparkles, ChevronDownIcon } from "lucide-react";
import {
  KITCHEN_SINK_MODELS,
  MODEL_LABELS,
  coalesceKitchenSinkModel,
  isKitchenSinkModel,
  type KitchenSinkModel,
} from "@/lib/models";

/** Re-exported for callers that want to type their state. */
export type ModelId = KitchenSinkModel;

interface ModelSelectorProps {
  value: string;
  onValueChange: (value: ModelId) => void;
  disabled?: boolean;
}

/**
 * Dropdown selector that lists every concrete model the kitchen-sink supports.
 * The trigger shows the active model's friendly label; rows show label +
 * description.
 */
export function ModelSelector({
  value,
  onValueChange,
  disabled,
}: ModelSelectorProps) {
  const activeId = coalesceKitchenSinkModel(value);
  const activeLabel = MODEL_LABELS[activeId].label;

  const handleValueChange = useCallback(
    (v: string) => {
      if (isKitchenSinkModel(v)) onValueChange(v);
    },
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
          <Sparkles className="size-3.5 text-violet-500 dark:text-violet-400" />
          <span className="hidden sm:inline">{activeLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Model
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={activeId}
          onValueChange={handleValueChange}
        >
          {KITCHEN_SINK_MODELS.map((id) => {
            const meta = MODEL_LABELS[id];
            const isActive = id === activeId;
            return (
              <DropdownMenuRadioItem
                key={id}
                value={id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5",
                  isActive && "bg-accent",
                )}
              >
                <Sparkles
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isActive
                      ? "text-violet-500 dark:text-violet-400"
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
                    {meta.label}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {meta.description}
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
