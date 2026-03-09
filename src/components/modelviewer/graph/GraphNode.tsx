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
          <button
            aria-label="Expand upwards"
            className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[100%] rounded border border-ui-border bg-white px-1 text-xs hover:bg-slate-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onExpandTop(data.id_array);
            }}
          >
            {data.topExpanded ? "▲" : "△"}
          </button>
        </HoverTooltip>
      ) : null}
      <div
        className="relative min-w-[12rem] rounded-panel border bg-white px-4 py-3 text-center shadow-sm"
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
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                {data.countDistinct == null || data.countTotal == null
                  ? "..."
                  : data.countDistinct === data.countTotal
                    ? String(data.countTotal)
                    : `${String(data.countDistinct)} / ${String(data.countTotal)}`}
              </span>
            </HoverTooltip>
          </div>
          <code className="mt-1 block rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
            {abbreviateType(data.targetPath.rdf_type)}
          </code>
        </div>
      </div>
      {data.hasChildren ? (
        <HoverTooltip
          title={`${data.bottomExpanded ? "collapse" : "expand"} ${String(Object.keys(data.targetPath.children).length)} fields`}
        >
          <button
            aria-label="Expand downwards"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[100%] rounded border border-ui-border bg-white px-1 text-xs hover:bg-slate-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onExpandBottom(data.id_array);
            }}
          >
            {data.bottomExpanded ? "▼" : "▽"}
          </button>
        </HoverTooltip>
      ) : null}
      <HiddenHandle id="bottom" position={Position.Bottom} type="source" />
    </div>
  );
}
