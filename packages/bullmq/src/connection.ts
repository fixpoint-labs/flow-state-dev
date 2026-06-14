/**
 * ioredis connection factory. Centralizes the Redis connection setup so
 * callers don't hand-build BullMQ-specific ioredis options.
 *
 * Workers require maxRetriesPerRequest: null (BullMQ blocking commands).
 * Producers keep the ioredis default. The prefix option namespaces all
 * BullMQ keys — never use ioredis keyPrefix (incompatible with BullMQ Lua).
 */
import type { RedisOptions } from "ioredis";
import type { BullmqConnectionOptions } from "./types";

const DEFAULT_PREFIX = "fsd";

export interface ResolvedConnection {
  connection: RedisOptions;
  prefix: string;
}

export function resolveProducerConnection(
  opts: BullmqConnectionOptions
): ResolvedConnection {
  const connection: RedisOptions =
    typeof opts.connection === "string"
      ? parseRedisUrl(opts.connection)
      : { ...opts.connection };

  return {
    connection,
    prefix: opts.prefix ?? DEFAULT_PREFIX,
  };
}

export function resolveWorkerConnection(
  opts: BullmqConnectionOptions
): ResolvedConnection {
  const { connection, prefix } = resolveProducerConnection(opts);
  return {
    connection: {
      ...connection,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    },
    prefix,
  };
}

function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const opts: RedisOptions = {
    host: parsed.hostname || "localhost",
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
  };
  if (parsed.password) opts.password = decodeURIComponent(parsed.password);
  if (parsed.username && parsed.username !== "default") {
    opts.username = decodeURIComponent(parsed.username);
  }
  const db = parsed.pathname?.replace("/", "");
  if (db) opts.db = parseInt(db, 10);
  if (parsed.protocol === "rediss:") {
    opts.tls = {};
  }
  return opts;
}
