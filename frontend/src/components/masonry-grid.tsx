import { Children, type ReactNode, useLayoutEffect, useRef } from "react";

/** Pack cards by their actual height, including when their details expand. */
export function MasonryGrid({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const sizeItem = (content: Element) => {
      const item = content.parentElement;
      if (item) {
        item.style.gridRowEnd = `span ${Math.max(1, Math.ceil(content.getBoundingClientRect().height + gap))}`;
      }
    };
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) sizeItem(entry.target);
    });

    for (const item of grid.children) {
      const content = item.firstElementChild;
      if (content) {
        sizeItem(content);
        observer.observe(content);
      }
    }

    return () => observer.disconnect();
  }, [children]);

  return (
    <div ref={gridRef} className="grid auto-rows-[1px] grid-flow-dense gap-x-4 @3xl:grid-cols-2">
      {Children.map(children, (child) => (
        <div className="min-w-0">
          <div>{child}</div>
        </div>
      ))}
    </div>
  );
}
