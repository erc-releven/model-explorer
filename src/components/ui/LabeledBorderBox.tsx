import type { ReactNode } from "react";

interface LabeledBorderBoxProps {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  label: string;
}

export function LabeledBorderBox({ action, children, className, label }: LabeledBorderBoxProps) {
  return (
    <fieldset className={`rounded-panel border border-ui-border p-3 ${className ?? ""}`.trim()}>
      <legend className="px-1">
        <span className="inline-flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
          {action}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}
