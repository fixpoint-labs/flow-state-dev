"use client";

/**
 * Composable artifact viewer shell.
 *
 * Purely presentational — no internal state management. Consumers compose
 * sub-components to build their own artifact viewer layout with header,
 * title, description, actions, content area, and close button.
 *
 * Ported from Vercel AI Elements `Artifact` component and adapted for
 * the @flow-state-dev/ui registry conventions.
 */

import type { ComponentProps, HTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { XIcon, type LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// ArtifactShell — root flex-col container
// ---------------------------------------------------------------------------

export const ArtifactShell = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex h-full flex-col overflow-hidden rounded-lg border bg-background",
      className,
    )}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// ArtifactHeader — flex row with border-b
// ---------------------------------------------------------------------------

export const ArtifactHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center gap-2 border-b px-3 py-2.5",
      className,
    )}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// ArtifactTitle — artifact name display
// ---------------------------------------------------------------------------

export const ArtifactTitle = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("flex-1 truncate text-sm font-semibold", className)}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// ArtifactDescription — muted metadata (timestamp, content type hint)
// ---------------------------------------------------------------------------

export const ArtifactDescription = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("shrink-0 text-xs text-muted-foreground", className)}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// ArtifactActions — flex row for action buttons
// ---------------------------------------------------------------------------

export const ArtifactActions = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex items-center gap-1", className)}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// ArtifactAction — icon button with optional tooltip
// ---------------------------------------------------------------------------

export type ArtifactActionProps = ComponentProps<typeof Button> & {
  icon: LucideIcon;
  tooltip?: string;
  label: string;
};

export const ArtifactAction = ({
  icon: Icon,
  tooltip,
  label,
  className,
  ...props
}: ArtifactActionProps) => {
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={label}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ---------------------------------------------------------------------------
// ArtifactContent — flex-1 overflow-auto body area
// ---------------------------------------------------------------------------

export const ArtifactContent = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-1 flex-col overflow-auto", className)}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// ArtifactClose — close button (X icon)
// ---------------------------------------------------------------------------

export type ArtifactCloseProps = ComponentProps<typeof Button>;

export const ArtifactClose = ({
  className,
  ...props
}: ArtifactCloseProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    className={className}
    aria-label="Close"
    {...props}
  >
    <XIcon className="h-4 w-4" />
  </Button>
);
