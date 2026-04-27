"use client";

import { memo, useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  FlowProvider,
  useFlow,
  useSession,
  useClientData,
  useResourceCollection,
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
import {
  ProviderPreferenceSelector,
  type ProviderPreference,
} from "@/components/provider-preference-selector";
import { FeatureSelector, type Features, DEFAULT_FEATURES } from "@/components/feature-selector";
import { ClientDataBar } from "@/components/client-data-bar";
import { inferThinkingStyle } from "@/lib/item-inference";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactDialog } from "@/components/artifact-dialog";
import { ResizeHandle } from "@/components/resize-handle";
import { SuggestionRow } from "@/components/suggestion-row";
import { VoiceToggle } from "@/components/voice-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import { ModelPresetProvider } from "@/components/model-preset-context";
import { ChatAgentMessage } from "@/components/chat-agent/message";

import type { RendererRegistry } from "@flow-state-dev/react";

const chatAgentRenderers: RendererRegistry = {
  ...chatAssistantRenderers,
  message: ChatAgentMessage,
  block_output: AgentResponseCard,
};


type MobilePanel = "chat" | "artifacts";

const SIDEBAR_DEFAULT_WIDTH = 480;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 700;
const SIDEBAR_STORAGE_KEY = "ks-sidebar-width";

const CLIENT_DATA_OPTIONS = {
  session: ["modeStatus", "workingMemory"] as string[],
  user: ["preferences"] as string[],
};

export default function Page() {
  return (
    <FlowProvider flowKind="chat-agent" userId="devuser" baseUrl="" renderers={chatAgentRenderers}>
      <KitchenSinkApp />
    </FlowProvider>
  );
}

function KitchenSinkApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, { items: true, autoResume: true });

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("ask");
  const [thinkingStyle, setThinkingStyle] = useState<ThinkingStyle>("auto");
  const [modelPreset, setModelPreset] = useState<ModelPreset>("preset/small");
  const [providerPreference, setProviderPreference] =
    useState<ProviderPreference>("");
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
  const { items: artifactItems, actions: artifactActions } = useResourceCollection(session, "artifacts");

  const modeStatus = clientData.session?.modeStatus as { currentMode: string; requestCount: number; thinkingStyle: string | undefined; resolvedModel: string | null; activeSkills?: Array<{ name: string; source: string }> } | undefined;
  const userPrefs = clientData.user?.preferences as { displayName: string; preferredModel: string; preferredProvider: string } | undefined;

  // Derive resolved thinking style from the most recent request's items.
  const resolvedThinkingStyle = useMemo(() => {
    if (session.items.length === 0) return null;
    const lastRequestId = session.items[session.items.length - 1].requestId;
    const requestItems = session.items.filter((i) => i.requestId === lastRequestId);
    return inferThinkingStyle(requestItems);
  }, [session.items]);

  // Derive artifact summaries from the resource collection snapshot.
  // Content is loaded lazily when a specific artifact is opened.
  const artifacts = useMemo(() => {
    return Object.entries(artifactItems).map(([key, item]) => {
      const data = item.clientData as { title: string; summary: string; updatedAt: number; extension: string | null; content: string } | undefined;
      return {
        id: key.replace("artifacts/", ""),
        title: data?.title ?? "Untitled",
        summary: data?.summary ?? "",
        updatedAt: data?.updatedAt ?? 0,
        extension: data?.extension ?? null,
        content: data?.content ?? "",
      };
    });
  }, [artifactItems]);

  // Sync local model preset from server state on initial load / session switch.
  const serverPreferredModel = userPrefs?.preferredModel;
  const prevServerModel = useRef(serverPreferredModel);
  useEffect(() => {
    if (serverPreferredModel && serverPreferredModel !== prevServerModel.current) {
      prevServerModel.current = serverPreferredModel;
      setModelPreset(serverPreferredModel as ModelPreset);
    }
  }, [serverPreferredModel]);

  // Sync local provider preference from server state. Treat undefined and ""
  // as the same "no preference" state so a fresh session doesn't thrash.
  const serverPreferredProvider = userPrefs?.preferredProvider ?? "";
  const prevServerProvider = useRef(serverPreferredProvider);
  useEffect(() => {
    if (serverPreferredProvider !== prevServerProvider.current) {
      prevServerProvider.current = serverPreferredProvider;
      setProviderPreference(serverPreferredProvider as ProviderPreference);
    }
  }, [serverPreferredProvider]);

  // Artifact content is loaded lazily when an artifact is selected.
  const [artifactContent, setArtifactContent] = useState<string | null>(null);

  const selectedArtifactMeta = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId]
  );

  // Fetch content when a new artifact is selected
  useEffect(() => {
    if (!selectedArtifactId) {
      setArtifactContent(null);
      return;
    }
    const storageKey = `artifacts/${selectedArtifactId}`;
    const item = artifactItems[storageKey];
    if (!item) {
      setArtifactContent(null);
      return;
    }
    item.fetchContent().then((content) => {
      setArtifactContent(content);
    }).catch(() => {
      setArtifactContent(null);
    });
  }, [selectedArtifactId, artifactItems]);

  const selectedArtifact = useMemo(() => {
    if (!selectedArtifactMeta) return null;
    return {
      ...selectedArtifactMeta,
      content: artifactContent ?? "",
    };
  }, [selectedArtifactMeta, artifactContent]);

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

  const handleProviderPreferenceChange = useCallback(
    (preference: ProviderPreference) => {
      setProviderPreference(preference);
      if (flow.activeSessionId) {
        void session.sendAction("setPreferredProvider", {
          preferredProvider: preference,
        });
      }
    },
    [flow.activeSessionId, session],
  );

  // When switching out of Build mode, collapse the mobile view back to chat.
  const handleModeChange = useCallback(
    (newMode: Mode) => {
      setMode(newMode);
      if (newMode !== "build") {
        setMobilePanel("chat");
      }
    },
    [],
  );

  const handleSuggestionClick = useCallback((text: string) => {
    setMessage(text);
  }, []);

  const handleSaveArtifact = useCallback(
    async (artifact: { id: string; title: string; content: string }) => {
      if (!flow.activeSessionId) return;
      // Use the flow action for saves — this triggers server-side processing
      // (state updates, summary generation) alongside the content update.
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
          {mode === "build" && (
            <Button
              variant={mobilePanel === "artifacts" ? "secondary" : "outline"}
              size="sm"
              className="gap-2 sm:hidden"
              onClick={() => setMobilePanel("artifacts")}
            >
              <Package className="h-4 w-4" />
              Artifacts ({artifacts.length})
            </Button>
          )}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <ClientDataBar
          displayName={userPrefs?.displayName}
          resolvedModel={modeStatus?.resolvedModel ?? undefined}
          thinkingStyleMode={thinkingStyle}
          thinkingStyle={resolvedThinkingStyle ?? modeStatus?.thinkingStyle}
          activeSkills={modeStatus?.activeSkills}
        />

        <div className="flex min-h-0 flex-1 sm:hidden">
          {mobilePanel === "chat" && (
            <ChatPanel
              message={message}
              mode={mode}
              thinkingStyle={thinkingStyle}
              modelPreset={modelPreset}
              providerPreference={providerPreference}
              features={features}
              isDisabled={isDisabled}
              session={session}
              voice={voice}
              ttsEnabled={ttsEnabled}
              onToggleTTS={() => setTtsEnabled((v) => !v)}
              onSetMessage={setMessage}
              onSetMode={handleModeChange}
              onSetThinkingStyle={setThinkingStyle}
              onModelPresetChange={handleModelPresetChange}
              onProviderPreferenceChange={handleProviderPreferenceChange}
              onSetFeatures={setFeatures}
              onSubmit={handleSubmit}
              onSuggestionClick={handleSuggestionClick}
            />
          )}

          {mobilePanel === "artifacts" && mode === "build" && (
            <div className="flex min-w-0 flex-1">
              <ArtifactPanel
                artifacts={artifacts}
                selectedId={selectedArtifactId}
                onSelect={setSelectedArtifactId}
                className="w-full border-l-0"
              />
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 sm:flex">
          <ChatPanel
            message={message}
            mode={mode}
            thinkingStyle={thinkingStyle}
            modelPreset={modelPreset}
            providerPreference={providerPreference}
            features={features}
            isDisabled={isDisabled}
            session={session}
            voice={voice}
            ttsEnabled={ttsEnabled}
            onToggleTTS={() => setTtsEnabled((v) => !v)}
            onSetMessage={setMessage}
            onSetMode={handleModeChange}
            onSetThinkingStyle={setThinkingStyle}
            onModelPresetChange={handleModelPresetChange}
            onProviderPreferenceChange={handleProviderPreferenceChange}
            onSetFeatures={setFeatures}
            onSubmit={handleSubmit}
            onSuggestionClick={handleSuggestionClick}
          />

          {mode === "build" && (
            <>
              <ResizeHandle onResize={handleSidebarResize} />
              <ArtifactPanel
                artifacts={artifacts}
                selectedId={selectedArtifactId}
                onSelect={setSelectedArtifactId}
                style={sidebarStyle}
              />
            </>
          )}
        </div>
      </main>

      <ArtifactDialog
        artifact={selectedArtifact}
        isSaving={session.isStreaming}
        onSaveArtifact={handleSaveArtifact}
        onClose={() => setSelectedArtifactId(null)}
      />
    </div>
  );
}

interface ChatPanelProps {
  message: string;
  mode: Mode;
  thinkingStyle: ThinkingStyle;
  modelPreset: string;
  providerPreference: string;
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
  onProviderPreferenceChange: (value: ProviderPreference) => void;
  onSetFeatures: (value: Features) => void;
  onSubmit: (msg: PromptInputMessage) => Promise<void>;
  onSuggestionClick: (text: string) => void;
}

/** Memoized conversation body — only re-renders when items/streaming/error change, not on typing. */
const ConversationBody = memo(function ConversationBody({
  items,
  isStreaming,
  statusMessage,
  isLoading,
  error,
  modelPreset,
}: {
  items: import("@flow-state-dev/core/items").OutputItem[];
  isStreaming: boolean;
  statusMessage: string;
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
            <RequestGroupRenderer items={items} isStreaming={isStreaming} statusMessage={statusMessage} />
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
  providerPreference,
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
  onProviderPreferenceChange,
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
          statusMessage={session.statusMessage}
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
            <ProviderPreferenceSelector
              value={providerPreference}
              onValueChange={onProviderPreferenceChange}
              disabled={isDisabled}
            />
            <FeatureSelector features={features} onFeaturesChange={onSetFeatures} disabled={isDisabled} />
            <VoiceToggle voice={voice} disabled={isDisabled} ttsEnabled={ttsEnabled} onToggleTTS={onToggleTTS} />
          </div>
          <PromptInput onSubmit={onSubmit}>
            <PromptInputTextarea
              name="message"
              placeholder={
                mode === "build" ? "Describe what to build..." :
                mode === "interview" ? "Name a topic to explore..." :
                mode === "debate" ? "State a position to challenge..." :
                "Ask a question..."
              }
              value={message}
              onChange={(e) => onSetMessage(e.target.value)}
              disabled={isDisabled}
            />
            <PromptInputSubmit
              className="mr-2 sm:mr-4"
              status={session.isStreaming ? "streaming" : "ready"}
              disabled={!session.isStreaming && (isDisabled || message.trim().length === 0)}
              onStop={session.abortRequest}
            />
          </PromptInput>
        </div>
      </div>
    </section>
  );
}
