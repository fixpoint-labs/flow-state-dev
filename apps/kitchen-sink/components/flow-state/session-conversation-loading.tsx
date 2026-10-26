"use client";

import { Spinner } from "@/components/ui/spinner";

/**
 * Shown while a session's snapshot and items are still loading. Keeps the
 * transcript empty so an idle blank area is not mistaken for an empty session.
 */
export function SessionConversationLoading({
  label = "Loading session…",
}: {
  label?: string;
}) {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16 text-muted-foreground"
      data-testid="session-loading"
    >
      <Spinner className="size-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
