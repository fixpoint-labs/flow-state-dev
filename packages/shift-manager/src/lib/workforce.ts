/**
 * The user's workers, through Workforce's client: their roster (their own
 * workers and the standard ones, each naming the flow it runs on) and their
 * sessions with each worker, found or started with `ensureWorkerSession`.
 *
 * The client is built over the Lab's one client, so it acts as the same user
 * and carries the same credential on every request.
 *
 * `useWorkforce` lives in Shift Manager, not in a package: `@flow-state-dev/react`
 * may import only `contracts`, `core` and `client`, and `@flow-state-dev/workforce`
 * may not import `react`, so neither package can hold a hook over
 * `createWorkforceClient`. An app builds the same client with `useMemo`.
 */
import { useMemo } from "react";
import { createWorkforceClient, type WorkforceClient } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";

/**
 * The workforce client for the Lab this page reads, one per connection.
 * Throws outside a `LabProvider`.
 */
export function useWorkforce(): WorkforceClient {
  const { client } = useLab();
  return useMemo(() => createWorkforceClient(client), [client]);
}
