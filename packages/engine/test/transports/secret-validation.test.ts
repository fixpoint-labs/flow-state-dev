/** Regression coverage for invalid configured signing and verification secrets. */
import { describe, expect, it, vi } from "vitest";
import { createHmacVerifier } from "../../src/transports/auth/createHmacVerifier";
import { createHs256JwtVerifier } from "../../src/transports/auth/createBearerTokenVerifier";
import { createBearerSecretPrincipalResolver } from "../../src/transports/auth/createBearerSecretPrincipalResolver";
import { createWebhookVerifier, githubWebhookVerifier, slackWebhookVerifier, stripeWebhookVerifier } from "../../src/transports/auth/createWebhookVerifier";
import { signPushTicket, verifyPushTicket } from "../../src/push/ticket";
import { boardPartitionKey } from "../../src/push/partition-key";

const invalidSecrets = ["", undefined, null, 42, false, {}, Buffer.from("key")];
const body = new TextEncoder().encode("payload");
const claims = { sub: "alice", exp: Date.now() + 60_000, topics: [] };

const helpers = {
  createHmacVerifier: (secret: string) => createHmacVerifier({ secret }),
  createHs256JwtVerifier: (secret: string) => createHs256JwtVerifier({ secret }),
  createBearerSecretPrincipalResolver: (secret: string) => createBearerSecretPrincipalResolver({ secret, principal: { userId: "system", orgId: "acme" } }),
  signPushTicket: (secret: string) => signPushTicket(claims, secret),
  verifyPushTicket: (secret: string) => verifyPushTicket("malformed", secret, "alice"),
  boardPartitionKey: (secret: string) => boardPartitionKey(secret, "tenant", "partition")
};

for (const [name, helper] of Object.entries(helpers)) {
  describe(name, () => {
    it.each(invalidSecrets)("rejects invalid secret %j", (secret) => {
      expect(() => helper(secret as string)).toThrow(`${name}: \`secret\` must be a non-empty string.`);
    });
  });
}

const webhooks = {
  createWebhookVerifier: (secret: string | (() => string)) => createWebhookVerifier({ secret, header: "signature" }),
  githubWebhookVerifier,
  stripeWebhookVerifier,
  slackWebhookVerifier
};
for (const [name, factory] of Object.entries(webhooks)) {
  describe(name, () => {
    it.each(invalidSecrets)("rejects invalid static secret %j at construction", (secret) => {
      expect(() => factory(secret as string)).toThrow(/secret.*non-empty string/);
    });
    it.each(invalidSecrets)("rejects invalid lazy secret %j on first use, even without headers", (secret) => {
      const getter = vi.fn(() => secret as string);
      const verify = factory(getter);
      expect(getter).not.toHaveBeenCalled();
      expect(() => verify(body, new Headers())).toThrow(/secret.*non-empty string/);
      // An invalid resolved value must never be cached and subsequently used.
      expect(() => verify(body, new Headers())).toThrow(/secret.*non-empty string/);
    });
  });
}
