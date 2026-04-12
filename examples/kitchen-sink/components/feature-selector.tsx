"use client";

import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Settings2,
  ShieldCheck,
  Terminal,
  Search,
  Globe,
  Network,
  ChevronDownIcon,
} from "lucide-react";

export interface Features {
  biasCheck: boolean;
  bashTool: boolean;
  search: boolean;
  fetch: boolean;
  crawl: boolean;
}

export const DEFAULT_FEATURES: Features = {
  biasCheck: false,
  bashTool: true,
  search: true,
  fetch: true,
  crawl: true,
};

interface FeatureOption {
  key: keyof Features;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const FEATURE_OPTIONS: FeatureOption[] = [
  {
    key: "bashTool",
    label: "Bash Tool",
    description: "Execute commands and manage files in a sandbox workspace",
    icon: Terminal,
    color: "text-emerald-500 dark:text-emerald-400",
  },
  {
    key: "search",
    label: "Search",
    description: "Search the web for information",
    icon: Search,
    color: "text-blue-500 dark:text-blue-400",
  },
  {
    key: "fetch",
    label: "Fetch",
    description: "Fetch and read the full content of web pages",
    icon: Globe,
    color: "text-violet-500 dark:text-violet-400",
  },
  {
    key: "crawl",
    label: "Crawl",
    description: "Crawl websites following links up to a specified depth",
    icon: Network,
    color: "text-amber-500 dark:text-amber-400",
  },
  {
    key: "biasCheck",
    label: "Bias Check",
    description: "Detect sycophancy and cognitive biases in responses",
    icon: ShieldCheck,
    color: "text-rose-500 dark:text-rose-400",
  },
];

interface FeatureSelectorProps {
  features: Features;
  onFeaturesChange: (features: Features) => void;
  disabled?: boolean;
}

export function FeatureSelector({
  features,
  onFeaturesChange,
  disabled,
}: FeatureSelectorProps) {
  const activeCount = Object.values(features).filter(Boolean).length;

  const handleToggle = useCallback(
    (key: keyof Features) => {
      onFeaturesChange({ ...features, [key]: !features[key] });
    },
    [features, onFeaturesChange],
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
            activeCount > 0 && "border-rose-500/30 dark:border-rose-400/30",
          )}
        >
          <Settings2
            className={cn(
              "size-3.5",
              activeCount > 0
                ? "text-rose-500 dark:text-rose-400"
                : "text-muted-foreground",
            )}
          />
          <span className="hidden sm:inline">
            {activeCount > 0 ? `Features (${activeCount})` : "Features"}
          </span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Features
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FEATURE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = features[option.key];

          return (
            <DropdownMenuItem
              key={option.key}
              onSelect={(e) => {
                e.preventDefault();
                handleToggle(option.key);
              }}
              className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5"
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0 transition-colors",
                  isActive ? option.color : "text-muted-foreground/40",
                )}
              />
              <div className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "text-sm font-medium leading-none transition-colors",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {option.label}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
