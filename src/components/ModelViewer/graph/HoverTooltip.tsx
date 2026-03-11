import { Tooltip, type TooltipProps } from "@mui/material";
import type { ReactElement } from "react";

interface HoverTooltipProps {
  children: ReactElement;
  placement?: TooltipProps["placement"];
  title: TooltipProps["title"];
}

export function HoverTooltip({
  children,
  placement,
  title,
}: HoverTooltipProps) {
  return (
    <Tooltip arrow enterDelay={150} placement={placement} title={title}>
      {children}
    </Tooltip>
  );
}
