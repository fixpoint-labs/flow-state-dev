/**
 * DevTool context — owns the flow-API clients and the WORKSPACE the panel is
 * looking at. The provider is parametrised so the same panel works in two
 * environments:
 *
 *  - The standalone `fsdev dev` shell, which reads/writes userId in
 *    localStorage and runs an interrupted-request sweep on mount.
 *  - Embedded hosts (e.g. kitchen-sink) where the host owns the userId,
 *    no localStorage write happens, and the recovery sweep is skipped by
 *    default to avoid surprising side effects.
 *
 * ## One workspace, one transition
 *
 * A workspace is an exact flow INSTANCE plus the session open under it. The two
 * are one value, changed together, because every way they could disagree is a
 * defect the operator sees: instance B showing A's session, a request addressed
 * to the copy that was open a moment ago, an approval landing in a workspace the
 * operator has left. Selection therefore lives here and moves atomically —
 * callers pick a workspace, they do not update two unrelated pieces of state.
 *
 * ## The visit token
 *
 * Every transition bumps `workspaceToken`, and reads fence on it (see
 * `hooks/use-workspace-fence.ts`). Comparing the instance and session alone is
 * not enough: switching A → B → A restores a tuple that a retired callback also
 * holds, so its late result would agree and install itself under a workspace the
 * operator has since re-entered. A token cannot come back, so a visit that ends
 * ends irreversibly. It is bumped on a credential/client change too — the same
 * ids under a different identity are a different workspace.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Client, FlowListEntry, RecoveryClient, SessionClient } from "@flow-state-dev/client";
import {
  createDevToolClient,
  createDevToolRecoveryClient,
  createDevToolSessionClient,
  type DevToolConfig,
} from "../lib/client";
import { isConclusiveRefusal, recordBelongsTo } from "../lib/instance-ownership";
import {
  clearLegacySingletonSessionHint,
  readLegacySingletonSessionHint,
  readSessionHint,
  writeSessionHint,
  writeUserId,
  type SessionHintScope,
} from "../config";

/** Whether the SettingsSheet exposes the userId editor. */
export type UserIdControl = "host" | "internal";

type DevToolState = {
  config: DevToolConfig;
  client: Client;
  sessionClient: SessionClient;
  recoveryClient: RecoveryClient;
  /** The EXACT instance id the workspace is on. Never a kind. */
  activeFlowId: string | null;
  activeSessionId: string | null;
  /** Bumped on every workspace transition; see the header. */
  workspaceToken: number;
  flows: FlowListEntry[];
  flowsLoading: boolean;
  flowsError: string | null;
};

type Action =
  | { type: "SET_CONFIG"; config: DevToolConfig; baseUrl: string | undefined }
  | { type: "SYNC_EXTERNAL_CONFIG"; config: DevToolConfig; baseUrl: string | undefined }
  | { type: "SELECT_INSTANCE"; flowId: string | null }
  | { type: "SELECT_SESSION"; sessionId: string | null }
  | { type: "SELECT_WORKSPACE"; flowId: string; sessionId: string }
  | { type: "SET_FLOWS"; flows: FlowListEntry[] }
  | { type: "SET_FLOWS_LOADING"; loading: boolean }
  | { type: "SET_FLOWS_ERROR"; error: string | null };

function buildClients(config: DevToolConfig, baseUrl: string | undefined) {
  return {
    client: createDevToolClient(config, baseUrl),
    sessionClient: createDevToolSessionClient(baseUrl, config.bearerToken),
    recoveryClient: createDevToolRecoveryClient(baseUrl, config.bearerToken),
  };
}

/**
 * Apply a rebuilt client set.
 *
 * The token bump is the point: the clients in flight belonged to the previous
 * credentials, so whatever they return is no longer this workspace's. A userId
 * change also drops the open session — it belongs to the operator who was
 * signed in, and re-reading it under a new identity would either be refused or,
 * worse, quietly show one operator's conversation to another.
 */
function withClients(
  state: DevToolState,
  config: DevToolConfig,
  baseUrl: string | undefined,
): DevToolState {
  const userChanged = config.userId !== state.config.userId;
  return {
    ...state,
    config,
    ...buildClients(config, baseUrl),
    activeSessionId: userChanged ? null : state.activeSessionId,
    workspaceToken: state.workspaceToken + 1,
  };
}

function reducer(state: DevToolState, action: Action): DevToolState {
  switch (action.type) {
    case "SET_CONFIG":
      return withClients(state, action.config, action.baseUrl);
    case "SYNC_EXTERNAL_CONFIG": {
      // External prop sync (standalone-shell focus re-read, or a host swapping
      // identity). Take the prop's userId, but keep the current bearer token
      // when the prop asserts none: the ad-hoc token set via the Settings sheet
      // lives only here (it's a credential we never persist to localStorage), so
      // a userId-only prop change carrying `bearerToken: undefined` must not
      // clobber it. A prop that DOES carry a token (an injected or host token)
      // is authoritative and replaces. `setConfig` keeps its exact-set path, so
      // clearing the token in Settings still works.
      const config: DevToolConfig = {
        ...action.config,
        bearerToken: action.config.bearerToken ?? state.config.bearerToken,
      };
      return withClients(state, config, action.baseUrl);
    }
    case "SELECT_INSTANCE":
      // Selecting or collapsing an instance ends the session under it. Carrying
      // the session across would address it to whichever copy is now open.
      return {
        ...state,
        activeFlowId: action.flowId,
        activeSessionId: null,
        workspaceToken: state.workspaceToken + 1,
      };
    case "SELECT_SESSION":
      return {
        ...state,
        activeSessionId: action.sessionId,
        workspaceToken: state.workspaceToken + 1,
      };
    case "SELECT_WORKSPACE":
      // Both at once — the ChildSession case, where the child may be owned by a
      // different instance than the one on screen. Two sequential updates would
      // leave a render with the new session under the old owner.
      return {
        ...state,
        activeFlowId: action.flowId,
        activeSessionId: action.sessionId,
        workspaceToken: state.workspaceToken + 1,
      };
    case "SET_FLOWS": {
      const next = { ...state, flows: action.flows, flowsLoading: false, flowsError: null };
      if (state.activeFlowId === null) return next;
      // The selected copy is gone from the catalog. There is no same-kind peer
      // to fall back to — a peer is a different instance with different work —
      // so the workspace empties and waits for a fresh pick.
      if (action.flows.some((flow) => flow.id === state.activeFlowId)) return next;
      return {
        ...next,
        activeFlowId: null,
        activeSessionId: null,
        workspaceToken: state.workspaceToken + 1,
      };
    }
    case "SET_FLOWS_LOADING":
      return { ...state, flowsLoading: action.loading };
    case "SET_FLOWS_ERROR":
      return { ...state, flowsError: action.error, flowsLoading: false };
    default:
      return state;
  }
}

type DevToolContextValue = DevToolState & {
  baseUrl: string | undefined;
  userIdControl: UserIdControl;
  /**
   * Whether interrupted-request sweeps (mount-time and request-row refresh)
   * are enabled. Off by default so embedded panels don't mutate stale
   * `in_progress` rows as a side effect of merely opening a session.
   */
  autoRecoverInterrupted: boolean;
  /** The catalog entry for `activeFlowId`, or `undefined` when nothing is selected. */
  activeFlow: FlowListEntry | undefined;
  dispatch: React.Dispatch<Action>;
  refreshFlows: () => Promise<void>;
  setConfig: (config: DevToolConfig) => void;
  /** Open (or, with `null`, collapse) an instance. Ends any session under it. */
  selectInstance: (flowId: string | null) => void;
  /** Open a session under the instance already selected. */
  selectSession: (sessionId: string | null) => void;
  /** Move instance and session together — following a child into its owner. */
  selectWorkspace: (flowId: string, sessionId: string) => void;
};

const DevToolContext = createContext<DevToolContextValue | null>(null);

function createInitialState(initialConfig: DevToolConfig, baseUrl: string | undefined): DevToolState {
  return {
    config: initialConfig,
    ...buildClients(initialConfig, baseUrl),
    activeFlowId: null,
    activeSessionId: null,
    workspaceToken: 0,
    flows: [],
    flowsLoading: false,
    flowsError: null,
  };
}

export type DevToolProviderProps = {
  /** Initial DevTool config. Required — parent (panel or shell) constructs it. */
  initialConfig: DevToolConfig;
  /** Optional API base URL forwarded to all flow-API clients. */
  baseUrl?: string;
  /** When true, sweeps interrupted requests on mount. Default false (embedded-safe). */
  autoRecoverInterrupted?: boolean;
  /** When "host", SettingsSheet hides the userId field. Default "internal". */
  userIdControl?: UserIdControl;
  children: ReactNode;
};

export function DevToolProvider({
  initialConfig,
  baseUrl,
  autoRecoverInterrupted = false,
  userIdControl = "internal",
  children,
}: DevToolProviderProps) {
  const [state, dispatch] = useReducer(reducer, null, () =>
    createInitialState(initialConfig, baseUrl),
  );

  const activeFlow = useMemo(
    () => state.flows.find((flow) => flow.id === state.activeFlowId),
    [state.flows, state.activeFlowId],
  );

  const refreshFlows = useCallback(async () => {
    dispatch({ type: "SET_FLOWS_LOADING", loading: true });
    dispatch({ type: "SET_FLOWS_ERROR", error: null });
    try {
      const flows = await state.client.listFlows();
      dispatch({ type: "SET_FLOWS", flows });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch flows";
      dispatch({ type: "SET_FLOWS_ERROR", error: message });
    }
  }, [state.client]);

  const setConfig = useCallback(
    (config: DevToolConfig) => {
      // Only the standalone shell persists userId to localStorage. When the
      // host owns the identity, treat `setConfig` as in-memory only so we
      // don't pollute the host app's storage.
      if (userIdControl === "internal") {
        writeUserId(config.userId);
      }
      dispatch({ type: "SET_CONFIG", config, baseUrl });
    },
    [userIdControl, baseUrl],
  );

  const selectInstance = useCallback((flowId: string | null) => {
    dispatch({ type: "SELECT_INSTANCE", flowId });
  }, []);

  // The hint is written where the pick happens, not in the reducer: which
  // instance a session was opened under is exactly what the key needs, and a
  // reducer has no business touching localStorage.
  const rememberSession = useCallback(
    (flowId: string | null, sessionId: string | null) => {
      if (flowId === null) return;
      writeSessionHint({ baseUrl, userId: state.config.userId, flowId }, sessionId);
    },
    [baseUrl, state.config.userId],
  );

  const selectSession = useCallback(
    (sessionId: string | null) => {
      rememberSession(state.activeFlowId, sessionId);
      dispatch({ type: "SELECT_SESSION", sessionId });
    },
    [rememberSession, state.activeFlowId],
  );

  const selectWorkspace = useCallback(
    (flowId: string, sessionId: string) => {
      rememberSession(flowId, sessionId);
      dispatch({ type: "SELECT_WORKSPACE", flowId, sessionId });
    },
    [rememberSession],
  );

  useEffect(() => {
    void refreshFlows();
  }, [refreshFlows]);

  // Restore a saved session for the instance just opened — but only after the
  // server agrees it belongs there.
  //
  // A hint is a convenience, and the failure it must not have is offering one
  // copy's session under another. So nothing is installed on the strength of a
  // stored string: the session is read, its admitted owner is compared against
  // the selected instance, and only then does it become the workspace. Nothing
  // renders under it in the meantime, because nothing has been installed.
  //
  // Attempts are recorded per (instance, client, user) so a hint that fails
  // validation is not retried in a loop. A real change to any of those is a new
  // question and gets a fresh attempt.
  const restoreAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    const instance = activeFlow;
    if (instance === undefined || state.activeSessionId !== null) return;
    // Joined on a separator no instance id or user id can contain, so two
    // different attempts cannot spell the same key. Written as the `\0` ESCAPE,
    // never as a literal NUL byte: git sniffs a file's first 8000 bytes for one
    // and renders the whole file as "Binary files differ" if it finds it, which
    // would ship a change with no reviewable diff (`scripts/validate-no-nul-bytes.mjs`).
    const attempt = `${instance.id}\0${state.config.userId}\0${state.workspaceToken}`;
    if (restoreAttemptRef.current === attempt) return;
    restoreAttemptRef.current = attempt;

    const scope: SessionHintScope = { baseUrl, userId: state.config.userId, flowId: instance.id };
    const scoped = readSessionHint(scope);
    // A singleton has exactly one possible owner, so an older kind-keyed hint
    // can be offered for it. A collection member's kind names its whole family,
    // so no legacy hint is ever offered there.
    const legacy =
      scoped === null && instance.cardinality === "singleton"
        ? readLegacySingletonSessionHint(instance.id)
        : null;
    const hint = scoped ?? legacy;
    if (hint === null) return;

    const sessionClient = state.sessionClient;
    void (async () => {
      // Three outcomes, not two. A hint is only DISCARDED on a conclusive
      // answer — the session is genuinely not this copy's, or genuinely not
      // there. Anything indeterminate (a 5xx, a dropped connection, a
      // credential that may refresh) leaves it alone and tries again next
      // time, because the two mistakes are not symmetric: wrongly keeping a
      // hint costs one failed restore that revalidates on the next attempt,
      // and wrongly deleting one is unrecoverable — a single blip would
      // silently turn off session restore for that operator, on every reload
      // afterwards, with nothing on screen to say why.
      let verdict: "owned" | "foreign" | "indeterminate";
      try {
        const detail = await sessionClient.getSession(hint);
        verdict =
          recordBelongsTo(detail, instance) && detail.userId === state.config.userId
            ? "owned"
            : "foreign";
      } catch (err) {
        verdict = isConclusiveRefusal(err) ? "foreign" : "indeterminate";
      }
      if (verdict === "indeterminate") return;
      if (verdict === "foreign") {
        if (scoped !== null) writeSessionHint(scope, null);
        if (legacy !== null) clearLegacySingletonSessionHint(instance.id);
        return;
      }
      // The workspace may have moved while the read was in flight. Installing
      // now would open a session under whichever copy is on screen instead.
      if (restoreAttemptRef.current !== attempt) return;
      if (legacy !== null) writeSessionHint(scope, hint);
      dispatch({ type: "SELECT_SESSION", sessionId: hint });
    })();
  }, [
    activeFlow,
    baseUrl,
    state.activeSessionId,
    state.config.userId,
    state.sessionClient,
    state.workspaceToken,
  ]);

  // Propagate EXTERNAL config changes (a new `initialConfig`/`baseUrl` prop from
  // the standalone shell's focus re-read or a host swapping identity/token) into
  // state. `initialConfig` is memoized by the parent on `[userId, bearerToken]`,
  // so its identity changes only on a real prop change — dispatch on that. We
  // deliberately do NOT key off `state.config`: an in-panel Settings edit mutates
  // `state.config` via `setConfig`, not the prop, so keying off it would revert
  // the operator's edit back to the prop on the next run. The ref skips the
  // redundant mount run (the reducer already seeded from `initialConfig`) and
  // keeps this comparing values, not firing on identity alone (BP-010).
  //
  // Dispatch the SYNC_EXTERNAL_CONFIG merge (not SET_CONFIG): a focus re-read
  // that changes only userId still carries `bearerToken: undefined` from the
  // prop layer (the token is never persisted), so a plain SET_CONFIG would drop
  // an ad-hoc Settings token on alt-tab. The merge keeps it.
  const lastApplied = useRef({ config: initialConfig, baseUrl });
  useEffect(() => {
    if (
      lastApplied.current.config === initialConfig &&
      lastApplied.current.baseUrl === baseUrl
    ) {
      return;
    }
    lastApplied.current = { config: initialConfig, baseUrl };
    dispatch({ type: "SYNC_EXTERNAL_CONFIG", config: initialConfig, baseUrl });
  }, [initialConfig, baseUrl]);

  // Sweep interrupted requests for the current user once on devtool mount.
  // Off by default for embedded panels — the host app may not want a panel
  // mount to mutate request state. The standalone shell opts in.
  useEffect(() => {
    if (!autoRecoverInterrupted) return;
    const userId = state.config.userId;
    if (userId.trim().length === 0) return;
    void state.recoveryClient.checkInterrupted({ userId }).catch((err) => {
      console.warn("[devtool] checkInterrupted failed", err);
    });
  }, [autoRecoverInterrupted, state.recoveryClient, state.config.userId]);

  const value = useMemo(
    () => ({
      ...state,
      baseUrl,
      userIdControl,
      autoRecoverInterrupted,
      activeFlow,
      dispatch,
      refreshFlows,
      setConfig,
      selectInstance,
      selectSession,
      selectWorkspace,
    }),
    [
      state,
      baseUrl,
      userIdControl,
      autoRecoverInterrupted,
      activeFlow,
      dispatch,
      refreshFlows,
      setConfig,
      selectInstance,
      selectSession,
      selectWorkspace,
    ],
  );

  return <DevToolContext.Provider value={value}>{children}</DevToolContext.Provider>;
}

export function useDevTool(): DevToolContextValue {
  const ctx = useContext(DevToolContext);
  if (!ctx) {
    throw new Error("useDevTool must be used within DevToolProvider");
  }
  return ctx;
}
