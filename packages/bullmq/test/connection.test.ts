import { describe, it, expect } from "vitest";
import { resolveProducerConnection, resolveWorkerConnection } from "../src/connection";

describe("resolveProducerConnection", () => {
  it("parses a redis:// URL into host/port", () => {
    const result = resolveProducerConnection({
      connection: "redis://localhost:6379/0"
    });
    expect(result.connection.host).toBe("localhost");
    expect(result.connection.port).toBe(6379);
    expect(result.connection.db).toBe(0);
    expect(result.prefix).toBe("fsd");
  });

  it("parses a rediss:// URL with TLS", () => {
    const result = resolveProducerConnection({
      connection: "rediss://user:pass@redis.example.com:6380/2"
    });
    expect(result.connection.host).toBe("redis.example.com");
    expect(result.connection.port).toBe(6380);
    expect(result.connection.password).toBe("pass");
    expect(result.connection.username).toBe("user");
    expect(result.connection.db).toBe(2);
    expect(result.connection.tls).toEqual({});
  });

  it("passes through RedisOptions object", () => {
    const result = resolveProducerConnection({
      connection: { host: "10.0.0.1", port: 6380 }
    });
    expect(result.connection.host).toBe("10.0.0.1");
    expect(result.connection.port).toBe(6380);
  });

  it("uses custom prefix when provided", () => {
    const result = resolveProducerConnection({
      connection: "redis://localhost:6379",
      prefix: "myapp"
    });
    expect(result.prefix).toBe("myapp");
  });

  it("ignores 'default' username", () => {
    const result = resolveProducerConnection({
      connection: "redis://default:secret@localhost:6379"
    });
    expect(result.connection.username).toBeUndefined();
    expect(result.connection.password).toBe("secret");
  });
});

describe("resolveWorkerConnection", () => {
  it("sets maxRetriesPerRequest to null for BullMQ workers", () => {
    const result = resolveWorkerConnection({
      connection: "redis://localhost:6379"
    });
    expect(result.connection.maxRetriesPerRequest).toBeNull();
  });

  it("sets enableReadyCheck to false", () => {
    const result = resolveWorkerConnection({
      connection: "redis://localhost:6379"
    });
    expect(result.connection.enableReadyCheck).toBe(false);
  });

  it("preserves other connection options from the URL", () => {
    const result = resolveWorkerConnection({
      connection: "redis://:secret@redis.internal:6380/3"
    });
    expect(result.connection.host).toBe("redis.internal");
    expect(result.connection.port).toBe(6380);
    expect(result.connection.password).toBe("secret");
    expect(result.connection.db).toBe(3);
    expect(result.connection.maxRetriesPerRequest).toBeNull();
  });
});
