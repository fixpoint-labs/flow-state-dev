"use client";

import { memo, useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  FlowProvider,
  useFlow,
  useSession,
  useClientData,
  useResourceCollectionList,
  useVoice,
} from "@flow-state-dev/react";
import { Button } from "@/components/ui/button";
import { Menu, MessageSquareText, Package, RotateCcw } from "lucide-react";

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
import { StuckRequestBanner } from "@/components/flow-state/stuck-request-banner";

import { SessionSidebar } from "@/components/session-sidebar";
import { AgentResponseCard } from "@/components/agent-response-card";
import { ModeSelector, type Mode } from "@/components/mode-selector";
import { ThinkingStyleSelector, type ThinkingStyle } from "@/components/thinking-style-selector";
import { ModelSelector, type ModelId } from "@/components/model-selector";
import { ThinkingToggle } from "@/components/thinking-toggle";
import { DEFAULT_KITCHEN_SINK_MODEL } from "@/lib/models";
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
import { ChatAgentMessage } from "@/components/chat-agent/message";

import type { RendererRegistry } from "@flow-state-dev/react";

const chatAgentRenderers: RendererRegistry = {
  ...chatAssistantRenderers,
  message: ChatAgentMessage,
  block_trace: AgentResponseCard,
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
  const { items: artifactItems, loadMore: loadMoreArtifacts, pagination: artifactsPagination } = useResourceCollectionList(session, "artifacts", { limit: 50 });

  const modeStatus = clientData.session?.modeStatus as { currentMode: string; requestCount: number; thinkingStyle: string | undefined; activeSkills?: Array<{ name: string; source: string }> } | undefined;
  const userPrefs = clientData.user?.preferences as { displayName: string; selectedModel: string; thinkingEnabled: boolean } | undefined;

  // Derive resolved thinking style from the most recent request's items.
  const resolvedThinkingStyle = useMemo(() => {
    if (session.items.length === 0) return null;
    const lastRequestId = session.items[session.items.length - 1].requestId;
    const requestItems = session.items.filter((i) => i.requestId === lastRequestId);
    return inferThinkingStyle(requestItems);
  }, [session.items]);

  // Derive artifact summaries from the paginated artifact list. Content is
  // loaded lazily via item.fetchContent() when an artifact is opened.
  const artifacts = useMemo(() => {
    return artifactItems.map((item) => {
      const data = item.clientData as { title: string; summary: string; updatedAt: number; extension: string | null; content: string } | undefined;
      return {
        id: item.topic.replace("artifacts/", ""),
        title: data?.title ?? "Untitled",
        summary: data?.summary ?? "",
        updatedAt: data?.updatedAt ?? 0,
        extension: data?.extension ?? null,
        content: data?.content ?? "",
        _handle: item,
      };
    });
  }, [artifactItems]);

  // Server is the source of truth for selectedModel + thinkingEnabled. Fall
  // back to the catalog default while user state is still loading.
  const selectedModel: ModelId =
    (userPrefs?.selectedModel as ModelId | undefined) ??
    DEFAULT_KITCHEN_SINK_MODEL;
  const thinkingEnabled = userPrefs?.thinkingEnabled ?? false;

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
    const item = artifactItems.find((i) => i.topic === storageKey);
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

  const handleSelectedModelChange = useCallback(
    (next: ModelId) => {
      if (!flow.activeSessionId) return;
      void session.sendAction("setSelectedModel", { selectedModel: next });
    },
    [flow.activeSessionId, session],
  );

  const handleThinkingEnabledChange = useCallback(
    (next: boolean) => {
      if (!flow.activeSessionId) return;
      void session.sendAction("setThinkingEnabled", { thinkingEnabled: next });
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
          selectedModel={selectedModel}
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
              selectedModel={selectedModel}
              thinkingEnabled={thinkingEnabled}
              features={features}
              isDisabled={isDisabled}
              session={session}
              voice={voice}
              ttsEnabled={ttsEnabled}
              onToggleTTS={() => setTtsEnabled((v) => !v)}
              onSetMessage={setMessage}
              onSetMode={handleModeChange}
              onSetThinkingStyle={setThinkingStyle}
              onSelectedModelChange={handleSelectedModelChange}
              onThinkingEnabledChange={handleThinkingEnabledChange}
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
            selectedModel={selectedModel}
            thinkingEnabled={thinkingEnabled}
            features={features}
            isDisabled={isDisabled}
            session={session}
            voice={voice}
            ttsEnabled={ttsEnabled}
            onToggleTTS={() => setTtsEnabled((v) => !v)}
            onSetMessage={setMessage}
            onSetMode={handleModeChange}
            onSetThinkingStyle={setThinkingStyle}
            onSelectedModelChange={handleSelectedModelChange}
            onThinkingEnabledChange={handleThinkingEnabledChange}
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
  selectedModel: ModelId;
  thinkingEnabled: boolean;
  features: Features;
  isDisabled: boolean;
  session: ReturnType<typeof useSession>;
  voice: ReturnType<typeof useVoice>;
  ttsEnabled: boolean;
  onToggleTTS: () => void;
  onSetMessage: (value: string) => void;
  onSetMode: (value: Mode) => void;
  onSetThinkingStyle: (value: ThinkingStyle) => void;
  onSelectedModelChange: (value: ModelId) => void;
  onThinkingEnabledChange: (value: boolean) => void;
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
}: {
  items: import("@flow-state-dev/core/items").OutputItem[];
  isStreaming: boolean;
  statusMessage: string;
  isLoading: boolean;
  error: { message: string } | null;
}) {
  return (
    <>
      <ScrollOnNewRequest items={items} />
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
    </>
  );
});

/**
 * Inline notice that appears above the prompt when the latest request on this
 * session was interrupted. Clicking Resume re-dispatches the same action and
 * starts streaming the new request id. Hidden in every other state — including
 * while a new request is already streaming — so the chat doesn't pile up
 * dueling controls.
 */
function ResumePrompt({ session }: { session: ReturnType<typeof useSession> }) {
  const [isResuming, setIsResuming] = useState(false);
  const latest = session.latestRequest;
  const canResume =
    latest?.status === "interrupted" && !session.isStreaming && !session.isFinishing;

  const handleResume = useCallback(async () => {
    setIsResuming(true);
    try {
      await session.resumeLatestRequest();
    } catch {
      // Error is already surfaced via session.error.
    } finally {
      setIsResuming(false);
    }
  }, [session]);

  if (!canResume) return null;

  return (
    <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        <span className="text-amber-700 dark:text-amber-300">
          The previous request was interrupted before it finished.
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResume}
          disabled={isResuming}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {isResuming ? "Resuming…" : "Resume"}
        </Button>
      </div>
    </div>
  );
}

function ChatPanel({
  message,
  mode,
  thinkingStyle,
  selectedModel,
  thinkingEnabled,
  features,
  isDisabled,
  session,
  voice,
  ttsEnabled,
  onToggleTTS,
  onSetMessage,
  onSetMode,
  onSetThinkingStyle,
  onSelectedModelChange,
  onThinkingEnabledChange,
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
        />
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t">
        {session.items.length === 0 && <SuggestionRow onSuggestionClick={onSuggestionClick} disabled={isDisabled} />}
        <StuckRequestBanner session={session} />
        <ResumePrompt session={session} />
        <div className="mx-auto max-w-3xl px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 sm:px-4 sm:pb-4">
          <div className="mb-2 flex items-center gap-3">
            <ModeSelector mode={mode} onModeChange={onSetMode} disabled={isDisabled} />
            <ThinkingStyleSelector value={thinkingStyle} onValueChange={onSetThinkingStyle} disabled={isDisabled} />
            <ModelSelector value={selectedModel} onValueChange={onSelectedModelChange} disabled={isDisabled} />
            <ThinkingToggle value={thinkingEnabled} onValueChange={onThinkingEnabledChange} disabled={isDisabled} />
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
              onStop={session.isStuck ? () => session.dismissRequest() : session.abortRequest}
            />
          </PromptInput>
        </div>
      </div>
    </section>
  );
}
