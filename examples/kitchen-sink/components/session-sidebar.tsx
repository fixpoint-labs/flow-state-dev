"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Plus, MessageSquare } from "lucide-react";
import type { SessionSummary } from "@flow-state-dev/client";

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  isLoading?: boolean;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  className?: string;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  isLoading,
  onNewChat,
  onSelectSession,
  className,
}: SessionSidebarProps) {
  return (
    <aside className={cn("flex h-full w-64 shrink-0 flex-col border-r bg-muted/30", className)}>
      <div className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
          disabled={isLoading}
        >
          <Plus className="h-4 w-4" />
          New Session
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1 p-2">
        <div className="flex flex-col gap-1">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                session.id === activeSessionId &&
                  "bg-accent text-accent-foreground font-medium"
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                Session {session.id.slice(0, 8)}
              </span>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No sessions yet
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
