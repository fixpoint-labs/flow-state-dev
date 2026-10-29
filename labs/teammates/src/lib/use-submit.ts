import { useState, type FormEvent } from "react";

/**
 * A form's submit, or a button's, that runs `action`, holding the controls while
 * it runs and keeping a refusal to show instead of throwing.
 */
export function useSubmit<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent | undefined, ...args: A) => {
    e?.preventDefault();
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
