"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import { createContext, useCallback, useContext } from "react";
import { useJumpToLatest, type JumpToLatest } from "@flow-state-dev/react";

// ---------------------------------------------------------------------------
// The feed: `useJumpToLatest`'s return, carried to the Conversation's children
// ---------------------------------------------------------------------------

const ConversationFeedContext = createContext<JumpToLatest | null>(null);

/**
 * The feed of the `<Conversation>` around this component: what marks the
 * person's line (`mine`) and what the jump button reads (`atEnd`, `jump`).
 * `null` outside a Conversation.
 */
export function useConversationFeed(): JumpToLatest | null {
  return useContext(ConversationFeedContext);
}

// ---------------------------------------------------------------------------
// Conversation (the scrolling element + the feed's provider)
// ---------------------------------------------------------------------------

export type ConversationProps = ComponentProps<"div"> & {
  /**
   * The feed from `useJumpToLatest`, made by the app so its composer can call
   * `feed.sent()` as the person's line goes out: that line then rises to near
   * the top, and its reply streams in below it. Without it the Conversation
   * makes its own feed, for a view that never sends.
   */
  feed?: JumpToLatest;
  /**
   * What the Conversation shows, such as a session id, for the feed it makes
   * when there is no `feed`: when it changes, the view opens at its end again.
   * When you make the feed, pass the key to `useJumpToLatest` instead.
   */
  resetKey?: string | null;
};

/**
 * The scrolling element of a conversation, on `useJumpToLatest`'s rule: it
 * opens at its end, a line the app says the person sent rises to near the
 * top, and nothing else moves the view. New content below shows the jump
 * button instead.
 */
export const Conversation = ({
  className,
  children,
  feed,
  resetKey,
  ...props
}: ConversationProps) => {
  // Always called, so the hooks keep their order; left unattached when the app passes a feed.
  const own = useJumpToLatest({ resetKey });
  const shown = feed ?? own;

  return (
    <ConversationFeedContext.Provider value={shown}>
      <div
        className={cn("relative flex-1 overflow-y-auto", className)}
        role="log"
        {...props}
        ref={shown.ref}
      >
        {children}
      </div>
    </ConversationFeedContext.Provider>
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
// ConversationScrollButton (jump to latest)
// ---------------------------------------------------------------------------

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
  /** The feed it jumps. Inside a `<Conversation>` it reads the Conversation's. */
  feed?: JumpToLatest;
};

/**
 * Jump to latest: shown while there is more below the view. It takes no
 * height when it shows, so showing it never moves the feed.
 */
export const ConversationScrollButton = ({
  className,
  feed,
  ...props
}: ConversationScrollButtonProps) => {
  const around = useConversationFeed();
  const shown = feed ?? around;
  if (!shown) {
    throw new Error("ConversationScrollButton needs a feed, or to be inside <Conversation>");
  }

  if (shown.atEnd) return null;

  return (
    <div className="pointer-events-none sticky bottom-0 z-10 flex h-0 items-end justify-center">
      <Button
        aria-label="Jump to latest"
        className={cn(
          "mb-4 rounded-full pointer-events-auto dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={shown.jump}
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
