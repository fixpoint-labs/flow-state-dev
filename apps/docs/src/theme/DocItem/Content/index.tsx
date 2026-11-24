/**
 * Wraps a doc page's content so the page register's counters start fresh on
 * every page: `sheets` numbers its `h2` headings ("SECTION 01 —") and `figures`
 * numbers its `<Figure>`s ("FIG. 1 — "). Both rules live in
 * `@flow-state-dev/design-system/page.css`. Above the content sits the page's
 * *Copy page* control.
 */
import type { ComponentProps, ReactElement } from "react";
import Content from "@theme-original/DocItem/Content";
import CopyPage from "@site/src/components/CopyPage";

type Props = ComponentProps<typeof Content>;

/** The doc page's content inside the counters' scope. */
export default function ContentWrapper(props: Props): ReactElement {
  return (
    <div className="sheets figures">
      <CopyPage />
      <Content {...props} />
    </div>
  );
}
