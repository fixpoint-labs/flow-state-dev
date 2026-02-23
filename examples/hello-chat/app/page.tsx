"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  FlowProvider,
  useFlow,
  useSession,
} from "@flow-state-dev/react";
import type { MessageItem } from "@flow-state-dev/core/items";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { SessionSidebar } from "@/components/session-sidebar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Bot, Loader2 } from "lucide-react";

export default function Page() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser" baseUrl="">
      <ChatApp />
    </FlowProvider>
  );
}

function ChatApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, {
    items: { itemTypes: ["message"] }
  });
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const messageCount = Number(
    session.snapshot?.state?.session?.messageCount ?? 0
  );

  // Items are already filtered to only be messages
  const messages = session.items;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, session.isStreaming]);

  const handleSend = useCallback(async () => {
    if (!flow.activeSessionId || message.trim().length === 0) return;
    const text = message.trim();
    setMessage("");
    await session.sendAction("chat", { message: text });
  }, [flow.activeSessionId, message, session]);

  const handleNewChat = useCallback(async () => {
    await flow.createSession();
  }, [flow]);

  return (
    <div className="flex h-screen">
      <SessionSidebar
        sessions={flow.sessions}
        activeSessionId={flow.activeSessionId}
        onNewChat={() => void handleNewChat()}
        onSelectSession={flow.selectSession}
      />
      <main className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b px-6 py-3">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Hello Chat</h1>
          {messageCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {messageCount} message{messageCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </header>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1">
          <div className="mx-auto max-w-3xl py-4">
            {messages.length === 0 && !session.isLoading && (
              <EmptyState />
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {session.error && (
              <div className="mx-4 my-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{session.error.message}</span>
              </div>
            )}
            {session.isStreaming && (
              <div className="flex items-center gap-2 px-4 py-3 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <ChatInput
          value={message}
          onChange={setMessage}
          onSend={() => void handleSend()}
          disabled={session.isStreaming || !flow.activeSessionId}
        />
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Bot className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="mb-2 text-lg font-semibold">Hello Chat</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        A minimal @flow-state-dev example. Send a message to start a
        conversation with the AI assistant.
      </p>
    </div>
  );
}
