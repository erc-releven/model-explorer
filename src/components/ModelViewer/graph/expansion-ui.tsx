import type { PathNodeExpansionOption } from "./expansion-options";

export function renderExpansionIcon(
  direction: "top" | "bottom",
  visibleCount: number,
  totalCount: number,
) {
  if (direction === "top") {
    if (visibleCount === 0) {
      return <span className="text-sm leading-none">△</span>;
    }

    if (visibleCount === totalCount) {
      return <span className="text-sm leading-none">▲</span>;
    }

    return <span className="text-sm leading-none">◭</span>;
  }

  if (visibleCount === 0) {
    return <span className="text-sm leading-none">▽</span>;
  }

  if (visibleCount === totalCount) {
    return <span className="text-sm leading-none">▼</span>;
  }

  return (
    <span className="inline-block rotate-180 text-sm leading-none">◭</span>
  );
}

export function getExpansionTooltip(
  direction: "top" | "bottom",
  visibleCount: number,
  totalCount: number,
  options: Array<PathNodeExpansionOption>,
): string {
  if (totalCount === 1) {
    const option = options[0];
    const targetLabel = direction === "top" ? "parent" : "child";

    if (option == null) {
      return targetLabel;
    }

    return option.visible
      ? `hide ${targetLabel}: ${option.label}`
      : `show ${targetLabel}: ${option.label}`;
  }

  const label = direction === "top" ? "parents" : "children";

  if (visibleCount === 0) {
    return `show ${String(totalCount)} available ${label}; shift-click to show all`;
  }

  if (visibleCount === totalCount) {
    return `all ${String(totalCount)} ${label} visible; shift-click to hide all`;
  }

  return `${String(visibleCount)} of ${String(totalCount)} ${label} visible; shift-click to show all`;
}
