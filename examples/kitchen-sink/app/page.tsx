"use client";

import { useState, useCallback, useMemo } from "react";
import {
  FlowProvider,
  ItemsRenderer,
  useFlow,
  useSession,
  useProjections,
  type RendererRegistry,
} from "@flow-state-dev/react";
import {
  artifactsListOutputSchema,
  modeStatusOutputSchema,
  userPrefsOutputSchema,
} from "@/src/flows/kitchen-sink/flow";

// AI Elements
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

// Bridge components
import { KitchenSinkMessage } from "@/components/kitchen-sink-message";
import { KitchenSinkReasoning } from "@/components/kitchen-sink-reasoning";
import { KitchenSinkStatus } from "@/components/kitchen-sink-status";
import { KitchenSinkError } from "@/components/kitchen-sink-error";

// Layout components
import { SessionSidebar } from "@/components/session-sidebar";
import { ModeSelector } from "@/components/mode-selector";
import { ProjectionsBar } from "@/components/projections-bar";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactViewer } from "@/components/artifact-viewer";
import { SuggestionRow } from "@/components/suggestion-row";


// ---------------------------------------------------------------------------
// Renderer registry — maps item types to AI Element bridge components
// ---------------------------------------------------------------------------
const renderers: RendererRegistry = {
  message: KitchenSinkMessage,
  reasoning: KitchenSinkReasoning,
  status: KitchenSinkStatus,
  error: KitchenSinkError,
  step_error: KitchenSinkError,
};

const ITEM_TYPES = [
  "message",
  "reasoning",
  "status",
  "error",
  "step_error",
];

// Stable reference for useProjections — avoids re-creating the options object on every render
const PROJECTION_OPTIONS = {
  session: {
    artifactsList: artifactsListOutputSchema,
    modeStatus: modeStatusOutputSchema,
  },
  user: {
    preferences: userPrefsOutputSchema,
  },
} as const;

// ---------------------------------------------------------------------------
// Root page
// ---------------------------------------------------------------------------
export default function Page() {
  return (
    <FlowProvider
      flowKind="kitchen-sink"
      userId="devuser"
      baseUrl=""
      renderers={renderers}
    >
      <KitchenSinkApp />
    </FlowProvider>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------
function KitchenSinkApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId, {
    items: { itemTypes: ITEM_TYPES },
  });

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"chat" | "plan" | "review">("chat");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  // Projections: live derived views from session + user state
  const projections = useProjections(session, PROJECTION_OPTIONS);

  const modeStatus = projections.session?.modeStatus;
  const userPrefs = projections.user?.preferences;
  const artifacts = projections.session?.artifactsList ?? [];

  // Resolve the selected artifact from the live projection data so it auto-updates
  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId]
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
  }, [flow]);

  const handleSuggestionClick = useCallback(
    (text: string) => {
      setMessage(text);
    },
    []
  );

  const isDisabled = session.isStreaming || !flow.activeSessionId || flow.isLoading;

  return (
    <div className="flex h-screen">
      {/* Left sidebar: sessions */}
      <SessionSidebar
        sessions={flow.sessions}
        activeSessionId={flow.activeSessionId}
        isLoading={flow.isLoading}
        onNewChat={() => void handleNewSession()}
        onSelectSession={flow.selectSession}
      />

      {/* Center: main conversation area */}
      <main className="flex flex-1 flex-col min-w-0">
        {/* Header bar with live projection data */}
        <ProjectionsBar
          currentMode={modeStatus?.currentMode}
          requestCount={modeStatus?.requestCount}
          displayName={userPrefs?.displayName}
          preferredModel={userPrefs?.preferredModel}
        />

        {/* Conversation area */}
        <Conversation className="flex-1">
          <ConversationContent className="mx-auto max-w-3xl">
            {session.items.length === 0 && !session.isLoading && (
              <ConversationEmptyState
                title="Kitchen Sink"
                description="A multi-modal AI assistant demonstrating all @flow-state-dev building blocks: handlers, generators, routers, sequencers, resources, projections, and tool-use."
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

        {/* Footer: suggestions, mode selector, input */}
        <div className="border-t">
          {session.items.length === 0 && (
            <SuggestionRow
              onSuggestionClick={handleSuggestionClick}
              disabled={isDisabled}
            />
          )}
          <div className="mx-auto max-w-3xl px-4 pb-4 pt-2">
            <div className="flex items-center gap-3 mb-2">
              <ModeSelector
                mode={mode}
                onModeChange={setMode}
                disabled={isDisabled}
              />
            </div>
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputTextarea
                name="message"
                placeholder={`Send a message in ${mode} mode...`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isDisabled}
              />
              <PromptInputSubmit
                className="mr-4"
                status={session.isStreaming ? "streaming" : "ready"}
                disabled={isDisabled || message.trim().length === 0}
              />
            </PromptInput>
          </div>
        </div>
      </main>

      {/* Right panel: artifact list or expanded viewer */}
      {selectedArtifact ? (
        <ArtifactViewer
          artifact={selectedArtifact}
          onClose={() => setSelectedArtifactId(null)}
          onBack={() => setSelectedArtifactId(null)}
        />
      ) : (
        <ArtifactPanel
          artifacts={artifacts}
          selectedId={selectedArtifactId}
          onSelect={setSelectedArtifactId}
        />
      )}
    </div>
  );
}
