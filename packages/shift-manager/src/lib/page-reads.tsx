/**
 * The reads a screen holds, for R to read again. Each screen read registers
 * its read-again with {@link useReadAgainOnR} while it is mounted, and R reads
 * again every one registered, beside the directory's and the Inbox view's: a
 * user pressing R on Messages reads the message log again, and on a project
 * its workstreams. Outside a {@link PageReadsProvider} (a component under test
 * on its own) registering does nothing.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";

const PageReadsContext = createContext<Set<() => void> | null>(null);

/** Hold the page's registered reads. */
export function PageReadsProvider({ children }: { children: ReactNode }) {
  const reads = useRef(new Set<() => void>()).current;
  return <PageReadsContext.Provider value={reads}>{children}</PageReadsContext.Provider>;
}

/** Register `readAgain` for R while the calling component is mounted. */
export function useReadAgainOnR(readAgain: () => void): void {
  const reads = useContext(PageReadsContext);
  useEffect(() => {
    if (reads === null) return;
    reads.add(readAgain);
    return () => {
      reads.delete(readAgain);
    };
  }, [reads, readAgain]);
}

/** Read again every read the page's screens registered. */
export function useReadPageAgain(): () => void {
  const reads = useContext(PageReadsContext);
  return useCallback(() => {
    for (const readAgain of [...(reads ?? [])]) readAgain();
  }, [reads]);
}
