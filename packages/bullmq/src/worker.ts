/**
 * Flow-run job processor. Dequeues BullMQ jobs and calls runAction for each,
 * mapping execution results back to BullMQ job completion/failure semantics.
 *
 * Non-retryable errors (validation, unknown flow/action, a session or request
 * another flow instance owns) are wrapped in BullMQ's UnrecoverableError so
 * they go straight to failed without retries. All other errors follow the
 * queue's retry/backoff config.
 *
 * A job that carries a place on a concurrency key (`leasePlace`) runs only in
 * that place's turn. Until then it waits by requeueing itself as a delayed
 * job, which frees the worker slot and counts no attempt, on the schedule the
 * engine's `planQueueWait` sets. While it runs, the worker renews the place on
 * its own timer and stops the run if the place is lost. The place goes back
 * when the job is done for good, and stays across retries.
 */
import { isValidOrgId } from "@flow-state-dev/core";
import {
  OrgRequiredError,
  holdLeasePlace,
  planQueueWait,
  settleUnstartedRequest,
} from "@flow-state-dev/engine";
import { DelayedError, Worker, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import { runAction } from "@flow-state-dev/engine";
import type {
  FlowRegistry,
  LeasePlace,
  StoreRegistry,
  RuntimeConfig,
  StreamBridge,
  StreamPublisher,
} from "@flow-state-dev/engine";
import type { OutputItem } from "@flow-state-dev/core/items";
import { resolveWorkerConnection } from "./connection";
import type { JobLeaseBackend } from "./lease-backend";
import type { BullmqConnectionOptions, FlowJobData, RetryConfig } from "./types";

/** Dependencies injected into the flow worker. */
export interface FlowWorkerDeps {
  registry: FlowRegistry;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
  bridge?: StreamBridge;
  concurrency?: number;
  lockDuration?: number;
  onItem?: (jobId: string, item: OutputItem, kind: "added" | "updated" | "done") => void;
  /**
   * The lease backend the deployment's concurrency places live on. A job
   * that carries a place waits for its turn on it. Absent → a job runs as
   * soon as a worker takes it, place or not.
   */
  leaseBackend?: JobLeaseBackend;
}

export interface CreateFlowWorkerOptions extends BullmqConnectionOptions {
  queueName?: string;
  retry?: RetryConfig;
  deps: FlowWorkerDeps;
}

const DEFAULT_QUEUE_NAME = "fsd-flows";
const DEFAULT_CONCURRENCY = 2;
/** 5 minutes — LLM calls are slow, so we extend the default lock. */
const DEFAULT_LOCK_DURATION = 300_000;

/**
 * Builds the job processor used by `createFlowWorker`. Exported separately so
 * the retry/terminal-publish semantics are testable without a Redis
 * connection (constructing a BullMQ `Worker` connects eagerly).
 */
export function createFlowJobProcessor(deps: FlowWorkerDeps) {
  const { registry, stores, runtimeConfig, bridge, onItem, leaseBackend } = deps;

  /**
   * Give a place back, best effort: a place that cannot be given back lapses
   * with its lease, and the job's own outcome is what BullMQ needs.
   */
  const giveBack = async (place: LeasePlace | undefined): Promise<void> => {
    if (place === undefined || leaseBackend === undefined) return;
    await leaseBackend.giveBack(place).catch(() => undefined);
  };

  /** Tell a caller waiting on the request's stream that it ended. */
  const publishFailure = async (requestId: string, error: Error): Promise<void> => {
    if (!bridge) return;
    const publisher = bridge.createPublisher(requestId);
    await publisher.publishTerminal({ error: { message: error.message } } as any).catch(() => {});
    await publisher.close().catch(() => {});
  };

  /**
   * Take the job's turn on its concurrency key, or requeue it to check again.
   * Returns the place the run holds, `undefined` when there is nothing to
   * hold, or throws BullMQ's `DelayedError` once the job is requeued.
   */
  const takeTurn = async (
    job: Job<FlowJobData>,
    token: string | undefined
  ): Promise<LeasePlace | undefined> => {
    const data = job.data;
    const backend = leaseBackend;
    let place = data.leasePlace ?? undefined;
    if (place === undefined || backend === undefined || data.requestId === undefined) {
      return undefined;
    }
    const requestId = data.requestId;

    // Cancelled while it waited: it never starts. Its place goes back now, so
    // the next run moves, and `runAction` settles the request aborted from the
    // recorded cancel without running the action.
    const record = await stores.request.get(requestId).catch(() => undefined);
    if (record?.abortRequested === true) {
      await giveBack(place);
      return undefined;
    }

    // Renew before asking: a place whose lease ran out while its job sat in
    // the queue is still this job's, and the turn check reconciles expired
    // places by their job's state, which for this job is `active`.
    let turn: boolean | "missing" =
      (await backend.renew(place)) === false ? "missing" : await backend.isMyTurn(place);
    if (turn === "missing") {
      // The place was dropped while the job could not renew it. The request
      // is still coming, so it lines up again, at the back.
      const retaken = await backend.take({ key: place.key, requestId, jobId: job.id });
      if ("heldBy" in retaken) throw new Error(`Could not line up again on "${place.key}"`);
      place = retaken.place;
      turn = await backend.isMyTurn(place);
    }

    const now = Date.now();
    const wait = data.leaseWait ?? { firstCheckAt: now, attempt: 0 };
    const waitedMs = now - wait.firstCheckAt;
    // The first check is always honoured; a later one past the budget times
    // out, as the engine's own wait does.
    if (turn === true && (wait.attempt === 0 || planQueueWait({ key: place.key, waitedMs, attempt: wait.attempt }).kind === "wait")) {
      if (place !== data.leasePlace || data.leaseWait != null) {
        await job.updateData({ ...data, leasePlace: place, leaseWait: null });
      }
      return place;
    }

    const step = planQueueWait({ key: place.key, waitedMs, attempt: wait.attempt });
    if (step.kind === "timeout") {
      await giveBack(place);
      await settleUnstartedRequest(stores, requestId, { status: "failed", cause: step.error });
      await publishFailure(requestId, step.error);
      throw new UnrecoverableError(step.error.message);
    }
    await job.updateData({
      ...data,
      leasePlace: place,
      leaseWait: { firstCheckAt: wait.firstCheckAt, attempt: wait.attempt + 1 },
    });
    // Back to the queue as a delayed job: the slot is free for other work,
    // and BullMQ does not count it as an attempt.
    await job.moveToDelayed(Date.now() + step.delayMs, token);
    throw new DelayedError();
  };

  return async (job: Job<FlowJobData>, token?: string) => {
    const data = job.data;
    // `flowKind` on the job is the instance's address — its exact id — so the
    // worker resolves the same copy the enqueuing process did.
    const flow = registry.get(data.flowKind);
    if (!flow) {
      throw new UnrecoverableError(`Unknown flow "${data.flowKind}"`);
    }

    const place = await takeTurn(job, token);
    // While the run holds its turn, renew the place on a timer of its own
    // (not the run heartbeat, which a flow can turn off), and stop the run
    // once the place is lost: another worker may take the key from then on.
    const lost = new AbortController();
    const hold =
      place !== undefined && leaseBackend !== undefined
        ? holdLeasePlace(leaseBackend, place, (error) => lost.abort(error))
        : undefined;
    // Kept across a retry, given back when the job is done for good.
    let keepPlace = false;

    // On a retry attempt the previous run may have persisted events under
    // the same requestId. Resume sequence numbering past them — tailing
    // clients filter on `sequence_number > cursor`, so a restart at zero
    // would hide the retry's events and corrupt cursor-based replay.
    // `attemptsMade` counts completed attempts inside a processor (BullMQ
    // increments it after moveToCompleted/moveToFailed), so > 0 means retry.
    let startSequenceNumber: number | undefined;
    if (job.attemptsMade > 0 && data.requestId !== undefined) {
      const prior = await stores.request
        .getEvents(data.requestId)
        .catch(() => []);
      startSequenceNumber = prior[prior.length - 1]?.sequence_number;
    }

    let publisher: StreamPublisher | undefined;
    if (bridge) {
      publisher = bridge.createPublisher(data.requestId ?? job.id ?? "unknown");
    }

    let terminalPublished = false;
    try {
      // A job enqueued before organizations were required carries none, and a
      // worker runs below principal resolution — there is nothing here that
      // could recover one, and borrowing the worker's own would run somebody's
      // work in an organization they never chose. Refused by name so the
      // failure reads as "drain and attribute this queue", not as a flow error
      // (BR-14, FIX-1442).
      //
      // Inside the `try`, deliberately. Thrown above it the refusal skipped
      // every terminal path: the publisher was already created, so it leaked
      // unclosed and no error terminal ever reached a waiting subscriber, and
      // the raw error let BullMQ retry a job that cannot become valid.
      if (!isValidOrgId(data.orgId)) {
        throw new OrgRequiredError(flow.kind, "this queued job");
      }
      const jobOrgId = data.orgId;

      const result = await runAction({
        flow,
        actionName: data.actionName as keyof typeof flow.actions & string,
        input: data.input,
        userId: data.userId,
        sessionId: data.sessionId,
        requestId: data.requestId,
        orgId: jobOrgId,
        tenantId: data.tenantId,
        source: data.source ?? "bullmq",
        metadata: data.metadata,
        stores,
        runtimeConfig,
        startSequenceNumber,
        ...(hold !== undefined ? { signal: lost.signal } : {}),
        onItem: (item: OutputItem, kind: "added" | "updated" | "done") => {
          onItem?.(job.id ?? "unknown", item, kind);
          if (publisher) {
            publisher
              .publishEvent({
                event: `item.${kind}`,
                data: JSON.stringify(item),
              })
              .catch(() => {}); // bridge is best-effort
          }
        },
      });

      if (lost.signal.aborted) {
        // Stopped because its place was lost: the request ends interrupted,
        // and running it again here could overlap the run that took the key.
        throw new UnrecoverableError((lost.signal.reason as Error).message);
      }

      if (result.error) {
        if (isNonRetryable(result.error)) {
          if (publisher) {
            await publisher.publishTerminal(result).catch(() => {});
            terminalPublished = true;
          }
          throw new UnrecoverableError(result.error.message);
        }
        // Retryable error: don't publish terminal yet — BullMQ will retry
        // and the subscriber needs to stay alive to receive the eventual
        // success or final-failure terminal.
        throw new Error(result.error.message);
      }

      if (publisher) {
        await publisher.publishTerminal(result).catch(() => {});
      }

      return result;
    } catch (caught) {
      // A record another flow instance owns is refused at admission, before
      // any write; retrying can only refuse again, so it fails outright.
      // Matched by name rather than `instanceof` for the same cross-realm
      // reason `UnrecoverableError` is below.
      // `OrgRequiredError` joins it: no attempt of this job can supply the
      // organization it is missing, so retrying only delays the same failure.
      const terminalByName =
        (caught as Error | undefined)?.name === "FlowInstanceBindingMismatchError" ||
        (caught as Error | undefined)?.name === "OrgRequiredError";
      const err = terminalByName
        ? new UnrecoverableError((caught as Error).message)
        : caught;
      // Publish the error terminal only when BullMQ will NOT retry this
      // job: a non-retryable error or the final configured attempt. Earlier
      // attempts skip the publish so the web-side subscriber stays alive for
      // the retry. Mirrors BullMQ's own `shouldRetryJob` predicate
      // (`attemptsMade + 1 < attempts`, UnrecoverableError checked by name
      // too for cross-realm errors).
      const willRetry =
        !(err instanceof UnrecoverableError) &&
        (err as Error | undefined)?.name !== "UnrecoverableError" &&
        job.attemptsMade + 1 < (job.opts.attempts ?? 1);
      keepPlace = willRetry;
      if (publisher && !terminalPublished && !willRetry) {
        const errorResult = {
          error: { message: err instanceof Error ? err.message : String(err) }
        };
        await publisher.publishTerminal(errorResult as any).catch(() => {});
      }
      throw err;
    } finally {
      hold?.stop();
      if (!keepPlace) await giveBack(place);
      if (publisher) {
        await publisher.close().catch(() => {});
      }
    }
  };
}

/**
 * Creates a BullMQ Worker that processes flow-run jobs by calling `runAction`.
 * Each job carries a `FlowJobData` payload; the worker resolves the flow from
 * the registry, executes it, and maps the result back to BullMQ job
 * completion/failure semantics.
 */
export function createFlowWorker(options: CreateFlowWorkerOptions): Worker {
  const { connection, prefix } = resolveWorkerConnection(options);
  const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
  const { concurrency, lockDuration } = options.deps;
  const processor = createFlowJobProcessor(options.deps);

  return new Worker(queueName, processor, {
    connection,
    prefix,
    concurrency: concurrency ?? DEFAULT_CONCURRENCY,
    lockDuration: lockDuration ?? DEFAULT_LOCK_DURATION,
  });
}

function isNonRetryable(error: { retryable?: boolean }): boolean {
  return error.retryable === false;
}
