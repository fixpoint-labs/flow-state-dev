---
"@flow-state-dev/engine": patch
"@flow-state-dev/node": patch
"@flow-state-dev/next": patch
"@flow-state-dev/vercel": patch
"@flow-state-dev/fsdev": patch
---

FIX-2805: Enforce the unauthenticated-flow guard inside `serve()` before network binds. Lambda, Next, and Vercel handlers now return 500 in production when a flow uses the default principal resolver, logging the diagnostic once per handler. Loopback Node binds and development serverless handlers remain available; explicitly set `allowUnauthenticated: true` to override. fsdev forwards its existing flag to `serve()`.
