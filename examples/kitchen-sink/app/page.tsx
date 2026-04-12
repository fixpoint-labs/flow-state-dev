"use client";

import { memo, useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  FlowProvider,
  useFlow,
  useSession,
  useClientData,
  useVoice,
} from "@flow-state-dev/react";
import { Button } from "@/components/ui/button";
import { Menu, MessageSquareText, Package } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  ScrollOnNewRequest,
} from "@/components/flow-state/conversation";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/flow-state/prompt-input";
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";
import { RequestGroupRenderer } from "@/components/flow-state/request-group";

import { SessionSidebar } from "@/components/session-sidebar";
import { AgentResponseCard } from "@/components/agent-response-card";
import { ModeSelector, type Mode } from "@/components/mode-selector";
import { ThinkingStyleSelector, type ThinkingStyle } from "@/components/thinking-style-selector";
import { ModelPresetSelector, type ModelPreset } from "@/components/model-preset-selector";
import { FeatureSelector, type Features, DEFAULT_FEATURES } from "@/components/feature-selector";
import { ClientDataBar } from "@/components/client-data-bar";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactViewer } from "@/components/artifact-viewer";
import { ResizeHandle } from "@/components/resize-handle";
import { SuggestionRow } from "@/components/suggestion-row";
import { VoiceToggle } from "@/components/voice-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import { ModelPresetProvider } from "@/components/model-preset-context";
import { KitchenSinkMessage } from "@/components/kitchen-sink-message";

import type { RendererRegistry } from "@flow-state-dev/react";

const kitchenSinkRenderers: RendererRegistry = {
  ...chatAssistantRenderers,
  message: KitchenSinkMessage,
  block_output: AgentResponseCard,
};


type MobilePanel = "chat" | "artifacts";

const SIDEBAR_DEFAULT_WIDTH = 480;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 700;
const SIDEBAR_STORAGE_KEY = "ks-sidebar-width";

const CLIENT_DATA_OPTIONS = {
  session: ["artifacts", "modeStatus", "workingMemory"] as string[],
  user: ["preferences"] as string[],
};

export default function Page() {
  return (
    <FlowProvider flowKind="kitchen-sink" userId="devuser" baseUrl="" renderers={kitchenSinkRenderers}>
      <KitchenSinkApp />
    </FlowProvider>
  );
}

function KitchenSinkApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, { items: true, autoResume: true });

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [thinkingStyle, setThinkingStyle] = useState<ThinkingStyle>("auto");
  const [modelPreset, setModelPreset] = useState<ModelPreset>("preset/small");
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    const stored = sessionStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored ? Number(stored) : SIDEBAR_DEFAULT_WIDTH;
  });

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w - delta));
      sessionStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const sidebarStyle = useMemo<CSSProperties>(
    () => ({ width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }),
    [sidebarWidth],
  );

  const voice = useVoice(session, {
    action: "run",
    buildInput: (text) => ({ message: text, mode, thinkingStyle, features }),
    autoPlayTTS: ttsEnabled,
  });

  // Refresh session list when the active session's title changes (e.g. from auto-title).
  const prevTitleRef = useRef(session.detail?.title);
  useEffect(() => {
    const currentTitle = session.detail?.title;
    if (currentTitle !== prevTitleRef.current) {
      prevTitleRef.current = currentTitle;
      if (currentTitle !== undefined) {
        void flow.refreshSessions();
      }
    }
  }, [session.detail?.title, flow]);

  const clientData = useClientData(session, CLIENT_DATA_OPTIONS);

  const modeStatus = clientData.session?.modeStatus as { currentMode: string; requestCount: number; thinkingStyle: string | undefined } | undefined;
  const userPrefs = clientData.user?.preferences as { displayName: string; preferredModel: string } | undefined;

  const artifacts = (clientData.session?.artifacts ?? []) as Array<{ id: string; title: string; summary: string; content: string; updatedAt: number }>;

  // Sync local model preset from server state on initial load / session switch.
  const serverPreferredModel = userPrefs?.preferredModel;
  const prevServerModel = useRef(serverPreferredModel);
  useEffect(() => {
    if (serverPreferredModel && serverPreferredModel !== prevServerModel.current) {
      prevServerModel.current = serverPreferredModel;
      setModelPreset(serverPreferredModel as ModelPreset);
    }
  }, [serverPreferredModel]);

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId]
  );

  const handleSubmit = useCallback(
    async (msg: PromptInputMessage) => {
      const text = msg.text.trim();
      if (!flow.activeSessionId || text.length === 0) return;
      setMessage("");
      await session.sendAction("run", {
        message: text,
        mode,
        thinkingStyle,
        features,
      }, { userMessage: text });
    },
    [flow.activeSessionId, mode, thinkingStyle, features, session]
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

  const handleModelPresetChange = useCallback(
    (preset: ModelPreset) => {
      setModelPreset(preset);
      if (flow.activeSessionId) {
        void session.sendAction("setPreferredModel", { preferredModel: preset });
      }
    },
    [flow.activeSessionId, session],
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

  const isDisabled = !session.canSendAction || !flow.activeSessionId || flow.isLoading;

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
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <ClientDataBar
          currentMode={modeStatus?.currentMode}
          requestCount={modeStatus?.requestCount}
          displayName={userPrefs?.displayName}
          preferredModel={userPrefs?.preferredModel}
          thinkingStyle={modeStatus?.thinkingStyle}
        />

        <div className="flex min-h-0 flex-1 sm:hidden">
          {mobilePanel === "chat" && (
            <ChatPanel
              message={message}
              mode={mode}
              thinkingStyle={thinkingStyle}
              modelPreset={modelPreset}
              features={features}
              isDisabled={isDisabled}
              session={session}
              voice={voice}
              ttsEnabled={ttsEnabled}
              onToggleTTS={() => setTtsEnabled((v) => !v)}
              onSetMessage={setMessage}
              onSetMode={setMode}
              onSetThinkingStyle={setThinkingStyle}
              onModelPresetChange={handleModelPresetChange}
              onSetFeatures={setFeatures}
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
            thinkingStyle={thinkingStyle}
            modelPreset={modelPreset}
            features={features}
            isDisabled={isDisabled}
            session={session}
            voice={voice}
            ttsEnabled={ttsEnabled}
            onToggleTTS={() => setTtsEnabled((v) => !v)}
            onSetMessage={setMessage}
            onSetMode={setMode}
            onSetThinkingStyle={setThinkingStyle}
            onModelPresetChange={handleModelPresetChange}
            onSetFeatures={setFeatures}
            onSubmit={handleSubmit}
            onSuggestionClick={handleSuggestionClick}
          />

          <ResizeHandle onResize={handleSidebarResize} />

          {selectedArtifact ? (
            <ArtifactViewer
              artifact={selectedArtifact}
              isSaving={session.isStreaming}
              onSaveArtifact={handleSaveArtifact}
              onClose={() => setSelectedArtifactId(null)}
              onBack={() => setSelectedArtifactId(null)}
              style={sidebarStyle}
            />
          ) : (
            <ArtifactPanel
              artifacts={artifacts}
              selectedId={selectedArtifactId}
              onSelect={setSelectedArtifactId}
              style={sidebarStyle}
            />
          )}
        </div>
      </main>
    </div>
  );
}

interface ChatPanelProps {
  message: string;
  mode: Mode;
  thinkingStyle: ThinkingStyle;
  modelPreset: string;
  features: Features;
  isDisabled: boolean;
  session: ReturnType<typeof useSession>;
  voice: ReturnType<typeof useVoice>;
  ttsEnabled: boolean;
  onToggleTTS: () => void;
  onSetMessage: (value: string) => void;
  onSetMode: (value: Mode) => void;
  onSetThinkingStyle: (value: ThinkingStyle) => void;
  onModelPresetChange: (value: ModelPreset) => void;
  onSetFeatures: (value: Features) => void;
  onSubmit: (msg: PromptInputMessage) => Promise<void>;
  onSuggestionClick: (text: string) => void;
}

/** Memoized conversation body — only re-renders when items/streaming/error change, not on typing. */
const ConversationBody = memo(function ConversationBody({
  items,
  isStreaming,
  isLoading,
  error,
  modelPreset,
}: {
  items: import("@flow-state-dev/core/items").OutputItem[];
  isStreaming: boolean;
  isLoading: boolean;
  error: { message: string } | null;
  modelPreset: string;
}) {
  return (
    <>
      <ScrollOnNewRequest items={items} />
      <ModelPresetProvider value={modelPreset}>
        <SessionItemsProvider value={items}>
          <ConversationContent className="mx-auto w-full max-w-3xl px-3 sm:px-4">
            {items.length === 0 && !isLoading && (
              <ConversationEmptyState
                title="Kitchen Sink"
                description="A multi-modal AI assistant demonstrating all @flow-state-dev building blocks: handlers, generators, routers, sequencers, resources, clientData, and tool-use."
              />
            )}
            <RequestGroupRenderer items={items} isStreaming={isStreaming} />
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <span>{error.message}</span>
              </div>
            )}
          </ConversationContent>
        </SessionItemsProvider>
      </ModelPresetProvider>
    </>
  );
});

function ChatPanel({
  message,
  mode,
  thinkingStyle,
  modelPreset,
  features,
  isDisabled,
  session,
  voice,
  ttsEnabled,
  onToggleTTS,
  onSetMessage,
  onSetMode,
  onSetThinkingStyle,
  onModelPresetChange,
  onSetFeatures,
  onSubmit,
  onSuggestionClick,
}: ChatPanelProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Conversation className="min-h-0 flex-1">
        <ConversationBody
          items={session.items}
          isStreaming={session.isStreaming}
          isLoading={session.isLoading}
          error={session.error}
          modelPreset={modelPreset}
        />
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t">
        {session.items.length === 0 && <SuggestionRow onSuggestionClick={onSuggestionClick} disabled={isDisabled} />}
        <div className="mx-auto max-w-3xl px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 sm:px-4 sm:pb-4">
          <div className="mb-2 flex items-center gap-3">
            <ModeSelector mode={mode} onModeChange={onSetMode} disabled={isDisabled} />
            <ThinkingStyleSelector value={thinkingStyle} onValueChange={onSetThinkingStyle} disabled={isDisabled} />
            <ModelPresetSelector value={modelPreset} onValueChange={onModelPresetChange} disabled={isDisabled} />
            <FeatureSelector features={features} onFeaturesChange={onSetFeatures} disabled={isDisabled} />
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
