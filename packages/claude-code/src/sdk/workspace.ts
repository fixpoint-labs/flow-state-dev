/**
 * `createWorkspaceAgentCapability` — a coding run whose files are resources.
 *
 * The agent block on its own is handed a directory and left there: whatever it
 * writes stays on that disk, and nothing carries it back. This capability
 * closes both ends. Before the run, every mounted resource collection is laid
 * into the directory; after it, what changed is reconciled back, and the paths
 * that could not be settled are written where the caller can read them.
 *
 * Composed as a sequencer rather than folded into the handler, because a
 * handler calling two other blocks is the thing BP-011 names.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { getPatternPrefix, isParameterizedPattern } from "@flow-state-dev/core/types";
import type {
  BlockContext,
  JsonObject,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import {
  createHostPlace,
  createProjection,
  PlaceUnreadableError,
  type FlushOutcome,
  type Mount,
  type Projection,
} from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  claudeCodeAgent,
  runNamespace,
  type ClaudeCodeAgentOptions,
} from "./agent";
import { sdkAgentHandleSchema } from "./types";
import { WORKSPACE_OUTCOMES, workspaceResources } from "./workspace-collections";

/** The block context these callbacks see. Loose for the reasons `./agent` gives. */
type WorkspaceContext = BlockContext<any, any, any, any, any, any, any, any, any>;

/** A collection selection entry. A bare string is `{ key, writable: true }`. */
export type WorkspaceCollectionSpec = string | { key: string; writable?: boolean };

export interface WorkspaceAgentCapabilityOptions
  extends Omit<ClaudeCodeAgentOptions, "cwd"> {
  /**
   * Where the projection lands on disk, resolved once per run.
   *
   * A resolver rather than a constant, and not merely by convention: two runs
   * sharing one directory would each hydrate over the other's files and flush
   * the result back. Give each run its own.
   */
  root: (
    input: { prompt: string },
    ctx: WorkspaceContext,
  ) => string | Promise<string>;
  /**
   * Which collections to mount. Default: every collection on `ctx.resources`
   * whose pattern gives a directory to mount it at.
   */
  collections?: WorkspaceCollectionSpec[];
  /** Accessor keys to skip during auto-discovery. */
  exclude?: string[];
  /**
   * Confine the run to the workspace it was given. Default `true`.
   *
   * **This is the canonical explanation; everywhere else links here.** Three
   * settings, answering different halves of the same question.
   *
   * `settingSources: []` stops the run reading its CONFIGURATION out of the
   * workspace. A projected directory holds whatever the mounted collections
   * hold, and in an application those are written by its users — so a
   * `CLAUDE.md` or a `.claude/settings.json` among them is user input the run
   * would otherwise obey (BP-031).
   *
   * The sandbox settings are what constrain the run's WRITES. `cwd` is a
   * working directory, not a fence: absolute paths still resolve, so the
   * boundary has to be declared. `enabled: true` is the boundary, and
   * `allowUnsandboxedCommands: false` closes the escape a command can ask for
   * by itself.
   *
   * `filesystem.allowWrite` is ADDITIVE, not a fence — the SDK's own types
   * call it "additional paths to allow writing within the sandbox", merged
   * with the paths its permission rules already allow. Naming the root here
   * adds it to what the run may write, which it needs because the root is not
   * the process's own directory. It does not narrow anything, and reading it
   * as the boundary would credit it with work `enabled` is doing.
   *
   * And `disallowedTools` takes away the tools that would move the run OUT of
   * the workspace — see {@link RELOCATION_TOOLS}. A confined directory the run
   * has already left is not a boundary.
   *
   * Setting `settingSources` or `sandbox` explicitly wins over the default —
   * containment is a default, not a lock. `disallowedTools` merges instead, so
   * a caller adding their own does not silently take the relocation ones away.
   * `contain: false` turns all three off, which is what a trusted-workspace
   * deployment wants and what nothing else should.
   */
  contain?: boolean;
  /** Block name. Default `"workspace-agent"`. */
  name?: string;
}

/**
 * Projections in flight, keyed by the id their chain is carrying.
 *
 * Module-level because hydrate and flush are separate blocks in one chain and
 * have nowhere else to meet, and a projection is not serialisable state.
 *
 * **Keyed by an id in SEQUENCER state, not by `runNamespace`.** That was the
 * first shape and it does not work: `runNamespace` identifies one block
 * INVOCATION — its `blockPath` comes from the block tree — so hydrate, the
 * agent, and flush each compute a different key and none of them finds what
 * the previous one left. The chain's own state is the thing all three steps
 * share, and it is per invocation of the chain, which is exactly the scope a
 * workspace has. The request id alone would be too coarse: a generator holding
 * this as a tool can call it several times in one request, and each call is a
 * separate workspace.
 *
 * The entry carries the root too, and that is what makes the one-directory
 * invariant structural rather than a promise. The agent's `cwd` and the
 * sandbox's `allowWrite` both READ this value instead of calling the resolver
 * again — a resolver that mints a directory (`mkdtemp`) returns a different one
 * each call, so two reads would hand the run one directory and confine it to
 * another.
 */
const openWorkspaces = new Map<string, { projection: Projection; root: string }>();

/** State the chain carries so its three steps address one workspace. */
const workspaceSequencerState = z.object({
  /** Key into `openWorkspaces`. Minted by hydrate, read by the other two. */
  workspaceId: z.string().nullable().default(null),
  /** The resolved root, so a reader needs no map lookup to answer `cwd`. */
  root: z.string().nullable().default(null),
});

let nextWorkspaceId = 0;


/** Duck-type check: is this entry on `ctx.resources` a collection ref? */
function isCollectionRef(value: unknown): value is ResourceCollectionRef<JsonObject> {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pattern === "string" && typeof v.list === "function";
}

const normalizeSpec = (spec: WorkspaceCollectionSpec) =>
  typeof spec === "string" ? { key: spec } : spec;

/**
 * Every collection on the block context that can be mounted somewhere.
 *
 * Deliberately its own copy of the shape the bash tool discovers with, rather
 * than a shared helper: the two read different context surfaces today, and
 * converging them belongs with the change that touches both consumers. Named
 * here so that change knows where to look.
 */
export function discoverMountsForTest(
  ctx: WorkspaceContext,
  explicit?: WorkspaceCollectionSpec[],
  exclude?: string[],
): Mount[] {
  return discoverMounts(ctx, explicit, exclude);
}

function discoverMounts(
  ctx: WorkspaceContext,
  explicit: WorkspaceCollectionSpec[] | undefined,
  exclude: string[] | undefined,
): Mount[] {
  const excluded = new Set(exclude ?? []);
  const wanted = explicit
    ? new Map(explicit.map((s) => [normalizeSpec(s).key, normalizeSpec(s)]))
    : undefined;
  const mounts: Mount[] = [];
  const bag = (ctx as { resources?: Record<string, unknown> }).resources;
  if (bag === undefined || typeof bag !== "object") return mounts;

  for (const [key, value] of Object.entries(bag)) {
    if (typeof value === "function") continue;
    // The run's own outcome log is not part of its workspace. Projecting it
    // would lay this run's conflicts into the directory as files, and the next
    // flush would read them back as the run's work.
    if (key === WORKSPACE_OUTCOMES) continue;
    if (wanted ? !wanted.has(key) : excluded.has(key)) continue;
    if (!isCollectionRef(value)) continue;
    // An external collection answers the duck-type — it has a `pattern` and a
    // `list` — and is not projectable through either. Its `list` is paged, so
    // hydrate's `for (const entry of await list())` throws before the run
    // starts, and it carries no mutators for a writable mount to flush
    // through. The brand is what separates them; the shape does not.
    if ((value as { external?: unknown }).external === true) {
      console.warn(
        `[workspace-agent] collection "${key}" is external and read-through, so it cannot be projected into a directory — skipped.`,
      );
      continue;
    }
    const prefix = getPatternPrefix(value.pattern);
    if (!prefix) continue;
    // A parameterized pattern's prefix stops at the first parameter, so
    // `data/[topic]/observations` mounts at `data` and its entries come back
    // addressed as `react/observations`. Core requires an object key for those
    // patterns, so the flush's `getOptional` throws on the string and the run
    // finishes having saved nothing. Skipped until a mount can carry the
    // parameters it would need to address them.
    if (isParameterizedPattern(value.pattern)) {
      console.warn(
        `[workspace-agent] collection "${key}" has parameterized pattern "${value.pattern}", whose entries cannot be addressed from a directory path — skipped.`,
      );
      continue;
    }
    mounts.push({
      prefix,
      collection: value as unknown as Mount["collection"],
      writable: wanted?.get(key)?.writable ?? true,
    });
  }
  return mounts;
}

/**
 * Tools that move a run out of the directory it was given.
 *
 * The SDK's worktree machinery relocates a run mid-flight, and only ever
 * because the MODEL asked for it. A projection that hydrated one directory and
 * flushes it afterwards would be reconciling a tree the run had already left —
 * nothing throws, the workspace is simply the wrong one.
 *
 * `disallowedTools` is the right lever rather than an allowlist: the SDK
 * documents it as removing the tools from the model's context entirely, so
 * they cannot be used "even if they would otherwise be allowed". An allowlist
 * would mean naming every tool a projected run may use, and silently removing
 * whatever the list forgot.
 */
export const RELOCATION_TOOLS = ["EnterWorktree", "ExitWorktree"] as const;

/**
 * A directory's physical path — symlinks resolved, created if it does not
 * exist yet.
 *
 * The agent resolves `cwd` through `realpath` before handing it to the SDK, so
 * a root that is a symlink means the process works in one path while anything
 * naming the unresolved spelling describes another. `filesystem.allowWrite`
 * naming the wrong one grants the run write access to a directory it is not
 * in, and grants nothing where it is — and macOS `/tmp` is a symlink, which
 * makes that the ordinary case there rather than an exotic one.
 *
 * Resolving here, once, is what keeps the three readers — the place, `cwd` and
 * the sandbox — on one answer. `realpath` needs the directory to exist, hence
 * the `mkdir`; `createHostPlace` would have made it a moment later anyway.
 */
function physicalPath(root: string): string {
  const absolute = resolve(root);
  mkdirSync(absolute, { recursive: true });
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * The sandbox settings for a run working in `root`. See `contain`.
 *
 * `enabled` and `allowUnsandboxedCommands: false` are the constraint;
 * `allowWrite` adds the root to what the run may write, because the root is
 * not the directory the process itself is in. It is additive, not a fence.
 */
export function containmentSandbox(root: string) {
  return {
    enabled: true,
    // A command asking to run unsandboxed is asking for the boundary to be
    // lifted. Refusing here is what makes it a boundary rather than a default
    // the run can talk its way out of.
    allowUnsandboxedCommands: false,
    filesystem: { allowWrite: [root] },
  };
}

/**
 * Create the workspace-agent capability.
 *
 * Every `claudeCodeAgent` option is forwarded except `cwd`, which this
 * capability owns: the directory is the projection's, and a caller setting it
 * would point the run at a tree the projection never filled.
 */
export function createWorkspaceAgentCapability(
  options: WorkspaceAgentCapabilityOptions,
) {
  const {
    root: resolveRoot,
    collections,
    exclude,
    contain = true,
    name = "workspace-agent",
    ...agentOptions
  } = options;

  const rootFor = (ctx: WorkspaceContext): string => {
    const root = (ctx.sequencer?.state as { root?: string | null } | undefined)?.root;
    if (typeof root !== "string" || root === "") {
      throw new Error(
        "[workspace-agent] no workspace is open for this run — the agent block ran without its hydrate step. It is only usable inside the sequencer this capability builds.",
      );
    }
    return root;
  };

  const hydrateWorkspace = handler({
    name: `${name}-hydrate`,
    description: "Lay the mounted collections into the run's workspace directory.",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async (input, ctx) => {
      // Resolved ONCE, here, and read from the chain's state everywhere else.
      const root = physicalPath(await resolveRoot(input, ctx as WorkspaceContext));
      const projection = createProjection({
        place: createHostPlace(root),
        mounts: discoverMounts(ctx as WorkspaceContext, collections, exclude),
      });
      const workspaceId = `${runNamespace(ctx as BlockContext)}#${nextWorkspaceId++}`;
      await (ctx as WorkspaceContext).sequencer!.patchState({
        workspaceId,
        root,
      } as never);
      await projection.hydrate();
      // Registered only once hydrate has succeeded. `reconcile` is reached
      // through the agent's `onErrored` and through the tap after it, and this
      // step runs BEFORE both — so a projection registered ahead of a hydrate
      // that throws is one nothing will ever come back for. On a long-lived
      // server that is a projection and a baseline retained per failed
      // attempt.
      openWorkspaces.set(workspaceId, { projection, root });
    },
  });

  /**
   * Reconcile the run's workspace, once.
   *
   * Called from two places — the flush tap on the way out, and the sequencer's
   * `onErrored` when something threw — because a `.tap()` after a step does
   * NOT run when that step fails. Without the second caller a failed run left
   * its projection and baseline resident forever AND never carried its files
   * back, which is the worse half: the run did work and the work went nowhere.
   *
   * The registry entry is the "already handled" flag. It is removed before the
   * flush, so whichever caller arrives first does the work and the other
   * returns immediately.
   */
  const reconcile = async (ctx: WorkspaceContext): Promise<void> => {
      const key = (ctx.sequencer?.state as { workspaceId?: string | null } | undefined)
        ?.workspaceId;
      if (typeof key !== "string") return;
      const entry = openWorkspaces.get(key);
      if (entry === undefined) return;
      // Removed before the flush, not after. A flush that throws still ends
      // this run's ownership of the directory; leaving the entry would let a
      // later block in the same run flush a projection whose place is gone.
      openWorkspaces.delete(key);

      let outcomes: readonly FlushOutcome[];
      try {
        outcomes = (await entry.projection.flush()).outcomes;
      } catch (err) {
        // One failure is reported rather than rethrown into a run that has
        // otherwise finished its work: the projection refused to decide
        // anything because it could not read the directory, which is the whole
        // point of it throwing, and the run's files are still on disk.
        //
        // Every other rejection is the opposite and must reach the caller. A
        // collection read, write or delete that failed is the run's work NOT
        // reaching the store, and swallowing it hands back a successful run
        // whose new file exists only in a directory about to be thrown away.
        if (!(err instanceof PlaceUnreadableError)) throw err;
        await ctx.emit.status(
          `Workspace could not be read at the end of this run, so nothing was saved back: ${err.message}`,
        );
        return;
      }

      const unsettled = outcomes.filter(
        (o) => o.kind === "orphan" || o.kind === "conflict" || o.kind === "contested",
      );
      if (unsettled.length === 0) return;

      const at = Date.now();
      const log = (ctx as { resources: Record<string, any> }).resources[
        WORKSPACE_OUTCOMES
      ];
      for (const outcome of unsettled) {
        const state =
          outcome.kind === "conflict"
            ? {
                kind: "conflict" as const,
                path: outcome.path,
                base: outcome.base,
                theirs: outcome.theirs,
                ours: outcome.ours,
                at,
              }
            : {
                // `outcome.kind` rather than a literal: orphan and contested
                // share this shape — neither carries hashes — but they are not
                // the same row, and writing one of them under the other's name
                // is how a reader learns the wrong fix.
                kind: outcome.kind,
                path: outcome.path,
                base: null,
                theirs: null,
                ours: null,
                at,
              };
        const ref = await log.getOrCreate(`${key}/${outcome.path}`, state);
        await ref.patchState(state);
      }

      const conflicts = unsettled.filter((o) => o.kind === "conflict").length;
      const contested = unsettled.filter((o) => o.kind === "contested");
      const orphans = unsettled.length - conflicts - contested.length;
      await ctx.emit.status(
        [
          conflicts > 0
            ? `${conflicts} file(s) changed elsewhere while this run held them and were not overwritten`
            : null,
          // The paths themselves, not just a count: the fix for a contested
          // path is to stop two runs sharing it, and you cannot do that
          // without knowing which one they share.
          contested.length > 0
            ? `${contested.length} file(s) are being written by another run and were not overwritten: ${contested
                .map((o) => o.path)
                .join(", ")}`
            : null,
          orphans > 0
            ? `${orphans} file(s) written outside every mounted collection and not saved`
            : null,
        ]
          .filter(Boolean)
          .join("; "),
      );
  };

  const flushWorkspace = handler({
    name: `${name}-flush`,
    description: "Reconcile the run's workspace back into its collections.",
    inputSchema: z.any(),
    resources: workspaceResources,
    execute: async (_input: unknown, ctx) => {
      await reconcile(ctx as WorkspaceContext);
    },
  });

  const agent = claudeCodeAgent({
    ...agentOptions,
    // The failure path. A `.tap()` after a step does not run when that step
    // throws, so this is the only hook that fires when the run itself fails —
    // and a sequencer takes no lifecycle hooks, which is why it lives on the
    // agent block rather than the chain. Composed with a caller's own hook
    // rather than replacing it.
    onErrored: async (error, ctx) => {
      await reconcile(ctx as WorkspaceContext);
      await agentOptions.onErrored?.(error, ctx);
    },
    // Owned by this capability: the directory is the projection's, and it is
    // READ from the registry rather than re-resolved. See `openWorkspaces`.
    cwd: (_input, ctx) => rootFor(ctx as WorkspaceContext),
    ...(contain
      ? {
          // An explicit setting wins. Containment is a default, not a lock.
          settingSources: agentOptions.settingSources ?? [],
          // Merged, not replaced: a caller disallowing tools of their own
          // should not have to remember to re-add these, and re-adding them is
          // what an override would silently make them responsible for.
          disallowedTools: [
            ...new Set([...(agentOptions.disallowedTools ?? []), ...RELOCATION_TOOLS]),
          ],
          sandbox:
            agentOptions.sandbox ??
            ((_input: { prompt: string }, ctx: WorkspaceContext) =>
              containmentSandbox(rootFor(ctx))),
        }
      : {}),
  });

  const workspaceAgent = sequencer({
    name,
    description:
      "Run the Claude Code Agent SDK against a workspace projected from resource collections, and reconcile what it changed back into them.",
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: sdkAgentHandleSchema,
    stateSchema: workspaceSequencerState,
  })
    .tap(hydrateWorkspace)
    .step(agent)
    .tap(flushWorkspace);

  return defineCapability({
    name,
    // Declared HERE, not inherited from the blocks below. A capability's
    // `tools` do not carry resource declarations up to the flow — see
    // `./capability` for the full account of that seam.
    resources: workspaceResources,
    presets: {
      tools: { tools: [workspaceAgent] },
      default: ["tools"],
    },
  });
}
