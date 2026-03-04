import type { Edge } from "@xyflow/react";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createDefaultNodeState,
  isBottomExpanded,
  isTopExpanded,
  type Scenario,
  type ScenarioAction,
  withBottomExpanded,
  withTopExpanded,
} from "../../../scenario";
import type { Pathbuilder } from "../../../serializer/pathbuilder";
import { fetchCountForNodePath } from "../../../serializer/sparql-query";
import { graphEdgeColors, graphNodeBorderColors } from "../../../theme/colors";
import { createGraphFromScenario } from "../graph-layout";

interface UseGraphTreeParams {
  dispatchScenario: Dispatch<ScenarioAction>;
  scenario: Scenario;
  pathbuilder: null | Pathbuilder;
}

function stringifyPath(idPath: Array<string>): string {
  return idPath.join("");
}

function getConnectedSelectedEdgeIds(
  edges: Array<Edge>,
  selectedNodeIds: Array<string>,
): Set<string> {
  const edgeIds = new Set<string>();

  if (selectedNodeIds.length < 2) {
    return edgeIds;
  }

  const adjacency = new Map<
    string,
    Array<{ edgeId: string; nodeId: string }>
  >();

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
    const previousByNode = new Map<
      string,
      { edgeId: string; nodeId: string }
    >();

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

function getGreenEdgeIdsBehindCountNodes(
  connectedEdgeIds: Set<string>,
  countNodeIds: Array<string>,
  edges: Array<Edge>,
  rootNodeId?: string,
): Set<string> {
  const greenEdgeIds = new Set<string>();

  if (
    rootNodeId == null ||
    countNodeIds.length === 0 ||
    connectedEdgeIds.size === 0
  ) {
    return greenEdgeIds;
  }

  const adjacency = new Map<
    string,
    Array<{ edgeId: string; nodeId: string }>
  >();

  for (const edge of edges) {
    const sourceNeighbors = adjacency.get(edge.source) ?? [];
    sourceNeighbors.push({ edgeId: edge.id, nodeId: edge.target });
    adjacency.set(edge.source, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.target) ?? [];
    targetNeighbors.push({ edgeId: edge.id, nodeId: edge.source });
    adjacency.set(edge.target, targetNeighbors);
  }

  const queue = [rootNodeId];
  const visited = new Set([rootNodeId]);
  const depthByNode = new Map<string, number>([[rootNodeId, 0]]);
  const parentByNode = new Map<string, string>();

  while (queue.length > 0) {
    const currentNodeId = queue.shift()!;
    const neighbors = adjacency.get(currentNodeId) ?? [];

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.nodeId)) {
        continue;
      }

      visited.add(neighbor.nodeId);
      parentByNode.set(neighbor.nodeId, currentNodeId);
      depthByNode.set(
        neighbor.nodeId,
        (depthByNode.get(currentNodeId) ?? 0) + 1,
      );
      queue.push(neighbor.nodeId);
    }
  }

  function isDescendantOf(nodeId: string, ancestorId: string): boolean {
    let cursor: undefined | string = nodeId;

    while (cursor != null) {
      if (cursor === ancestorId) {
        return true;
      }

      cursor = parentByNode.get(cursor);
    }

    return false;
  }

  const connectedEdges = edges.filter((edge) => connectedEdgeIds.has(edge.id));

  for (const edge of connectedEdges) {
    const sourceDepth = depthByNode.get(edge.source);
    const targetDepth = depthByNode.get(edge.target);

    if (
      sourceDepth == null ||
      targetDepth == null ||
      sourceDepth === targetDepth
    ) {
      continue;
    }

    const childNodeId = sourceDepth > targetDepth ? edge.source : edge.target;
    const childDepth = Math.max(sourceDepth, targetDepth);

    for (const countNodeId of countNodeIds) {
      const countDepth = depthByNode.get(countNodeId);

      if (countDepth == null || childDepth <= countDepth) {
        continue;
      }

      if (isDescendantOf(childNodeId, countNodeId)) {
        greenEdgeIds.add(edge.id);
        break;
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
  const previousSparqlConfigSerialized = useRef<string>(
    JSON.stringify(modelState.sparql),
  );
  const [countByNodeId, setCountByNodeId] = useState<
    Record<string, { distinctCount: number; totalCount: number }>
  >({});
  const onSelectNode = useCallback(
    (idPath: Array<string>, count: boolean) => {
      function hasPrefix(path: Array<string>, prefix: Array<string>): boolean {
        if (path.length < prefix.length) {
          return false;
        }

        return prefix.every((part, index) => path[index] === part);
      }

      function hasCountAncestor(path: Array<string>): boolean {
        return modelState.nodes.some((node) => {
          return (
            node.selected === "count" &&
            node.id.length < path.length &&
            hasPrefix(path, node.id)
          );
        });
      }

      function clearCountNodesIfNoSelection(
        nodes: Scenario["nodes"],
      ): Scenario["nodes"] {
        if (nodes.some((node) => node.selected === "yes")) {
          return nodes;
        }

        return nodes.map((node) => {
          if (node.selected !== "count") {
            return node;
          }

          return {
            ...node,
            selected: "no",
          };
        });
      }

      const existingNodeIndex = modelState.nodes.findIndex((node) => {
        return (
          node.id.length === idPath.length &&
          node.id.every((nodeId, index) => nodeId === idPath[index])
        );
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
                selected: count ? "count" : "yes",
              },
            ],
          },
          type: "state/setNodes",
        });
        return;
      }

      const clickedNode = modelState.nodes[existingNodeIndex]!;

      if (clickedNode.selected !== "no") {
        const nextNodes = clearCountNodesIfNoSelection(
          modelState.nodes.map((node, index) => {
            if (index !== existingNodeIndex) {
              return node;
            }

            return {
              ...node,
              selected: "no",
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
              selected: count ? "count" : "yes",
            };
          }),
        },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes],
  );

  const onExpandTop = useCallback(
    (idPath: Array<string>) => {
      lastExpandedNodeId.current = idPath.join("");
      const existingNodeIndex = modelState.nodes.findIndex((node) => {
        return (
          node.id.length === idPath.length &&
          node.id.every((nodeId, index) => nodeId === idPath[index])
        );
      });

      if (existingNodeIndex === -1) {
        dispatchModelState({
          payload: {
            nodes: [
              ...modelState.nodes,
              { ...createDefaultNodeState(idPath), expanded: "top" },
            ],
          },
          type: "state/setNodes",
        });
        return;
      }

      const nextNodes = modelState.nodes.map((node, index) => {
        if (index !== existingNodeIndex) {
          return node;
        }

        return {
          ...withTopExpanded(node, !isTopExpanded(node)),
        };
      });

      dispatchModelState({
        payload: { nodes: nextNodes },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes],
  );

  const onExpandBottom = useCallback(
    (idPath: Array<string>) => {
      lastExpandedNodeId.current = idPath.join("");
      function hasPrefix(path: Array<string>, prefix: Array<string>): boolean {
        if (path.length < prefix.length) {
          return false;
        }

        return prefix.every((part, index) => path[index] === part);
      }

      const existingNodeIndex = modelState.nodes.findIndex((node) => {
        return (
          node.id.length === idPath.length &&
          node.id.every((nodeId, index) => nodeId === idPath[index])
        );
      });

      if (existingNodeIndex === -1) {
        dispatchModelState({
          payload: {
            nodes: [
              ...modelState.nodes,
              { ...createDefaultNodeState(idPath), expanded: "bottom" },
            ],
          },
          type: "state/setNodes",
        });
        return;
      }

      const targetNode = modelState.nodes[existingNodeIndex]!;

      if (isBottomExpanded(targetNode)) {
        const nextNodes = modelState.nodes
          .filter((node, index) => {
            if (index === existingNodeIndex) {
              return true;
            }

            return !(
              hasPrefix(node.id, idPath) && node.id.length > idPath.length
            );
          })
          .map((node, index) => {
            if (index !== existingNodeIndex) {
              return node;
            }

            return withBottomExpanded(node, false);
          });

        dispatchModelState({
          payload: { nodes: nextNodes },
          type: "state/setNodes",
        });
        return;
      }

      dispatchModelState({
        payload: {
          nodes: modelState.nodes.map((node, index) => {
            if (index !== existingNodeIndex) {
              return node;
            }

            return withBottomExpanded(node, true);
          }),
        },
        type: "state/setNodes",
      });
    },
    [dispatchModelState, modelState.nodes],
  );

  const graphWithoutCounts = useMemo(() => {
    const baseGraph = createGraphFromScenario(
      modelState,
      pathbuilder,
      onExpandBottom,
      onSelectNode,
      onExpandTop,
    );

    const selectedNodeIds = modelState.nodes
      .filter((node) => node.selected === "yes" || node.selected === "count")
      .map((node) => stringifyPath(node.id));
    const countNodeIds = modelState.nodes
      .filter((node) => node.selected === "count")
      .map((node) => stringifyPath(node.id));

    if (selectedNodeIds.length < 2) {
      return baseGraph;
    }

    const connectedSelectedEdgeIds = getConnectedSelectedEdgeIds(
      baseGraph.edges,
      selectedNodeIds,
    );
    const rootNodeId =
      modelState.nodes[0] == null
        ? undefined
        : stringifyPath(modelState.nodes[0].id);
    const greenEdgeIds = getGreenEdgeIdsBehindCountNodes(
      connectedSelectedEdgeIds,
      countNodeIds,
      baseGraph.edges,
      rootNodeId,
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
  }, [modelState, onExpandBottom, onExpandTop, onSelectNode, pathbuilder]);

  useEffect(() => {
    const currentSparqlConfigSerialized = JSON.stringify(modelState.sparql);

    if (previousSparqlConfigSerialized.current !== currentSparqlConfigSerialized) {
      previousSparqlConfigSerialized.current = currentSparqlConfigSerialized;
      setCountByNodeId({});
    }

    const visibleNodeIds = new Set(
      graphWithoutCounts.nodes.map((node) => stringifyPath(node.data.id_array)),
    );

    setCountByNodeId((previousState) => {
      const nextState = Object.fromEntries(
        Object.entries(previousState).filter(([nodeId]) =>
          visibleNodeIds.has(nodeId),
        ),
      );

      return Object.keys(nextState).length === Object.keys(previousState).length
        ? previousState
        : nextState;
    });

    if (graphWithoutCounts.nodes.length === 0) {
      return;
    }

    let isCancelled = false;

    void Promise.all(
      graphWithoutCounts.nodes.map(async (node) => {
        const nodeId = stringifyPath(node.data.id_array);
        let counts: { distinctCount: number; totalCount: number };

        try {
          counts = await fetchCountForNodePath(pathbuilder, node.data.id_array, {
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

          if (
            previousCounts?.distinctCount === counts.distinctCount &&
            previousCounts?.totalCount === counts.totalCount
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
  }, [graphWithoutCounts.nodes, modelState.sparql, pathbuilder]);

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
