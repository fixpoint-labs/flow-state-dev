/**
 * Wraps a doc page's content so the page register's counters start fresh on
 * every page: `sheets` numbers its `h2` headings ("SHEET 01 —") and `figures`
 * numbers its `<Figure>`s ("FIG. 1 — "). Both rules live in
 * `@flow-state-dev/design-system/page.css`.
 */
import type { ComponentProps, ReactElement } from "react";
import Content from "@theme-original/DocItem/Content";

type Props = ComponentProps<typeof Content>;

/** The doc page's content inside the counters' scope. */
export default function ContentWrapper(props: Props): ReactElement {
  return (
    <div className="sheets figures">
      <Content {...props} />
    </div>
  );
}
