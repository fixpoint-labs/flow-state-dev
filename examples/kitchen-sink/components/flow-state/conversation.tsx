"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

// ---------------------------------------------------------------------------
// Scroll context (replaces use-stick-to-bottom)
// ---------------------------------------------------------------------------

type ConversationScrollContextValue = {
  isAtBottom: boolean;
  scrollToBottom: () => void;
};

const ConversationScrollContext =
  createContext<ConversationScrollContextValue | null>(null);

export function useConversationScroll() {
  const ctx = useContext(ConversationScrollContext);
  if (!ctx) {
    throw new Error("useConversationScroll must be used inside <Conversation>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Conversation (scroll container + context provider)
// ---------------------------------------------------------------------------

export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkIsAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 50;
    setIsAtBottom(
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    );
  }, []);

  // Re-check when content resizes (e.g. streaming adds text beyond viewport).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(checkIsAtBottom);
    for (const child of el.children) {
      observer.observe(child);
    }
    // Also observe the container itself for size changes.
    observer.observe(el);
    return () => observer.disconnect();
  }, [checkIsAtBottom]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  return (
    <ConversationScrollContext.Provider value={{ isAtBottom, scrollToBottom }}>
      <div
        ref={scrollRef}
        onScroll={checkIsAtBottom}
        className={cn("relative flex-1 overflow-y-auto", className)}
        role="log"
        {...props}
      >
        {children}
      </div>
    </ConversationScrollContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// ConversationContent
// ---------------------------------------------------------------------------

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <div className={cn("flex flex-col gap-4 p-4", className)} {...props} />
);

// ---------------------------------------------------------------------------
// ConversationEmptyState
// ---------------------------------------------------------------------------

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// ScrollOnNewRequest — scrolls to bottom once per new request
// ---------------------------------------------------------------------------

/**
 * Place inside <Conversation> to auto-scroll to bottom when a new request
 * appears (e.g. user sends a message). Does NOT auto-scroll during streaming.
 */
export function ScrollOnNewRequest({ items }: { items: OutputItem[] }) {
  const { scrollToBottom } = useConversationScroll();
  const lastRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (items.length === 0) {
      lastRequestIdRef.current = null;
      return;
    }
    const lastRequestId = items[items.length - 1].requestId;
    if (lastRequestId !== lastRequestIdRef.current) {
      lastRequestIdRef.current = lastRequestId;
      scrollToBottom();
    }
  }, [items, scrollToBottom]);

  return null;
}

// ---------------------------------------------------------------------------
// ConversationScrollButton (sticky bottom, uses scroll context)
// ---------------------------------------------------------------------------

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationScroll();

  if (isAtBottom) return null;

  return (
    <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
      <Button
        className={cn(
          "rounded-full pointer-events-auto dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={scrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Message types + download (unchanged)
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "data" | "tool";
  content: string;
}

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: ConversationMessage[];
  filename?: string;
  formatMessage?: (message: ConversationMessage, index: number) => string;
};

const defaultFormatMessage = (message: ConversationMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${message.content}`;
};

export const messagesToMarkdown = (
  messages: ConversationMessage[],
  formatMessage: (
    message: ConversationMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
