interface GraphParseStatusProps {
  graphPathCount: number;
  xmlSourceLabel: string;
  className?: string;
}

export function GraphParseStatus({
  graphPathCount,
  xmlSourceLabel,
  className,
}: GraphParseStatusProps) {
  return (
    <div className={["text-sm text-neutral-600", className ?? ""].join(" ")}>
      Parsed <strong>{graphPathCount}</strong> paths from{" "}
      <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
        {xmlSourceLabel}
      </code>
      .
    </div>
  );
}
