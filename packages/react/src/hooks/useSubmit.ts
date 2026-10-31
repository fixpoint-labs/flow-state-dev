/**
 * `useSubmit`: a button's or a form's call that holds its controls while it
 * runs and keeps a refusal to show. Wraps any async call (an adapter's, a
 * client's); `useAction` is the hook for sending one flow action.
 */
import { useState, type FormEvent } from "react";

/** What `useSubmit` returns. */
export interface Submit<A extends unknown[]> {
  /** `true` while the action runs. Bind it to the controls' `disabled`, so a second click can't send it twice. */
  busy: boolean;
  /** The last refusal's message, or `undefined`. Cleared when the action runs again. */
  error: string | undefined;
  /** Runs the action. Pass the form event, if any, to prevent its default; never throws. */
  submit: (event: FormEvent | undefined, ...args: A) => Promise<void>;
}

/**
 * A form's submit, or a button's, that runs `action`, holding the controls while
 * it runs and keeping a refusal to show instead of throwing. Show `error` next
 * to the controls, so a refused call never looks like it worked.
 */
export function useSubmit<A extends unknown[]>(action: (...args: A) => Promise<void>): Submit<A> {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent | undefined, ...args: A) => {
    event?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await action(...args);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}
