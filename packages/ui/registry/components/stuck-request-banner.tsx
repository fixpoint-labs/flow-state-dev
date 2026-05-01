"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type StuckRequestBannerSession = {
  isStuck: boolean;
  dismissRequest: (requestId?: string) => Promise<void>;
};

/**
 * Renders a "Connection lost" affordance when the in-flight request has gone
 * silent past the watchdog threshold. The dismiss button works without a
 * live SSE connection — it issues an out-of-band POST abort and reconciles
 * with the latest server snapshot.
 */
export function StuckRequestBanner({
  session,
  className
}: {
  session: StuckRequestBannerSession;
  className?: string;
}) {
  const [isDismissing, setIsDismissing] = useState(false);

  if (!session.isStuck) return null;

  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      await session.dismissRequest();
    } finally {
      setIsDismissing(false);
    }
  };

  return (
    <div className={cn("mx-auto max-w-3xl px-3 pt-2 sm:px-4", className)}>
      <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Connection lost — the previous request stopped responding.
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          disabled={isDismissing}
        >
          {isDismissing ? "Dismissing…" : "Dismiss"}
        </Button>
      </div>
    </div>
  );
}
