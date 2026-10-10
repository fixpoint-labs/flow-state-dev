/**
 * The person's workers, through Workforce's client: their roster (their own
 * workers and the standard ones, each naming the flow it runs on) and their
 * sessions with each worker, found or started with `ensureWorkerSession`.
 *
 * The client is built from the Lab connection every other read uses, so it
 * acts as the same person and carries the same credential on every request.
 *
 * `useWorkforce` lives in Shift Manager, not in a package: `@flow-state-dev/react`
 * may import only `contracts`, `core` and `client`, and `@flow-state-dev/workforce`
 * may not import `react`, so neither package can hold a hook over
 * `createWorkforceClient`. An app builds the same client with `useMemo`.
 */
import { useMemo } from "react";
import type { WorkforceClient } from "@flow-state-dev/workforce/browser";
import { workforceClientFor } from "./connection";
import { useLab } from "./lab-data";

// Built in `connection`, beside the clients it is made from, so the Lab reader can build one too.
export { workforceClientFor };

/**
 * The workforce client for the Lab this page reads, one per connection.
 * Throws outside a `LabProvider`.
 */
export function useWorkforce(): WorkforceClient {
  const { clients } = useLab();
  return useMemo(() => workforceClientFor(clients), [clients]);
}
