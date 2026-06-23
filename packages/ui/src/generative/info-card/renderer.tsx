/**
 * `<InfoCardRenderer />` — default renderer for the `info-card` component shape.
 *
 * Plain Tailwind classnames; no shadcn-primitive dependency so it is safe to
 * import at runtime from `@flow-state-dev/ui/generative/renderers`. Apps that want a
 * fancier card can install the registry-distributed variant and override
 * `renderers.component["info-card"]` on FlowProvider.
 */
import type { ComponentItem } from "@flow-state-dev/contracts";
import type { InfoCardData } from "./schema";

export function InfoCardRenderer({ item }: { item: ComponentItem }) {
  const data = item.data as InfoCardData;
  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden max-w-md">
      {data.imageUrl ? (
        <div className="aspect-[16/9] bg-muted overflow-hidden">
          <img
            src={data.imageUrl}
            alt={data.title}
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}
      <div className="p-4 space-y-2">
        <div>
          <h3 className="text-base font-semibold leading-tight">{data.title}</h3>
          {data.subtitle ? (
            <p className="text-sm text-muted-foreground mt-0.5">{data.subtitle}</p>
          ) : null}
        </div>
        {data.facts.length > 0 ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            {data.facts.map((fact, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {data.footer ? (
          <p className="text-xs text-muted-foreground pt-1 border-t border-border">
            {data.footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}
