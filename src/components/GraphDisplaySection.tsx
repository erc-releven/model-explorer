import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import colors from "tailwindcss/colors";

interface RootGroupOption {
  id: string;
  name: string;
}
type RootGroupSortMode = "frequency" | "name";

interface ActiveGroupSummary {
  name: string;
  typeLabel: string;
}

interface GraphDisplaySectionProps {
  sortedGroups: Array<RootGroupOption>;
  groupReferenceCounts: Record<string, number>;
  activeGroupId: string;
  onSelectGroup: (groupId: string) => void;
  showNoModelMessage: boolean;
  activeGroup: ActiveGroupSummary | null;
  flowViewportRef: React.RefObject<HTMLDivElement | null>;
  flow: { nodes: Array<Node>; edges: Array<Edge> } | null;
  onFlowInit: (instance: ReactFlowInstance) => void;
  onFlowNodeClick: (event: React.MouseEvent, node: Node) => void;
}

const FIRST_SELECTED_NODE_COLOR = colors.red[600];
const NORMAL_SELECTED_NODE_COLOR = colors.slate[600];
const NODE_SELECTION_SEPARATOR_COLOR = colors.white;

export const COUNT_HIGHLIGHT_GREEN = colors.green[700];
export const NODE_REFERENCE_LABEL_TEXT_COLOR = colors.zinc[700];
export const NODE_REFERENCE_LABEL_BG_COLOR = colors.white;
export const FALLBACK_REFERENCED_GROUP_COLOR = colors.sky[100];
export const GROUP_COLOR_PALETTE: Array<string> = [
  colors.sky[100],
  colors.cyan[100],
  colors.teal[100],
  colors.emerald[100],
  colors.lime[100],
  colors.amber[100],
  colors.orange[100],
  colors.rose[100],
  colors.fuchsia[100],
  colors.violet[100],
  colors.indigo[100],
  colors.blue[100],
];

export function getNodeBorderClass(classification: string): string {
  if (classification === "model") {
    return "border-2 border-neutral-400";
  }
  return "border border-neutral-300";
}

export function getNodeContainerClass(
  isGroupLike: boolean,
  nodeBorderClass: string,
): string {
  if (isGroupLike) {
    return `overflow-visible h-auto rounded-xl min-w-[170px] min-h-[64px] px-3 py-2 ${nodeBorderClass}`;
  }
  return `overflow-visible h-auto w-max max-w-none rounded-full min-w-[132px] min-h-[52px] px-[10px] py-[6px] ${nodeBorderClass}`;
}

export function getNodeBorderRadius(isGroupLike: boolean): string {
  return isGroupLike ? "0.75rem" : "9999px";
}

export function getSelectionDoubleBorderShadow({
  isFirstSelected,
  isCountNode,
  isSelected,
  isImplicitlySelected,
}: {
  isFirstSelected: boolean;
  isCountNode: boolean;
  isSelected: boolean;
  isImplicitlySelected: boolean;
}): string {
  if (isFirstSelected && isCountNode) {
    return [
      `0 0 0 2px ${NODE_SELECTION_SEPARATOR_COLOR}`,
      `0 0 0 4px ${FIRST_SELECTED_NODE_COLOR}`,
      `0 0 0 6px ${NODE_SELECTION_SEPARATOR_COLOR}`,
      `0 0 0 8px ${COUNT_HIGHLIGHT_GREEN}`,
    ].join(", ");
  }
  if (isFirstSelected) {
    return `0 0 0 2px ${NODE_SELECTION_SEPARATOR_COLOR}, 0 0 0 4px ${FIRST_SELECTED_NODE_COLOR}`;
  }
  if (isCountNode) {
    return `0 0 0 2px ${NODE_SELECTION_SEPARATOR_COLOR}, 0 0 0 4px ${COUNT_HIGHLIGHT_GREEN}`;
  }
  if (isImplicitlySelected) {
    return "none";
  }
  if (isSelected) {
    return `0 0 0 2px ${NODE_SELECTION_SEPARATOR_COLOR}, 0 0 0 4px ${NORMAL_SELECTED_NODE_COLOR}`;
  }
  return "none";
}

export function GraphDisplaySection({
  sortedGroups,
  groupReferenceCounts,
  activeGroupId,
  onSelectGroup,
  showNoModelMessage,
  activeGroup,
  flowViewportRef,
  flow,
  onFlowInit,
  onFlowNodeClick,
}: GraphDisplaySectionProps) {
  const [rootGroupSortMode, setRootGroupSortMode] =
    useState<RootGroupSortMode>("frequency");
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const distanceFromRootByNodeId = useMemo(() => {
    const distances = new Map<string, number>();
    if (!flow || !activeGroupId) {
      return distances;
    }

    const nodeIds = new Set(flow.nodes.map((node) => node.id));
    if (!nodeIds.has(activeGroupId)) {
      return distances;
    }

    const adjacency = new Map<string, Set<string>>();
    for (const nodeId of nodeIds) {
      adjacency.set(nodeId, new Set<string>());
    }
    for (const edge of flow.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        continue;
      }
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    }

    const queue: Array<string> = [activeGroupId];
    distances.set(activeGroupId, 0);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDistance = distances.get(current) ?? 0;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (distances.has(neighbor)) {
          continue;
        }
        distances.set(neighbor, currentDistance + 1);
        queue.push(neighbor);
      }
    }
    return distances;
  }, [activeGroupId, flow]);
  const sourcePathIdByDisplayId = useMemo(() => {
    const map = new Map<string, string>();
    if (!flow) {
      return map;
    }
    for (const node of flow.nodes) {
      const sourcePathId = (
        (node.data as { sourcePathId?: unknown } | undefined)?.sourcePathId ??
        ""
      )
        .toString()
        .trim();
      if (sourcePathId.length > 0) {
        map.set(node.id, sourcePathId);
      }
    }
    return map;
  }, [flow]);
  const displayedRootGroups = useMemo(() => {
    const next = [...sortedGroups];
    if (rootGroupSortMode === "name") {
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    }
    next.sort((a, b) => {
      const aCount = groupReferenceCounts[a.id] ?? 0;
      const bCount = groupReferenceCounts[b.id] ?? 0;
      return bCount - aCount || a.name.localeCompare(b.name);
    });
    return next;
  }, [groupReferenceCounts, rootGroupSortMode, sortedGroups]);

  const resolveEdgeReferenceNodeId = (edge: Edge): string => {
    const raw = (edge.data as { edgeReferenceNodeId?: unknown } | undefined)
      ?.edgeReferenceNodeId;
    return typeof raw === "string" ? raw.trim() : "";
  };
  const resolveEdgeTooltipText = (edge: Edge): string => {
    const edgeReferenceNodeId = resolveEdgeReferenceNodeId(edge);
    if (edgeReferenceNodeId !== "") {
      return edgeReferenceNodeId;
    }

    const sourceDistance = distanceFromRootByNodeId.get(edge.source);
    const targetDistance = distanceFromRootByNodeId.get(edge.target);
    if (
      sourceDistance !== undefined &&
      targetDistance !== undefined &&
      sourceDistance !== targetDistance
    ) {
      const forwardDisplayId =
        sourceDistance > targetDistance ? edge.source : edge.target;
      return sourcePathIdByDisplayId.get(forwardDisplayId) ?? forwardDisplayId;
    }
    if (targetDistance !== undefined) {
      return sourcePathIdByDisplayId.get(edge.target) ?? edge.target;
    }
    if (sourceDistance !== undefined) {
      return sourcePathIdByDisplayId.get(edge.source) ?? edge.source;
    }
    return sourcePathIdByDisplayId.get(edge.target) ?? edge.target;
  };
  const resolveEdgeForwardNodeId = (edge: Edge): string => {
    const sourceDistance = distanceFromRootByNodeId.get(edge.source);
    const targetDistance = distanceFromRootByNodeId.get(edge.target);
    if (
      sourceDistance !== undefined &&
      targetDistance !== undefined &&
      sourceDistance !== targetDistance
    ) {
      return sourceDistance > targetDistance ? edge.source : edge.target;
    }
    if (targetDistance !== undefined) {
      return edge.target;
    }
    if (sourceDistance !== undefined) {
      return edge.source;
    }
    return edge.target;
  };

  const updateEdgeTooltip = (event: React.MouseEvent, edge: Edge): void => {
    const container = flowViewportRef.current;
    if (!container) {
      setEdgeTooltip(null);
      return;
    }
    const bounds = container.getBoundingClientRect();
    setEdgeTooltip({
      text: resolveEdgeTooltipText(edge),
      x: event.clientX - bounds.left + 12,
      y: event.clientY - bounds.top + 12,
    });
  };
  const handleEdgeClick = (edge: Edge): void => {
    const instance = reactFlowInstance;
    const container = flowViewportRef.current;
    if (!instance || !container) {
      return;
    }

    const targetNodeId = resolveEdgeForwardNodeId(edge);
    const node = instance.getNode(targetNodeId);
    if (!node) {
      return;
    }

    const viewport = instance.getViewport();
    const zoom = viewport.zoom <= 0 ? 1 : viewport.zoom;
    const visibleFlowWidth = container.clientWidth / zoom;
    const visibleFlowHeight = container.clientHeight / zoom;
    const visibleMinX = -viewport.x / zoom;
    const visibleMaxX = visibleMinX + visibleFlowWidth;
    const visibleMinY = -viewport.y / zoom;
    const visibleMaxY = visibleMinY + visibleFlowHeight;

    const nodeX = node.position.x;
    const nodeY = node.position.y;
    const nodeWidth = node.measured?.width ?? node.width ?? 0;
    const nodeHeight = node.measured?.height ?? node.height ?? 0;
    const nodeCenterX = nodeX + nodeWidth / 2;
    const nodeCenterY = nodeY + nodeHeight / 2;

    const isNodeVisible =
      nodeCenterX >= visibleMinX &&
      nodeCenterX <= visibleMaxX &&
      nodeCenterY >= visibleMinY &&
      nodeCenterY <= visibleMaxY;
    if (isNodeVisible) {
      return;
    }

    void instance.setCenter(nodeCenterX, nodeCenterY, {
      duration: 220,
      zoom,
    });
  };

  return (
    <>
      {showNoModelMessage ? (
        <p className="rounded-md border border-neutral-300 bg-white p-3 text-neutral-700">
          No model elements found in the loaded XML file.
        </p>
      ) : null}

      {activeGroup ? (
        <div className="mt-2">
          <h3 className="text-lg font-semibold">Model exploration</h3>
          <div className="min-w-0 w-full">
            Select a root type to begin exploring the model. Root type sort
            order:
            <div className="inline-flex flex-col items-stretch gap-1 rounded-md border border-neutral-300 bg-white p-1 text-xs text-neutral-700">
              <Button
                className={[
                  "rounded px-2 py-0.5",
                  rootGroupSortMode === "frequency"
                    ? "bg-neutral-800 text-white"
                    : "hover:bg-neutral-100",
                ].join(" ")}
                onPress={() => {
                  setRootGroupSortMode("frequency");
                }}
              >
                # entity references
              </Button>
              <Button
                className={[
                  "rounded px-2 py-0.5",
                  rootGroupSortMode === "name"
                    ? "bg-neutral-800 text-white"
                    : "hover:bg-neutral-100",
                ].join(" ")}
                onPress={() => {
                  setRootGroupSortMode("name");
                }}
              >
                name
              </Button>
            </div>
            <div className="root-group-scroll flex flex-1 flex-wrap items-center gap-2 pb-1">
              {displayedRootGroups.map((group) => (
                <Button
                  key={group.id}
                  className="rounded-full border border-neutral-400 bg-white px-2.5 py-1 text-xs font-medium text-neutral-900 shadow-sm hover:bg-neutral-100 whitespace-nowrap"
                  onPress={() => {
                    onSelectGroup(group.id);
                  }}
                >
                  {group.name} [{groupReferenceCounts[group.id] ?? 0}]
                </Button>
              ))}
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              Click on nodes to add them to a model sub-selection, shift click
              to add them as count nodes.
            </p>
            <div
              ref={flowViewportRef}
              className="relative mt-4 h-[29.4rem] w-full overflow-hidden rounded-xl border border-neutral-200"
            >
              {flow ? (
                <ReactFlow
                  onInit={(instance) => {
                    setReactFlowInstance(instance);
                    onFlowInit(instance);
                  }}
                  fitView
                  fitViewOptions={{ padding: 0.15 }}
                  minZoom={0.02}
                  nodes={flow.nodes}
                  edges={flow.edges}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  onNodeClick={onFlowNodeClick}
                  onEdgeClick={(_, edge) => {
                    handleEdgeClick(edge);
                  }}
                  onEdgeMouseEnter={(event, edge) => {
                    updateEdgeTooltip(event, edge);
                  }}
                  onEdgeMouseMove={(event, edge) => {
                    updateEdgeTooltip(event, edge);
                  }}
                  onEdgeMouseLeave={() => {
                    setEdgeTooltip(null);
                  }}
                >
                  <Controls />
                  <Background gap={16} />
                </ReactFlow>
              ) : null}
              {edgeTooltip ? (
                <div
                  className="pointer-events-none absolute z-50 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md"
                  style={{ left: edgeTooltip.x, top: edgeTooltip.y }}
                >
                  {edgeTooltip.text}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
