/**
 * Tests for the webhook verifier presets (FIX-439). Each preset is exercised
 * against a real signature in the provider's exact format: Stripe
 * (`t=,v1=` with timestamp tolerance), GitHub (`sha256=` raw), and Slack
 * (`v0:<ts>:<body>` with a separate timestamp header). Covers valid, tampered,
 * wrong-secret, and stale-timestamp paths, plus lazy secret resolution.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  createWebhookVerifier,
  githubWebhookVerifier,
  slackWebhookVerifier,
  stripeWebhookVerifier
} from "../../src/transports/auth/createWebhookVerifier";

const SECRET = "whsec_test_secret";
const BODY = new TextEncoder().encode('{"type":"invoice.paid","data":{"object":{"id":"in_1"}}}');

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("stripeWebhookVerifier", () => {
  function stripeHeader(ts: number, body: Uint8Array, secret = SECRET): string {
    const signed = new TextEncoder().encode(`${ts}.`);
    const payload = new Uint8Array(signed.length + body.length);
    payload.set(signed, 0);
    payload.set(body, signed.length);
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    return `t=${ts},v1=${sig}`;
  }

  it("verifies a valid Stripe signature within tolerance", () => {
    const verify = stripeWebhookVerifier(SECRET);
    const now = Math.floor(Date.now() / 1000);
    expect(verify(BODY, headers({ "stripe-signature": stripeHeader(now, BODY) }))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const verify = stripeWebhookVerifier(SECRET);
    const now = Math.floor(Date.now() / 1000);
    const header = stripeHeader(now, BODY);
    const tampered = new TextEncoder().encode('{"type":"charge.refunded"}');
    expect(verify(tampered, headers({ "stripe-signature": header }))).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const verify = stripeWebhookVerifier(SECRET, { toleranceSeconds: 300 });
    const stale = Math.floor(Date.now() / 1000) - 1000;
    expect(verify(BODY, headers({ "stripe-signature": stripeHeader(stale, BODY) }))).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const verify = stripeWebhookVerifier(SECRET);
    expect(verify(BODY, headers({}))).toBe(false);
  });
});

describe("githubWebhookVerifier", () => {
  it("verifies a valid sha256= signature", () => {
    const verify = githubWebhookVerifier(SECRET);
    const sig = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`;
    expect(verify(BODY, headers({ "x-hub-signature-256": sig }))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    const verify = githubWebhookVerifier(SECRET);
    const sig = `sha256=${createHmac("sha256", "other").update(BODY).digest("hex")}`;
    expect(verify(BODY, headers({ "x-hub-signature-256": sig }))).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const verify = githubWebhookVerifier(SECRET);
    const sig = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(verify(BODY, headers({ "x-hub-signature-256": sig }))).toBe(false);
  });
});

describe("slackWebhookVerifier", () => {
  function slackSig(ts: number, body: Uint8Array, secret = SECRET): string {
    const base = new TextEncoder().encode(`v0:${ts}:`);
    const payload = new Uint8Array(base.length + body.length);
    payload.set(base, 0);
    payload.set(body, base.length);
    return `v0=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  }

  it("verifies a valid Slack signature", () => {
    const now = Math.floor(Date.now() / 1000);
    const verify = slackWebhookVerifier(SECRET);
    expect(
      verify(
        BODY,
        headers({
          "x-slack-signature": slackSig(now, BODY),
          "x-slack-request-timestamp": String(now)
        })
      )
    ).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    const stale = Math.floor(Date.now() / 1000) - 1000;
    const verify = slackWebhookVerifier(SECRET);
    expect(
      verify(
        BODY,
        headers({
          "x-slack-signature": slackSig(stale, BODY),
          "x-slack-request-timestamp": String(stale)
        })
      )
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    const now = Math.floor(Date.now() / 1000);
    const verify = slackWebhookVerifier(SECRET);
    const sig = slackSig(now, BODY);
    const tampered = new TextEncoder().encode('{"type":"other"}');
    expect(
      verify(
        tampered,
        headers({ "x-slack-signature": sig, "x-slack-request-timestamp": String(now) })
      )
    ).toBe(false);
  });

  it("rejects a missing timestamp header", () => {
    const now = Math.floor(Date.now() / 1000);
    const verify = slackWebhookVerifier(SECRET);
    expect(verify(BODY, headers({ "x-slack-signature": slackSig(now, BODY) }))).toBe(false);
  });

  it("rejects a non-canonical timestamp header (no parseInt normalization)", () => {
    // A signature computed over the cleaned integer must NOT verify against a
    // header carrying trailing junk — the base string uses the literal header.
    const now = Math.floor(Date.now() / 1000);
    const verify = slackWebhookVerifier(SECRET);
    const sigOverInt = slackSig(now, BODY);
    expect(
      verify(
        BODY,
        headers({ "x-slack-signature": sigOverInt, "x-slack-request-timestamp": `${now}abc` })
      )
    ).toBe(false);
  });
});

describe("createWebhookVerifier", () => {
  it("resolves a getter secret lazily on first use", () => {
    let calls = 0;
    const verify = createWebhookVerifier({
      header: "x-sig",
      format: "raw",
      prefix: "sha256=",
      secret: () => {
        calls += 1;
        return SECRET;
      }
    });
    const sig = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`;
    expect(verify(BODY, headers({ "x-sig": sig }))).toBe(true);
    expect(verify(BODY, headers({ "x-sig": sig }))).toBe(true);
    // Secret getter is memoized after the first call.
    expect(calls).toBe(1);
  });

  it("memoizes the slackWebhookVerifier getter secret across calls", () => {
    let calls = 0;
    const verify = slackWebhookVerifier(() => {
      calls += 1;
      return SECRET;
    });
    const now = Math.floor(Date.now() / 1000);
    const base = new TextEncoder().encode(`v0:${now}:`);
    const payload = new Uint8Array(base.length + BODY.length);
    payload.set(base, 0);
    payload.set(BODY, base.length);
    const sig = `v0=${createHmac("sha256", SECRET).update(payload).digest("hex")}`;
    const h = headers({ "x-slack-signature": sig, "x-slack-request-timestamp": String(now) });
    expect(verify(BODY, h)).toBe(true);
    expect(verify(BODY, h)).toBe(true);
    expect(calls).toBe(1);
  });
});
