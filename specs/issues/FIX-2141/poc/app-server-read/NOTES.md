# POC · read Codex's usage through app-server

**Question.** Does the pinned Codex CLI answer `account/rateLimits/read` with no run, and can a
reader tell "signed out" from "API key" without guessing?

**Run.** `node specs/issues/FIX-2141/poc/app-server-read/read.mjs <codex>` with `<codex>` the
binary shipped in `@openai/codex` 0.152.1 (the version beside `@openai/codex-sdk` 0.152.1, the
Codex harness's tested pin). `CODEX_HOME` pointed at an empty folder, then at one where
`codex login --with-api-key` stored a fake key. Run on 2026-10-23.

**Signed out:**

```json
{
  "account": {
    "id": 2,
    "result": {
      "account": null,
      "requiresOpenaiAuth": true
    }
  },
  "rateLimits": {
    "error": {
      "code": -32600,
      "message": "codex account authentication required to read rate limits"
    },
    "id": 3
  }
}
```

**API key:**

```json
{
  "account": {
    "id": 2,
    "result": {
      "account": {
        "type": "apiKey"
      },
      "requiresOpenaiAuth": true
    }
  },
  "rateLimits": {
    "error": {
      "code": -32600,
      "message": "chatgpt authentication required to read rate limits"
    },
    "id": 3
  }
}
```

**Signed-in shape**, from `codex app-server generate-ts` on the same binary (not seen live; that
needs a ChatGPT sign-in, and is goal leg f):

```ts
type GetAccountRateLimitsResponse = {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: { [limitId: string]?: RateLimitSnapshot } | null;
  accountId: string | null;
  // also rateLimitResetCredits, rateLimitUpsell
};
type RateLimitSnapshot = {
  limitId: string | null; limitName: string | null;
  primary: RateLimitWindow | null; secondary: RateLimitWindow | null;
  planType: PlanType | null; credits: CreditsSnapshot | null;
  // also individualLimit, spendControlReached, rateLimitReachedType
};
type RateLimitWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
type Account = { type: "apiKey" } | { type: "chatgpt"; email: string | null; planType: PlanType } | { type: "amazonBedrock"; usesCodexManagedCredentials: boolean };
```

**Result.** The premise holds. The read needs no run, and `account/read` separates the two
no-number states (`account: null` against `type: "apiKey"`), so the reader never infers one from
an error message. Throwaway: this script is evidence, not the reader.
