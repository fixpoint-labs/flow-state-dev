---
"@flow-state-dev/engine": patch
---

FIX-2807: Reject empty or non-string secrets in HMAC, webhook, HS256 JWT and push helpers. Static secrets fail at construction; lazy secrets fail when resolved. Push still generates a random key when the secret option is omitted, but explicitly invalid values throw.
