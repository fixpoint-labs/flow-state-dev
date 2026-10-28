/**
 * A numbered, framed diagram for a docs page.
 *
 * The drawing is an SVG imported in MDX, which Docusaurus's SVGR turns into a
 * React component, so it is inlined into the page: its text takes the page's
 * fonts, and its lines and fills take the page's tokens and colour mode
 * through the drawing classes in `@flow-state-dev/design-system/page.css`.
 *
 * ```mdx
 * import Figure from "@site/src/components/Figure";
 * import Scopes from "./state-scopes.svg";
 *
 * <Figure svg={Scopes} caption="The four state scopes" description="Request, session, …" />
 * ```
 *
 * The caption is the figure's visible title and, through `aria-labelledby`,
 * the drawing's accessible name; `description` is its long description. The number ("FIG. 2 — ") is a
 * CSS counter, reset once per page, so figures number in page order.
 */
import type { ComponentType, ReactElement, SVGProps } from "react";
import { useId } from "react";

/** The props SVGR's component takes: SVG attributes, plus its title and description. */
export type DrawingProps = SVGProps<SVGSVGElement> & {
  title?: string;
  titleId?: string;
  desc?: string;
  descId?: string;
};

export interface FigureProps {
  /** The drawing: the default export of an imported `.svg` file. */
  svg: ComponentType<DrawingProps>;
  /** The figure's title, shown in the caption band after its number. Also the drawing's accessible name. */
  caption: string;
  /** What the drawing shows, in full, for a reader who cannot see it. */
  description: string;
}

/** A framed, numbered figure whose drawing is inlined into the page. */
export default function Figure({ svg: Drawing, caption, description }: FigureProps): ReactElement {
  const id = useId();
  const captionId = `${id}-caption`;
  const descId = `${id}-desc`;
  // The caption names both the figure and the drawing (no SVG <title>, so it is
  // neither read twice nor shown again as a tooltip); the description is the SVG's <desc>.
  return (
    <figure className="figure">
      <figcaption className="figure__caption" id={captionId}>
        {caption}
      </figcaption>
      <div className="figure__body">
        <Drawing
          className="drawing"
          role="img"
          desc={description}
          descId={descId}
          aria-labelledby={captionId}
          aria-describedby={descId}
        />
      </div>
    </figure>
  );
}
