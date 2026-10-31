import { useEffect, useEffectEvent, useRef } from "react";

import { observeIntersection } from "../../lib/observeIntersection";

const LOAD_AHEAD_PX = 320;

export function SettledShelfMoreRow(props: {
  readonly canShowMore: boolean;
  readonly failed: boolean;
  readonly onShowMore: () => void;
  readonly onRetry: () => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const showMore = useEffectEvent(props.onShowMore);
  const { canShowMore } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the row in the sidebar scroller; callers remount it per page so a row still in view loads the next one
  useEffect(() => {
    const row = rowRef.current;
    if (row === null || !canShowMore) return;
    return observeIntersection(
      row,
      (entry) => {
        if (entry.isIntersecting) showMore();
      },
      {
        root: row.closest('[data-slot="scroll-area-viewport"]'),
        rootMargin: `${LOAD_AHEAD_PX}px 0px`,
      },
    );
  }, [canShowMore]);

  return (
    <li className="list-none">
      <button
        ref={rowRef}
        type="button"
        role="treeitem"
        tabIndex={-1}
        data-sidebar-row="settled:more"
        data-sidebar-parent="shelf:settled"
        disabled={!props.failed}
        onClick={props.onRetry}
        className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-sidebar-muted-foreground"
      >
        {props.failed ? "Could not load older threads. Retry" : "Loading"}
      </button>
    </li>
  );
}
