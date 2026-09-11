/**
 * Does a pi extension get resolved provider auth it could hand to FSD?
 * Writes auth-probe.json. Reports SHAPE and PRESENCE only — never key material.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OUT = new URL("./auth-probe.json", import.meta.url).pathname;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const findings: Record<string, unknown> = {};
    const anyCtx = ctx as any;

    findings.hasModelRegistry = Boolean(anyCtx.modelRegistry);
    findings.hasComplete = typeof anyCtx.modelRegistry?.complete === "function";
    findings.isUsingOAuth = {
      anthropic: anyCtx.modelRegistry?.isUsingOAuth?.("anthropic") ?? null,
    };
    findings.registryMethods = anyCtx.modelRegistry
      ? Object.getOwnPropertyNames(
          Object.getPrototypeOf(anyCtx.modelRegistry),
        ).filter((m) => m !== "constructor")
      : [];

    for (const id of ["anthropic", "openai-codex", "xai"]) {
      try {
        const auth = await anyCtx.modelRegistry?.getProviderAuth?.(id);
        findings[id] = auth
          ? {
              keys: Object.keys(auth),
              source: auth.source ?? null,
              authKeys: auth.auth ? Object.keys(auth.auth) : [],
              authKinds: auth.auth
                ? Object.fromEntries(
                    Object.entries(auth.auth).map(([k, v]) => [
                      k,
                      typeof v === "string" ? `string(${v.length})` : typeof v,
                    ]),
                  )
                : {},
              // Presence and shape only. Never the secret itself.
              apiKeyPresent: Boolean(auth.apiKey),
              apiKeyPrefix:
                typeof auth.apiKey === "string"
                  ? auth.apiKey.slice(0, 4)
                  : null,
              headerNames: auth.headers ? Object.keys(auth.headers) : [],
              baseUrl: auth.baseUrl ?? null,
              envNames: auth.env ? Object.keys(auth.env) : [],
            }
          : { resolved: false };
      } catch (error) {
        findings[id] = { error: String(error).slice(0, 200) };
      }
    }

    const { writeFileSync } = await import("node:fs");
    writeFileSync(OUT, JSON.stringify(findings, null, 2));
  });
}
