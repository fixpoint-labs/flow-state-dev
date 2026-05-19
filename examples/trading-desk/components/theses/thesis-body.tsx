/**
 * thesis-body — renders the structured body sections of a published memo.
 *
 * Each section is `{ h, p, items }` with `p` and `items` nullable. The
 * renderer keeps the heading, the paragraph when present, and the bullet
 * list when non-empty.
 */
import type { ReactElement } from "react";
import type { MemoCitation, ThesisSection } from "@/src/flows/trading-desk/resources";
import { cn } from "@/lib/utils";

export type ThesisBodyProps = {
  body: ReadonlyArray<ThesisSection>;
  citations?: ReadonlyArray<MemoCitation> | null;
};

export function ThesisBody({ body, citations }: ThesisBodyProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {body.map((section, index) => (
        <section key={`${section.h}-${index}`} className="flex flex-col gap-1.5">
          <h3
            className={cn(
              "font-mono text-[10.5px] uppercase tracking-wider",
              "text-[color:var(--c-fg-faint)]",
            )}
          >
            {section.h}
          </h3>
          {section.p ? (
            <p className="text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
              {section.p}
            </p>
          ) : null}
          {section.items && section.items.length > 0 ? (
            <ul className="ml-3 list-disc text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
              {section.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {citations && citations.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3
            className={cn(
              "font-mono text-[10.5px] uppercase tracking-wider",
              "text-[color:var(--c-fg-faint)]",
            )}
          >
            Sources
          </h3>
          <ul className="ml-3 list-disc text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
            {citations.map((c, i) => (
              <li key={i}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
