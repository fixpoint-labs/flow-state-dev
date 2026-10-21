/**
 * Doc content only, so each page's sheet and figure counters start at 1.
 * The rules live in `@flow-state-dev/design-system/page.css`.
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
