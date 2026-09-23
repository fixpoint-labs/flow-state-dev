"use client";

import { memo, Suspense, useState, useCallback, useEffect, useMemo, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FlowNavigator,
  FlowProvider,
  SuspensionResolverProvider,
  useFlow,
  useSession,
  useClientData,
  useResourceCollectionList,
  useVoice,
  type FlowNavigatorLeaf,
  type FlowNavigatorLeafState,
  type FlowNavigatorSection,
} from "@flow-state-dev/react";
import { createResourceClient } from "@flow-state-dev/client";
import { Button } from "@/components/ui/button";
import { Menu, MessageSquareText, Package, Plus, RotateCcw, Users, Wrench, X } from "lucide-react";

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

import { AgentResponseCard } from "@/components/agent-response-card";
import { ModeSelector, type Mode } from "@/components/mode-selector";
import { ThinkingStyleSelector, type ThinkingStyle } from "@/components/thinking-style-selector";
import { ModelSelector, type ModelId } from "@/components/model-selector";
import { ThinkingToggle } from "@/components/thinking-toggle";
import { DEFAULT_KITCHEN_SINK_MODEL } from "@/lib/models";
import { FeatureSelector, type Features, DEFAULT_FEATURES } from "@/components/feature-selector";
import { ClientDataBar } from "@/components/client-data-bar";
import { ArtifactPanel } from "@/components/artifact-panel";
import { TeamPanel } from "@/components/team-panel";
import { ArtifactDialog } from "@/components/artifact-dialog";
import { ResizeHandle } from "@/components/resize-handle";
import { SuggestionRow } from "@/components/suggestion-row";
import { BackgroundWorkPanel, BackgroundWorkRefresh } from "@/components/background-work-panel";
import { VoiceToggle } from "@/components/voice-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import { ChatAgentMessage } from "@/components/chat-agent/message";
import { cn } from "@/lib/utils";
import { CHANNEL_KINDS, SEAT_KINDS, SHELL_FLOW_KIND } from "@/lib/workforce-shell";

import type { RendererRegistry } from "@flow-state-dev/react";

const chatAgentRenderers: RendererRegistry = {
  ...chatAssistantRenderers,
  message: ChatAgentMessage,
  block_trace: AgentResponseCard,
};


type MobilePanel = "chat" | "artifacts";

/**
 * The rail's sections. How deep each kind goes is read off the flow's declared
 * cardinality, never written here: a channel kind opens straight into its
 * conversations, a seat kind opens into seats and then one seat's.
 *
 * "Assistant" is this app's own chat flow, so its conversations stay one click
 * away.
 */
const RAIL_SECTIONS: readonly FlowNavigatorSection[] = [
  { label: "Channels", kinds: CHANNEL_KINDS },
  { label: "Seats", kinds: SEAT_KINDS },
  { label: "Assistant", kinds: [SHELL_FLOW_KIND] },
];

/** The rail's theme: the navigator's custom properties, set to this app's tokens. */
const RAIL_THEME = {
  "--fsd-nav-fg": "var(--color-foreground)",
  "--fsd-nav-muted-fg": "var(--color-muted-foreground)",
  "--fsd-nav-selected-bg": "var(--color-accent)",
  "--fsd-nav-selected-fg": "var(--color-accent-foreground)",
} as CSSProperties;

/** A session picked in the rail that is not one of the assistant's own. */
type PickedSession = { sessionId: string; kind: string };

const SIDEBAR_DEFAULT_WIDTH = 480;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 700;
const SIDEBAR_STORAGE_KEY = "ks-sidebar-width";

const CLIENT_DATA_OPTIONS = {
  session: ["modeStatus", "workingMemory"] as string[],
  user: ["preferences"] as string[],
};

export default function Page() {
  // useSearchParams() must be wrapped in Suspense in Next.js app router —
  // it opts the route out of prerender. The wrapper keeps SSR happy without
  // forcing the production landing page to be fully dynamic.
  return (
    <Suspense fallback={null}>
      <PageInner />
    </Suspense>
  );
}

function PageInner() {
  // Under E2E test mode only, allow tests to mint a per-test userId via
  // ?e2eUserId=... so parallel scenarios don't share session state. The env
  // var is `NEXT_PUBLIC_*` so the gate evaluates on the client; production
  // builds without it always use the hardcoded "devuser".
  const searchParams = useSearchParams();
  const e2eUserId =
    process.env.NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE === "1"
      ? searchParams.get("e2eUserId")
      : null;
  const userId = e2eUserId ?? "devuser";
  return (
    <FlowProvider flowKind="chat-agent" userId={userId} baseUrl="" renderers={chatAgentRenderers}>
      <KitchenSinkApp />
    </FlowProvider>
  );
}

function KitchenSinkApp() {
  // The assistant's own sessions, and which one the stream is on. The rail's
  // navigator reads the flow list once more for itself: one extra read per
  // page, never one per row.
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, { items: true, autoResume: true });

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("ask");
  const [thinkingStyle, setThinkingStyle] = useState<ThinkingStyle>("default");
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const [isRailDrawerOpen, setIsRailDrawerOpen] = useState(false);
  const [isTeamSheetOpen, setIsTeamSheetOpen] = useState(false);
  const [picked, setPicked] = useState<PickedSession | null>(null);
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

  // Applied through a custom property so it only takes effect where the panel
  // is a column (`lg` and up); below that the panel is a sheet with its own width.
  const teamPanelStyle = useMemo(
    () => ({ "--team-panel-width": `${sidebarWidth}px` }) as CSSProperties,
    [sidebarWidth],
  );

  const voice = useVoice(session, {
    action: "run",
    buildInput: (text) => ({ message: text, mode, thinkingStyle, features }),
    autoPlayTTS: ttsEnabled,
  });

  // A channel's or a seat's session, when one is picked in the rail. Read
  // only: the composer below talks to the assistant's flow and no other.
  const pickedSession = useSession(picked?.sessionId, {
    flowKind: picked?.kind,
    items: true,
    autoResume: true,
  });

  // One resource client for every panel read, held stable: the panels fence
  // their reads on it, so a new object each render would read as a new
  // backend each render.
  const resourceClient = useMemo(() => createResourceClient({ baseUrl: "" }), []);
  // The panels read through the assistant's session, because that flow is the
  // one declaring the roster and the boards.
  const panelSessionId = flow.activeSessionId;

  const clientData = useClientData(session, CLIENT_DATA_OPTIONS);
  const { items: artifactItems } = useResourceCollectionList(session, "artifacts", { limit: 50 });

  const modeStatus = clientData.session?.modeStatus as { currentMode: string; requestCount: number; thinkingStyle: string | undefined; activeSkills?: Array<{ name: string; source: string }> } | undefined;
  const userPrefs = clientData.user?.preferences as { displayName: string; selectedModel: string; thinkingEnabled: boolean } | undefined;

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

  // Fetch content when a new artifact is selected. The framework's list
  // endpoint returns `topic` already stripped of the collection prefix
  // (`extractBareTopic` → "hello.md", not "artifacts/hello.md"), and
  // `selectedArtifactId` is derived from that same stripped topic above
  // — so we compare bare-to-bare and skip the storageKey construction
  // that would never match.
  useEffect(() => {
    if (!selectedArtifactId) {
      setArtifactContent(null);
      return;
    }
    const item = artifactItems.find((i) => i.topic === selectedArtifactId);
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

  const handleNewSession = useCallback(
    async (leaf: FlowNavigatorLeafState) => {
      await flow.createSession();
      setPicked(null);
      leaf.refresh();
      setIsRailDrawerOpen(false);
      setMobilePanel("chat");
    },
    [flow]
  );

  const handleSelectSession = useCallback(
    (id: string, leaf: FlowNavigatorLeaf) => {
      if (leaf.kind === SHELL_FLOW_KIND) {
        flow.selectSession(id);
        setPicked(null);
      } else {
        setPicked({ sessionId: id, kind: leaf.kind });
      }
      setIsRailDrawerOpen(false);
      setMobilePanel("chat");
    },
    [flow]
  );

  const railSlots = useMemo(
    () => ({
      // "New session" sits inside the assistant's own leaf, the one place a
      // new conversation can be started from this page.
      leafToolbar: (leaf: FlowNavigatorLeafState) =>
        leaf.kind === SHELL_FLOW_KIND ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-2 text-xs"
            onClick={() => void handleNewSession(leaf)}
            disabled={flow.isLoading}
          >
            <Plus className="h-3.5 w-3.5" />
            New session
          </Button>
        ) : null,
    }),
    [handleNewSession, flow.isLoading]
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

  const chatPanel = (
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
  );
  const stream =
    picked === null ? chatPanel : <PickedSessionPanel session={pickedSession} kind={picked.kind} />;

  const teamPanel = (
    <TeamPanel
      sessionId={panelSessionId}
      resourceClient={resourceClient}
      top={
        mode === "build" ? (
          <ArtifactPanel
            artifacts={artifacts}
            selectedId={selectedArtifactId}
            onSelect={setSelectedArtifactId}
            className="h-72 shrink-0 border-b border-l-0"
          />
        ) : null
      }
    />
  );

  // Three regions, and the order they give way in as the window narrows:
  // below `lg` the team panel becomes a sheet opened from the header, below
  // `sm` the rail becomes a drawer too, and the stream never yields.
  //
  // The rail and the panel are each mounted ONCE, at every width. A drawer is
  // the same element restyled, not a second copy, so there is one flow-list
  // read, one scroll container and one set of open rows whatever the width.
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      {isRailDrawerOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          aria-label="Close navigator"
          onClick={() => setIsRailDrawerOpen(false)}
        />
      )}
      <aside
        className={cn(
          "shrink-0 flex-col border-r sm:static sm:z-auto sm:flex sm:w-64 sm:max-w-none sm:bg-muted/30 sm:shadow-none",
          isRailDrawerOpen
            ? "fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[85vw] bg-background shadow-2xl"
            : "hidden",
        )}
        data-testid="rail"
        aria-label="Channels, seats and conversations"
      >
        <Rail
          slots={railSlots}
          selectedSessionId={picked?.sessionId ?? flow.activeSessionId}
          onSelectSession={handleSelectSession}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col" data-testid="stream">
        <div className="flex items-center gap-2 border-b px-3 py-2 sm:px-4 lg:hidden">
          <Button variant="outline" size="sm" className="gap-2 sm:hidden" onClick={() => setIsRailDrawerOpen(true)}>
            <Menu className="h-4 w-4" />
            Browse
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
          {mode === "build" && picked === null && (
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
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            aria-label="Open boards and roster"
            onClick={() => setIsTeamSheetOpen(true)}
          >
            <Users className="h-4 w-4" />
            Team
          </Button>
          <div className="ml-auto sm:hidden">
            <ThemeToggle />
          </div>
        </div>

        <ClientDataBar
          displayName={userPrefs?.displayName}
          selectedModel={selectedModel}
          activeSkills={modeStatus?.activeSkills}
        />

        {/* Mounted HERE, above both responsive trees, and exactly once. The
            mobile and desktop `ChatPanel`s are both alive at the same time —
            one is hidden with CSS, not unmounted — so a side effect placed
            inside either of them runs twice per turn. The panel itself is fine
            to render twice; its stream-end re-read is not. */}
        <BackgroundWorkRefresh session={session} />

        <div className="flex min-h-0 flex-1 sm:hidden">
          {(mobilePanel === "chat" || picked !== null) && stream}

          {mobilePanel === "artifacts" && mode === "build" && picked === null && (
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

        <div className="hidden min-h-0 flex-1 sm:flex">{stream}</div>
      </main>

      <ResizeHandle onResize={handleSidebarResize} className="hidden lg:flex" />
      {isTeamSheetOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close boards and roster"
          onClick={() => setIsTeamSheetOpen(false)}
        />
      )}
      <aside
        className={cn(
          "shrink-0 flex-col border-l lg:static lg:z-auto lg:flex lg:w-[var(--team-panel-width)] lg:max-w-none lg:shadow-none",
          isTeamSheetOpen
            ? "fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-[90vw] bg-background shadow-2xl"
            : "hidden",
        )}
        style={teamPanelStyle}
        data-testid="team-panel"
        aria-label="Boards and roster"
      >
        <div className="flex items-center justify-end border-b px-2 py-1 lg:hidden">
          <Button variant="ghost" size="icon-sm" aria-label="Close boards and roster" onClick={() => setIsTeamSheetOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {teamPanel}
      </aside>

      <ArtifactDialog
        artifact={selectedArtifact}
        isSaving={session.isStreaming}
        onSaveArtifact={handleSaveArtifact}
        onClose={() => setSelectedArtifactId(null)}
      />
    </div>
  );
}

/** The rail: one navigator over every section, and the app's links underneath it. */
function Rail({
  slots,
  selectedSessionId,
  onSelectSession,
}: {
  slots: { leafToolbar: (leaf: FlowNavigatorLeafState) => React.ReactNode };
  selectedSessionId: string | undefined;
  onSelectSession: (sessionId: string, leaf: FlowNavigatorLeaf) => void;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 py-1" style={RAIL_THEME}>
        <FlowNavigator
          sections={RAIL_SECTIONS}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          slots={slots}
        />
      </div>
      <div className="flex items-center gap-1 border-t p-3">
        <ThemeToggle />
        <Button asChild variant="ghost" size="icon-sm" aria-label="Open DevTool">
          <Link href="/devtool" target="_blank" rel="noopener" title="Open DevTool">
            <Wrench className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </>
  );
}

/**
 * A session from another flow, opened from the rail: its transcript, and no
 * composer, because this page sends turns to the assistant only.
 */
function PickedSessionPanel({ session, kind }: { session: ReturnType<typeof useSession>; kind: string }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="picked-session">
      <Conversation className="min-h-0 flex-1" data-testid="conversation">
        <ConversationBody
          items={session.items}
          isStreaming={session.isStreaming}
          isFinishing={session.isFinishing}
          statusMessage={session.statusMessage}
          isLoading={session.isLoading}
          error={session.error}
          emptyTitle="Nothing here yet"
          emptyDescription={`This ${kind} session has no turns yet.`}
        />
        <ConversationScrollButton />
      </Conversation>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Read only. Messages from this page go to the assistant, so pick one of its conversations to reply.
      </p>
    </section>
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
  isFinishing,
  statusMessage,
  isLoading,
  error,
  emptyTitle = "Kitchen Sink",
  emptyDescription = "A multi-modal AI assistant demonstrating all @flow-state-dev building blocks: handlers, generators, routers, sequencers, resources, clientData, and tool-use.",
}: {
  items: import("@flow-state-dev/core/items").OutputItem[];
  isStreaming: boolean;
  isFinishing: boolean;
  statusMessage: string;
  isLoading: boolean;
  error: { message: string } | null;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <>
      <ScrollOnNewRequest items={items} />
      <SessionItemsProvider value={items}>
        <ConversationContent className="mx-auto w-full max-w-3xl px-3 sm:px-4">
          {items.length === 0 && !isLoading && (
            <ConversationEmptyState title={emptyTitle} description={emptyDescription} />
          )}
          <RequestGroupRenderer items={items} isStreaming={isStreaming} isFinishing={isFinishing} statusMessage={statusMessage} />
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
 * session was interrupted. Clicking Resume continues the interrupted request
 * under its OWN id (crash-recovery re-entry) and streams the re-entry inline —
 * it does not re-dispatch a fresh request, so the request list shows the same
 * row transitioning interrupted → completed rather than a new `retryOf`
 * sibling. Hidden in every other state — including while a new request is
 * already streaming — so the chat doesn't pile up dueling controls.
 */
function ResumePrompt({ session }: { session: ReturnType<typeof useSession> }) {
  const [isResuming, setIsResuming] = useState(false);
  const latest = session.latestRequest;
  const canResume =
    latest?.status === "interrupted" && !session.isStreaming && !session.isFinishing;

  const handleResume = useCallback(async () => {
    if (latest === null) return;
    setIsResuming(true);
    try {
      await session.continueRequest(latest.id);
    } catch {
      // Error is already surfaced via session.error.
    } finally {
      setIsResuming(false);
    }
  }, [session, latest]);

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
    // Bridge the session's streaming resume to the inline approval cards
    // (the ui Approval renderer) so approving/rejecting a suspension streams the
    // continuation into the chat live, without a page refresh.
    <SuspensionResolverProvider resolve={session.resumeSuspension}>
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Conversation className="min-h-0 flex-1" data-testid="conversation">
        <ConversationBody
          items={session.items}
          isStreaming={session.isStreaming}
          isFinishing={session.isFinishing}
          statusMessage={session.statusMessage}
          isLoading={session.isLoading}
          error={session.error}
        />
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t">
        {session.items.length === 0 && <SuggestionRow onSuggestionClick={onSuggestionClick} disabled={isDisabled} />}
        <StuckRequestBanner session={session} />
        {/* Outside the conversation, deliberately: a child session's output is not
            part of the transcript and nothing folds it in. */}
        <BackgroundWorkPanel session={session} flowKind="chat-agent" />
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
    </SuspensionResolverProvider>
  );
}
