import {
  Background,
  Controls,
  type Edge,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { type Dispatch, useEffect, useMemo, useRef } from "react";

import type { Scenario, ScenarioAction } from "../../scenario";
import type { Pathbuilder } from "../../serializer/pathbuilder";
import { GraphNode as GraphNodeComponent } from "./graph/GraphNode";
import { useGraphTree } from "./graph/useGraphTree";
import type { GraphNode } from "./graph-layout";

interface GraphViewerProps {
  dispatchScenario: Dispatch<ScenarioAction>;
  scenario: Scenario;
  pathbuilder: null | Pathbuilder;
}

const nodeTypes: NodeTypes = { pathNode: GraphNodeComponent };

export function GraphViewer({ dispatchScenario, scenario, pathbuilder }: GraphViewerProps) {
  const { expandedNodeId, graph, rootNodeId } = useGraphTree({
    dispatchScenario,
    scenario,
    pathbuilder,
  });

  return (
    <div aria-label="Graph viewer" className="panel relative min-h-panel flex-1 overflow-hidden">
      <ReactFlowProvider>
        <GraphCanvas expandedNodeId={expandedNodeId} graph={graph} rootNodeId={rootNodeId} />
      </ReactFlowProvider>
      {scenario.nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
          <div className="rounded-panel border border-ui-border bg-surface-alt px-4 py-3 text-sm text-text-strong shadow-sm">
            select a root model to begin exploring the model
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface GraphCanvasProps {
  expandedNodeId: null | string;
  graph: {
    edges: Array<Edge>;
    nodes: Array<GraphNode>;
  };
  rootNodeId?: string;
}

function GraphCanvas({ expandedNodeId, graph, rootNodeId }: GraphCanvasProps) {
  const dynamicallyPositionedNodes = useMemo(() => {
    const rowMap = new Map<number, Array<GraphNode>>();

    for (const node of graph.nodes) {
      const rowNodes = rowMap.get(node.data.row_index);

      if (rowNodes == null) {
        rowMap.set(node.data.row_index, [node]);
        continue;
      }

      rowNodes.push(node);
    }

    const xGap = 260;
    const yGap = 160;
    const indexMap = new Map<string, { index: number; size: number }>();

    for (const rowNodes of rowMap.values()) {
      for (const [index, node] of rowNodes.entries()) {
        indexMap.set(node.id, { index, size: rowNodes.length });
      }
    }

    const positionedNodes = graph.nodes.map((node) => {
      const rowEntry = indexMap.get(node.id);

      if (rowEntry == null) {
        return node;
      }

      const x = (rowEntry.index - (rowEntry.size - 1) / 2) * xGap;
      const y = node.data.row_index * yGap;

      return {
        ...node,
        position: { x, y },
      };
    });

    const rootNode =
      rootNodeId == null ? undefined : positionedNodes.find((node) => node.id === rootNodeId);

    if (rootNode == null) {
      return positionedNodes;
    }

    const rootOffsetX = rootNode.position.x;
    const rootOffsetY = rootNode.position.y;

    return positionedNodes.map((node) => {
      return {
        ...node,
        position: {
          x: node.position.x - rootOffsetX,
          y: node.position.y - rootOffsetY,
        },
      };
    });
  }, [graph.nodes, rootNodeId]);
  const [nodes, setNodes, onNodesChange] = useNodesState(dynamicallyPositionedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const { getViewport, setCenter, setViewport } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const previousNodeXById = useRef(new Map<string, number>());
  const previousRootNodeId = useRef<null | string>(null);
  const previousMinY = useRef<null | number>(null);
  const previousMaxY = useRef<null | number>(null);

  useEffect(() => {
    setNodes(dynamicallyPositionedNodes);
    setEdges(graph.edges);
  }, [dynamicallyPositionedNodes, graph.edges, setEdges, setNodes]);

  useEffect(() => {
    if (rootNodeId == null) {
      previousRootNodeId.current = null;
      return;
    }

    if (previousRootNodeId.current === rootNodeId) {
      return;
    }

    const rootNode = dynamicallyPositionedNodes.find((node) => node.id === rootNodeId);

    if (rootNode == null) {
      previousRootNodeId.current = rootNodeId;
      return;
    }

    const nodeWidth = 192;
    const nodeHeight = 88;

    void setCenter(rootNode.position.x + nodeWidth / 2, rootNode.position.y + nodeHeight / 2, {
      duration: 300,
      zoom: 1,
    });
    previousRootNodeId.current = rootNodeId;
    previousMinY.current = dynamicallyPositionedNodes.reduce((currentMin, node) => {
      return Math.min(currentMin, node.position.y);
    }, 0);
    previousMaxY.current = dynamicallyPositionedNodes.reduce((currentMax, node) => {
      return Math.max(currentMax, node.position.y);
    }, 0);
  }, [dynamicallyPositionedNodes, rootNodeId, setCenter]);

  useEffect(() => {
    const currentNodeXById = new Map(
      dynamicallyPositionedNodes.map((node) => [node.id, node.position.x]),
    );
    const minY = dynamicallyPositionedNodes.reduce((currentMin, node) => {
      return Math.min(currentMin, node.position.y);
    }, 0);
    const maxY = dynamicallyPositionedNodes.reduce((currentMax, node) => {
      return Math.max(currentMax, node.position.y);
    }, 0);
    const previousMin = previousMinY.current;
    const previous = previousMaxY.current;

    const canvasHeight = canvasRef.current?.clientHeight;

    if (canvasHeight == null) {
      previousMinY.current = minY;
      previousMaxY.current = maxY;
      previousNodeXById.current = currentNodeXById;
      return;
    }

    const nodeHeight = 88;
    const rowPadding = 24;
    const topOverflow = 24;
    const viewport = getViewport();
    const previousExpandedNodeX =
      expandedNodeId == null ? undefined : previousNodeXById.current.get(expandedNodeId);
    const currentExpandedNodeX =
      expandedNodeId == null ? undefined : currentNodeXById.get(expandedNodeId);
    const nextViewportX =
      previousExpandedNodeX == null || currentExpandedNodeX == null
        ? viewport.x
        : viewport.x + (previousExpandedNodeX - currentExpandedNodeX) * viewport.zoom;
    const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

    if (previousMin != null && minY < previousMin) {
      const visibleTop = -viewport.y / viewport.zoom;
      const newRowTop = minY - topOverflow - rowPadding;

      if (newRowTop < visibleTop) {
        const panAmount = (visibleTop - newRowTop) * viewport.zoom;

        void setViewport(
          {
            x: nextViewportX,
            y: viewport.y + panAmount,
            zoom: viewport.zoom,
          },
          { duration: 280, ease: easeOutCubic },
        );
      }
    } else if (previous != null && maxY > previous) {
      const visibleBottom = (canvasHeight - viewport.y) / viewport.zoom;
      const newRowBottom = maxY + nodeHeight + rowPadding;

      if (newRowBottom > visibleBottom) {
        const panAmount = (newRowBottom - visibleBottom) * viewport.zoom;

        void setViewport(
          {
            x: nextViewportX,
            y: viewport.y - panAmount,
            zoom: viewport.zoom,
          },
          { duration: 280, ease: easeOutCubic },
        );
      }
    }

    previousMinY.current = minY;
    previousMaxY.current = maxY;
    previousNodeXById.current = currentNodeXById;
  }, [dynamicallyPositionedNodes, expandedNodeId, getViewport, setViewport]);

  return (
    <div ref={canvasRef} className="h-full w-full">
      <ReactFlow
        edges={edges}
        fitView
        minZoom={0.1}
        nodes={nodes}
        nodesDraggable={false}
        nodeTypes={nodeTypes}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
