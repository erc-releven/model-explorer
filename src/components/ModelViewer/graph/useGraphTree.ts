import type { Edge } from "@xyflow/react";
import { type Dispatch, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createDefaultNodeState, type Scenario, type ScenarioAction } from "../../../scenario";
import type { Pathbuilder } from "../../../serializer/pathbuilder";
import { fetchCountForNodePath } from "../../../serializer/sparql-query";
import { graphEdgeColors, graphNodeBorderColors } from "../../../theme/colors";
import { createGraphFromScenario } from "../graph-layout";
import { resolveTargetPathForNodePath, stringifyPath } from "./graph-paths";

interface UseGraphTreeParams {
  dispatchScenario: Dispatch<ScenarioAction>;
  scenario: Scenario;
  pathbuilder: null | Pathbuilder;
}

function areNodePathsEqual(left: Array<string>, right: Array<string>): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function hasPrefix(path: Array<string>, prefix: Array<string>): boolean {
  if (path.length < prefix.length) {
    return false;
  }

  return prefix.every((part, index) => path[index] === part);
}

function appendVisibleNodes(
  nodes: Scenario["nodes"],
  nextPaths: Array<Array<string>>,
): Scenario["nodes"] {
  const nextNodes = [...nodes];

  for (const path of nextPaths) {
    if (nextNodes.some((node) => areNodePathsEqual(node.id, path))) {
      continue;
    }

    nextNodes.push(createDefaultNodeState(path));
  }

  return nextNodes;
}

function removeVisibleSubtree(
  nodes: Scenario["nodes"],
  rootPath: Array<string>,
): Scenario["nodes"] {
  return nodes.filter((node) => !hasPrefix(node.id, rootPath));
}

function setOptionVisibility(
  nodes: Scenario["nodes"],
  optionPaths: Array<Array<string>>,
  visible: boolean,
): Scenario["nodes"] {
  if (visible) {
    return appendVisibleNodes(nodes, optionPaths);
  }

  return optionPaths.reduce((nextNodes, optionPath) => {
    return removeVisibleSubtree(nextNodes, optionPath);
  }, nodes);
}

function getConnectedSelectedEdgeIds(
  edges: Array<Edge>,
  selectedNodeIds: Array<string>,
): Set<string> {
  const edgeIds = new Set<string>();

  if (selectedNodeIds.length < 2) {
    return edgeIds;
  }

  const adjacency = new Map<string, Array<{ edgeId: string; nodeId: string }>>();

  for (const edge of edges) {
    const sourceNeighbors = adjacency.get(edge.source) ?? [];
    sourceNeighbors.push({ edgeId: edge.id, nodeId: edge.target });
    adjacency.set(edge.source, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.target) ?? [];
    targetNeighbors.push({ edgeId: edge.id, nodeId: edge.source });
    adjacency.set(edge.target, targetNeighbors);
  }

  for (const [sourceIndex, sourceNodeId] of selectedNodeIds.entries()) {
    const queue = [sourceNodeId];
    const visited = new Set([sourceNodeId]);
    const previousByNode = new Map<string, { edgeId: string; nodeId: string }>();

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;
      const neighbors = adjacency.get(currentNodeId) ?? [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }

        visited.add(neighbor.nodeId);
        previousByNode.set(neighbor.nodeId, {
          edgeId: neighbor.edgeId,
          nodeId: currentNodeId,
        });
        queue.push(neighbor.nodeId);
      }
    }

    for (
      let targetIndex = sourceIndex + 1;
      targetIndex < selectedNodeIds.length;
      targetIndex += 1
    ) {
      let cursor = selectedNodeIds[targetIndex]!;

      while (cursor !== sourceNodeId) {
        const previous = previousByNode.get(cursor);

        if (previous == null) {
          break;
        }

        edgeIds.add(previous.edgeId);
        cursor = previous.nodeId;
      }
    }
  }

  return edgeIds;
}

function getGreenEdgeIds(
  connectedEdgeIds: Set<string>,
  countNodeIds: Array<string>,
  selectedNodeIds: Array<string>,
  edges: Array<Edge>,
): Set<string> {
  if (countNodeIds.length === 0 || connectedEdgeIds.size === 0) {
    return new Set();
  }

  // Build adjacency restricted to connected selected edges only.
  const adjacency = new Map<string, Array<{ edgeId: string; nodeId: string }>>();

  for (const edge of edges) {
    if (!connectedEdgeIds.has(edge.id)) {
      continue;
    }

    const sourceNeighbors = adjacency.get(edge.source) ?? [];
    sourceNeighbors.push({ edgeId: edge.id, nodeId: edge.target });
    adjacency.set(edge.source, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.target) ?? [];
    targetNeighbors.push({ edgeId: edge.id, nodeId: edge.source });
    adjacency.set(edge.target, targetNeighbors);
  }

  const selectedNodeSet = new Set(selectedNodeIds);
  const greenEdgeIds = new Set<string>();

  // For each count node, BFS through the connected subgraph and trace paths
  // to all adjacent selected nodes in either direction.
  for (const countNodeId of countNodeIds) {
    const queue = [countNodeId];
    const visited = new Set([countNodeId]);
    const previousByNode = new Map<string, { edgeId: string; nodeId: string }>();

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;

      for (const neighbor of adjacency.get(currentNodeId) ?? []) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }

        visited.add(neighbor.nodeId);
        previousByNode.set(neighbor.nodeId, { edgeId: neighbor.edgeId, nodeId: currentNodeId });
        queue.push(neighbor.nodeId);
      }
    }

    for (const targetId of selectedNodeIds) {
      if (targetId === countNodeId || !previousByNode.has(targetId)) {
        continue;
      }

      let cursor = targetId;

      while (cursor !== countNodeId) {
        const previous = previousByNode.get(cursor);

        if (previous == null) {
          break;
        }

        greenEdgeIds.add(previous.edgeId);
        cursor = previous.nodeId;
      }
    }
  }

  return greenEdgeIds;
}

export function useGraphTree({
  dispatchScenario: dispatchModelState,
  scenario: modelState,
  pathbuilder,
}: UseGraphTreeParams) {
  const lastExpandedNodeId = useRef<null | string>(null);
  const previousSparqlConfigSerialized = useRef<string>(JSON.stringify(modelState.sparql));
  const [countByNodeId, setCountByNodeId] = useState<
    Record<string, { distinctCount: number; totalCount: number }>
  >({});
  const onSelectNode = useCallback(
    (idPath: Array<string>, count: boolean) => {
      function hasCountAncestor(path: Array<string>): boolean {
        return modelState.nodes.some((node) => {
          return (
            node.selected === "count" && node.id.length < path.length && hasPrefix(path, node.id)
          );
        });
      }

      function clearCountNodesIfNoSelection(nodes: Scenario["nodes"]): Scenario["nodes"] {
        if (nodes.some((node) => node.selected === "value")) {
          return nodes;
        }

        return nodes.map((node) => {
          if (node.selected !== "count") {
            return node;
          }

          return {
            ...node,
            selected: undefined,
          };
        });
      }

      const existingNodeIndex = modelState.nodes.findIndex((node) => {
        return areNodePathsEqual(node.id, idPath);
      });

      if (existingNodeIndex === -1) {
        if (count && hasCountAncestor(idPath)) {
          return;
        }

        dispatchModelState({
          payload: {
            nodes: [
              ...modelState.nodes,
              {
                ...createDefaultNodeState(idPath),
                selected: count ? "count" : "value",
              },
            ],
          },
          type: "state/setNodes",
        });
        return;
      }

      const clickedNode = modelState.nodes[existingNodeIndex]!;

      if (clickedNode.selected != null) {
        const nextNodes = clearCountNodesIfNoSelection(
          modelState.nodes.map((node, index) => {
            if (index !== existingNodeIndex) {
              return node;
            }

            return {
              ...node,
              selected: undefined,
            };
          }),
        );

        dispatchModelState({
          payload: { nodes: nextNodes },
          type: "state/setNodes",
        });
        return;
      }

      if (count && hasCountAncestor(idPath)) {
        return;
      }

      dispatchModelState({
        payload: {
          nodes: modelState.nodes.map((node, index) => {
            if (index !== existingNodeIndex) {
              return node;
            }

            return {
              ...node,
              selected: count ? "count" : "value",
            };
          }),
        },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes],
  );

  const onToggleTopOption = useCallback(
    (idPath: Array<string>, optionPath: Array<string>) => {
      if (pathbuilder == null) {
        return;
      }

      lastExpandedNodeId.current = idPath.join("");
      const isVisible = modelState.nodes.some((node) => areNodePathsEqual(node.id, optionPath));
      const nextNodes = isVisible
        ? removeVisibleSubtree(modelState.nodes, optionPath)
        : appendVisibleNodes(modelState.nodes, [optionPath]);

      dispatchModelState({
        payload: { nodes: nextNodes },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes, pathbuilder],
  );

  const onSetTopOptionsVisibility = useCallback(
    (idPath: Array<string>, optionPaths: Array<Array<string>>, visible: boolean) => {
      if (pathbuilder == null || optionPaths.length === 0) {
        return;
      }

      lastExpandedNodeId.current = idPath.join("");
      dispatchModelState({
        payload: {
          nodes: setOptionVisibility(modelState.nodes, optionPaths, visible),
        },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes, pathbuilder],
  );

  const onToggleBottomOption = useCallback(
    (idPath: Array<string>, optionPath: Array<string>) => {
      if (pathbuilder == null) {
        return;
      }

      lastExpandedNodeId.current = idPath.join("");
      const isVisible = modelState.nodes.some((node) => areNodePathsEqual(node.id, optionPath));
      const nextNodes = isVisible
        ? removeVisibleSubtree(modelState.nodes, optionPath)
        : appendVisibleNodes(modelState.nodes, [optionPath]);

      dispatchModelState({
        payload: { nodes: nextNodes },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes, pathbuilder],
  );

  const onSetBottomOptionsVisibility = useCallback(
    (idPath: Array<string>, optionPaths: Array<Array<string>>, visible: boolean) => {
      if (pathbuilder == null || optionPaths.length === 0) {
        return;
      }

      lastExpandedNodeId.current = idPath.join("");
      dispatchModelState({
        payload: {
          nodes: setOptionVisibility(modelState.nodes, optionPaths, visible),
        },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes, pathbuilder],
  );

  const graphWithoutCounts = useMemo(() => {
    const baseGraph = createGraphFromScenario(
      modelState,
      pathbuilder,
      onSetBottomOptionsVisibility,
      onToggleBottomOption,
      onSelectNode,
      onSetTopOptionsVisibility,
      onToggleTopOption,
    );

    const selectedNodeIds = modelState.nodes
      .filter((node) => node.selected === "value" || node.selected === "count")
      .map((node) => stringifyPath(node.id));
    const countNodeIds = modelState.nodes
      .filter((node) => node.selected === "count")
      .map((node) => stringifyPath(node.id));

    if (selectedNodeIds.length < 2) {
      return baseGraph;
    }

    const connectedSelectedEdgeIds = getConnectedSelectedEdgeIds(baseGraph.edges, selectedNodeIds);
    const greenEdgeIds = getGreenEdgeIds(
      connectedSelectedEdgeIds,
      countNodeIds,
      selectedNodeIds,
      baseGraph.edges,
    );

    return {
      ...baseGraph,
      edges: baseGraph.edges.map((edge) => {
        if (!connectedSelectedEdgeIds.has(edge.id)) {
          return edge;
        }

        const highlightColor = greenEdgeIds.has(edge.id)
          ? graphNodeBorderColors.count
          : graphEdgeColors.selectedSubgraph;

        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: highlightColor,
            strokeWidth: 2,
          },
        };
      }),
    };
  }, [
    modelState,
    onSelectNode,
    onSetBottomOptionsVisibility,
    onSetTopOptionsVisibility,
    onToggleBottomOption,
    onToggleTopOption,
    pathbuilder,
  ]);

  useEffect(() => {
    const currentSparqlConfigSerialized = JSON.stringify(modelState.sparql);

    if (previousSparqlConfigSerialized.current !== currentSparqlConfigSerialized) {
      previousSparqlConfigSerialized.current = currentSparqlConfigSerialized;
      setCountByNodeId({});
    }

    const visibleNodeIds = new Set(modelState.nodes.map((node) => stringifyPath(node.id)));

    setCountByNodeId((previousState) => {
      const nextState = Object.fromEntries(
        Object.entries(previousState).filter(([nodeId]) => visibleNodeIds.has(nodeId)),
      );

      return Object.keys(nextState).length === Object.keys(previousState).length
        ? previousState
        : nextState;
    });

    if (modelState.nodes.length === 0) {
      return;
    }

    const nodesNeedingCounts = modelState.nodes.filter((node) => {
      return countByNodeId[stringifyPath(node.id)] == null;
    });

    if (nodesNeedingCounts.length === 0) {
      return;
    }

    let isCancelled = false;

    void Promise.all(
      nodesNeedingCounts.map(async (node) => {
        const nodeId = stringifyPath(node.id);
        let counts: { distinctCount: number; totalCount: number };

        try {
          counts = await fetchCountForNodePath(pathbuilder, node.id, {
            sparql: modelState.sparql,
          });
        } catch {
          return;
        }

        if (isCancelled) {
          return;
        }

        setCountByNodeId((previousState) => {
          const previousCounts = previousState[nodeId];

          if (previousCounts == null) {
            return { ...previousState, [nodeId]: counts };
          }

          if (
            previousCounts.distinctCount === counts.distinctCount &&
            previousCounts.totalCount === counts.totalCount
          ) {
            return previousState;
          }

          return { ...previousState, [nodeId]: counts };
        });
      }),
    );

    return () => {
      isCancelled = true;
    };
  }, [countByNodeId, modelState.nodes, modelState.sparql, pathbuilder]);

  const graph = useMemo(() => {
    return {
      ...graphWithoutCounts,
      nodes: graphWithoutCounts.nodes.map((node) => {
        const nodeId = stringifyPath(node.data.id_array);

        return {
          ...node,
          data: {
            ...node.data,
            countDistinct: countByNodeId[nodeId]?.distinctCount,
            countTotal: countByNodeId[nodeId]?.totalCount,
          },
        };
      }),
    };
  }, [countByNodeId, graphWithoutCounts]);

  const rootNodeId = modelState.nodes[0]?.id.join("");

  return {
    expandedNodeId: lastExpandedNodeId.current,
    graph,
    rootNodeId,
  };
}
