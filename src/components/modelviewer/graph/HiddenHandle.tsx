import { Handle, type HandleProps } from "@xyflow/react";

const hiddenHandleStyle = {
  background: "transparent",
  border: "none",
  opacity: 0,
} as const;

export function HiddenHandle(props: HandleProps) {
  return <Handle {...props} style={hiddenHandleStyle} />;
}
