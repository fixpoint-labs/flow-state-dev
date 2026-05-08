/**
 * thesis-body — renders the structured body sections of a published memo.
 *
 * Each section is `{ h, p?, items? }`. The renderer keeps the heading, the
 * optional paragraph, and the optional bullet list.
 */
import type { ReactElement } from "react";
import type { ThesisSection } from "@/src/flows/trading-desk/resources";
import { cn } from "@/lib/utils";

export type ThesisBodyProps = {
  body: ReadonlyArray<ThesisSection>;
};

export function ThesisBody({ body }: ThesisBodyProps): ReactElement {
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
          {"p" in section && section.p !== undefined && section.p !== "" ? (
            <p className="text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
              {section.p}
            </p>
          ) : null}
          {"items" in section && section.items !== undefined && section.items.length > 0 ? (
            <ul className="ml-3 list-disc text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
              {section.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
