/**
 * The fixture app's Node server (FIX-2368): its `FlowState` on `serve()`,
 * with the built page from `STATIC_DIR` beside the API, on `PORT`. A
 * process-only process serves nothing and runs the queue.
 *
 * The runner forks this file once per process (`goals/lib/peers.mts`) and
 * asks it only for its port and to stop.
 */
import { serve } from "@flow-state-dev/node";
import { servePeer } from "../../../lib/peers.mts";
import { app, workerOnly } from "./flowstate.ts";

if (workerOnly) {
  await app.ready();
  servePeer({ port: () => 0, stop: () => app.dispose() });
} else {
  const handle = await serve(app, {
    port: Number(process.env.PORT),
    host: "127.0.0.1",
    staticDir: process.env.STATIC_DIR,
    handleSignals: false,
    shutdownGraceMs: 500
  });
  servePeer({ port: () => handle.port, stop: () => handle.close() });
}
