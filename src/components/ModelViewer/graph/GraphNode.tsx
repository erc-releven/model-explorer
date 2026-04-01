import { Button } from "@mui/material";
import { type NodeProps, Position } from "@xyflow/react";

import { abbreviateType } from "../../../serializer/prefixes";
import { graphNodeBorderColors } from "../../../theme/colors";
import type { GraphNode as FlowGraphNode } from "../graph-layout";
import { HiddenHandle } from "./HiddenHandle";
import { HoverTooltip } from "./HoverTooltip";

export function GraphNode({ data }: NodeProps<FlowGraphNode>) {
  const hasEntityReferences = data.targetPath.references.length > 0;
  const isReachedFromBelow = data.id_array.at(-2) === "<";
  const canExpandTop = hasEntityReferences || isReachedFromBelow;
  const nodeBorderColor =
    data.selected === "count"
      ? graphNodeBorderColors.count
      : data.selected != null
        ? graphNodeBorderColors.selected
        : graphNodeBorderColors.default;
  const topTooltip = hasEntityReferences
    ? `${data.topExpanded ? "collapse" : "expand"} ${String(data.targetPath.references.length)} entity references`
    : `${data.topExpanded ? "collapse" : "expand"} parent`;

  return (
    <div>
      <HiddenHandle id="top" position={Position.Top} type="target" />
      {canExpandTop ? (
        <HoverTooltip title={topTooltip}>
          <Button
            aria-label="Expand upwards"
            size="small"
            sx={{
              bgcolor: "background.paper",
              borderRadius: 1,
              color: nodeBorderColor,
              borderColor: nodeBorderColor,
              height: 24,
              left: "50%",
              minWidth: 0,
              p: 0,
              position: "absolute",
              top: 0,
              transform: "translate(-50%, -100%)",
              width: 24,
              "&:hover": {
                borderColor: nodeBorderColor,
              },
            }}
            variant="outlined"
            onClick={(event) => {
              event.stopPropagation();
              data.onExpandTop(data.id_array);
            }}
          >
            {data.topExpanded ? "▲" : "△"}
          </Button>
        </HoverTooltip>
      ) : null}
      <div
        className="relative min-w-[12rem] rounded-panel border bg-surface px-4 py-3 text-center text-text-strong shadow-sm"
        style={{ borderColor: nodeBorderColor }}
        onClick={(event) => {
          data.onSelectNode(data.id_array, event.shiftKey);
        }}
      >
        <div className="inline-block w-full">
          <div className="flex items-start justify-between gap-2 text-left">
            <HoverTooltip placement="top" title={data.id_array.join(" ")}>
              <span className="block text-sm font-semibold">{data.targetPath.name}</span>
            </HoverTooltip>
            <HoverTooltip
              placement="top"
              title={
                data.countDistinct == null || data.countTotal == null
                  ? "fetching instance count..."
                  : `${String(data.countDistinct)} distinct instances, ${String(data.countTotal)} instances total`
              }
            >
              <span className="rounded bg-surface-alt px-2 py-0.5 font-mono text-xs text-muted">
                {data.countDistinct == null || data.countTotal == null
                  ? "..."
                  : data.countDistinct === data.countTotal
                    ? String(data.countTotal)
                    : `${String(data.countDistinct)} / ${String(data.countTotal)}`}
              </span>
            </HoverTooltip>
          </div>
          <code className="mt-1 block rounded bg-surface-alt px-2 py-1 font-mono text-xs text-muted">
            {abbreviateType(data.targetPath.rdf_type)}
          </code>
        </div>
      </div>
      {data.hasChildren ? (
        <HoverTooltip
          title={`${data.bottomExpanded ? "collapse" : "expand"} ${String(Object.keys(data.targetPath.children).length)} fields`}
        >
          <Button
            aria-label="Expand downwards"
            size="small"
            sx={{
              bgcolor: "background.paper",
              bottom: 0,
              borderRadius: 1,
              color: nodeBorderColor,
              borderColor: nodeBorderColor,
              height: 24,
              left: "50%",
              minWidth: 0,
              p: 0,
              position: "absolute",
              transform: "translate(-50%, 100%)",
              width: 24,
              "&:hover": {
                borderColor: nodeBorderColor,
              },
            }}
            variant="outlined"
            onClick={(event) => {
              event.stopPropagation();
              data.onExpandBottom(data.id_array);
            }}
          >
            {data.bottomExpanded ? "▼" : "▽"}
          </Button>
        </HoverTooltip>
      ) : null}
      <HiddenHandle id="bottom" position={Position.Bottom} type="source" />
    </div>
  );
}
