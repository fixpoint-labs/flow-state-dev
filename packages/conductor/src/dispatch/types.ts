/**
 * The dispatcher seam — layer 3, the coding harness.
 *
 * Conductor decides *which* phase and *which* gate; the vendor harness decides
 * *how* the work inside a phase actually gets done. This file is the whole
 * contract between them, and it is deliberately vendor-neutral: Claude Code is
 * the first implementation, Codex and Cursor are expected, and nothing
 * Claude-shaped may appear here. If a field only makes sense for one vendor, it
 * belongs in that vendor's options object, not in this file.
 *
 * Two rules the seam depends on:
 *
 * - **A dispatcher declares its isolation model; conductor provisions to match.**
 *   A local CLI runs in a directory, so conductor cuts a worktree and points it
 *   there. A cloud dispatch runs in the vendor's own environment, so conductor
 *   supplies a branch name and manages no local tree at all. The dispatcher does
 *   not create workspaces and conductor does not guess what one needs.
 * - **`run` settles; it does not throw.** A vendor that crashed, timed out, or
 *   was never installed returns `outcome: "failed"` with a reason. The tick
 *   turns that into a `dispatch_failed` signal, which `decide` escalates — a
 *   thrown exception would bypass the ledger and lose the transition.
 */

import type { DispatchAction } from "../model/actions";
import type { EntityKind, Phase } from "../model/phases";

/**
 * What a dispatcher needs provisioned before it can run.
 *
 * - `worktree` — a dedicated git worktree, on the phase's branch. The dispatcher
 *   runs in it and nothing else does, so parallel phases never collide.
 * - `cwd` — the repo root as it stands. Cheaper, and only safe when one dispatch
 *   runs at a time.
 * - `remote` — the vendor's own environment. Conductor manages no local tree and
 *   supplies only the branch name.
 */
export type IsolationModel = "worktree" | "cwd" | "remote";

/**
 * What conductor tells a dispatcher to do.
 *
 * Everything a vendor harness needs and nothing about how it works. `action` is
 * the work; `branch` and `workspacePath` are where it happens; `guidancePaths`
 * are the repo files the harness should read for *this* phase (scoping, not
 * exposure — a retrospective does not need every objective); `because` is the
 * context carried verbatim from the {@link DispatchAction} that produced it.
 */
export interface PhaseBrief {
  /**
   * Correlates this dispatch with the signal that settles it and with the
   * `dispatches/<id>` record. Assigned by conductor, opaque to the vendor.
   */
  readonly dispatchId: string;
  readonly entityId: string;
  readonly entityKind: EntityKind;
  /** The phase the entity is in — what stage of the process this work belongs to. */
  readonly phase: Phase;
  /** The work to do, straight off the action `decide` produced. */
  readonly action: DispatchAction["kind"];
  /**
   * The branch the work belongs on, per conductor's branch policy (see
   * `./branch`). `null` for a phase that produces no branch.
   */
  readonly branch: string | null;
  /**
   * Absolute directory the dispatch runs in, provisioned to match the
   * dispatcher's declared isolation. `null` for a `remote` dispatcher, which
   * runs in the vendor's environment and gets only the branch.
   */
  readonly workspacePath: string | null;
  /** Repo-relative guidance paths the harness should read for this phase. */
  readonly guidancePaths: readonly string[];
  /**
   * The command that will prove this work item's goal, or `null` when the
   * project declares none.
   *
   * **Outward only.** It is here so an agent can run the same check conductor
   * will run and stop when it passes, rather than handing back work it could
   * have known was unfinished. It is *not* a channel: conductor reads the
   * command from its own configuration every time, nothing reads a brief back,
   * and {@link DispatchResult} has nowhere to name a command — so a harness
   * cannot influence what runs, and a verdict still comes only from an exit
   * status conductor itself observed.
   */
  readonly goalCommand: readonly string[] | null;
  /** What prompted this dispatch, carried from the action. `null` on phase entry. */
  readonly because: string | null;
  /**
   * What the work item asks for, in plain language. `null` when conductor holds
   * no description — M0's issue record carries only an id, so this is populated
   * by whichever connector knows the issue's title.
   */
  readonly summary: string | null;
}

/**
 * What a dispatch left behind.
 *
 * Every field is optional because vendors report different amounts. A harness
 * that pushed a branch and opened a PR itself can say so; one that only pushed
 * reports the branch and conductor learns the PR from GitHub on the next read.
 * **Absent never means "nothing happened"** — it means the vendor did not say,
 * and the structural read is the authority regardless.
 */
export interface DispatchProduced {
  /** Branch the dispatch pushed. */
  readonly branch?: string;
  /** PR the dispatch opened or updated, when the vendor opened it itself. */
  readonly pullNumber?: number;
  /** Repo-relative path of a file the dispatch wrote, for a file-hosted artifact. */
  readonly artifactPath?: string;
}

/**
 * What a dispatch settled to. Maps one-to-one onto the `dispatches/<id>`
 * record — `vendor` comes from the {@link Dispatcher}, everything else from here.
 */
export interface DispatchResult {
  /** Echoes {@link PhaseBrief.dispatchId}, so a result is attributable out of order. */
  readonly dispatchId: string;
  readonly outcome: "completed" | "failed";
  readonly produced: DispatchProduced;
  /** Vendor-reported cost in USD. `null` when the vendor reports none. */
  readonly costUsd: number | null;
  /** The vendor's own run/session identifier, for a human to open. `null` when none. */
  readonly vendorRunId: string | null;
  /** Why it failed, in plain terms. `null` when it completed. */
  readonly error: string | null;
  /**
   * What the dispatch proved about the work item's goal, when it ran the check.
   *
   * **Absent means the dispatch made no claim** — the same rule
   * {@link DispatchProduced} holds, and here it is the whole point. `outcome`
   * cannot answer this question in either direction: `"completed"` means the
   * harness settled, so an agent that ran the check, found the goal unmet and
   * said so still reports a completion, and reading that as a pass would rubber
   * stamp the one gate whose entire job is proving the work. `"failed"` means
   * the harness crashed, timed out, or was never given a workspace, and reading
   * *that* as a failed goal reports a broken vendor as "the change did not do
   * what the issue asked". So the verdict is its own field, and a dispatcher
   * that cannot produce one structurally omits it rather than guessing.
   *
   * **It must come from something with an exit status, never from the agent's
   * prose.** A model may produce a signal and may never produce an action; a
   * verdict read out of a final message is a model deciding a merge gate.
   */
  readonly goalCheck?: "passed" | "failed";
  readonly startedAt: string;
  readonly settledAt: string;
}

/**
 * A coding harness conductor can hand a phase to.
 *
 * Implementations must settle rather than throw (see the file header), and must
 * treat `brief.workspacePath` as the only place they may write.
 */
export interface Dispatcher {
  /** Vendor identity, recorded on every dispatch record. */
  readonly vendor: string;
  /** What conductor must provision before calling `run`. */
  readonly isolation: IsolationModel;
  /** Run one phase brief to completion. */
  run(brief: PhaseBrief): Promise<DispatchResult>;
}
