/**
 * The ordered-lease backend on Redis: the lines the engine's concurrency
 * arbiter keeps its keys in, shared by every process of a BullMQ deployment.
 *
 * A backend holds no policy (the engine's arbiter does). It keeps, per key, a
 * line of places in the order they were taken. Each place records the request
 * it is for, the BullMQ job that will run it, and a lease. Every change to a
 * line is one Lua script, so two processes never see half of one.
 *
 * **Liveness.** A place lives while something renews it: the process that
 * took it until it enqueues the job, then the worker that runs or requeues
 * the job. A place whose lease ran out is not dropped blindly. Whichever call
 * finds it (a take, a turn check, a give-back) reads its job's state in
 * BullMQ first: a job still waiting, delayed or in retry backoff is coming
 * back, so its place is kept and renewed; a job that is active (its worker
 * stopped renewing), completed, failed, gone, or never enqueued loses it.
 * A job whose place was dropped finds it missing when it next runs, and the
 * worker lines it up again at the back.
 *
 * **Wake.** Giving the first place back promotes the next place's job from
 * delayed to waiting, so the next run starts without waiting out its requeue
 * delay. The promotion follows the give-back script from JavaScript rather
 * than inside it: BullMQ's promote is its own script over its own keys.
 */
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { Job, type Queue } from "bullmq";
import type {
  ConcurrencyLeaseBackend,
  LeasePlace,
  LeaseTakeInput,
  LeaseTakeResult,
} from "@flow-state-dev/engine";
import { resolveProducerConnection } from "./connection";
import type { BullmqConnectionOptions } from "./types";

/**
 * How long a place lives past its last renewal, by default. Holders renew
 * every 2 seconds and a waiter's requeue delay is capped at 2 seconds, so ten
 * seconds survives a few missed renewals, and a holder that cannot renew is
 * stopped at five.
 */
export const DEFAULT_LEASE_MS = 10_000;

/** Job states that are coming back to a worker: their places are kept. */
const RETURNING_STATES = new Set(["waiting", "delayed", "prioritized", "waiting-children"]);

/** The BullMQ job id a place's job is enqueued under, unless it names another. */
export function leaseJobId(place: LeasePlace): string {
  return `fsd-lease-${place.ticket}`;
}

/** What a worker may add to a take: the job that already exists for the request. */
export type JobLeaseTakeInput = LeaseTakeInput & {
  /** The job the place is for. Default: {@link leaseJobId} of the new place. */
  jobId?: string;
};

/**
 * A lease backend a queue worker can re-take a place on for a job that
 * already exists. Any `ConcurrencyLeaseBackend` fits; one that ignores
 * `jobId` loses only the reconciliation of that place.
 */
export interface JobLeaseBackend extends ConcurrencyLeaseBackend {
  take(input: JobLeaseTakeInput): Promise<LeaseTakeResult>;
}

/** The Redis backend, with its connection to close. */
export interface RedisLeaseBackend extends JobLeaseBackend {
  readonly leaseMs: number;
  /** Close this backend's Redis connection. */
  close(): Promise<void>;
}

export interface CreateRedisLeaseBackendOptions extends BullmqConnectionOptions {
  /** The queue whose jobs hold the places, read to reconcile an expired place. */
  queue: Queue;
  /** How long a place lives past its last renewal. Default {@link DEFAULT_LEASE_MS}. */
  leaseMs?: number;
}

// Every script reads the clock from Redis, so processes with skewed clocks
// agree on when a lease ran out.
const NOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

/** KEYS: line, exp, req, job, seq · ARGV: ticket, requestId, ifEmpty, leaseMs, jobId */
const TAKE = `${NOW}
if ARGV[3] == '1' and redis.call('ZCARD', KEYS[1]) > 0 then
  local head = redis.call('ZRANGE', KEYS[1], 0, 0)[1]
  return {'held', redis.call('HGET', KEYS[3], head) or ''}
end
local seq = redis.call('INCR', KEYS[5])
redis.call('ZADD', KEYS[1], seq, ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], now + tonumber(ARGV[4]))
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[4], ARGV[1], ARGV[5])
return {'place'}
`;

/** KEYS: line · ARGV: ticket → 1 first, 0 behind, -1 missing */
const TURN = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return -1 end
if redis.call('ZRANGE', KEYS[1], 0, 0)[1] == ARGV[1] then return 1 end
return 0
`;

/** KEYS: line, exp · ARGV: ticket, leaseMs → 1 kept, 0 gone */
const RENEW = `${NOW}
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
redis.call('HSET', KEYS[2], ARGV[1], now + tonumber(ARGV[2]))
return 1
`;

/**
 * Remove a place. With ARGV[2] == '1', only if its lease has still run out
 * (a reconcile that lost a race with a renewal leaves it). Returns the next
 * place's job id when the removed place was first, for the caller to wake.
 *
 * KEYS: line, exp, req, job, seq · ARGV: ticket, onlyIfExpired
 */
const REMOVE = `${NOW}
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return false end
if ARGV[2] == '1' then
  local exp = tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0')
  if exp >= now then return false end
end
local wasFirst = redis.call('ZRANGE', KEYS[1], 0, 0)[1] == ARGV[1]
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('HDEL', KEYS[4], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
  return false
end
if not wasFirst then return false end
local head = redis.call('ZRANGE', KEYS[1], 0, 0)[1]
return redis.call('HGET', KEYS[4], head) or false
`;

/** KEYS: line, exp, job · returns [ticket, jobId, ...] for places whose lease ran out */
const EXPIRED = `${NOW}
local out = {}
for _, ticket in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  local exp = tonumber(redis.call('HGET', KEYS[2], ticket) or '0')
  if exp < now then
    table.insert(out, ticket)
    table.insert(out, redis.call('HGET', KEYS[3], ticket) or '')
  end
end
return out
`;

/**
 * Build the Redis lease backend over the deployment's connection, reading
 * `queue` to reconcile an expired place.
 */
export function createRedisLeaseBackend(
  options: CreateRedisLeaseBackendOptions
): RedisLeaseBackend {
  const { connection, prefix } = resolveProducerConnection(options);
  const redis = new Redis(connection);
  // A failed call rejects on its own; the connection's error event would
  // otherwise print as unhandled on every reconnect attempt.
  redis.on("error", () => undefined);
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const { queue } = options;

  // One hash tag per key, so a key's line lives in one cluster slot.
  const keysOf = (key: string) => {
    const base = `${prefix}:lease:{${key}}`;
    return {
      line: `${base}:line`,
      exp: `${base}:exp`,
      req: `${base}:req`,
      job: `${base}:job`,
      seq: `${base}:seq`,
    };
  };

  const remove = async (place: LeasePlace, onlyIfExpired: boolean): Promise<void> => {
    const k = keysOf(place.key);
    const next = (await redis.eval(
      REMOVE,
      5,
      k.line,
      k.exp,
      k.req,
      k.job,
      k.seq,
      place.ticket,
      onlyIfExpired ? "1" : "0"
    )) as string | null;
    if (next) await wake(next);
  };

  /** Start the next run now rather than at the end of its requeue delay. */
  const wake = async (jobId: string): Promise<void> => {
    try {
      const job = await Job.fromId(queue, jobId);
      if (job !== undefined && (await job.isDelayed())) await job.promote();
    } catch {
      // It moved on its own between the read and the promote; it runs anyway.
    }
  };

  const renewPlace = async (place: LeasePlace): Promise<boolean> => {
    const k = keysOf(place.key);
    return (await redis.eval(RENEW, 2, k.line, k.exp, place.ticket, String(leaseMs))) === 1;
  };

  /** Keep or drop every place on `key` whose lease ran out, by its job's state. */
  const reconcile = async (key: string): Promise<void> => {
    const k = keysOf(key);
    const expired = (await redis.eval(EXPIRED, 3, k.line, k.exp, k.job)) as string[];
    for (let i = 0; i < expired.length; i += 2) {
      const place = { key, ticket: expired[i]! };
      const jobId = expired[i + 1]!;
      const state = jobId === "" ? "unknown" : await queue.getJobState(jobId);
      if (RETURNING_STATES.has(state)) await renewPlace(place);
      else await remove(place, true);
    }
  };

  return {
    leaseMs,

    async take(input) {
      await reconcile(input.key);
      const k = keysOf(input.key);
      const place: LeasePlace = { key: input.key, ticket: randomUUID() };
      const result = (await redis.eval(
        TAKE,
        5,
        k.line,
        k.exp,
        k.req,
        k.job,
        k.seq,
        place.ticket,
        input.requestId,
        input.ifEmpty === true ? "1" : "0",
        String(leaseMs),
        input.jobId ?? leaseJobId(place)
      )) as string[];
      return result[0] === "held" ? { heldBy: result[1]! } : { place };
    },

    async isMyTurn(place) {
      await reconcile(place.key);
      const answer = await redis.eval(TURN, 1, keysOf(place.key).line, place.ticket);
      return answer === 1 ? true : answer === 0 ? false : "missing";
    },

    async giveBack(place) {
      await remove(place, false);
    },

    renew: renewPlace,

    async close() {
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}
