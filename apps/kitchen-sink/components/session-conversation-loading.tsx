"use client";

import { Spinner } from "@/components/ui/spinner";

export function SessionConversationLoading() {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16 text-muted-foreground"
      data-testid="session-loading"
    >
      <Spinner className="size-6" />
      <p className="text-sm">Loading session…</p>
    </div>
  );
}
