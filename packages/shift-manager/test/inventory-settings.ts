/**
 * Shift Manager's settings for the shared inventory
 * (`labs/test-support/inventory.ts`): the content rules (L3, L4 over all of
 * `src/`, own sessions), the read model that goes, and the types its screen
 * computes itself. `inventory.test.ts` runs them against
 * `inventory-allowlist.json`, which only shrinks. Shift Manager is a
 * published app over another host's Lab, so the path classes and caps (L1,
 * L2, H), which describe a starter, don't apply.
 */
import type { AppInventory } from "../../../labs/test-support/inventory.ts";

export const shiftManager: AppInventory = {
  path: "packages/shift-manager",
  entry: "src/lib/connection.ts",
  rules: ["L3", "L4", "own sessions"],
  gone: ["src/lib/reads.ts"],
  /** A snapshot is the read model's by definition: never one the screen computes. */
  neverScreen: /Snapshot$/,
  /** What is left of the read model: it may not grow. */
  readModel: ["src/lib/reads.ts"],
  /**
   * The types the screen computes itself, by the module that exports them.
   * A type stays on the allowlist when it hand-writes the shape of something
   * the server computes or stores: a row, a read's result, a request's
   * outcome, or the callbacks of a hand-built read or stream. It is listed
   * here when the screen computes it (a route, the theme, a component's
   * props, UI state, counts, a hook's output assembled from several reads,
   * entries drawn from stored items) or when it is taken from a package's
   * own type (a view's value, an action's output). A type that leaves the
   * allowlist for this list names its reason ({ name, reason }).
   */
  screenTypes: {
    "src/gaps.ts": ["Gaps"],
    "src/components/ToolLine.tsx": ["CallRunSegment"],
    "src/components/TurnComposer.tsx": ["TurnSendState"],
    "src/components/flow-state/attachments.tsx": [
      "AttachmentUploader", "AttachmentRefusal", "PendingAttachment", "AttachmentLimitOverrides", "UseAttachmentsOptions",
      "Attachments", "AttachmentPreviewProps", "AttachmentStripProps", "AttachButtonProps",
    ],
    "src/components/flow-state/code-block.tsx": [
      "CodeBlockCopyButtonProps", "CodeBlockLanguageSelectorProps", "CodeBlockLanguageSelectorTriggerProps",
      "CodeBlockLanguageSelectorValueProps", "CodeBlockLanguageSelectorContentProps", "CodeBlockLanguageSelectorItemProps",
    ],
    "src/components/flow-state/connection-screen.tsx": ["ConnectionFailure"],
    "src/components/flow-state/conversation.tsx": [
      "ConversationProps", "ConversationContentProps", "ConversationEmptyStateProps", "ConversationScrollButtonProps",
      "ConversationMessage", "ConversationDownloadProps",
    ],
    "src/components/flow-state/error.tsx": ["ErrorBodyProps"],
    "src/components/flow-state/message-response.tsx": ["MessageResponseProps"],
    "src/components/flow-state/message.tsx": [
      "MessageProps", "MessageContentProps", "MessageActionsProps", "MessageActionProps", "MessageBranchProps",
      "MessageBranchContentProps", "MessageBranchSelectorProps", "MessageBranchPreviousProps", "MessageBranchNextProps",
      "MessageBranchPageProps", "MessageToolbarProps", "ReadMessageFile",
    ],
    "src/components/flow-state/reasoning.tsx": ["ReasoningProps", "ReasoningTriggerProps", "ReasoningContentProps"],
    "src/components/flow-state/review-hold.tsx": ["ReviewDetail", "ReviewAnswer"],
    "src/components/flow-state/run-checks.tsx": ["RunChecksProps"],
    "src/components/flow-state/shimmer.tsx": ["TextShimmerProps"],
    "src/components/flow-state/spend.tsx": ["SpendLineOptions"],
    "src/components/flow-state/task-actions.tsx": ["TaskRerunOption"],
    "src/components/flow-state/task-plan-state.ts": ["TaskEntry", "TaskPlanState", "StatusGroup", "AssigneeGroup"],
    "src/components/flow-state/task-plan.tsx": ["StatusConfig", "TaskPlanProps"],
    "src/components/flow-state/tool-grouping.ts": ["ToolVerbs", "ToolCallLabelInput"],
    "src/components/flow-state/tool-naming.ts": ["ToolSubject"],
    "src/components/flow-state/tool-summaries.ts": ["ToolCallSummary"],
    "src/components/flow-state/tool.tsx": ["ToolInputProps", "ToolOutputProps", "ToolGroupProps", "ToolRowProps"],
    "src/lib/ask-session.ts": ["SessionCall", "SessionReply"],
    "src/lib/columns.ts": ["Column"],
    "src/lib/conversation-tasks.ts": ["ConversationTask"],
    "src/lib/conversation.ts": ["WorkerConversation"],
    "src/lib/derive.ts": ["Roster", "WorkerState", "WorkerStates", "ShiftCounts", "ShiftCoordinator"],
    "src/lib/feed-health.ts": ["ReportFeed"],
    "src/lib/first-run.ts": ["StarterDelegate"],
    "src/lib/lab-data.tsx": ["LabData"],
    "src/lib/messages.ts": ["MessageExchange"],
    "src/lib/projects.ts": ["ProjectAddress"],
    "src/lib/roster.ts": ["RosterRead"],
    "src/lib/routes.ts": ["ProjectTab", "TaskTab", "TaskGrouping", "Route"],
    "src/lib/routines.ts": ["RoutineChange"],
    "src/lib/rules.ts": ["StandingRule", "RulesRead", "RuleEditInput", "StandingRulesView"],
    "src/lib/run.ts": ["OpenRun"],
    "src/lib/task.tsx": ["RunState", "InterruptState", "TaskView"],
    "src/lib/theme.ts": ["ThemeLook"],
  },
};
