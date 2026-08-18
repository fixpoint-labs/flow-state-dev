/**
 * The work recorder: turns the translation layer's observation events into rows
 * in the two resource collections.
 *
 * It contains NO tool names. Everything it consumes is already framework
 * vocabulary ("a file op happened", "a plan item moved"), which is what keeps
 * the vendor mapping to one site and makes this module testable with scripted
 * events and a fake collection.
 *
 * **Watching the work must never break the work.** There is no fatal path here.
 * Every failure — an unkeyable path, a collection write that throws, a shape
 * nobody has seen — degrades to a missing entry plus a DURABLE gap row.
 *
 * The gap row is the half that is easy to get wrong. A skip that leaves nothing
 * behind is indistinguishable afterwards from a mutation that never happened,
 * which is the same blindness this feature exists to remove — so every skip the
 * recorder recognises writes a row a reader can find over the same route. A
 * status note goes out too, but it cannot BE the record: `ctx.emit.status`
 * dedupes on the message string and renders into a latest-wins slot, so two
 * identical skips collapse, and reading a gap back out of prose is grading by
 * substring.
 *
 * A run that records NOTHING still has to be graded as a failure somewhere
 * else: a recorder whose every write fails would leave gap rows, but one that
 * is never fed at all leaves nothing, and only a check outside it can tell that
 * from a run that did nothing.
 */
import { resolve as resolvePath } from "node:path";
import { normalizeResourcePath } from "@flow-state-dev/core/types";
import type {
  ObservedFileOpKind,
  ObservedGapKind,
  ObservedOutcome,
} from "./work-collections";
import type { TranslatedEvent } from "./types";

/**
 * The slice of a collection ref this module uses. Structural on purpose: it is
 * the whole surface the recorder is allowed to touch, and `list`/`count` are
 * deliberately absent — those trigger a full-prefix load on a lazy collection,
 * which is the cost the lazy declaration exists to avoid.
 */
export interface UpsertableCollection {
  upsert(
    key: string,
    update: Record<string, unknown>,
    createOnly?: Record<string, unknown>,
  ): Promise<unknown>;
}

/** Options for {@link createWorkRecorder}. */
export interface WorkRecorderOptions {
  /**
   * The run's own namespace, prefixed onto every key. May be more than one
   * path segment — see {@link WorkRecorderOptions} callers.
   *
   * A workstream session is REUSED across runs, so without this a second run
   * would merge its file entries by path into the first run's rows and mix its
   * plan items in, and a reader would get "what has this workstream ever done"
   * in answer to "what did this run do".
   *
   * It must identify **one invocation of the agent**, not one request. Those
   * are not the same thing: a generator holding the agent as a tool can call it
   * several times in a single request, and every one of those is a separate
   * coding run with its own files, its own to-do ids, and its own gap ordinals.
   * A request-wide namespace merges all of them — and the gap ordinals, which
   * restart at 1 per recorder, would overwrite each other outright.
   */
  runId: string;
  files: UpsertableCollection;
  plan: UpsertableCollection;
  /**
   * Where skips land. Optional so a caller that only wants the two records can
   * omit it — a missing gaps collection degrades to the status note alone,
   * which is worse but never fatal.
   */
  gaps?: UpsertableCollection;
  /**
   * How long writes coalesce before a flush. Neither per-event nor once at the
   * end: a per-result upsert stacks a read-modify-write on top of the per-message
   * emission awaits on a run shape whose item persistence is already quadratic,
   * while flushing only at the end loses everything if the process is killed
   * after a file was written — and an unfinished run is precisely the one whose
   * file record matters most. Both constraints are real; either one alone
   * produces the wrong design.
   */
  flushIntervalMs?: number;
  /** Called with a human-readable note when an entry could not be recorded. */
  onSkipped?: (note: string) => void;
  /** Clock seam for tests. */
  now?: () => number;
}

/** A live recorder for one run. */
export interface WorkRecorder {
  /** Buffer one translated event. Ignores events it does not consume. Never throws. */
  observe(event: TranslatedEvent): void;
  /** Write everything buffered. Never throws. */
  flush(): Promise<void>;
  /** Cancel the pending interval and flush one last time. Never throws. */
  stop(): Promise<void>;
}

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;

/**
 * Canonicalize a path the run addressed into a collection key segment.
 *
 * Two things have to hold at once. The same file reached as `/work/repo/a.ts`
 * and as `a.ts` must land on ONE entry, so a relative path is resolved against
 * the run's working directory — which is this process's, because the block
 * forwards no `cwd` to the SDK. And the result must never contain a `..`
 * segment, because the collection key normalizer rejects those; `resolve`
 * guarantees that by collapsing them, which a relative-to-a-root encoding
 * emphatically does not (a run writing outside the root produces nothing but
 * `..`, and the entry would be silently dropped on every successful write).
 *
 * The leading separator is dropped because the normalizer strips it anyway, so
 * keeping it would make one path two spellings of one key.
 */
export function canonicalFilePathKey(rawPath: string): string {
  return resolvePath(rawPath).replace(/\\/g, "/").replace(/^\/+/, "");
}

/** One buffered file row, merged across every touch inside a flush window. */
interface PendingFileEntry {
  /**
   * Absent when a settlement is being held for another call still open on this
   * path — the upsert then leaves the row's existing kind alone, so kind and
   * outcome never describe different calls.
   */
  lastKind?: ObservedFileOpKind;
  outcome: ObservedOutcome;
  lastTouchedAt: number;
}

/** One buffered plan row. Absent fields are left alone by the upsert. */
interface PendingPlanEntry {
  title?: string;
  status?: string;
  previousStatus?: string;
  lastOutcome: ObservedOutcome;
  lastTouchedAt: number;
}

/**
 * Create a recorder for one run.
 *
 * Writes are buffered per key and flushed on an interval, so a path touched
 * repeatedly costs one write per window rather than one per event.
 */
export function createWorkRecorder(options: WorkRecorderOptions): WorkRecorder {
  const {
    runId,
    files,
    plan,
    gaps,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    onSkipped,
    now = Date.now,
  } = options;

  const pendingFiles = new Map<string, PendingFileEntry>();
  const pendingPlan = new Map<string, PendingPlanEntry>();
  const pendingGaps = new Map<string, Record<string, unknown>>();
  /** Ordinal for the next gap row. Zero-padded so key order is time order. */
  let gapOrdinal = 0;
  /**
   * The status this recorder has last recorded as CONFIRMED for an item, so an
   * update can move it into `previousStatus`. Held here rather than read back
   * from the collection: a read per event is the cost the coalesced flush
   * exists to avoid, and the recorder is the only writer of these rows.
   */
  const confirmedStatus = new Map<string, string>();
  /**
   * Unsettled call ids per row key.
   *
   * A row is keyed by its SUBJECT — a path, a task id — while mutations are per
   * CALL, and two calls can be in flight on one subject at once. Without this,
   * the first result to arrive settles the row that the second call is still
   * using, so an interrupted second call leaves an `applied` row and its
   * unresolved mutation disappears from the readback entirely.
   *
   * A row therefore only leaves `pending` when nothing is still outstanding on
   * it. That is the same can't-tell rule as everywhere else: while a mutation
   * on this subject is unresolved, the honest outcome is "unresolved".
   */
  const outstandingCalls = new Map<string, Map<string, ObservedFileOpKind | undefined>>();
  /**
   * Rows that have had two calls open at once.
   *
   * Deriving a previous status assumes the statuses this recorder saw arrived
   * in the order they happened. One overlap breaks that for the REST of the
   * row's life, not just while the overlap lasts: the last call to settle reads
   * `confirmedStatus` written by an out-of-order sibling, so suppressing the
   * derivation only during the overlap still lets the final settlement assert a
   * move backwards. Once the ordering is unknowable it stays unknowable, and
   * the harness's own `from` is the only thing that can speak to a transition
   * afterwards.
   */
  const orderingUnknowable = new Set<string>();

  /**
   * Fold this event's outcome together with any other calls still in flight on
   * the same row, and return the outcome TOGETHER WITH the metadata of the call
   * that outcome describes.
   *
   * **Returning both is the point, not a convenience.** `lastKind` and `outcome`
   * are a pair describing one touch, and this function is the only thing that
   * knows which call the outcome ended up being about. When it returned an
   * outcome alone, the caller had to guess the matching metadata — and guessed
   * wrong in both directions, in two separate review rounds: first by letting a
   * settling call overwrite an unfinished call's kind, then, after that was
   * "fixed" by keeping whatever was already there, by retaining the *settled*
   * call's kind when it was the earlier call left unresolved. Pairing them here
   * makes the whole axis unreachable rather than patched twice.
   */
  const settleAgainstOpenCalls = (
    scope: "file" | "plan",
    subjectKey: string,
    callId: string,
    outcome: ObservedOutcome,
    meta?: ObservedFileOpKind,
  ): { outcome: ObservedOutcome; meta: ObservedFileOpKind | undefined } => {
    // Files and plan items are keyed the same way (`<runId>/<segment>`) into two
    // DIFFERENT collections, so the two keyspaces are only distinct by accident
    // of what a segment usually looks like. Scoping the bookkeeping key means a
    // plan item whose id collides with a root-level file path cannot hold that
    // file's row at `pending`, or mark its ordering unknowable.
    const key = `${scope}:${subjectKey}`;
    if (outcome === "pending") {
      const open = outstandingCalls.get(key) ?? new Map<string, ObservedFileOpKind | undefined>();
      if (open.size > 0 && !open.has(callId)) orderingUnknowable.add(key);
      open.set(callId, meta);
      outstandingCalls.set(key, open);
      return { outcome: "pending", meta };
    }
    const open = outstandingCalls.get(key);
    open?.delete(callId);
    if (open !== undefined && open.size > 0) {
      // Someone else is still mid-flight on this subject, so the row is not
      // settled however THIS call ended — and the `pending` now describes that
      // other call, so its metadata is what belongs beside it. Insertion order
      // makes the last entry the most recently attempted.
      const stillOpen = [...open.values()].at(-1);
      return { outcome: "pending", meta: stillOpen };
    }
    outstandingCalls.delete(key);
    return { outcome, meta };
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes flushes so a timer flush and the final flush cannot interleave. */
  let writing: Promise<void> = Promise.resolve();

  /**
   * Record a gap: a durable row a reader can find, plus a live note.
   *
   * The row is what survives the run; the note is only for someone watching it
   * happen. `rawPath` is stored as STATE precisely because the failing case is
   * a path that cannot be a key — as a value, a control character is just a
   * character.
   */
  /**
   * Call the caller's reporting hook, swallowing anything it throws.
   *
   * **A reporting hook that throws must not become the failure it reports.**
   * Every call to `onSkipped` goes through here, and that is the point rather
   * than tidiness: the reporting path is the one place nobody defends, because
   * it is the thing that reports failures — and an unguarded call inside the
   * serialized flush chain rejects `flush()`/`stop()`, turning a successful
   * coding run into a bookkeeping failure. That is exactly the outcome this
   * whole module exists to make impossible.
   */
  const report = (reason: string): void => {
    try {
      onSkipped?.(reason);
    } catch {
      // Deliberately empty: see above.
    }
  };

  const gap = (kind: ObservedGapKind, reason: string, rawPath?: string): void => {
    report(reason);
    gapOrdinal += 1;
    pendingGaps.set(`${runId}/${String(gapOrdinal).padStart(6, "0")}`, {
      kind,
      reason,
      ...(rawPath !== undefined ? { rawPath } : {}),
      at: now(),
    });
    armTimer();
  };

  const armTimer = (): void => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushIntervalMs);
    // Never hold the process open for a bookkeeping flush.
    (timer as { unref?: () => void }).unref?.();
  };

  /**
   * Compose and validate a key up front. Failing here — rather than letting the
   * write reject a window later — is what lets the gap row carry the raw value
   * that could not be keyed, which is the whole point of the gap record.
   */
  const keyFor = (
    subject: ObservedGapKind,
    label: string,
    segment: string,
    rawPath?: string,
  ): string | null => {
    try {
      return normalizeResourcePath(`${runId}/${segment}`);
    } catch (err) {
      gap(subject, `a ${label} could not be keyed: ${(err as Error).message}`, rawPath);
      return null;
    }
  };

  const observeFileOp = (event: Extract<TranslatedEvent, { kind: "file_op_observed" }>): void => {
    const canonical = canonicalFilePathKey(event.path);
    // The harness named a different path, and canonicalization did not
    // reconcile them — so the row about to be written is keyed under a path the
    // harness says it did not touch. Recording the operation is still right (it
    // happened), but a reader must be able to see that the key is contested,
    // or a later comparison against the run's tool activity reads this as the
    // record having lost a write.
    if (event.resolvedPath !== undefined && canonicalFilePathKey(event.resolvedPath) !== canonical) {
      // THE GAP IS THE WHOLE RECORD, the same as a plan update the harness
      // applied to a different item. The settling event's other fields — the
      // kind the harness reported, its outcome — describe the write it actually
      // performed at ITS path, so stamping them onto a row keyed by the path the
      // run named would assert that something happened to a file that may never
      // have been touched. The attempt keeps the `pending` row it already has,
      // which is the honest state: asked for, not confirmed.
      gap(
        "file",
        `a file mutation was attempted on the path the run named and the harness reported ` +
          `writing "${event.resolvedPath}" instead, so nothing was settled for either`,
        event.path,
      );
      return;
    }
    const key = keyFor("file", "file operation", canonical, event.path);
    if (key === null) return;
    // `outcome` and `meta` arrive paired because they describe ONE call, which
    // is not always this one: a settlement held at `pending` by another open
    // call describes that call, and carries its kind. Taking the kind from
    // `event.op` here instead is what put an unfinished Edit's `pending` beside
    // a finished Write's `created` — and then, once that was patched by keeping
    // whatever the row already had, put the settled call's kind beside the
    // earlier call's unresolved outcome. Neither is reachable from a pair.
    const { outcome, meta } = settleAgainstOpenCalls(
      "file",
      key,
      event.callId,
      event.outcome,
      event.op,
    );
    pendingFiles.set(key, {
      ...pendingFiles.get(key),
      ...(meta !== undefined ? { lastKind: meta } : {}),
      outcome,
      lastTouchedAt: now(),
    });
    armTimer();
  };

  const observePlanItem = (
    event: Extract<TranslatedEvent, { kind: "plan_item_observed" }>,
  ): void => {
    const key = keyFor("plan", "plan item", event.itemId);
    if (key === null) return;
    // No metadata pairing here: a plan row's `status` is the item's own state as
    // the harness confirmed it, not a field that only makes sense beside this
    // call's outcome — so unlike a file row's kind, it does not travel with
    // whichever call the outcome ended up describing.
    const { outcome: settled } = settleAgainstOpenCalls("plan", key, event.callId, event.outcome);
    const merged: PendingPlanEntry = {
      ...pendingPlan.get(key),
      lastOutcome: settled,
      lastTouchedAt: now(),
    };
    if (event.title !== undefined) merged.title = event.title;
    if (event.status !== undefined && event.outcome === "applied") {
      // The harness's own account of the move wins over anything derived here.
      // Deriving is a fallback, not the design: on an item's FIRST move there
      // is nothing to derive from — the create carried no status — so a derived
      // `previousStatus` is null for a transition the harness described in full.
      //
      // And the fallback is ABANDONED while other calls are open on this item.
      // Deriving assumes the statuses this recorder saw arrived in the order
      // they happened, which concurrent updates do not guarantee: settle two
      // out of order and the row asserts a transition backwards — a move the
      // harness never described, in a record whose whole job is to assert only
      // what it did. The harness's own `from` stays authoritative here, because
      // it describes the transition rather than the arrival order.
      const prior =
        event.previousStatus ??
        (orderingUnknowable.has(`plan:${key}`) ? undefined : confirmedStatus.get(event.itemId));
      // The CURRENT status is recorded unconditionally, because the harness
      // confirmed it whether or not it changed. Gating this on a change left a
      // no-op update (`pending` → `pending`) with `status: null`, since a create
      // records no status — the row denying a state the harness had just
      // confirmed.
      confirmedStatus.set(event.itemId, event.status);
      merged.status = event.status;
      // Only a real change moves the POINTER, though. Re-confirming the status
      // an item already holds is not a transition, and recording it as one
      // would leave `previousStatus === status` on a row that never moved.
      if (prior !== undefined && prior !== event.status) merged.previousStatus = prior;
    }
    pendingPlan.set(key, merged);
    armTimer();
  };

  /**
   * Write one buffered map out. A row that fails becomes a gap of its own, so
   * the reason survives the run — except for a gap row's own failure, which has
   * nowhere left to go and would loop if it tried.
   */
  const drain = async (
    collection: UpsertableCollection,
    buffer: Map<string, Record<string, unknown>>,
    subject: ObservedGapKind | null,
    label: string,
  ): Promise<void> => {
    for (const [key, update] of buffer) {
      try {
        await collection.upsert(key, update);
      } catch (err) {
        const reason = `a ${label} entry for "${key}" could not be written: ${(err as Error).message}`;
        // A gap row's OWN failure has nowhere left to go and would loop if it
        // tried, so it reports rather than raising another gap.
        if (subject !== null) gap(subject, reason);
        else report(reason);
      }
    }
  };

  const flush = async (): Promise<void> => {
    // Snapshot and clear before awaiting: an event arriving mid-flush belongs to
    // the next window, and re-writing it here would be a lost update either way.
    const fileBatch = new Map<string, Record<string, unknown>>(
      [...pendingFiles].map(([key, entry]) => [key, { ...entry }]),
    );
    const planBatch = new Map<string, Record<string, unknown>>(
      [...pendingPlan].map(([key, entry]) => [key, { ...entry }]),
    );
    pendingFiles.clear();
    pendingPlan.clear();
    if (fileBatch.size === 0 && planBatch.size === 0 && pendingGaps.size === 0) return;

    writing = writing.then(async () => {
      await drain(files, fileBatch, "file", "file operation");
      await drain(plan, planBatch, "plan", "plan item");
      // Gaps LAST, so a gap raised by the two drains above is in this batch
      // rather than waiting for the next window — and, at the final flush,
      // rather than never being written at all.
      const gapBatch = new Map(pendingGaps);
      pendingGaps.clear();
      if (gaps !== undefined) await drain(gaps, gapBatch, null, "gap");
    });
    await writing;
  };

  return {
    observe(event: TranslatedEvent): void {
      try {
        if (event.kind === "file_op_observed") observeFileOp(event);
        else if (event.kind === "plan_item_observed") observePlanItem(event);
        else if (event.kind === "work_gap_observed")
          gap(event.subject, event.reason, event.rawPath);
      } catch (err) {
        gap(
          event.kind === "plan_item_observed" ? "plan" : "file",
          `an observed ${event.kind} could not be buffered: ${(err as Error).message}`,
        );
      }
    },
    flush,
    /**
     * Flush once, then await whatever was already in flight.
     *
     * A gap raised by a write that fails DURING this settle is not lost, and it
     * is worth saying why, because the reasoning is not local to this function:
     * a flush drains gaps LAST, inside the same chained body as the file and
     * plan writes, so a failure in either of those lands in that same flush's
     * gap batch. Nothing can add to `pendingGaps` after its snapshot except a
     * later flush, which snapshots again. Measured, not assumed — see the
     * "persists a gap raised by a write that failed mid-flush" test.
     *
     * That invariant is what makes a single flush sufficient here. If the drain
     * order in `flush` ever changes, this stops being true and `stop()` needs
     * to drain to quiescence instead.
     */
    async stop(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
      await writing;
    },
  };
}
