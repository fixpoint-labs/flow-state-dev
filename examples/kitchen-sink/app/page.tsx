"use client";

import { useState, useCallback, useMemo } from "react";
import {
  FlowProvider,
  ItemsRenderer,
  useFlow,
  useSession,
  useClientData,
  useVoice,
  type RendererRegistry,
} from "@flow-state-dev/react";
import { Button } from "@/components/ui/button";
import { Menu, MessageSquareText, Package } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/src/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/src/components/ai-elements/prompt-input";

import { KitchenSinkMessage } from "@/components/kitchen-sink-message";
import { KitchenSinkReasoning } from "@/components/kitchen-sink-reasoning";
import { KitchenSinkStatus } from "@/components/kitchen-sink-status";
import { KitchenSinkError } from "@/components/kitchen-sink-error";

import { SessionSidebar } from "@/components/session-sidebar";
import { ModeSelector } from "@/components/mode-selector";
import { ClientDataBar } from "@/components/client-data-bar";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactViewer } from "@/components/artifact-viewer";
import { SuggestionRow } from "@/components/suggestion-row";
import { VoiceToggle } from "@/components/voice-toggle";

const renderers: RendererRegistry = {
  message: KitchenSinkMessage,
  reasoning: KitchenSinkReasoning,
  status: KitchenSinkStatus,
  error: KitchenSinkError,
  step_error: KitchenSinkError,
};

const ITEM_TYPES = ["message", "reasoning", "status", "error", "step_error"];

type MobilePanel = "chat" | "artifacts";

const CLIENT_DATA_OPTIONS = {
  session: ["artifactsList", "artifactsDetail", "modeStatus"] as string[],
  user: ["preferences"] as string[],
};

export default function Page() {
  return (
    <FlowProvider flowKind="kitchen-sink" userId="devuser" baseUrl="" renderers={renderers}>
      <KitchenSinkApp />
    </FlowProvider>
  );
}

function KitchenSinkApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, {
    items: { itemTypes: ITEM_TYPES },
  });

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"chat" | "plan" | "review">("chat");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);

  const voice = useVoice(session, {
    action: "run",
    buildInput: (text) => ({ message: text, mode }),
    autoPlayTTS: ttsEnabled,
  });

  const clientData = useClientData(session, CLIENT_DATA_OPTIONS);

  const modeStatus = clientData.session?.modeStatus as { currentMode: string; requestCount: number } | undefined;
  const userPrefs = clientData.user?.preferences as { displayName: string; preferredModel: string } | undefined;
  const artifacts = (clientData.session?.artifactsList ?? []) as Array<{ id: string; title: string; content: string }>;
  const artifactsDetail = (clientData.session?.artifactsDetail ?? []) as Array<{ id: string; title: string; content: string; updatedAt: number }>;

  const selectedArtifact = useMemo(
    () => artifactsDetail.find((a) => a.id === selectedArtifactId) ?? null,
    [artifactsDetail, selectedArtifactId]
  );

  const handleSubmit = useCallback(
    async (msg: PromptInputMessage) => {
      const text = msg.text.trim();
      if (!flow.activeSessionId || text.length === 0) return;
      setMessage("");
      await session.sendAction("run", { message: text, mode });
    },
    [flow.activeSessionId, mode, session]
  );

  const handleNewSession = useCallback(async () => {
    await flow.createSession();
    setIsSessionDrawerOpen(false);
    setMobilePanel("chat");
  }, [flow]);

  const handleSelectSession = useCallback(
    (id: string) => {
      flow.selectSession(id);
      setIsSessionDrawerOpen(false);
      setMobilePanel("chat");
    },
    [flow]
  );

  const handleSuggestionClick = useCallback((text: string) => {
    setMessage(text);
  }, []);

  const handleSaveArtifact = useCallback(
    async (artifact: { id: string; title: string; content: string }) => {
      if (!flow.activeSessionId) return;
      await session.sendAction("saveArtifact", artifact);
    },
    [flow.activeSessionId, session]
  );

  const isDisabled = session.isStreaming || !flow.activeSessionId || flow.isLoading;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <SessionSidebar
        className="hidden lg:flex"
        sessions={flow.sessions}
        activeSessionId={flow.activeSessionId}
        isLoading={flow.isLoading}
        onNewChat={() => void handleNewSession()}
        onSelectSession={handleSelectSession}
      />

      {isSessionDrawerOpen && (
        <div className="fixed inset-0 z-40 flex bg-black/40 lg:hidden" role="dialog" aria-modal="true" aria-label="Session list drawer">
          <SessionSidebar
            className="w-[18rem] max-w-[85vw] border-r bg-background shadow-2xl"
            sessions={flow.sessions}
            activeSessionId={flow.activeSessionId}
            isLoading={flow.isLoading}
            onNewChat={() => void handleNewSession()}
            onSelectSession={handleSelectSession}
          />
          <button
            type="button"
            className="flex-1"
            aria-label="Close sessions drawer"
            onClick={() => setIsSessionDrawerOpen(false)}
          />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2 sm:px-4 lg:hidden">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsSessionDrawerOpen(true)}>
            <Menu className="h-4 w-4" />
            Sessions
          </Button>
          <Button
            variant={mobilePanel === "chat" ? "secondary" : "outline"}
            size="sm"
            className="gap-2 sm:hidden"
            onClick={() => setMobilePanel("chat")}
          >
            <MessageSquareText className="h-4 w-4" />
            Chat
          </Button>
          <Button
            variant={mobilePanel === "artifacts" ? "secondary" : "outline"}
            size="sm"
            className="gap-2 sm:hidden"
            onClick={() => setMobilePanel("artifacts")}
          >
            <Package className="h-4 w-4" />
            Artifacts ({artifacts.length})
          </Button>
        </div>

        <ClientDataBar
          currentMode={modeStatus?.currentMode}
          requestCount={modeStatus?.requestCount}
          displayName={userPrefs?.displayName}
          preferredModel={userPrefs?.preferredModel}
        />

        <div className="flex min-h-0 flex-1 sm:hidden">
          {mobilePanel === "chat" && (
            <ChatPanel
              message={message}
              mode={mode}
              isDisabled={isDisabled}
              session={session}
              voice={voice}
              ttsEnabled={ttsEnabled}
              onToggleTTS={() => setTtsEnabled((v) => !v)}
              onSetMessage={setMessage}
              onSetMode={setMode}
              onSubmit={handleSubmit}
              onSuggestionClick={handleSuggestionClick}
            />
          )}

          {mobilePanel === "artifacts" && (
            <div className="flex min-w-0 flex-1">
              {selectedArtifact ? (
                <ArtifactViewer
                  artifact={selectedArtifact}
                  isSaving={session.isStreaming}
                  onSaveArtifact={handleSaveArtifact}
                  onClose={() => {
                    setSelectedArtifactId(null);
                    setMobilePanel("chat");
                  }}
                  onBack={() => setSelectedArtifactId(null)}
                  className="w-full border-l-0"
                />
              ) : (
                <ArtifactPanel
                  artifacts={artifacts}
                  selectedId={selectedArtifactId}
                  onSelect={setSelectedArtifactId}
                  className="w-full border-l-0"
                />
              )}
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 sm:flex">
          <ChatPanel
            message={message}
            mode={mode}
            isDisabled={isDisabled}
            session={session}
            voice={voice}
            ttsEnabled={ttsEnabled}
            onToggleTTS={() => setTtsEnabled((v) => !v)}
            onSetMessage={setMessage}
            onSetMode={setMode}
            onSubmit={handleSubmit}
            onSuggestionClick={handleSuggestionClick}
          />

          {selectedArtifact ? (
            <ArtifactViewer
              artifact={selectedArtifact}
              isSaving={session.isStreaming}
              onSaveArtifact={handleSaveArtifact}
              onClose={() => setSelectedArtifactId(null)}
              onBack={() => setSelectedArtifactId(null)}
              className="w-[20rem] md:w-[24rem] lg:w-[30rem]"
            />
          ) : (
            <ArtifactPanel
              artifacts={artifacts}
              selectedId={selectedArtifactId}
              onSelect={setSelectedArtifactId}
              className="w-[16rem] md:w-[18rem]"
            />
          )}
        </div>
      </main>
    </div>
  );
}

interface ChatPanelProps {
  message: string;
  mode: "chat" | "plan" | "review";
  isDisabled: boolean;
  session: ReturnType<typeof useSession>;
  voice: ReturnType<typeof useVoice>;
  ttsEnabled: boolean;
  onToggleTTS: () => void;
  onSetMessage: (value: string) => void;
  onSetMode: (value: "chat" | "plan" | "review") => void;
  onSubmit: (msg: PromptInputMessage) => Promise<void>;
  onSuggestionClick: (text: string) => void;
}

function ChatPanel({
  message,
  mode,
  isDisabled,
  session,
  voice,
  ttsEnabled,
  onToggleTTS,
  onSetMessage,
  onSetMode,
  onSubmit,
  onSuggestionClick,
}: ChatPanelProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-3 sm:px-4">
          {session.items.length === 0 && !session.isLoading && (
            <ConversationEmptyState
              title="Kitchen Sink"
              description="A multi-modal AI assistant demonstrating all @flow-state-dev building blocks: handlers, generators, routers, sequencers, resources, clientData, and tool-use."
            />
          )}
          <ItemsRenderer items={session.items} />
          {session.error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <span>{session.error.message}</span>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t">
        {session.items.length === 0 && <SuggestionRow onSuggestionClick={onSuggestionClick} disabled={isDisabled} />}
        <div className="mx-auto max-w-3xl px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 sm:px-4 sm:pb-4">
          <div className="mb-2 flex items-center gap-3">
            <ModeSelector mode={mode} onModeChange={onSetMode} disabled={isDisabled} />
            <VoiceToggle voice={voice} disabled={isDisabled} ttsEnabled={ttsEnabled} onToggleTTS={onToggleTTS} />
          </div>
          <PromptInput onSubmit={onSubmit}>
            <PromptInputTextarea
              name="message"
              placeholder={`Send a message in ${mode} mode...`}
              value={message}
              onChange={(e) => onSetMessage(e.target.value)}
              disabled={isDisabled}
            />
            <PromptInputSubmit
              className="mr-2 sm:mr-4"
              status={session.isStreaming ? "streaming" : "ready"}
              disabled={isDisabled || message.trim().length === 0}
            />
          </PromptInput>
        </div>
      </div>
    </section>
  );
}
