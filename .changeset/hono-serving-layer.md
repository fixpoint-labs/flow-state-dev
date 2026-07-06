---
"@flow-state-dev/node": minor
---

Rebuild the serving layer on Hono. `serve()` now runs the engine router on `@hono/node-server` instead of a hand-rolled `node:http`↔Web-Fetch bridge — same signature, same health checks, static/SPA serving, and graceful shutdown, with unbuffered SSE preserved. Adds `createServerApp()` (also at the `@flow-state-dev/node/app` subpath), the portable Hono app that `serve()` wraps, and a `@flow-state-dev/node/aws-lambda` entry (`createLambdaHandler`) for deploying the same app to AWS Lambda response streaming. The internal `handleApiRequest`/`readRequestBody` bridge exports are removed.
